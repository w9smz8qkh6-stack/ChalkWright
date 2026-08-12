import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  loadPowerSchoolCompatibilityConfig,
  parsePowerSchoolDate,
  powerSchoolOperationTimeoutMs,
  type PowerSchoolCompatibilityConfig,
} from '../config/powerschool-session.js';
import type { IsoDate } from '../contracts/v1/common.js';
import type { ScheduleObservation } from '../contracts/v1/schedule.js';
import type { RoomId } from '../domain/identities.js';
import { PersistentCompatibilityPowerSchoolBellScheduleSource } from '../infrastructure/powerschool-session/persistent-compatibility-source.js';
import type {
  ObservationReadResult,
  ScheduleObservationSource,
} from '../ports/read-sources.js';

export interface PowerSchoolCompatibilityBellWorkerOutput {
  readonly exitCode: number;
  readonly result?: ObservationReadResult<ScheduleObservation>;
  readonly errorCode?: 'collector-config-invalid' | 'collector-usage-invalid';
}

export type PowerSchoolCompatibilitySourceFactory = (options: {
  readonly config: PowerSchoolCompatibilityConfig;
  readonly environment: NodeJS.ProcessEnv;
  readonly signal?: AbortSignal;
}) => ScheduleObservationSource;

export async function runPowerSchoolCompatibilityBellWorker(options: {
  readonly arguments: readonly string[];
  readonly environment?: NodeJS.ProcessEnv;
  readonly signal?: AbortSignal;
  readonly sourceFactory?: PowerSchoolCompatibilitySourceFactory;
}): Promise<PowerSchoolCompatibilityBellWorkerOutput> {
  let date: IsoDate;
  try {
    if (options.arguments.length !== 1) throw new Error('usage');
    date = parsePowerSchoolDate(options.arguments[0]) as IsoDate;
  } catch {
    return { exitCode: 64, errorCode: 'collector-usage-invalid' };
  }
  const environment = options.environment ?? process.env;
  scrubForbiddenAuthority(environment);
  let config: PowerSchoolCompatibilityConfig;
  try {
    config = loadPowerSchoolCompatibilityConfig(environment);
    config = {
      ...config,
      overallTimeoutMs: powerSchoolOperationTimeoutMs(config.overallTimeoutMs),
    };
  } catch {
    return { exitCode: 64, errorCode: 'collector-config-invalid' };
  }
  try {
    const source =
      options.sourceFactory?.({
        config,
        environment,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      }) ??
      new PersistentCompatibilityPowerSchoolBellScheduleSource(config, {
        environment,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      });
    const result = await source.readSchedule({
      date,
      roomId: config.roomId as RoomId,
    });
    return { exitCode: exitCodeFor(result), result };
  } catch {
    return {
      exitCode: 1,
      result: {
        status: 'failed',
        error: {
          category: 'internal',
          code: 'collector-startup-failed',
          message:
            'Persistent PowerSchool compatibility collection failed before producing an observation.',
          retryable: false,
          diagnostics: [],
        },
      },
    };
  }
}

function scrubForbiddenAuthority(environment: NodeJS.ProcessEnv): void {
  for (const name of [
    'CLASSROOM_HUB_POWERSCHOOL_GOOGLE_USERNAME',
    'CLASSROOM_HUB_POWERSCHOOL_GOOGLE_PASSWORD',
    'CLASSROOM_HUB_POWERSCHOOL_GOOGLE_TOTP',
    'CLASSROOM_HUB_POWERSCHOOL_REPAIR_REFERENCE',
    'CLASSROOM_HUB_POWERSCHOOL_ONEPASSWORD_SERVICE_ACCOUNT_ENV',
    'OP_SERVICE_ACCOUNT_TOKEN',
  ]) {
    delete environment[name];
  }
}

function exitCodeFor(
  result: ObservationReadResult<ScheduleObservation>,
): number {
  switch (result.status) {
    case 'observed':
      return 0;
    case 'repair-required':
      return 3;
    case 'not-found':
      return 2;
    case 'failed':
      return result.error.code === 'collector-already-running' ? 75 : 1;
  }
}

async function main(): Promise<void> {
  const controller = new AbortController();
  const interrupt = (): void => controller.abort('process-signal');
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  const output = await runPowerSchoolCompatibilityBellWorker({
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
