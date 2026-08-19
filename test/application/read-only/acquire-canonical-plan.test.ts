import assert from 'node:assert/strict';
import test from 'node:test';

import { acquireCanonicalPlan } from '../../../src/application/read-only/acquire-canonical-plan.js';
import { contractVersion } from '../../../src/contracts/v1/common.js';
import type { ScheduleObservation } from '../../../src/contracts/v1/schedule.js';
import type { ClassId, RoomId } from '../../../src/domain/identities.js';
import type { ScheduleObservationSource } from '../../../src/ports/read-sources.js';

const roomId = 'room-b407' as RoomId;
const observation: ScheduleObservation = {
  contractVersion,
  observationId: 'synthetic-observation',
  observedForDate: '2035-04-13',
  kind: 'normal',
  verification: 'verified',
  periods: [
    {
      periodId: 'period-1',
      courseKey: 'course-1',
      blockLabel: 'Period 1',
      roomKey: roomId,
      startsAt: '2035-04-13T08:00:00Z',
      endsAt: '2035-04-13T09:00:00Z',
    },
  ],
  provenance: {
    source: 'powerschool',
    method: 'session-http',
    observedAt: '2035-04-13T07:00:00Z',
    verification: 'verified',
    sourceReference: 'synthetic-bell-schedule',
  },
  freshness: { state: 'fresh', observedAt: '2035-04-13T07:00:00Z' },
  diagnostics: [],
};

test('read-only acquisition makes the normalized observation authoritative for canonical planning', async () => {
  const source: ScheduleObservationSource = {
    readSchedule: async () => ({ status: 'observed', observation }),
  };
  const result = await acquireCanonicalPlan(source, {
    date: '2035-04-13',
    roomId,
    mappings: [
      {
        classId: 'class-1' as ClassId,
        sectionCode: 'Course 1',
        roomId,
        periodId: 'period-1',
      },
    ],
    timing: {
      timeZone: 'America/Chicago',
      checkInOpenMinutesBefore: 10,
      dismissalWarningMinutesBefore: 5,
    },
  });

  assert.equal(result.status, 'planned');
  if (result.status === 'planned') {
    assert.deepEqual(result.plan.sourceObservationIds, [
      'synthetic-observation',
    ]);
    assert.equal(result.plan.roomId, roomId);
    assert.equal(result.plan.timeZone, 'America/Chicago');
    assert.equal(
      result.plan.meetings[0]?.officialStartsAt,
      '2035-04-13T08:00:00Z',
    );
  }
});

test('acquisition exposes no writer and preserves repair-required results', async () => {
  const source: ScheduleObservationSource = {
    readSchedule: async () => ({
      status: 'repair-required',
      error: {
        category: 'authentication-repair-required',
        code: 'powerschool-session-expired',
        message: 'Repair required.',
        retryable: false,
        diagnostics: [],
      },
    }),
  };
  const result = await acquireCanonicalPlan(source, {
    date: '2035-04-13',
    roomId,
    mappings: [],
    timing: {
      timeZone: 'America/Chicago',
      checkInOpenMinutesBefore: 10,
      dismissalWarningMinutesBefore: 5,
    },
  });
  assert.equal(result.status, 'repair-required');
  assert.equal(acquireCanonicalPlan.length, 2);
});

test('acquisition rejects invalid, mismatched, stale, and unverified observations', async () => {
  for (const candidate of [
    { ...observation, observedForDate: '2035-04-14' },
    {
      ...observation,
      freshness: {
        state: 'stale' as const,
        observedAt: observation.freshness.observedAt,
      },
    },
    {
      ...observation,
      verification: 'unverified' as const,
      provenance: {
        ...observation.provenance,
        verification: 'unverified' as const,
      },
    },
    {
      ...observation,
      provenance: {
        ...observation.provenance,
        verification: 'unverified' as const,
      },
    },
    {
      ...observation,
      periods: [{ ...observation.periods[0]!, startsAt: 'invalid' }],
    },
    { ...observation, kind: 'no-classes' as const },
    { ...observation, periods: [] },
  ]) {
    const source: ScheduleObservationSource = {
      readSchedule: async () => ({
        status: 'observed',
        observation: candidate,
      }),
    };
    const result = await acquireCanonicalPlan(source, {
      date: '2035-04-13',
      roomId,
      mappings: [
        {
          classId: 'class-1' as ClassId,
          sectionCode: 'Course 1',
          roomId,
          periodId: 'period-1',
        },
      ],
      timing: {
        timeZone: 'America/Chicago',
        checkInOpenMinutesBefore: 10,
        dismissalWarningMinutesBefore: 5,
      },
    });
    assert.equal(result.status, 'not-found');
  }
});

test('acquisition preserves an ordered period when only the dismissal display window is short', async () => {
  const shortPeriod: ScheduleObservation = {
    ...observation,
    periods: [
      {
        ...observation.periods[0]!,
        endsAt: '2035-04-13T08:05:00Z',
      },
    ],
  };
  const source: ScheduleObservationSource = {
    readSchedule: async () => ({
      status: 'observed',
      observation: shortPeriod,
    }),
  };
  const result = await acquireCanonicalPlan(source, {
    date: '2035-04-13',
    roomId,
    mappings: [
      {
        classId: 'class-1' as ClassId,
        sectionCode: 'Course 1',
        roomId,
        periodId: 'period-1',
      },
    ],
    timing: {
      timeZone: 'America/Chicago',
      checkInOpenMinutesBefore: 10,
      dismissalWarningMinutesBefore: 5,
    },
  });

  assert.equal(result.status, 'planned');
  if (result.status === 'planned') {
    assert.equal(result.plan.meetings.length, 1);
    assert.equal(
      result.plan.meetings[0]?.officialStartsAt,
      '2035-04-13T08:00:00Z',
    );
    assert.equal(
      result.plan.meetings[0]?.officialEndsAt,
      '2035-04-13T08:05:00Z',
    );
    assert.ok(
      result.plan.diagnostics.some(
        (diagnostic) => diagnostic.code === 'plan-has-no-valid-meetings',
      ) === false,
    );
    assert.ok(
      result.plan.diagnostics.some(
        (diagnostic) => diagnostic.code === 'period-dismissal-window-adjusted',
      ),
    );
  }
});
