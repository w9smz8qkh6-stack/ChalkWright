import { createPlanRefreshJobHandler } from '../application/integration/plan-refresh-handler.js';
import { loadPowerSchoolCompatibilityConfig } from '../config/powerschool-session.js';
import type { ScheduleObservation } from '../contracts/v1/schedule.js';
import type {
  ObservationReadResult,
  ScheduleObservationSource,
} from '../ports/read-sources.js';
import { isDirectEntrypoint } from './direct-invocation.js';
import {
  powerSchoolCompatibilitySupervisorCleanupMs,
  runPowerSchoolCompatibilityBellSupervisor,
} from './powerschool-compatibility-bell-collector.js';
import {
  rejectAmbientProductionAuthority,
  runProductionJobRuntime,
  type ProductionJobEntrypointOutput,
  type ProductionJobRuntimeContext,
} from './production-job-runtime.js';

/**
 * Reads the exact PowerSchool schedule through Chalkwright's dedicated retained
 * browser profile. The profile can silently renew an existing browser-bound
 * session, but this entrypoint has no credentials, 1Password references,
 * repair callback, form-filling API, or legacy-application dependency.
 */
export async function runProductionRetainedPlanRefresh(options: {
  readonly arguments: readonly string[];
  readonly environment?: NodeJS.ProcessEnv;
  readonly signal?: AbortSignal;
  readonly hardStop: () => never;
  readonly now?: () => string;
  readonly nextId?: () => string;
  readonly sourceForRun?: (
    context: ProductionJobRuntimeContext,
    signal: AbortSignal,
    environment: NodeJS.ProcessEnv,
  ) => ScheduleObservationSource;
  readonly retainedRead?: typeof runPowerSchoolCompatibilityBellSupervisor;
}): Promise<ProductionJobEntrypointOutput> {
  return runProductionJobRuntime({
    ...options,
    // The child supervisor may consume 2 s of graceful termination and 1 s
    // proving post-SIGKILL process-group quiescence. The parent must remain
    // alive beyond that complete cleanup contract.
    hardStopGraceMs: powerSchoolCompatibilitySupervisorCleanupMs + 500,
    jobName: 'source-auth-preflight',
    handler: (context, environment) => {
      rejectAmbientProductionAuthority(environment, [
        'CLASSROOM_HUB_CLASSROOM_',
        'CLASSROOM_HUB_CALENDAR_',
        'CLASSROOM_HUB_ALERT_DELIVERY_REFERENCE',
        'CLASSROOM_HUB_M15_',
        'CLASSROOM_HUB_POWERSCHOOL_REPAIR_',
        'CLASSROOM_HUB_POWERSCHOOL_ONEPASSWORD_',
        'OP_SERVICE_ACCOUNT_TOKEN',
      ]);
      const powerSchool = loadPowerSchoolCompatibilityConfig(environment);
      if (powerSchool.roomId !== context.production.roomId)
        throw new Error('production-powerschool-room-mismatch');
      return createPlanRefreshJobHandler({
        config: context.production,
        plans: context.state,
        evidencePrefix: 'production',
        futureClassDayLookaheadDays: 7,
        sourceForRun: (signal) =>
          options.sourceForRun?.(context, signal, environment) ??
          supervisedRetainedSource({
            environment,
            signal,
            run:
              options.retainedRead ?? runPowerSchoolCompatibilityBellSupervisor,
          }),
      });
    },
  });
}

function supervisedRetainedSource(options: {
  readonly environment: NodeJS.ProcessEnv;
  readonly signal: AbortSignal;
  readonly run: typeof runPowerSchoolCompatibilityBellSupervisor;
}): ScheduleObservationSource {
  return {
    readSchedule: async (request) => {
      const output = await options.run({
        arguments: [request.date],
        environment: options.environment,
        signal: options.signal,
      });
      return output.result ?? retainedSupervisorFailure(output.errorCode);
    },
  };
}

function retainedSupervisorFailure(
  code: string | undefined,
): ObservationReadResult<ScheduleObservation> {
  return {
    status: 'failed',
    error: {
      category: 'internal',
      code:
        code === 'collector-config-invalid' ||
        code === 'collector-usage-invalid'
          ? code
          : 'collector-output-invalid',
      message:
        'The supervised retained-profile reader failed before producing a schedule observation.',
      retryable: false,
      diagnostics: [],
    },
  };
}

async function main(): Promise<void> {
  const controller = new AbortController();
  const interrupt = (): void => controller.abort('process-signal');
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  const output = await runProductionRetainedPlanRefresh({
    arguments: process.argv.slice(2),
    signal: controller.signal,
    hardStop: () => process.exit(124),
  });
  process.removeListener('SIGINT', interrupt);
  process.removeListener('SIGTERM', interrupt);
  process.stdout.write(
    `${JSON.stringify({ status: output.status, ...(output.code === undefined ? {} : { code: output.code }) })}\n`,
  );
  process.exitCode = output.exitCode;
}

const invokedPath = process.argv[1];
if (isDirectEntrypoint(import.meta.url, invokedPath)) void main();
