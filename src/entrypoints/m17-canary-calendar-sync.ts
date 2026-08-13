import { randomUUID } from 'node:crypto';

import type { OpaqueId } from '../contracts/v1/common.js';
import type { RoomId, ScreenId } from '../domain/identities.js';
import { synchronizeM17CanaryCalendar } from '../application/calendar/canary-sync.js';
import { loadM17CanaryCalendarConfig } from '../config/m17-canary.js';
import { loadProductionServerConfig } from '../config/production.js';
import { SqliteCalendarExecutionState } from '../infrastructure/sqlite/calendar-execution-state.js';
import { SqliteDatabase } from '../infrastructure/sqlite/database.js';
import { SqliteApplicationStateRepository } from '../infrastructure/sqlite/repository.js';
import { isDirectEntrypoint } from './direct-invocation.js';

export async function runM17CanaryCalendarSync(options: {
  readonly arguments: readonly string[];
  readonly environment?: NodeJS.ProcessEnv;
  readonly signal?: AbortSignal;
  readonly now?: () => string;
}): Promise<{
  readonly exitCode: number;
  readonly status: string;
  readonly code: string;
  readonly observedEventCount: number;
  readonly intentCount: number;
  readonly attemptedExternalMutations: number;
  readonly completedExternalMutations: number;
}> {
  if (
    options.arguments.length !== 1 ||
    (options.arguments[0] !== '--preflight' &&
      options.arguments[0] !== '--execute')
  )
    return rejected('m17-canary-usage-invalid');
  const execute = options.arguments[0] === '--execute';
  const environment = options.environment ?? process.env;
  rejectAmbientAuthority(environment);
  const reference = environment.CHALKWRIGHT_M17_CANARY_CONFIG_REFERENCE;
  if (reference === undefined) return rejected('m17-canary-config-required');
  let database: SqliteDatabase | undefined;
  try {
    const config = loadM17CanaryCalendarConfig(reference);
    const production = loadProductionServerConfig(
      config.productionConfigReference,
    );
    if (
      !production.instanceId.includes('-canary-') ||
      production.databasePath !== config.databasePath ||
      production.timeZone !== config.timeZone
    )
      return rejected('m17-canary-runtime-mismatch');
    const clock = options.now ?? (() => new Date().toISOString());
    const requestedAt = clock();
    const date = localDate(requestedAt, config.timeZone);
    if (date === undefined) return rejected('m17-canary-clock-invalid');
    database = new SqliteDatabase(config.databasePath, {
      migration: { appliedAt: requestedAt },
    });
    const plans = new SqliteApplicationStateRepository(database, {
      clock: { now: clock },
      nextRevision: () => `m17-calendar-${randomUUID()}`,
      academicYearEndForDate: () => production.academicYearEnd,
    });
    const plan = await plans.findEffective({
      date,
      screenId: production.screenId as ScreenId,
      roomId: production.roomId as RoomId,
    });
    if (plan === undefined || plan.verification !== 'verified')
      return rejected('m17-canary-plan-unavailable');
    const window = localDayWindow(date, config.timeZone);
    if (window === undefined) return rejected('m17-canary-clock-invalid');
    const writerClient =
      await import('../infrastructure/google-calendar/official-writer-client.js');
    let listTransport;
    let mutationTransport;
    if (execute) {
      const pair = writerClient.loadOfficialCalendarProductionTrialTransports(
        config.credentialReferencePath,
      );
      listTransport = pair.listTransport;
      mutationTransport = pair.mutationTransport;
    } else {
      listTransport = writerClient.loadOfficialCalendarWriterListTransport(
        config.credentialReferencePath,
      );
    }
    const signal = AbortSignal.any(
      [AbortSignal.timeout(config.overallTimeoutMs), options.signal].filter(
        (value): value is AbortSignal => value !== undefined,
      ),
    );
    const result = await synchronizeM17CanaryCalendar({
      calendarId: config.calendarId,
      scopeId: config.scopeId as OpaqueId,
      plan,
      timeMin: window.timeMin,
      timeMax: window.timeMax,
      requestTimeoutMs: config.requestTimeoutMs,
      maximumPages: config.maximumPages,
      maximumEvents: config.maximumEvents,
      leaseDurationSeconds: config.leaseDurationSeconds,
      clock,
      signal,
      listTransport,
      ...(mutationTransport === undefined ? {} : { mutationTransport }),
      state: new SqliteCalendarExecutionState(database),
      execute,
    });
    return {
      exitCode:
        result.status === 'succeeded'
          ? 0
          : result.status === 'repair-required'
            ? 3
            : 1,
      ...result,
    };
  } catch {
    return rejected('m17-canary-startup-failed');
  } finally {
    database?.close();
  }
}

function rejectAmbientAuthority(environment: NodeJS.ProcessEnv): void {
  for (const [name, value] of Object.entries(environment)) {
    if (
      value !== undefined &&
      value.length > 0 &&
      (name.startsWith('CLASSROOM_HUB_POWERSCHOOL_') ||
        name.startsWith('CLASSROOM_HUB_CLASSROOM_') ||
        name.startsWith('CLASSROOM_HUB_M15_') ||
        name === 'CLASSROOM_HUB_ALERT_DELIVERY_REFERENCE')
    )
      throw new Error('m17-canary-ambient-authority-rejected');
  }
}

function localDate(instant: string, timeZone: string): string | undefined {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(instant));
    const part = (type: Intl.DateTimeFormatPartTypes): string | undefined =>
      parts.find((entry) => entry.type === type)?.value;
    const year = part('year');
    const month = part('month');
    const day = part('day');
    return year === undefined || month === undefined || day === undefined
      ? undefined
      : `${year}-${month}-${day}`;
  } catch {
    return undefined;
  }
}

function localDayWindow(
  date: string,
  timeZone: string,
): { readonly timeMin: string; readonly timeMax: string } | undefined {
  if (timeZone !== 'Asia/Ho_Chi_Minh') return undefined;
  const localMidnight = Date.parse(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(localMidnight)) return undefined;
  const timeMin = new Date(localMidnight - 7 * 60 * 60_000).toISOString();
  const timeMax = new Date(localMidnight + 17 * 60 * 60_000).toISOString();
  return { timeMin, timeMax };
}

function rejected(code: string) {
  return {
    exitCode: 1,
    status: 'failed',
    code,
    observedEventCount: 0,
    intentCount: 0,
    attemptedExternalMutations: 0,
    completedExternalMutations: 0,
  } as const;
}

async function main(): Promise<void> {
  const controller = new AbortController();
  const stop = (): void => controller.abort('process-signal');
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  const result = await runM17CanaryCalendarSync({
    arguments: process.argv.slice(2),
    signal: controller.signal,
  });
  process.removeListener('SIGINT', stop);
  process.removeListener('SIGTERM', stop);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result.exitCode;
}

if (isDirectEntrypoint(import.meta.url, process.argv[1])) void main();
