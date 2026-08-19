import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  contractVersion,
  type IsoDate,
} from '../../src/contracts/v1/common.js';
import type { ScheduleObservation } from '../../src/contracts/v1/schedule.js';
import type { CourseworkEnrichment } from '../../src/domain/coursework.js';
import type { ClassId, RoomId, ScreenId } from '../../src/domain/identities.js';
import type { EffectiveDayPlan } from '../../src/domain/plans.js';
import { runProductionClassroomRefresh } from '../../src/entrypoints/production-classroom-refresh.js';
import { runProductionPlanRefresh } from '../../src/entrypoints/production-plan-refresh.js';
import { runProductionRetainedPlanRefresh } from '../../src/entrypoints/production-retained-plan-refresh.js';
import { runM17CanaryCalendarSync } from '../../src/entrypoints/m17-canary-calendar-sync.js';
import { writeNewProtectedJson } from '../../src/infrastructure/filesystem/protected-json.js';
import { SqliteDatabase } from '../../src/infrastructure/sqlite/database.js';
import { SqliteApplicationStateRepository } from '../../src/infrastructure/sqlite/repository.js';

const requestedAt = '2035-04-13T01:30:00.000Z';
const date = '2035-04-13' as IsoDate;
const roomId = 'room-c509' as RoomId;
const screenId = 'screen-c509-production' as ScreenId;
const classId = 'class-c509-a' as ClassId;

test('production plan refresh stores only the verified read-only plan', async () => {
  const fixture = createFixture();
  try {
    let sourceConstructions = 0;
    const output = await runProductionPlanRefresh({
      arguments: [],
      environment: planEnvironment(fixture.environment),
      now: () => requestedAt,
      nextId: () => 'production-plan-refresh-test',
      hardStop: () => {
        throw new Error('unexpected-hard-stop');
      },
      sourceForRun: () => {
        sourceConstructions += 1;
        return {
          readSchedule: async (request) => ({
            status: 'observed',
            observation: scheduleObservationForDate(request.date, true),
          }),
        };
      },
    });
    assert.equal(output.status, 'succeeded');
    assert.equal(output.result?.attemptedExternalMutations, 0);
    assert.equal(output.result?.completedExternalMutations, 0);
    assert.equal(sourceConstructions, 1);
    using database = new SqliteDatabase(fixture.databasePath, {
      migration: { appliedAt: requestedAt },
    });
    const repository = repositoryFor(database);
    assert.equal(
      (
        await repository.findEffective({
          screenId,
          roomId,
          date,
        })
      )?.meetings.length,
      1,
    );
  } finally {
    fixture.close();
  }
});

test('retained-profile production plan refresh remains credential-free and stores the verified plan', async () => {
  const fixture = createFixture();
  try {
    const environment = {
      ...planEnvironment(fixture.environment),
      CLASSROOM_HUB_POWERSCHOOL_IDENTITY_ORIGIN:
        'https://accounts.example.invalid',
      CLASSROOM_HUB_POWERSCHOOL_BOOTSTRAP_RESOURCE_ORIGINS:
        'https://powerschool.invalid,https://accounts.example.invalid',
      CLASSROOM_HUB_POWERSCHOOL_BOOTSTRAP_MAX_REQUESTS: '16',
      CLASSROOM_HUB_POWERSCHOOL_COMPATIBILITY_PROFILE_DIRECTORY: join(
        fixture.root,
        'retained-profile',
      ),
    };
    let supervisedReads = 0;
    const output = await runProductionRetainedPlanRefresh({
      arguments: [],
      environment,
      now: () => requestedAt,
      nextId: () => 'production-retained-plan-refresh-test',
      hardStop: () => {
        throw new Error('unexpected-hard-stop');
      },
      retainedRead: async ({ arguments: [requestedDate] }) => {
        supervisedReads += 1;
        return {
          exitCode: 0,
          result: {
            status: 'observed',
            observation: scheduleObservationForDate(
              requestedDate as IsoDate,
              true,
            ),
          },
        };
      },
    });
    assert.equal(output.status, 'succeeded');
    assert.equal(output.result?.attemptedExternalMutations, 0);
    assert.equal(output.result?.completedExternalMutations, 0);
    assert.equal(supervisedReads, 8);
    using database = new SqliteDatabase(fixture.databasePath, {
      migration: { appliedAt: requestedAt },
    });
    assert.equal(
      (
        await repositoryFor(database).findEffective({
          screenId,
          roomId,
          date,
        })
      )?.meetings.length,
      1,
    );
  } finally {
    fixture.close();
  }
});

test('retained-profile plan refresh rejects ambient repair authority before constructing its supervisor', async () => {
  const fixture = createFixture();
  try {
    let supervisedReads = 0;
    const output = await runProductionRetainedPlanRefresh({
      arguments: [],
      environment: {
        ...planEnvironment(fixture.environment),
        CLASSROOM_HUB_POWERSCHOOL_IDENTITY_ORIGIN:
          'https://accounts.example.invalid',
        CLASSROOM_HUB_POWERSCHOOL_BOOTSTRAP_RESOURCE_ORIGINS:
          'https://powerschool.invalid,https://accounts.example.invalid',
        CLASSROOM_HUB_POWERSCHOOL_BOOTSTRAP_MAX_REQUESTS: '16',
        CLASSROOM_HUB_POWERSCHOOL_COMPATIBILITY_PROFILE_DIRECTORY: join(
          fixture.root,
          'retained-profile',
        ),
        CLASSROOM_HUB_POWERSCHOOL_REPAIR_REFERENCE:
          '/protected/must-not-be-used',
      },
      now: () => requestedAt,
      nextId: () => 'production-retained-authority-rejection-test',
      hardStop: () => {
        throw new Error('unexpected-hard-stop');
      },
      retainedRead: async () => {
        supervisedReads += 1;
        throw new Error('must-not-run');
      },
    });
    assert.equal(output.status, 'rejected');
    assert.equal(supervisedReads, 0);
  } finally {
    fixture.close();
  }
});

test('retained-profile parent permits the supervisor full graceful and forced quiescence window', async () => {
  const fixture = createFixture();
  const controller = new AbortController();
  try {
    let hardStops = 0;
    let readStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      readStarted = resolve;
    });
    const outputPromise = runProductionRetainedPlanRefresh({
      arguments: [],
      environment: {
        ...planEnvironment(fixture.environment),
        CLASSROOM_HUB_POWERSCHOOL_IDENTITY_ORIGIN:
          'https://accounts.example.invalid',
        CLASSROOM_HUB_POWERSCHOOL_BOOTSTRAP_RESOURCE_ORIGINS:
          'https://powerschool.invalid,https://accounts.example.invalid',
        CLASSROOM_HUB_POWERSCHOOL_BOOTSTRAP_MAX_REQUESTS: '16',
        CLASSROOM_HUB_POWERSCHOOL_COMPATIBILITY_PROFILE_DIRECTORY: join(
          fixture.root,
          'retained-profile',
        ),
      },
      signal: controller.signal,
      now: () => requestedAt,
      nextId: () => 'production-retained-supervisor-cleanup-test',
      hardStop: () => {
        hardStops += 1;
        throw new Error('unexpected-hard-stop');
      },
      retainedRead: async () => {
        readStarted();
        await new Promise<void>((resolve) => setTimeout(resolve, 3_100));
        return {
          exitCode: 1,
          result: {
            status: 'failed',
            error: {
              category: 'unavailable',
              code: 'child-interrupted',
              message: 'The supervised child quiesced after forced teardown.',
              retryable: false,
              diagnostics: [],
            },
          },
        };
      },
    });
    await started;
    controller.abort('synthetic-parent-interrupt');
    const output = await outputPromise;
    assert.equal(output.status, 'failed');
    assert.equal(hardStops, 0);
  } finally {
    fixture.close();
  }
});

test('retained-profile production plan refresh exposes sanitized failed source code', async () => {
  const fixture = createFixture();
  try {
    const output = await runProductionRetainedPlanRefresh({
      arguments: [],
      environment: {
        ...planEnvironment(fixture.environment),
        CLASSROOM_HUB_POWERSCHOOL_IDENTITY_ORIGIN:
          'https://accounts.example.invalid',
        CLASSROOM_HUB_POWERSCHOOL_BOOTSTRAP_RESOURCE_ORIGINS:
          'https://powerschool.invalid,https://accounts.example.invalid',
        CLASSROOM_HUB_POWERSCHOOL_BOOTSTRAP_MAX_REQUESTS: '16',
        CLASSROOM_HUB_POWERSCHOOL_COMPATIBILITY_PROFILE_DIRECTORY: join(
          fixture.root,
          'retained-profile',
        ),
      },
      now: () => requestedAt,
      nextId: () => 'production-retained-failed-code-test',
      hardStop: () => {
        throw new Error('unexpected-hard-stop');
      },
      retainedRead: async () => ({
        exitCode: 1,
        result: {
          status: 'failed',
          error: {
            category: 'unsafe-configuration',
            code: 'request-policy-violation',
            message:
              'The retained-profile reader blocked an unexpected request.',
            retryable: false,
            diagnostics: [],
          },
        },
      }),
    });
    assert.equal(output.status, 'failed');
    assert.equal(
      output.code,
      'production-source-unavailable-request-policy-violation',
    );
    assert.equal(output.result?.attemptedExternalMutations, 0);
    assert.equal(output.result?.completedExternalMutations, 0);
  } finally {
    fixture.close();
  }
});

test('production plan refresh stores the full bounded future week and selects its first class day', async () => {
  const fixture = createFixture();
  try {
    const requestedDates: string[] = [];
    const output = await runProductionPlanRefresh({
      arguments: [],
      environment: planEnvironment(fixture.environment),
      now: () => requestedAt,
      nextId: () => 'production-future-plan-refresh-test',
      hardStop: () => {
        throw new Error('unexpected-hard-stop');
      },
      sourceForRun: () => ({
        readSchedule: async (request) => {
          requestedDates.push(request.date);
          const hasClasses = request.date !== '2035-04-14';
          return {
            status: 'observed' as const,
            observation: scheduleObservationForDate(request.date, hasClasses),
          };
        },
      }),
    });
    assert.equal(output.status, 'succeeded');
    assert.deepEqual(requestedDates, [
      '2035-04-13',
      '2035-04-14',
      '2035-04-15',
      '2035-04-16',
      '2035-04-17',
      '2035-04-18',
      '2035-04-19',
      '2035-04-20',
    ]);
    using database = new SqliteDatabase(fixture.databasePath, {
      migration: { appliedAt: requestedAt },
    });
    const repository = repositoryFor(database);
    assert.deepEqual(
      (
        await repository.findNextEffective({
          screenId,
          roomId,
          afterDate: date,
        })
      )?.date,
      '2035-04-15',
    );
  } finally {
    fixture.close();
  }
});

test('production Sunday refresh skips an unavailable current plan and stores the following week', async () => {
  const fixture = createFixture();
  const sunday = '2035-04-15' as IsoDate;
  try {
    const requestedDates: string[] = [];
    const output = await runProductionPlanRefresh({
      arguments: [],
      environment: planEnvironment(fixture.environment),
      now: () => '2035-04-15T01:30:00.000Z',
      nextId: () => 'production-sunday-future-week-test',
      hardStop: () => {
        throw new Error('unexpected-hard-stop');
      },
      sourceForRun: () => ({
        readSchedule: async (request) => {
          requestedDates.push(request.date);
          if (request.date === sunday)
            return {
              status: 'not-found' as const,
              diagnostics: [
                {
                  code: 'bell-schedule-periods-missing',
                  severity: 'error' as const,
                  message: 'No exact schedule was available for this date.',
                },
              ],
            };
          return {
            status: 'observed' as const,
            observation: scheduleObservationForDate(request.date, true),
          };
        },
      }),
    });
    assert.equal(output.status, 'succeeded');
    assert.deepEqual(requestedDates, [
      '2035-04-15',
      '2035-04-16',
      '2035-04-17',
      '2035-04-18',
      '2035-04-19',
      '2035-04-20',
      '2035-04-21',
      '2035-04-22',
    ]);
    assert.ok(
      output.result?.diagnostics.some(
        ({ code }) => code === 'production-current-plan-unavailable-skipped',
      ),
    );
    using database = new SqliteDatabase(fixture.databasePath, {
      migration: { appliedAt: requestedAt },
    });
    const repository = repositoryFor(database);
    assert.equal(
      await repository.findEffective({
        screenId,
        roomId,
        date: sunday,
      }),
      undefined,
    );
    assert.equal(
      (
        await repository.findNextEffective({
          screenId,
          roomId,
          afterDate: sunday,
        })
      )?.date,
      '2035-04-16',
    );
    assert.equal(output.result?.attemptedExternalMutations, 0);
    assert.equal(output.result?.completedExternalMutations, 0);
  } finally {
    fixture.close();
  }
});

test('production future lookahead skips an unavailable date without storing it as no classes', async () => {
  const fixture = createFixture();
  try {
    const requestedDates: string[] = [];
    const output = await runProductionPlanRefresh({
      arguments: [],
      environment: planEnvironment(fixture.environment),
      now: () => requestedAt,
      nextId: () => 'production-future-plan-unavailable-date-test',
      hardStop: () => {
        throw new Error('unexpected-hard-stop');
      },
      sourceForRun: () => ({
        readSchedule: async (request) => {
          requestedDates.push(request.date);
          if (request.date === '2035-04-14')
            return {
              status: 'not-found' as const,
              diagnostics: [
                {
                  code: 'bell-schedule-periods-missing',
                  severity: 'error' as const,
                  message: 'No exact schedule was available for this date.',
                },
              ],
            };
          return {
            status: 'observed' as const,
            observation: scheduleObservationForDate(request.date, true),
          };
        },
      }),
    });
    assert.equal(output.status, 'succeeded');
    assert.deepEqual(requestedDates, [
      '2035-04-13',
      '2035-04-14',
      '2035-04-15',
      '2035-04-16',
      '2035-04-17',
      '2035-04-18',
      '2035-04-19',
      '2035-04-20',
    ]);
    using database = new SqliteDatabase(fixture.databasePath, {
      migration: { appliedAt: requestedAt },
    });
    const repository = repositoryFor(database);
    assert.equal(
      await repository.findEffective({
        screenId,
        roomId,
        date: '2035-04-14' as IsoDate,
      }),
      undefined,
    );
    assert.equal(
      (
        await repository.findNextEffective({
          screenId,
          roomId,
          afterDate: date,
        })
      )?.date,
      '2035-04-15',
    );
  } finally {
    fixture.close();
  }
});

test('production future lookahead stores an ordered short class day instead of discarding it', async () => {
  const fixture = createFixture();
  try {
    const requestedDates: string[] = [];
    const output = await runProductionPlanRefresh({
      arguments: [],
      environment: planEnvironment(fixture.environment),
      now: () => requestedAt,
      nextId: () => 'production-future-plan-contract-test',
      hardStop: () => {
        throw new Error('unexpected-hard-stop');
      },
      sourceForRun: () => ({
        readSchedule: async (request) => {
          requestedDates.push(request.date);
          const candidate = scheduleObservationForDate(request.date, true);
          return {
            status: 'observed' as const,
            observation:
              request.date === '2035-04-14'
                ? {
                    ...candidate,
                    periods: candidate.periods.map((period) => ({
                      ...period,
                      endsAt: `${request.date}T01:05:00.000Z`,
                    })),
                  }
                : candidate,
          };
        },
      }),
    });
    assert.equal(output.status, 'succeeded');
    assert.deepEqual(requestedDates, [
      '2035-04-13',
      '2035-04-14',
      '2035-04-15',
      '2035-04-16',
      '2035-04-17',
      '2035-04-18',
      '2035-04-19',
      '2035-04-20',
    ]);
    using database = new SqliteDatabase(fixture.databasePath, {
      migration: { appliedAt: requestedAt },
    });
    const repository = repositoryFor(database);
    const shortDay = await repository.findEffective({
      screenId,
      roomId,
      date: '2035-04-14' as IsoDate,
    });
    assert.equal(shortDay?.meetings.length, 1);
    assert.equal(
      shortDay?.meetings[0]?.officialEndsAt,
      '2035-04-14T01:05:00.000Z',
    );
    assert.ok(
      shortDay?.diagnostics.some(
        (diagnostic) => diagnostic.code === 'period-dismissal-window-adjusted',
      ),
    );
    assert.equal(
      (
        await repository.findNextEffective({
          screenId,
          roomId,
          afterDate: date,
        })
      )?.date,
      '2035-04-14',
    );
  } finally {
    fixture.close();
  }
});

test('production plan refresh stops after seven verified empty future dates', async () => {
  const fixture = createFixture();
  try {
    const requestedDates: string[] = [];
    const output = await runProductionPlanRefresh({
      arguments: [],
      environment: planEnvironment(fixture.environment),
      now: () => requestedAt,
      nextId: () => 'production-future-plan-bound-test',
      hardStop: () => {
        throw new Error('unexpected-hard-stop');
      },
      sourceForRun: () => ({
        readSchedule: async (request) => {
          requestedDates.push(request.date);
          return {
            status: 'observed' as const,
            observation: scheduleObservationForDate(
              request.date,
              request.date === date,
            ),
          };
        },
      }),
    });
    assert.equal(output.status, 'succeeded');
    assert.deepEqual(requestedDates, [
      '2035-04-13',
      '2035-04-14',
      '2035-04-15',
      '2035-04-16',
      '2035-04-17',
      '2035-04-18',
      '2035-04-19',
      '2035-04-20',
    ]);
    using database = new SqliteDatabase(fixture.databasePath, {
      migration: { appliedAt: requestedAt },
    });
    assert.equal(
      await repositoryFor(database).findNextEffective({
        screenId,
        roomId,
        afterDate: date,
      }),
      undefined,
    );
  } finally {
    fixture.close();
  }
});

test('production future lookahead preserves authentication repair without guessing', async () => {
  const fixture = createFixture();
  try {
    const requestedDates: string[] = [];
    const output = await runProductionPlanRefresh({
      arguments: [],
      environment: planEnvironment(fixture.environment),
      now: () => requestedAt,
      nextId: () => 'production-future-plan-auth-test',
      hardStop: () => {
        throw new Error('unexpected-hard-stop');
      },
      sourceForRun: () => ({
        readSchedule: async (request) => {
          requestedDates.push(request.date);
          if (request.date === date)
            return {
              status: 'observed' as const,
              observation: scheduleObservationForDate(request.date, true),
            };
          return {
            status: 'repair-required' as const,
            error: {
              category: 'authentication-repair-required' as const,
              code: 'session-state-rejected',
              message: 'Repair required.',
              retryable: false,
              diagnostics: [],
            },
          };
        },
      }),
    });
    assert.equal(output.status, 'repair-required');
    assert.equal(output.code, 'production-powerschool-session-state-rejected');
    assert.deepEqual(requestedDates, ['2035-04-13', '2035-04-14']);
    assert.equal(output.result?.attemptedExternalMutations, 0);
    assert.equal(output.result?.completedExternalMutations, 0);
  } finally {
    fixture.close();
  }
});

test('production future lookahead exposes only bounded failed source codes', async () => {
  const fixture = createFixture();
  try {
    const requestedDates: string[] = [];
    const output = await runProductionPlanRefresh({
      arguments: [],
      environment: planEnvironment(fixture.environment),
      now: () => requestedAt,
      nextId: () => 'production-future-plan-failed-code-test',
      hardStop: () => {
        throw new Error('unexpected-hard-stop');
      },
      sourceForRun: () => ({
        readSchedule: async (request) => {
          requestedDates.push(request.date);
          if (request.date === date)
            return {
              status: 'observed' as const,
              observation: scheduleObservationForDate(request.date, true),
            };
          return {
            status: 'failed' as const,
            error: {
              category: 'unsafe-configuration' as const,
              code: 'request-policy-violation',
              message: 'The source failed safely.',
              retryable: false,
              diagnostics: [],
            },
          };
        },
      }),
    });
    assert.equal(output.status, 'failed');
    assert.equal(
      output.code,
      'production-future-plan-unavailable-request-policy-violation',
    );
    assert.deepEqual(requestedDates, ['2035-04-13', '2035-04-14']);
    assert.equal(output.result?.attemptedExternalMutations, 0);
    assert.equal(output.result?.completedExternalMutations, 0);
  } finally {
    fixture.close();
  }
});

test('production active Classroom refresh derives one local target before source authority', async () => {
  const fixture = createFixture();
  try {
    await seedEffectivePlan(fixture.databasePath, effectivePlan());
    let sourceConstructions = 0;
    const output = await runProductionClassroomRefresh({
      arguments: [],
      environment: classroomEnvironment(fixture.environment),
      now: () => requestedAt,
      nextId: () => 'production-classroom-refresh-test',
      hardStop: () => {
        throw new Error('unexpected-hard-stop');
      },
      sourceForRun: () => {
        sourceConstructions += 1;
        return {
          readEnrichment: async ({ classId: requestedClass }) => ({
            status: 'observed',
            observation: {
              contractVersion,
              observationId: 'production-classroom-observation',
              observedForDate: date,
              classId: requestedClass,
              value: enrichment(requestedClass),
              provenance: {
                source: 'google-classroom',
                method: 'api-read',
                observedAt: requestedAt,
                verification: 'verified',
                sourceReference: `google-classroom:${requestedClass}`,
              },
              freshness: { state: 'fresh', observedAt: requestedAt },
              verification: 'verified',
              diagnostics: [],
            },
          }),
        };
      },
    });
    assert.equal(output.status, 'succeeded');
    assert.equal(output.result?.attemptedExternalMutations, 0);
    assert.equal(output.result?.completedExternalMutations, 0);
    assert.equal(sourceConstructions, 1);
  } finally {
    fixture.close();
  }
});

test('inactive and invalid production jobs fail before provider construction', async () => {
  const fixture = createFixture();
  try {
    await seedEffectivePlan(fixture.databasePath, {
      ...effectivePlan(),
      meetings: [],
    });
    let sourceConstructions = 0;
    const inactive = await runProductionClassroomRefresh({
      arguments: [],
      environment: classroomEnvironment(fixture.environment),
      now: () => requestedAt,
      nextId: () => 'production-classroom-inactive-test',
      hardStop: () => {
        throw new Error('unexpected-hard-stop');
      },
      sourceForRun: () => {
        sourceConstructions += 1;
        throw new Error('must-not-construct');
      },
    });
    assert.equal(inactive.status, 'skipped');
    assert.equal(sourceConstructions, 0);

    const invalidUsage = await runProductionPlanRefresh({
      arguments: ['unexpected'],
      environment: {},
      hardStop: () => {
        throw new Error('unexpected-hard-stop');
      },
      sourceForRun: () => {
        sourceConstructions += 1;
        throw new Error('must-not-construct');
      },
    });
    assert.deepEqual(invalidUsage, {
      exitCode: 64,
      status: 'rejected',
      code: 'production-job-usage-invalid',
    });
    assert.equal(sourceConstructions, 0);
  } finally {
    fixture.close();
  }
});

test('production provider jobs reject ambient authority from every other provider family', async () => {
  const fixture = createFixture();
  try {
    let sourceConstructions = 0;
    const plan = await runProductionPlanRefresh({
      arguments: [],
      environment: {
        ...planEnvironment(fixture.environment),
        CLASSROOM_HUB_CLASSROOM_UNEXPECTED_AUTHORITY: 'present',
      },
      now: () => requestedAt,
      hardStop: () => {
        throw new Error('unexpected-hard-stop');
      },
      sourceForRun: () => {
        sourceConstructions += 1;
        throw new Error('must-not-construct');
      },
    });
    assert.equal(plan.status, 'rejected');

    const classroom = await runProductionClassroomRefresh({
      arguments: [],
      environment: {
        ...classroomEnvironment(fixture.environment),
        CLASSROOM_HUB_POWERSCHOOL_UNEXPECTED_AUTHORITY: 'present',
      },
      now: () => requestedAt,
      hardStop: () => {
        throw new Error('unexpected-hard-stop');
      },
      sourceForRun: () => {
        sourceConstructions += 1;
        throw new Error('must-not-construct');
      },
    });
    assert.equal(classroom.status, 'rejected');
    assert.equal(sourceConstructions, 0);
  } finally {
    fixture.close();
  }
});

test('M17 Calendar preflight skips when only a verified future class day is available', async () => {
  const fixture = createFixture();
  try {
    await seedEffectivePlan(
      fixture.databasePath,
      effectivePlanForDate('2035-04-14' as IsoDate),
    );
    const output = await runM17CanaryCalendarSync({
      arguments: ['--preflight'],
      environment: m17CalendarEnvironment(fixture),
      now: () => requestedAt,
    });
    assert.deepEqual(output, {
      exitCode: 0,
      status: 'skipped',
      code: 'm17-canary-calendar-no-current-plan',
      observedEventCount: 0,
      intentCount: 0,
      attemptedExternalMutations: 0,
      completedExternalMutations: 0,
    });
  } finally {
    fixture.close();
  }
});

test('M17 Calendar preflight still fails when no verified current or future plan exists', async () => {
  const fixture = createFixture();
  try {
    const output = await runM17CanaryCalendarSync({
      arguments: ['--preflight'],
      environment: m17CalendarEnvironment(fixture),
      now: () => requestedAt,
    });
    assert.equal(output.exitCode, 1);
    assert.equal(output.status, 'failed');
    assert.equal(output.code, 'm17-canary-plan-unavailable');
    assert.equal(output.attemptedExternalMutations, 0);
    assert.equal(output.completedExternalMutations, 0);
  } finally {
    fixture.close();
  }
});

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), 'classroom-hub-production-jobs-'));
  chmodSync(root, 0o700);
  const managedRoot = join(root, 'classroom-hub-production');
  const databasePath = join(managedRoot, 'state', 'classroom-hub.sqlite');
  const backupDirectory = join(managedRoot, 'backups');
  mkdirSync(join(managedRoot, 'state'), { recursive: true, mode: 0o700 });
  mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });
  const configReference = join(root, 'production-server.json');
  const credentialReference = join(root, 'classroom-authorized-user.json');
  writeNewProtectedJson(configReference, {
    version: 1,
    instanceId: 'classroom-hub-c509-production',
    roomId,
    screenId,
    screenLabel: 'C509 Classroom Display',
    host: '127.0.0.1',
    port: 4317,
    timeZone: 'Asia/Ho_Chi_Minh',
    academicYearEnd: '2035-06-30',
    managedRoot,
    databasePath,
    backupDirectory,
    operatorTokenReference: join(root, 'operator-token'),
    courseMappings: [
      {
        classId,
        sectionCode: 'Synthetic C509 CODE-A',
        providerCourseKey: '123456789',
        attendanceClassCode: 'C509-A',
      },
    ],
    checkInOpenMinutesBefore: 5,
    dismissalWarningMinutesBefore: 5,
  });
  new SqliteDatabase(databasePath, {
    migration: { appliedAt: requestedAt },
  }).close();
  const environment: NodeJS.ProcessEnv = {
    CLASSROOM_HUB_PRODUCTION_CONFIG_REFERENCE: configReference,
    CLASSROOM_HUB_INSTANCE_ID: 'classroom-hub-c509-production',
    CLASSROOM_HUB_OPERATIONS_SCOPE_ID: 'c509-production',
    CLASSROOM_HUB_TIME_ZONE: 'Asia/Ho_Chi_Minh',
    CLASSROOM_HUB_MANAGED_ROOT: managedRoot,
    CLASSROOM_HUB_DATABASE_PATH: databasePath,
    CLASSROOM_HUB_BACKUP_DIRECTORY: backupDirectory,
    CLASSROOM_HUB_ACADEMIC_YEAR_END: '2035-06-30',
    CLASSROOM_HUB_JOB_DEADLINE_SECONDS: '60',
    CLASSROOM_HUB_ALERT_DELIVERY_MODE: 'report-only',
    CLASSROOM_HUB_POWERSCHOOL_ROOM_ID: roomId,
    CLASSROOM_HUB_POWERSCHOOL_ORIGIN: 'https://powerschool.invalid',
    CLASSROOM_HUB_POWERSCHOOL_STATUS_PATH: '/teachers/home.html',
    CLASSROOM_HUB_POWERSCHOOL_STATUS_READY_SELECTOR: '#status-ready',
    CLASSROOM_HUB_POWERSCHOOL_BELL_PATH_TEMPLATE:
      '/teachers/aet_schedulebell.html?target_date={date-us}',
    CLASSROOM_HUB_POWERSCHOOL_BELL_READY_SELECTOR: '#bell-ready',
    CLASSROOM_HUB_POWERSCHOOL_SESSION_DIRECTORY: join(
      root,
      'powerschool-session',
    ),
    CLASSROOM_HUB_CLASSROOM_CREDENTIAL_REFERENCE: credentialReference,
    CLASSROOM_HUB_CLASSROOM_COURSE_MAPPINGS: JSON.stringify([
      { classId, providerCourseKey: '123456789' },
    ]),
    CLASSROOM_HUB_CLASSROOM_CACHE_FRESH_SECONDS: '900',
    CLASSROOM_HUB_CLASSROOM_BACKOFF_BASE_SECONDS: '60',
    CLASSROOM_HUB_CLASSROOM_BACKOFF_MAX_SECONDS: '900',
  };
  return {
    root,
    databasePath,
    environment,
    close: () => rmSync(root, { recursive: true, force: true }),
  };
}

function m17CalendarEnvironment(fixture: {
  readonly root: string;
  readonly databasePath: string;
}): NodeJS.ProcessEnv {
  const calendarId = 'auto-lesson-2@example.test';
  const reference = join(fixture.root, 'm17-calendar.json');
  const productionReference = join(fixture.root, 'm17-production-server.json');
  writeNewProtectedJson(productionReference, {
    version: 1,
    instanceId: 'classroom-hub-c509-canary-production',
    roomId,
    screenId,
    screenLabel: 'C509 Classroom Display',
    host: '127.0.0.1',
    port: 4317,
    timeZone: 'Asia/Ho_Chi_Minh',
    academicYearEnd: '2035-06-30',
    managedRoot: join(fixture.root, 'classroom-hub-production'),
    databasePath: fixture.databasePath,
    backupDirectory: join(fixture.root, 'classroom-hub-production', 'backups'),
    operatorTokenReference: join(fixture.root, 'operator-token'),
    courseMappings: [
      {
        classId,
        sectionCode: 'Synthetic C509 CODE-A',
        providerCourseKey: '123456789',
        attendanceClassCode: 'C509-A',
      },
    ],
    checkInOpenMinutesBefore: 5,
    dismissalWarningMinutesBefore: 5,
  });
  writeNewProtectedJson(reference, {
    version: 1,
    kind: 'chalkwright-m17-parallel-canary',
    calendarSummary: 'Auto Lesson 2',
    calendarId,
    calendarReferenceHash: digestCalendarReference(calendarId),
    deniedCalendarReferenceHashes: [
      digestCalendarReference('primary'),
      digestCalendarReference('legacy@example.test'),
    ],
    scopeId: 'chalkwright-c509-2035-canary',
    timeZone: 'Asia/Ho_Chi_Minh',
    productionConfigReference: productionReference,
    credentialReferencePath: join(fixture.root, 'calendar-writer.json'),
    databasePath: fixture.databasePath,
    requestTimeoutMs: 5_000,
    overallTimeoutMs: 60_000,
    leaseDurationSeconds: 120,
    maximumPages: 1,
    maximumEvents: 10,
  });
  return { CHALKWRIGHT_M17_CANARY_CONFIG_REFERENCE: reference };
}

function digestCalendarReference(value: string): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

function planEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(environment).filter(
      ([name]) => !name.startsWith('CLASSROOM_HUB_CLASSROOM_'),
    ),
  );
}

function classroomEnvironment(
  environment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(environment).filter(
      ([name]) => !name.startsWith('CLASSROOM_HUB_POWERSCHOOL_'),
    ),
  );
}

async function seedEffectivePlan(
  databasePath: string,
  plan: EffectiveDayPlan,
): Promise<void> {
  using database = new SqliteDatabase(databasePath, {
    migration: { appliedAt: requestedAt },
  });
  assert.equal(
    (await repositoryFor(database).storeEffective(plan)).status,
    'stored',
  );
}

function repositoryFor(database: SqliteDatabase) {
  let revision = 0;
  return new SqliteApplicationStateRepository(database, {
    clock: { now: () => requestedAt },
    nextRevision: () => `production-job-test-${++revision}`,
    academicYearEndForDate: () => '2035-06-30',
  });
}

function scheduleObservation(): ScheduleObservation {
  return scheduleObservationForDate(date, true);
}

function scheduleObservationForDate(
  observedForDate: IsoDate,
  hasClasses: boolean,
): ScheduleObservation {
  return {
    contractVersion,
    observationId: 'production-plan-observation',
    observedForDate,
    kind: hasClasses ? 'normal' : 'no-classes',
    verification: 'verified',
    periods: hasClasses
      ? [
          {
            periodId: `period-${observedForDate}`,
            courseKey: 'CODE-A',
            blockLabel: 'A',
            roomKey: roomId,
            startsAt: `${observedForDate}T01:00:00.000Z`,
            endsAt: `${observedForDate}T06:00:00.000Z`,
          },
        ]
      : [],
    provenance: {
      source: 'powerschool',
      method: 'session-http',
      observedAt: requestedAt,
      verification: 'verified',
      sourceReference: 'synthetic-production-plan',
    },
    freshness: { state: 'fresh', observedAt: requestedAt },
    diagnostics: [],
  };
}

function effectivePlan(): EffectiveDayPlan {
  return effectivePlanForDate(date);
}

function effectivePlanForDate(planDate: IsoDate): EffectiveDayPlan {
  return {
    contractVersion,
    effectivePlanId: `production-effective-plan-${planDate}`,
    canonicalPlanId: `production-canonical-plan-${planDate}`,
    date: planDate,
    timeZone: 'Asia/Ho_Chi_Minh',
    roomId,
    screenId,
    verification: 'verified',
    meetings: [
      {
        meetingId: `production-meeting-a-${planDate}`,
        courseKey: 'CODE-A',
        blockLabel: 'A',
        checkInOpensAt: `${planDate}T00:55:00.000Z`,
        officialStartsAt: `${planDate}T01:00:00.000Z`,
        checkInClosesAt: `${planDate}T01:00:00.000Z`,
        contentStartsAt: `${planDate}T01:00:00.000Z`,
        dismissalStartsAt: `${planDate}T05:55:00.000Z`,
        officialEndsAt: `${planDate}T06:00:00.000Z`,
      },
    ],
    diagnostics: [],
  };
}

function enrichment(requestedClass: ClassId): CourseworkEnrichment {
  return {
    observedForDate: date,
    classId: requestedClass,
    freshness: 'fresh',
    recent: [],
    upcoming: [],
    refreshedAt: requestedAt,
    provenanceReference: `google-classroom:${requestedClass}`,
  };
}
