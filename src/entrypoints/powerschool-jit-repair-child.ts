import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { powerSchoolJitHeadlessEnvironmentName } from '../config/powerschool-repair.js';
import {
  loadPowerSchoolBootstrapConfig,
  loadPowerSchoolPersistentProfileDirectory,
  parsePowerSchoolDate,
  powerSchoolCompatibilityProfileEnvironmentName,
  powerSchoolOperationTimeoutMs,
} from '../config/powerschool-session.js';
import type { IsoDate } from '../contracts/v1/common.js';
import {
  repairPowerSchoolSessionWithCredentials,
  type PowerSchoolJitRepairResult,
} from '../infrastructure/powerschool-session/jit-repair-browser.js';
import { decodePowerSchoolRepairSecretPacket } from '../infrastructure/powerschool-session/repair-secret-packet.js';

const maximumPacketBytes = 16 * 1024;

export interface PowerSchoolJitRepairWorkerOutput {
  readonly exitCode: number;
  readonly result?: PowerSchoolJitRepairResult;
  readonly errorCode?:
    'repair-config-invalid' | 'repair-input-invalid' | 'repair-usage-invalid';
}

export async function runPowerSchoolJitRepairWorker(options: {
  readonly arguments: readonly string[];
  readonly packet: Buffer;
  readonly environment?: NodeJS.ProcessEnv;
  readonly signal?: AbortSignal;
  readonly repair?: typeof repairPowerSchoolSessionWithCredentials;
}): Promise<PowerSchoolJitRepairWorkerOutput> {
  let date: IsoDate;
  let persistentCompatibility = false;
  try {
    if (
      options.arguments.length === 2 &&
      options.arguments[0] === '--persistent-compatibility'
    ) {
      persistentCompatibility = true;
      date = parsePowerSchoolDate(options.arguments[1]) as IsoDate;
    } else {
      if (options.arguments.length !== 1) throw new Error('usage');
      date = parsePowerSchoolDate(options.arguments[0]) as IsoDate;
    }
  } catch {
    options.packet.fill(0);
    return { exitCode: 64, errorCode: 'repair-usage-invalid' };
  }
  const environment = options.environment ?? process.env;
  const headlessSetting = environment[powerSchoolJitHeadlessEnvironmentName];
  if (
    headlessSetting !== undefined &&
    headlessSetting !== '0' &&
    headlessSetting !== '1'
  ) {
    options.packet.fill(0);
    return { exitCode: 64, errorCode: 'repair-config-invalid' };
  }
  const headless = headlessSetting === '1';
  let persistentProfileDirectory: string | undefined;
  let config;
  try {
    config = loadPowerSchoolBootstrapConfig(environment);
    if (persistentCompatibility) {
      persistentProfileDirectory =
        loadPowerSchoolPersistentProfileDirectory(environment);
    }
    config = {
      ...config,
      overallTimeoutMs: powerSchoolOperationTimeoutMs(config.overallTimeoutMs),
    };
  } catch {
    options.packet.fill(0);
    return { exitCode: 64, errorCode: 'repair-config-invalid' };
  }
  scrubForbiddenAuthority(environment);
  let credentials;
  try {
    credentials = decodePowerSchoolRepairSecretPacket(options.packet);
  } catch {
    return { exitCode: 64, errorCode: 'repair-input-invalid' };
  }
  const result = await (
    options.repair ?? repairPowerSchoolSessionWithCredentials
  )({
    config,
    requestedDate: date,
    credentials,
    browserEnvironment: environment,
    headless,
    ...(persistentProfileDirectory === undefined
      ? {}
      : { persistentProfileDirectory }),
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
    'CLASSROOM_HUB_POWERSCHOOL_REPAIR_REFERENCE',
    powerSchoolJitHeadlessEnvironmentName,
    powerSchoolCompatibilityProfileEnvironmentName,
    'OP_SERVICE_ACCOUNT_TOKEN',
  ]) {
    delete environment[name];
  }
}

async function readPacketFromStandardInput(): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for await (const chunk of process.stdin) {
      const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += value.byteLength;
      if (total > maximumPacketBytes) throw new Error('repair-input-invalid');
      chunks.push(value);
    }
    if (total < 1) throw new Error('repair-input-invalid');
    const packet = Buffer.concat(chunks, total);
    for (const chunk of chunks) chunk.fill(0);
    return packet;
  } catch {
    for (const chunk of chunks) chunk.fill(0);
    throw new Error('repair-input-invalid');
  }
}

async function main(): Promise<void> {
  const controller = new AbortController();
  const interrupt = (): void => controller.abort('process-signal');
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  let output: PowerSchoolJitRepairWorkerOutput;
  try {
    const packet = await readPacketFromStandardInput();
    output = await runPowerSchoolJitRepairWorker({
      arguments: process.argv.slice(2),
      packet,
      signal: controller.signal,
    });
  } catch {
    output = { exitCode: 64, errorCode: 'repair-input-invalid' };
  }
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
