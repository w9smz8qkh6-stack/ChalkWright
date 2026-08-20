import { loadProductionServerConfig } from '../config/production.js';
import { isIsoDate } from '../domain/runtime-validation.js';
import { isDirectEntrypoint } from './direct-invocation.js';
import type { PowerSchoolJitRepairSupervisorOutput } from './powerschool-jit-repair.js';
import { runPowerSchoolJitRepairSupervisor } from './powerschool-jit-repair.js';

export interface M17PowerSchoolRepairOutput {
  readonly exitCode: number;
  readonly status: 'authenticated' | 'rejected' | 'failed';
  readonly code?: string;
  readonly phoneApprovalObserved?: boolean;
}

/**
 * Compose the isolated JIT worker for the canary's current local date.
 * This entrypoint owns no timer and cannot be imported by routine plan jobs.
 */
export async function runM17PowerSchoolRepair(options: {
  readonly arguments: readonly string[];
  readonly environment?: NodeJS.ProcessEnv;
  readonly now?: () => string;
  readonly supervisor?: typeof runPowerSchoolJitRepairSupervisor;
  readonly signal?: AbortSignal;
}): Promise<M17PowerSchoolRepairOutput> {
  if (options.arguments.length !== 0)
    return {
      exitCode: 64,
      status: 'rejected',
      code: 'm17-repair-usage-invalid',
    };
  const environment = options.environment ?? process.env;
  const date = repairDate(environment, options.now);
  if (date === undefined)
    return {
      exitCode: 64,
      status: 'rejected',
      code: 'm17-repair-config-invalid',
    };
  const output = await (
    options.supervisor ?? runPowerSchoolJitRepairSupervisor
  )({
    arguments: ['--operator-present', '--persistent-compatibility', date],
    environment,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  return sanitize(output);
}

function repairDate(
  environment: NodeJS.ProcessEnv,
  now: (() => string) | undefined,
): string | undefined {
  const supplied = environment.CHALKWRIGHT_M17_REPAIR_DATE;
  if (supplied !== undefined) return isIsoDate(supplied) ? supplied : undefined;
  try {
    const reference = environment.CLASSROOM_HUB_PRODUCTION_CONFIG_REFERENCE;
    if (reference === undefined || reference.length === 0)
      throw new Error('config');
    return localDate(
      (now ?? (() => new Date().toISOString()))(),
      loadProductionServerConfig(reference).timeZone,
    );
  } catch {
    return undefined;
  }
}

function localDate(instant: string, timeZone: string): string {
  const epoch = Date.parse(instant);
  if (!Number.isFinite(epoch)) throw new Error('instant');
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(epoch));
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  const date = `${values.year}-${values.month}-${values.day}`;
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) throw new Error('date');
  return date;
}

function sanitize(
  output: PowerSchoolJitRepairSupervisorOutput,
): M17PowerSchoolRepairOutput {
  if ('result' in output) {
    return output.result.status === 'authenticated'
      ? {
          exitCode: output.exitCode,
          status: 'authenticated',
          phoneApprovalObserved: output.result.phoneApprovalObserved,
        }
      : {
          exitCode: output.exitCode,
          status: 'failed',
          code:
            output.result.code === 'unexpected-challenge'
              ? `unexpected-challenge-${output.result.challengeCategory}`
              : output.result.code === 'repair-policy-violation'
                ? `repair-policy-violation-${output.result.policyReason}`
                : output.result.code,
        };
  }
  return {
    exitCode: output.exitCode,
    status: 'rejected',
    code: output.errorCode ?? 'repair-worker-invalid',
  };
}

async function main(): Promise<void> {
  const controller = new AbortController();
  const interrupt = (): void => controller.abort('process-signal');
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  try {
    const output = await runM17PowerSchoolRepair({
      arguments: process.argv.slice(2),
      signal: controller.signal,
    });
    process.stdout.write(`${JSON.stringify(output)}\n`);
    process.exitCode = output.exitCode;
  } finally {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
  }
}

if (isDirectEntrypoint(import.meta.url, process.argv[1])) void main();
