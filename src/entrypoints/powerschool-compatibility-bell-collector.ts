import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  loadPowerSchoolCompatibilityConfig,
  parsePowerSchoolDate,
  powerSchoolCompatibilityEnvironmentNames,
} from '../config/powerschool-session.js';
import { runQuiescentChild } from '../infrastructure/process/quiescent-child.js';
import type { PowerSchoolCompatibilityBellWorkerOutput } from './powerschool-compatibility-bell-collector-child.js';

export const powerSchoolCompatibilitySupervisorCleanupMs = 3_000;

export async function runPowerSchoolCompatibilityBellSupervisor(options: {
  readonly arguments: readonly string[];
  readonly environment?: NodeJS.ProcessEnv;
  readonly childRunner?: typeof runQuiescentChild;
  readonly signal?: AbortSignal;
}): Promise<PowerSchoolCompatibilityBellWorkerOutput> {
  try {
    if (options.arguments.length !== 1) throw new Error('usage');
    parsePowerSchoolDate(options.arguments[0]);
  } catch {
    return { exitCode: 64, errorCode: 'collector-usage-invalid' };
  }
  const environment = options.environment ?? process.env;
  let config;
  try {
    config = loadPowerSchoolCompatibilityConfig(environment);
  } catch {
    return { exitCode: 64, errorCode: 'collector-config-invalid' };
  }
  const worker = fileURLToPath(
    new URL(
      './powerschool-compatibility-bell-collector-child.js',
      import.meta.url,
    ),
  );
  const result = await (options.childRunner ?? runQuiescentChild)({
    executable: process.execPath,
    arguments: [worker, options.arguments[0]!],
    cwd: resolve(dirname(worker), '../..'),
    environment: childEnvironment(environment),
    deadlineMs: config.overallTimeoutMs,
    terminationGraceMs: 2_000,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  if (result.status !== 'completed') {
    return {
      exitCode: 1,
      result: {
        status: 'failed',
        error: {
          category:
            result.code === 'child-deadline-exceeded'
              ? 'timeout'
              : 'unavailable',
          code: result.code,
          message:
            'The supervised persistent PowerSchool compatibility collector did not complete safely.',
          retryable: false,
          diagnostics: [],
        },
      },
    };
  }
  return parseWorkerOutput(result.output);
}

function childEnvironment(source: NodeJS.ProcessEnv): Record<string, string> {
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
    ...powerSchoolCompatibilityEnvironmentNames,
  ]) {
    const value = source[name];
    if (value !== undefined) output[name] = value;
  }
  return output;
}

function parseWorkerOutput(
  output: string,
): PowerSchoolCompatibilityBellWorkerOutput {
  try {
    const parsed: unknown = JSON.parse(output);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'exitCode' in parsed &&
      typeof parsed.exitCode === 'number'
    ) {
      return parsed as PowerSchoolCompatibilityBellWorkerOutput;
    }
  } catch {
    // The fixed child contract is fail-closed below.
  }
  return {
    exitCode: 1,
    result: {
      status: 'failed',
      error: {
        category: 'internal',
        code: 'collector-output-invalid',
        message:
          'The supervised persistent compatibility collector returned an invalid result.',
        retryable: false,
        diagnostics: [],
      },
    },
  };
}

async function main(): Promise<void> {
  const controller = new AbortController();
  const interrupt = (): void => controller.abort('process-signal');
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  try {
    const output = await runPowerSchoolCompatibilityBellSupervisor({
      arguments: process.argv.slice(2),
      signal: controller.signal,
    });
    process.stdout.write(
      `${JSON.stringify(output.result ?? { status: 'rejected', code: output.errorCode })}\n`,
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
