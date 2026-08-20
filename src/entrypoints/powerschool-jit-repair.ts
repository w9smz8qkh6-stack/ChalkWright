import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  loadPowerSchoolRepairReferences,
  powerSchoolJitHeadlessEnvironmentName,
  powerSchoolRepairReferenceEnvironmentName,
} from '../config/powerschool-repair.js';
import {
  loadPowerSchoolBootstrapConfig,
  loadPowerSchoolPersistentProfileDirectory,
  parsePowerSchoolDate,
  powerSchoolBootstrapEnvironmentNames,
  powerSchoolCompatibilityProfileEnvironmentName,
} from '../config/powerschool-session.js';
import {
  destroyPowerSchoolRepairSecrets,
  readPowerSchoolRepairSecrets,
} from '../infrastructure/one-password/powerschool-repair-secrets.js';
import {
  loadPowerSchoolOnePasswordServiceAccountToken,
  powerSchoolOnePasswordServiceAccountEnvironmentName,
} from '../infrastructure/one-password/service-account-authority.js';
import { encodePowerSchoolRepairSecretPacket } from '../infrastructure/powerschool-session/repair-secret-packet.js';
import { runQuiescentChild } from '../infrastructure/process/quiescent-child.js';
import type { PowerSchoolJitRepairWorkerOutput } from './powerschool-jit-repair-child.js';

export type PowerSchoolJitRepairSupervisorOutput =
  | PowerSchoolJitRepairWorkerOutput
  | {
      readonly exitCode: 64 | 69;
      readonly errorCode:
        | 'repair-config-invalid'
        | 'repair-secret-unavailable'
        | 'repair-usage-invalid';
    };

export async function runPowerSchoolJitRepairSupervisor(options: {
  readonly arguments: readonly string[];
  readonly environment?: NodeJS.ProcessEnv;
  readonly childRunner?: typeof runQuiescentChild;
  readonly secretReader?: typeof readPowerSchoolRepairSecrets;
  readonly signal?: AbortSignal;
}): Promise<PowerSchoolJitRepairSupervisorOutput> {
  const startedAt = performance.now();
  let date: string;
  let persistentCompatibility = false;
  try {
    if (options.arguments[0] !== '--operator-present') {
      throw new Error('usage');
    }
    if (
      options.arguments.length === 3 &&
      options.arguments[1] === '--persistent-compatibility'
    ) {
      persistentCompatibility = true;
      date = parsePowerSchoolDate(options.arguments[2]);
    } else {
      if (options.arguments.length !== 2) throw new Error('usage');
      date = parsePowerSchoolDate(options.arguments[1]);
    }
  } catch {
    return { exitCode: 64, errorCode: 'repair-usage-invalid' };
  }
  const environment = options.environment ?? process.env;
  let bootstrapConfig;
  let references;
  let headlessRepair: boolean;
  try {
    bootstrapConfig = loadPowerSchoolBootstrapConfig(environment);
    references = loadPowerSchoolRepairReferences(environment);
    headlessRepair = resolveHeadlessRepair(environment);
    if (persistentCompatibility)
      loadPowerSchoolPersistentProfileDirectory(environment);
  } catch {
    return { exitCode: 64, errorCode: 'repair-config-invalid' };
  }
  const initialRemainingMs = remainingBudget(
    bootstrapConfig.overallTimeoutMs,
    startedAt,
  );
  if (initialRemainingMs < 1) {
    return {
      exitCode: 1,
      result: { status: 'failed', code: 'timeout' },
    };
  }
  const timeoutSignal = AbortSignal.timeout(initialRemainingMs);
  const operationSignal =
    options.signal === undefined
      ? timeoutSignal
      : AbortSignal.any([options.signal, timeoutSignal]);
  let serviceAccountToken: Buffer | undefined;
  try {
    serviceAccountToken =
      loadPowerSchoolOnePasswordServiceAccountToken(environment);
  } catch {
    return { exitCode: 69, errorCode: 'repair-secret-unavailable' };
  }
  let secrets;
  try {
    secrets = await (options.secretReader ?? readPowerSchoolRepairSecrets)({
      references,
      environment,
      ...(serviceAccountToken === undefined ? {} : { serviceAccountToken }),
      signal: operationSignal,
    });
  } catch {
    if (operationSignal.aborted) {
      return {
        exitCode: 1,
        result: {
          status: 'failed',
          code: abortedByTimeout(operationSignal, timeoutSignal)
            ? 'timeout'
            : 'aborted',
        },
      };
    }
    return { exitCode: 69, errorCode: 'repair-secret-unavailable' };
  } finally {
    serviceAccountToken?.fill(0);
  }
  let packet: Buffer;
  try {
    packet = encodePowerSchoolRepairSecretPacket(secrets);
  } finally {
    destroyPowerSchoolRepairSecrets(secrets);
  }
  const childDeadlineMs = remainingBudget(
    bootstrapConfig.overallTimeoutMs,
    startedAt,
  );
  const childTimeoutSeconds = Math.floor(childDeadlineMs / 1_000);
  if (childTimeoutSeconds < 30) {
    packet.fill(0);
    return {
      exitCode: 1,
      result: { status: 'failed', code: 'timeout' },
    };
  }
  const worker = fileURLToPath(
    new URL('./powerschool-jit-repair-child.js', import.meta.url),
  );
  let result;
  try {
    result = await (options.childRunner ?? runQuiescentChild)({
      executable: process.execPath,
      arguments: [
        worker,
        ...(persistentCompatibility ? ['--persistent-compatibility'] : []),
        date,
      ],
      cwd: resolve(dirname(worker), '../..'),
      environment: childEnvironment(
        environment,
        childTimeoutSeconds,
        headlessRepair,
        persistentCompatibility,
      ),
      deadlineMs: childDeadlineMs,
      terminationGraceMs: 2_000,
      input: packet,
      signal: operationSignal,
    });
  } catch {
    packet.fill(0);
    return {
      exitCode: 1,
      result: { status: 'failed', code: 'browser-unavailable' },
    };
  }
  if (result.status !== 'completed') {
    return {
      exitCode: 1,
      result: {
        status: 'failed',
        code:
          result.code === 'child-deadline-exceeded' ||
          abortedByTimeout(operationSignal, timeoutSignal)
            ? 'timeout'
            : result.code === 'child-interrupted'
              ? 'aborted'
              : 'browser-unavailable',
      },
    };
  }
  return parseWorkerOutput(result.output);
}

function childEnvironment(
  source: NodeJS.ProcessEnv,
  bootstrapTimeoutSeconds: number,
  headlessRepair: boolean,
  persistentCompatibility: boolean,
): Record<string, string> {
  const output: Record<string, string> = {};
  for (const name of [
    'DBUS_SESSION_BUS_ADDRESS',
    'DISPLAY',
    'FONTCONFIG_PATH',
    'HOME',
    'LANG',
    'PATH',
    'TMPDIR',
    'TZ',
    'WAYLAND_DISPLAY',
    'XAUTHORITY',
    'XDG_RUNTIME_DIR',
    ...powerSchoolBootstrapEnvironmentNames,
    ...(persistentCompatibility
      ? [powerSchoolCompatibilityProfileEnvironmentName]
      : []),
  ]) {
    const value = source[name];
    if (value !== undefined) output[name] = value;
  }
  delete output[powerSchoolRepairReferenceEnvironmentName];
  delete output[powerSchoolOnePasswordServiceAccountEnvironmentName];
  output.CLASSROOM_HUB_POWERSCHOOL_BOOTSTRAP_TIMEOUT_SECONDS = String(
    bootstrapTimeoutSeconds,
  );
  output[powerSchoolJitHeadlessEnvironmentName] = headlessRepair ? '1' : '0';
  return output;
}

/**
 * The service-account repair retains its original headless default. A
 * root-owned production unit may explicitly request a headed Chrome context
 * only for the dedicated, authenticated repair display; routine jobs never
 * reach this supervisor.
 */
function resolveHeadlessRepair(source: NodeJS.ProcessEnv): boolean {
  const configured = source[powerSchoolJitHeadlessEnvironmentName];
  if (configured === undefined) {
    return (
      source[powerSchoolOnePasswordServiceAccountEnvironmentName] !== undefined
    );
  }
  if (configured === '0') return false;
  if (configured === '1') return true;
  throw new Error('powerschool-repair-config-invalid');
}

function remainingBudget(overallMs: number, startedAt: number): number {
  return Math.max(0, Math.floor(overallMs - (performance.now() - startedAt)));
}

function abortedByTimeout(
  operationSignal: AbortSignal,
  timeoutSignal: AbortSignal,
): boolean {
  return (
    timeoutSignal.aborted && operationSignal.reason === timeoutSignal.reason
  );
}

function parseWorkerOutput(output: string): PowerSchoolJitRepairWorkerOutput {
  try {
    const parsed: unknown = JSON.parse(output);
    if (isWorkerOutput(parsed)) return parsed;
  } catch {
    // Fixed child output fails closed below.
  }
  return {
    exitCode: 1,
    result: { status: 'failed', code: 'browser-unavailable' },
  };
}

function isWorkerOutput(
  value: unknown,
): value is PowerSchoolJitRepairWorkerOutput {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort().join(',');
  if (keys === 'errorCode,exitCode') {
    return (
      record.exitCode === 64 &&
      (record.errorCode === 'repair-config-invalid' ||
        record.errorCode === 'repair-input-invalid' ||
        record.errorCode === 'repair-usage-invalid')
    );
  }
  if (keys !== 'exitCode,result' || !isRepairResult(record.result))
    return false;
  return (
    (record.exitCode === 0 && record.result.status === 'authenticated') ||
    (record.exitCode === 1 && record.result.status === 'failed')
  );
}

function isRepairResult(
  value: unknown,
): value is NonNullable<PowerSchoolJitRepairWorkerOutput['result']> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return false;
  const record = value as Record<string, unknown>;
  if (record.status === 'authenticated') {
    return (
      Object.keys(record).sort().join(',') === 'phoneApprovalObserved,status' &&
      typeof record.phoneApprovalObserved === 'boolean'
    );
  }
  if (record.status === 'failed' && record.code === 'unexpected-challenge') {
    return (
      Object.keys(record).sort().join(',') ===
        'challengeCategory,code,status' &&
      [
        'account-choice-ambiguous',
        'account-verification-required',
        'browser-rejected',
        'captcha-required',
        'passkey-or-security-key-required',
        'recovery-required',
        'selection-unrecognized',
        'unclassified',
      ].includes(String(record.challengeCategory))
    );
  }
  return (
    record.status === 'failed' &&
    Object.keys(record).sort().join(',') === 'code,status' &&
    [
      'aborted',
      'browser-launch-closed',
      'browser-launch-failed',
      'browser-launch-timeout',
      'browser-unavailable',
      'collector-already-running',
      'credential-rejected',
      'repair-policy-violation',
      'session-state-unsafe',
      'timeout',
    ].includes(String(record.code))
  );
}

async function main(): Promise<void> {
  const controller = new AbortController();
  const interrupt = (): void => controller.abort('process-signal');
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  try {
    const output = await runPowerSchoolJitRepairSupervisor({
      arguments: process.argv.slice(2),
      signal: controller.signal,
    });
    process.stdout.write(
      `${JSON.stringify(
        'result' in output
          ? output.result
          : { status: 'rejected', code: output.errorCode },
      )}\n`,
    );
    process.exitCode = output.exitCode;
  } finally {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
  }
}

const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  import.meta.url === pathToFileURL(resolve(invokedPath)).href
) {
  void main();
}
