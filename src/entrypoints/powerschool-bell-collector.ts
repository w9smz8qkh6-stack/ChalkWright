import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  loadPowerSchoolRoutineConfig,
  parsePowerSchoolDate,
  powerSchoolRoutineEnvironmentNames,
} from '../config/powerschool-session.js';
import { runQuiescentChild } from '../infrastructure/process/quiescent-child.js';
import type { PowerSchoolBellWorkerOutput } from './powerschool-bell-collector-child.js';

export async function runPowerSchoolBellSupervisor(options: {
  readonly arguments: readonly string[];
  readonly environment?: NodeJS.ProcessEnv;
  readonly childRunner?: typeof runQuiescentChild;
  readonly signal?: AbortSignal;
}): Promise<PowerSchoolBellWorkerOutput> {
  try {
    if (options.arguments.length !== 1) throw new Error('usage');
    parsePowerSchoolDate(options.arguments[0]);
  } catch {
    return { exitCode: 64, errorCode: 'collector-usage-invalid' };
  }
  const environment = options.environment ?? process.env;
  let config;
  try {
    config = loadPowerSchoolRoutineConfig(environment);
  } catch {
    return { exitCode: 64, errorCode: 'collector-config-invalid' };
  }
  const worker = fileURLToPath(
    new URL('./powerschool-bell-collector-child.js', import.meta.url),
  );
  const result = await (options.childRunner ?? runQuiescentChild)({
    executable: process.execPath,
    arguments: [worker, options.arguments[0]!],
    cwd: resolve(dirname(worker), '../..'),
    environment: childEnvironment(
      environment,
      powerSchoolRoutineEnvironmentNames,
    ),
    deadlineMs: config.overallTimeoutMs,
    terminationGraceMs: 1_000,
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
            'The supervised PowerSchool collector did not complete safely.',
          retryable: false,
          diagnostics: [],
        },
      },
    };
  }
  return parseWorkerOutput(result.output);
}

function childEnvironment(
  source: NodeJS.ProcessEnv,
  names: readonly string[],
): Record<string, string> {
  const output: Record<string, string> = {};
  for (const name of [
    'FONTCONFIG_PATH',
    'HOME',
    'LANG',
    'PATH',
    'TMPDIR',
    'TZ',
    ...names,
  ]) {
    const value = source[name];
    if (value !== undefined) output[name] = value;
  }
  return output;
}

function parseWorkerOutput(output: string): PowerSchoolBellWorkerOutput {
  try {
    const parsed: unknown = JSON.parse(output);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'exitCode' in parsed &&
      typeof parsed.exitCode === 'number'
    ) {
      return parsed as PowerSchoolBellWorkerOutput;
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
        message: 'The supervised collector returned an invalid result.',
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
    const output = await runPowerSchoolBellSupervisor({
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
