import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  loadPowerSchoolBootstrapConfig,
  parsePowerSchoolDate,
  powerSchoolBootstrapEnvironmentNames,
} from '../config/powerschool-session.js';
import { runQuiescentChild } from '../infrastructure/process/quiescent-child.js';
import type { PowerSchoolBootstrapWorkerOutput } from './powerschool-session-bootstrap-child.js';

export async function runPowerSchoolBootstrapSupervisor(options: {
  readonly arguments: readonly string[];
  readonly environment?: NodeJS.ProcessEnv;
  readonly childRunner?: typeof runQuiescentChild;
  readonly signal?: AbortSignal;
}): Promise<PowerSchoolBootstrapWorkerOutput> {
  try {
    if (options.arguments.length !== 1) throw new Error('usage');
    parsePowerSchoolDate(options.arguments[0]);
  } catch {
    return { exitCode: 64, errorCode: 'bootstrap-usage-invalid' };
  }
  const environment = options.environment ?? process.env;
  let config;
  try {
    config = loadPowerSchoolBootstrapConfig(environment);
  } catch {
    return { exitCode: 64, errorCode: 'bootstrap-config-invalid' };
  }
  const worker = fileURLToPath(
    new URL('./powerschool-session-bootstrap-child.js', import.meta.url),
  );
  const result = await (options.childRunner ?? runQuiescentChild)({
    executable: process.execPath,
    arguments: [worker, options.arguments[0]!],
    cwd: resolve(dirname(worker), '../..'),
    environment: childEnvironment(environment),
    deadlineMs: config.overallTimeoutMs,
    terminationGraceMs: 1_000,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  if (result.status !== 'completed') {
    return {
      exitCode: 1,
      result: {
        status: 'failed',
        code:
          result.code === 'child-deadline-exceeded'
            ? 'timeout'
            : 'browser-unavailable',
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
    ...powerSchoolBootstrapEnvironmentNames,
  ]) {
    const value = source[name];
    if (value !== undefined) output[name] = value;
  }
  return output;
}

function parseWorkerOutput(output: string): PowerSchoolBootstrapWorkerOutput {
  try {
    const parsed: unknown = JSON.parse(output);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'exitCode' in parsed &&
      typeof parsed.exitCode === 'number'
    ) {
      return parsed as PowerSchoolBootstrapWorkerOutput;
    }
  } catch {
    // The fixed child contract is fail-closed below.
  }
  return {
    exitCode: 1,
    result: { status: 'failed', code: 'browser-unavailable' },
  };
}

async function main(): Promise<void> {
  const controller = new AbortController();
  const interrupt = (): void => controller.abort('process-signal');
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  try {
    const output = await runPowerSchoolBootstrapSupervisor({
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
