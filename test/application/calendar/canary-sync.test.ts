import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { synchronizeM17CanaryCalendar } from '../../../src/application/calendar/canary-sync.js';
import { calendarOwnershipMarker } from '../../../src/config/google-calendar.js';
import {
  contractVersion,
  type OpaqueId,
} from '../../../src/contracts/v1/common.js';
import type { EffectiveDayPlan } from '../../../src/domain/plans.js';
import {
  roomIdFromLocation,
  screenIdFromLocation,
} from '../../../src/domain/identities.js';
import type {
  CalendarMutationTransport,
  CalendarWriterObservedEvent,
} from '../../../src/ports/calendar-mutation-transport.js';
import type { CalendarEventListTransport } from '../../../src/infrastructure/google-calendar/contracts.js';
import { SqliteCalendarExecutionState } from '../../../src/infrastructure/sqlite/calendar-execution-state.js';
import { SqliteDatabase } from '../../../src/infrastructure/sqlite/database.js';

const now = '2035-04-13T00:00:00.000Z';
const timeMin = '2035-04-12T17:00:00.000Z';
const timeMax = '2035-04-13T17:00:00.000Z';
const scopeId = 'chalkwright-c509-2035-canary' as OpaqueId;
const calendarId = 'auto-lesson-2@example.test';

function plan(): EffectiveDayPlan {
  const roomId = roomIdFromLocation('C509');
  const screenId = screenIdFromLocation('screen-c509-canary');
  if (roomId === undefined || screenId === undefined)
    throw new Error('synthetic-identity-invalid');
  return {
    contractVersion,
    effectivePlanId: 'effective-m17',
    canonicalPlanId: 'canonical-m17',
    date: '2035-04-13',
    timeZone: 'Asia/Ho_Chi_Minh',
    roomId,
    screenId,
    verification: 'verified',
    diagnostics: [],
    meetings: [
      {
        meetingId: 'meeting-a',
        courseKey: 'course-a',
        blockLabel: 'Block A',
        checkInOpensAt: '2035-04-13T00:50:00.000Z',
        officialStartsAt: '2035-04-13T01:00:00.000Z',
        checkInClosesAt: '2035-04-13T01:00:00.000Z',
        contentStartsAt: '2035-04-13T01:00:00.000Z',
        dismissalStartsAt: '2035-04-13T01:40:00.000Z',
        officialEndsAt: '2035-04-13T01:45:00.000Z',
      },
    ],
  };
}

test('writes only Auto Lesson 2, then converges without another mutation', async () => {
  const root = mkdtempSync(join(tmpdir(), 'chalkwright-m17-sync-'));
  let provider: CalendarWriterObservedEvent | undefined;
  let mutations = 0;
  const listTransport: CalendarEventListTransport = {
    async listEvents(request) {
      assert.equal(request.calendarId, calendarId);
      return {
        items:
          provider === undefined
            ? []
            : [
                {
                  id: provider.eventReference,
                  etag: provider.etag,
                  status: 'confirmed',
                  eventType: 'default',
                  summary: provider.summary,
                  description: provider.description,
                  start: {
                    dateTime: provider.startsAt,
                    timeZone: provider.timeZone,
                  },
                  end: {
                    dateTime: provider.endsAt,
                    timeZone: provider.timeZone,
                  },
                  extendedProperties: {
                    private: {
                      classroomHubOwner: 'classroom-hub',
                      classroomHubScope: scopeId,
                      classroomHubOwnershipMarker: calendarOwnershipMarker,
                    },
                  },
                },
              ],
      };
    },
  };
  const mutationTransport: CalendarMutationTransport = {
    async getEvent() {
      return provider === undefined
        ? { status: 'not-found' }
        : { status: 'found', event: provider };
    },
    async insertEvent(request) {
      assert.equal(request.calendarId, calendarId);
      assert.equal(request.sendUpdates, 'none');
      mutations += 1;
      provider = {
        ...request.desired,
        eventReference: request.eventReference,
        etag: 'etag-1',
        ownership: {
          owner: 'classroom-hub',
          scopeId: request.ownership.scopeId,
          ownershipMarker: request.ownership.ownershipMarker,
        },
      };
      return provider;
    },
    async updateEvent() {
      throw new Error('unexpected-update');
    },
    async deleteEvent() {
      throw new Error('unexpected-delete');
    },
  };
  try {
    using database = new SqliteDatabase(join(root, 'state.sqlite'), {
      migration: { appliedAt: now },
    });
    const options = {
      calendarId,
      scopeId,
      plan: plan(),
      timeMin,
      timeMax,
      requestTimeoutMs: 5_000,
      maximumPages: 2,
      maximumEvents: 10,
      leaseDurationSeconds: 120,
      clock: () => now,
      signal: new AbortController().signal,
      listTransport,
      mutationTransport,
      state: new SqliteCalendarExecutionState(database),
      execute: true,
    };
    const first = await synchronizeM17CanaryCalendar(options);
    assert.equal(first.status, 'succeeded', JSON.stringify(first));
    assert.equal(first.completedExternalMutations, 1);
    const second = await synchronizeM17CanaryCalendar(options);
    assert.equal(second.status, 'succeeded', JSON.stringify(second));
    assert.equal(second.completedExternalMutations, 0);
    assert.equal(mutations, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('accepts bounded deterministic intent identities composed from real plan scope', async () => {
  const root = mkdtempSync(join(tmpdir(), 'chalkwright-m17-long-intent-'));
  let inserted = 0;
  const realisticPlan = plan();
  const longPlan: EffectiveDayPlan = {
    ...realisticPlan,
    effectivePlanId:
      'effective-plan-2035-04-13-room-c509-screen-screen-c509-canary-production',
    meetings: realisticPlan.meetings.map((meeting) => ({
      ...meeting,
      meetingId:
        'meeting-2035-04-13-room-c509-period-computer-fundamentals-mict02-2',
    })),
  };
  try {
    using database = new SqliteDatabase(join(root, 'state.sqlite'), {
      migration: { appliedAt: now },
    });
    const state = new SqliteCalendarExecutionState(database);
    const result = await synchronizeM17CanaryCalendar({
      calendarId,
      scopeId:
        'chalkwright-screen-c509-canary-production-auto-lesson-2-canary' as OpaqueId,
      plan: longPlan,
      timeMin,
      timeMax,
      requestTimeoutMs: 5_000,
      maximumPages: 1,
      maximumEvents: 10,
      leaseDurationSeconds: 120,
      clock: () => now,
      signal: new AbortController().signal,
      listTransport: {
        async listEvents() {
          return { items: [] };
        },
      },
      mutationTransport: {
        async getEvent() {
          return { status: 'not-found' };
        },
        async insertEvent(request) {
          assert.ok(request.eventReference.length < 128);
          inserted += 1;
          return {
            ...request.desired,
            eventReference: request.eventReference,
            etag: 'etag-long-intent',
            ownership: {
              owner: 'classroom-hub',
              scopeId: request.ownership.scopeId,
              ownershipMarker: request.ownership.ownershipMarker,
            },
          };
        },
        async updateEvent() {
          throw new Error('unexpected-update');
        },
        async deleteEvent() {
          throw new Error('unexpected-delete');
        },
      },
      state,
      execute: true,
    });
    assert.equal(result.status, 'succeeded', JSON.stringify(result));
    assert.equal(result.completedExternalMutations, 1);
    assert.equal(inserted, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('malformed provider evidence blocks with zero mutation', async () => {
  let mutations = 0;
  const result = await synchronizeM17CanaryCalendar({
    calendarId,
    scopeId,
    plan: plan(),
    timeMin,
    timeMax,
    requestTimeoutMs: 5_000,
    maximumPages: 1,
    maximumEvents: 10,
    leaseDurationSeconds: 120,
    clock: () => now,
    signal: new AbortController().signal,
    listTransport: {
      async listEvents() {
        return { items: [{ id: 'malformed' }] };
      },
    },
    state: {} as never,
    execute: false,
  });
  assert.equal(result.code, 'm17-canary-audit-blocked');
  assert.equal(result.attemptedExternalMutations, 0);
  assert.equal(mutations, 0);
});

test('read-only preflight returns exact intents without mutation capability use', async () => {
  const result = await synchronizeM17CanaryCalendar({
    calendarId,
    scopeId,
    plan: plan(),
    timeMin,
    timeMax,
    requestTimeoutMs: 5_000,
    maximumPages: 1,
    maximumEvents: 10,
    leaseDurationSeconds: 120,
    clock: () => now,
    signal: new AbortController().signal,
    execute: false,
    listTransport: {
      async listEvents() {
        return { items: [] };
      },
    },
    state: {} as never,
  });
  assert.equal(result.code, 'm17-canary-calendar-preflight-ready');
  assert.equal(result.intentCount, 1);
  assert.equal(result.attemptedExternalMutations, 0);
});
