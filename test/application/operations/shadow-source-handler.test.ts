import assert from 'node:assert/strict';
import test from 'node:test';

import { createShadowSourceAuthHandler } from '../../../src/application/shadow/source-handler.js';
import { contractVersion } from '../../../src/contracts/v1/common.js';
import type { ScheduleObservation } from '../../../src/contracts/v1/schedule.js';
import type { ShadowConfig } from '../../../src/config/shadow.js';
import type {
  ClassId,
  RoomId,
  ScreenId,
} from '../../../src/domain/identities.js';
import type {
  CanonicalPlan,
  EffectiveDayPlan,
} from '../../../src/domain/plans.js';

const config: ShadowConfig = {
  instanceId: 'synthetic-shadow',
  roomId: 'room-c509' as RoomId,
  screenId: 'screen-c509-shadow' as ScreenId,
  screenLabel: 'C509 Shadow',
  host: '127.0.0.1',
  port: 4328,
  productionPort: 20790,
  timeZone: 'Asia/Ho_Chi_Minh',
  academicYearEnd: '2035-06-30',
  managedRoot: '/synthetic/shadow',
  databasePath: '/synthetic/shadow/state/app.sqlite',
  backupDirectory: '/synthetic/shadow/backups',
  courseMappings: [
    {
      classId: 'class-a' as ClassId,
      sectionCode: 'English CODE-A C509',
      providerCourseKey: '123',
      roomId: 'room-c509' as RoomId,
    },
  ],
  checkInOpenMinutesBefore: 5,
  dismissalWarningMinutesBefore: 5,
};

const observation: ScheduleObservation = {
  contractVersion,
  observationId: 'observation-a',
  observedForDate: '2035-04-13',
  kind: 'normal',
  verification: 'verified',
  periods: [
    {
      periodId: 'period-a',
      courseKey: 'CODE-A',
      blockLabel: 'A',
      roomKey: 'room-c509',
      startsAt: '2035-04-13T01:00:00Z',
      endsAt: '2035-04-13T02:00:00Z',
    },
  ],
  provenance: {
    source: 'powerschool',
    method: 'session-http',
    observedAt: '2035-04-13T00:00:00Z',
    verification: 'verified',
    sourceReference: 'synthetic',
  },
  freshness: { state: 'fresh', observedAt: '2035-04-13T00:00:00Z' },
  diagnostics: [],
};

const request = {
  jobName: 'source-auth-preflight' as const,
  runId: 'run-a',
  scopeId: 'shadow-scope',
  requestedAt: '2035-04-13T00:00:00Z',
  deadlineAt: '2035-04-13T00:01:00Z',
};

test('stores verified canonical and screen-scoped plans with zero external mutations', async () => {
  const canonical: CanonicalPlan[] = [];
  const effective: EffectiveDayPlan[] = [];
  const handler = createShadowSourceAuthHandler({
    config,
    sourceForRun: () => ({
      readSchedule: async () => ({ status: 'observed', observation }),
    }),
    plans: {
      storeCanonical: async (plan) => {
        canonical.push(plan);
        return { status: 'stored', revision: 'canonical' };
      },
      storeEffective: async (plan) => {
        effective.push(plan);
        return { status: 'stored', revision: 'effective' };
      },
    },
  });
  const result = await handler(request, new AbortController().signal);
  assert.equal(result.category, 'succeeded');
  assert.equal(result.attemptedExternalMutations, 0);
  assert.equal(canonical.length, 1);
  assert.equal(effective[0]?.screenId, config.screenId);
});

test('stores an authoritative empty plan when the verified schedule has no classes', async () => {
  const canonical: CanonicalPlan[] = [];
  const effective: EffectiveDayPlan[] = [];
  const handler = createShadowSourceAuthHandler({
    config,
    sourceForRun: () => ({
      readSchedule: async () => ({
        status: 'observed',
        observation: {
          ...observation,
          kind: 'no-classes',
          periods: [],
          diagnostics: [
            {
              code: 'schedule-no-classes',
              severity: 'info',
              message:
                'The verified schedule contains no classes for the requested date.',
            },
          ],
        },
      }),
    }),
    plans: {
      storeCanonical: async (plan) => {
        canonical.push(plan);
        return { status: 'stored', revision: 'canonical-empty' };
      },
      storeEffective: async (plan) => {
        effective.push(plan);
        return { status: 'stored', revision: 'effective-empty' };
      },
    },
  });

  const result = await handler(request, new AbortController().signal);
  assert.equal(result.category, 'succeeded');
  assert.equal(result.attemptedExternalMutations, 0);
  assert.deepEqual(canonical[0]?.meetings, []);
  assert.deepEqual(effective[0]?.meetings, []);
});

test('returns repair-required and performs no writes', async () => {
  let writes = 0;
  const handler = createShadowSourceAuthHandler({
    config,
    sourceForRun: () => ({
      readSchedule: async () => ({
        status: 'repair-required',
        error: {
          category: 'authentication-repair-required',
          code: 'session-state-rejected',
          message: 'Repair.',
          retryable: false,
          diagnostics: [],
        },
      }),
    }),
    plans: {
      storeCanonical: async () => {
        writes += 1;
        return { status: 'stored', revision: 'x' };
      },
      storeEffective: async () => {
        writes += 1;
        return { status: 'stored', revision: 'x' };
      },
    },
  });
  const result = await handler(request, new AbortController().signal);
  assert.equal(result.category, 'repair-required');
  if (result.category === 'repair-required') {
    assert.equal(
      result.error.code,
      'shadow-powerschool-session-state-rejected',
    );
  }
  assert.equal(writes, 0);
});
