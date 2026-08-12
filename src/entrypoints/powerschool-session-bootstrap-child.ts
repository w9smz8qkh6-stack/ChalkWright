import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  loadPowerSchoolBootstrapConfig,
  parsePowerSchoolDate,
  powerSchoolOperationTimeoutMs,
} from '../config/powerschool-session.js';
import type { IsoDate } from '../contracts/v1/common.js';
import {
  bootstrapPowerSchoolSession,
  type PowerSchoolBootstrapResult,
} from '../infrastructure/powerschool-session/manual-bootstrap.js';

export interface PowerSchoolBootstrapWorkerOutput {
  readonly exitCode: number;
  readonly result?: PowerSchoolBootstrapResult;
  readonly errorCode?: 'bootstrap-config-invalid' | 'bootstrap-usage-invalid';
}

export async function runPowerSchoolBootstrapWorker(options: {
  readonly arguments: readonly string[];
  readonly environment?: NodeJS.ProcessEnv;
  readonly signal?: AbortSignal;
  readonly bootstrap?: typeof bootstrapPowerSchoolSession;
}): Promise<PowerSchoolBootstrapWorkerOutput> {
  let date: IsoDate;
  try {
    if (options.arguments.length !== 1) throw new Error('usage');
    date = parsePowerSchoolDate(options.arguments[0]) as IsoDate;
  } catch {
    return { exitCode: 64, errorCode: 'bootstrap-usage-invalid' };
  }
  const environment = options.environment ?? process.env;
  scrubForbiddenAuthority(environment);
  let config;
  try {
    config = loadPowerSchoolBootstrapConfig(environment);
    config = {
      ...config,
      overallTimeoutMs: powerSchoolOperationTimeoutMs(config.overallTimeoutMs),
    };
  } catch {
    return { exitCode: 64, errorCode: 'bootstrap-config-invalid' };
  }
  const result = await (options.bootstrap ?? bootstrapPowerSchoolSession)({
    config,
    requestedDate: date,
    browserEnvironment: environment,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  return {
    exitCode: result.status === 'authenticated' ? 0 : 1,
    result,
  };
}

function scrubForbiddenAuthority(environment: NodeJS.ProcessEnv): void {
  for (const name of [
    'CLASSROOM_HUB_POWERSCHOOL_GOOGLE_USERNAME',
    'CLASSROOM_HUB_POWERSCHOOL_GOOGLE_PASSWORD',
    'CLASSROOM_HUB_POWERSCHOOL_GOOGLE_TOTP',
    'OP_SERVICE_ACCOUNT_TOKEN',
  ]) {
    delete environment[name];
  }
}

async function main(): Promise<void> {
  const controller = new AbortController();
  const interrupt = (): void => controller.abort('process-signal');
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  const output = await runPowerSchoolBootstrapWorker({
    arguments: process.argv.slice(2),
    signal: controller.signal,
  });
  process.removeListener('SIGINT', interrupt);
  process.removeListener('SIGTERM', interrupt);
  process.send?.(JSON.stringify(output));
}

const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  import.meta.url === pathToFileURL(resolve(invokedPath)).href
) {
  void main();
}
