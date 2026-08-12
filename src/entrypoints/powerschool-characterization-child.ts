import {
  characterizePowerSchoolOnce,
  characterizePowerSchoolProfilePreflight,
  type PowerSchoolCharacterizationResult,
} from '../application/read-only/powerschool-characterization.js';
import { fileURLToPath } from 'node:url';
import type { Clock } from '../domain/determinism.js';
import type { RoomId } from '../domain/identities.js';
import { PassiveBrowserReadSession } from '../infrastructure/powerschool/browser-read.js';
import { PowerSchoolBrowserTransport } from '../infrastructure/powerschool/browser-transport.js';
import { powerSchoolM07bCharacterizationPolicy } from '../infrastructure/powerschool/characterization-policy.js';
import type { PassiveReadTransport } from '../infrastructure/powerschool/contracts.js';
import { LivePowerSchoolCharacterizationSource } from '../infrastructure/powerschool/live-characterization-source.js';
import { PassiveSameOriginHttpReader } from '../infrastructure/powerschool/passive-http.js';

export const powerSchoolCharacterizationProfileEnvironmentKey =
  'CLASSROOM_HUB_POWERSCHOOL_PROFILE_PATH' as const;
export const powerSchoolCharacterizationSupervisorCapability =
  'm07b-fixed-supervisor-v1' as const;

export interface ManagedCharacterizationLane {
  readonly http: PassiveReadTransport;
  readonly browser: PassiveReadTransport;
  close(): Promise<void>;
}

export interface ManagedCharacterizationLaneFactory {
  create(options: {
    readonly profileMode: 'managed-powerschool';
    readonly userDataDir: string;
    readonly origin: 'https://tasv.powerschool.com';
    readonly statusPath: '/teachers/home.html';
    readonly bellPath: '/teachers/aet_schedulebell.html?target_date=08/10/2026';
    readonly requestedDate: '2026-08-10';
    readonly timeoutMs: 10_000;
    readonly maximumBodyBytes: 2_097_152;
  }): Promise<ManagedCharacterizationLane>;
}

/** Production composition kept inert until the fixed supervisor invokes it. */
export const managedCharacterizationLaneFactory: ManagedCharacterizationLaneFactory =
  {
    async create(options) {
      const session = await PassiveBrowserReadSession.launch({
        userDataDir: options.userDataDir,
        profileMode: options.profileMode,
        allowedOrigin: options.origin,
        timeoutMs: options.timeoutMs,
        maxBodyBytes: options.maximumBodyBytes,
        allowedRoutes: [
          { pathTemplate: options.statusPath },
          {
            pathTemplate: '/teachers/aet_schedulebell.html?target_date={date}',
          },
        ],
        allowedResources: [],
        dateValueFormat: 'mm/dd/yyyy',
        expectedDate: options.requestedDate,
      });
      const browser = new PowerSchoolBrowserTransport(session, options.origin);
      const http = new PassiveSameOriginHttpReader({
        origin: options.origin,
        authenticationProbePath: options.statusPath,
        allowedPathTemplates: [
          options.statusPath,
          '/teachers/aet_schedulebell.html?target_date={date}',
        ],
        dateValueFormat: 'mm/dd/yyyy',
        expectedDate: options.requestedDate,
        maximumTimeoutMs: options.timeoutMs,
        maximumBodyBytes: options.maximumBodyBytes,
        cookies: browser,
      });
      return { http, browser, close: () => session.close() };
    },
  };

export interface PowerSchoolCharacterizationChildOptions {
  readonly supervisorCapability: typeof powerSchoolCharacterizationSupervisorCapability;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly clock: Clock;
  readonly monotonicNow: () => number;
  readonly laneFactory?: ManagedCharacterizationLaneFactory;
  /** The supervisor owns the IPC/stdout sink; it receives one JSON line. */
  readonly writeEvidence: (serialized: string) => void;
}

/**
 * Fixed-purpose child boundary. It has no repair, persistence, Calendar, or
 * generic URL capability, and emits only the validated evidence projection.
 */
export async function runPowerSchoolCharacterizationChild(
  options: PowerSchoolCharacterizationChildOptions,
): Promise<PowerSchoolCharacterizationResult> {
  if (
    options.supervisorCapability !==
    powerSchoolCharacterizationSupervisorCapability
  ) {
    throw new Error('powerschool-characterization-supervisor-required');
  }
  const now = options.clock.now();
  if (
    now < powerSchoolM07bCharacterizationPolicy.windowStartsAt ||
    now >= powerSchoolM07bCharacterizationPolicy.windowEndsAt
  ) {
    const result = characterizePowerSchoolProfilePreflight({
      policy: powerSchoolM07bCharacterizationPolicy,
      clock: options.clock,
    });
    options.writeEvidence(`${JSON.stringify(result.evidence)}\n`);
    return result;
  }

  const profilePath =
    options.environment[powerSchoolCharacterizationProfileEnvironmentKey];
  if (
    profilePath === undefined ||
    profilePath.length < 1 ||
    profilePath.length > 4096
  ) {
    const result = characterizePowerSchoolProfilePreflight({
      policy: powerSchoolM07bCharacterizationPolicy,
      clock: options.clock,
    });
    options.writeEvidence(`${JSON.stringify(result.evidence)}\n`);
    return result;
  }

  let lane: ManagedCharacterizationLane | undefined;
  let result: PowerSchoolCharacterizationResult;
  try {
    const laneOptions = {
      profileMode: 'managed-powerschool',
      userDataDir: profilePath,
      origin: 'https://tasv.powerschool.com',
      statusPath: '/teachers/home.html',
      bellPath: '/teachers/aet_schedulebell.html?target_date=08/10/2026',
      requestedDate: '2026-08-10',
      timeoutMs: 10_000,
      maximumBodyBytes: 2_097_152,
    } as const;
    lane = await (
      options.laneFactory ?? managedCharacterizationLaneFactory
    ).create(laneOptions);
    const source = new LivePowerSchoolCharacterizationSource({
      policy: powerSchoolM07bCharacterizationPolicy,
      clock: options.clock,
      monotonicNow: options.monotonicNow,
      http: lane.http,
      browser: lane.browser,
      roomId: 'room-b407' as RoomId,
      utcOffset: '+07:00',
    });
    result = await characterizePowerSchoolOnce({
      policy: powerSchoolM07bCharacterizationPolicy,
      dependencies: {
        clock: options.clock,
        monotonicNow: options.monotonicNow,
        source,
      },
    });
  } finally {
    if (lane !== undefined) {
      try {
        await lane.close();
      } catch {
        // Closing is mandatory, but cleanup details must not cross the child boundary.
      }
    }
  }
  options.writeEvidence(`${JSON.stringify(result.evidence)}\n`);
  return result;
}

async function sendEvidence(serialized: string): Promise<void> {
  if (process.send === undefined) {
    throw new Error('powerschool-characterization-ipc-required');
  }
  await new Promise<void>((resolve, reject) => {
    process.send?.(serialized.trim(), (error) =>
      error === null || error === undefined ? resolve() : reject(error),
    );
  });
}

export async function main(): Promise<void> {
  if (
    process.argv.length !== 3 ||
    process.argv[2] !== powerSchoolCharacterizationSupervisorCapability
  ) {
    throw new Error('powerschool-characterization-supervisor-required');
  }
  let serialized = '';
  await runPowerSchoolCharacterizationChild({
    supervisorCapability: powerSchoolCharacterizationSupervisorCapability,
    environment: process.env,
    clock: { now: () => new Date().toISOString() },
    monotonicNow: () => performance.now(),
    writeEvidence: (value) => {
      if (serialized.length > 0) {
        throw new Error('powerschool-characterization-multiple-evidence');
      }
      serialized = value;
    },
  });
  await sendEvidence(serialized);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
