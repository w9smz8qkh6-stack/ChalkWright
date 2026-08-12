import assert from 'node:assert/strict';
import test from 'node:test';

import {
  contractVersion,
  type CalendarOwnership,
} from '../../../src/contracts/v1/index.js';
import {
  desiredCalendarEvents,
  planCalendarReconciliation,
  type ExistingCalendarEvent,
} from '../../../src/application/planning/calendar-intents.js';
import type { RoomId, ScreenId } from '../../../src/domain/identities.js';
import type { EffectiveDayPlan } from '../../../src/domain/plans.js';
import { buildMeeting } from '../../fixtures/builders.js';

const ownership: CalendarOwnership = {
  classification: 'verified-application-owned',
  scopeId: 'scope-alpha',
  ownershipMarker: 'classroom-hub-v1',
};
function plan(): EffectiveDayPlan {
  return {
    contractVersion,
    effectivePlanId: 'effective-alpha',
    canonicalPlanId: 'plan-alpha',
    date: '2035-04-13',
    timeZone: 'Etc/UTC',
    roomId: 'room-alpha' as RoomId,
    screenId: 'screen-alpha' as ScreenId,
    verification: 'verified',
    diagnostics: [],
    meetings: [
      buildMeeting({
        id: 'm1',
        courseKey: 'course-alpha',
        blockLabel: 'Block A',
        checkInOpensAt: '2035-04-13T07:55:00Z',
        officialStartsAt: '2035-04-13T08:00:00Z',
        checkInClosesAt: '2035-04-13T08:00:00Z',
        contentStartsAt: '2035-04-13T08:00:00Z',
        dismissalStartsAt: '2035-04-13T08:55:00Z',
        officialEndsAt: '2035-04-13T09:00:00Z',
      }),
    ],
  };
}
function desired() {
  return desiredCalendarEvents({
    plan: plan(),
    scopeId: ownership.scopeId,
    summaries: { 'course-alpha': 'Class A' },
    description: 'Synthetic class schedule',
  });
}
function existing(
  reference: string,
  changes: Partial<ExistingCalendarEvent> = {},
): ExistingCalendarEvent {
  const event = desired()[0]!;
  return {
    eventReference: reference,
    ownership,
    summary: event.summary,
    description: event.description,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    timeZone: event.timeZone,
    ...changes,
  };
}

test('plans create, no-op, replace, duplicate cleanup, and obsolete deletion intents', () => {
  assert.deepEqual(
    planCalendarReconciliation({
      plan: plan(),
      desired: desired(),
      existing: [],
      ownership,
      force: false,
    }).intents.map((item) => item.kind),
    ['create'],
  );
  assert.deepEqual(
    planCalendarReconciliation({
      plan: plan(),
      desired: desired(),
      existing: [existing('one')],
      ownership,
      force: false,
    }).intents.map((item) => item.kind),
    ['no-op'],
  );
  assert.deepEqual(
    planCalendarReconciliation({
      plan: plan(),
      desired: desired(),
      existing: [existing('one', { startsAt: '2035-04-13T08:01:00Z' })],
      ownership,
      force: false,
    }).intents.map((item) => item.kind),
    ['replace'],
  );
  assert.deepEqual(
    planCalendarReconciliation({
      plan: plan(),
      desired: desired(),
      existing: [existing('one'), existing('two')],
      ownership,
      force: false,
    }).intents.map((item) => item.kind),
    ['no-op', 'delete'],
  );
  assert.deepEqual(
    planCalendarReconciliation({
      plan: plan(),
      desired: [],
      existing: [existing('one')],
      ownership,
      force: false,
    }).intents.map((item) => item.kind),
    ['delete'],
  );
});

test('fingerprints are byte stable and force bypasses only the fingerprint short-circuit', () => {
  const first = planCalendarReconciliation({
    plan: plan(),
    desired: desired(),
    existing: [existing('one')],
    ownership,
    force: false,
  });
  const second = planCalendarReconciliation({
    plan: plan(),
    desired: desired(),
    existing: [existing('one')],
    ownership,
    previousFingerprint: first.fingerprint,
    force: false,
  });
  assert.equal(
    first.fingerprint,
    planCalendarReconciliation({
      plan: plan(),
      desired: desired(),
      existing: [existing('one')],
      ownership,
      force: false,
    }).fingerprint,
  );
  assert.equal(second.shouldReconcile, false);
  assert.equal(second.intents.length, 0);
  const forced = planCalendarReconciliation({
    plan: plan(),
    desired: desired(),
    existing: [existing('one')],
    ownership,
    previousFingerprint: first.fingerprint,
    force: true,
  });
  assert.equal(forced.shouldReconcile, true);
  assert.deepEqual(
    forced.intents.map((item) => item.kind),
    ['no-op'],
  );
});

test('ignores unrelated ownership, rejects invalid intervals, suppresses notifications, and converges', () => {
  const unrelated = existing('other', {
    ownership: { ...ownership, scopeId: 'other-scope' },
  });
  const created = planCalendarReconciliation({
    plan: plan(),
    desired: desired(),
    existing: [unrelated],
    ownership,
    force: true,
  });
  assert.deepEqual(
    created.intents.map((item) => item.kind),
    ['create'],
  );
  assert.ok(
    created.diagnostics.some(
      (item) => item.code === 'calendar-events-unrelated',
    ),
  );
  assert.ok(created.intents.every((item) => item.notifyAttendees === false));
  const bad = [{ ...desired()[0]!, endsAt: '2035-04-13T07:00:00Z' }];
  assert.equal(
    planCalendarReconciliation({
      plan: plan(),
      desired: bad,
      existing: [],
      ownership,
      force: true,
    }).diagnostics[0]?.code,
    'calendar-interval-invalid',
  );
  const afterCreate = [existing('created')];
  assert.deepEqual(
    planCalendarReconciliation({
      plan: plan(),
      desired: desired(),
      existing: afterCreate,
      ownership,
      force: true,
    }).intents.map((item) => item.kind),
    ['no-op'],
  );
});

test('refuses Calendar intents for stale or otherwise unverified plan material', () => {
  const unverified = { ...plan(), verification: 'unverified' as const };
  assert.deepEqual(
    desiredCalendarEvents({
      plan: unverified,
      scopeId: ownership.scopeId,
      summaries: { 'course-alpha': 'Class A' },
      description: 'Synthetic class schedule',
    }),
    [],
  );
  const result = planCalendarReconciliation({
    plan: unverified,
    desired: desired(),
    existing: [],
    ownership,
    force: true,
  });
  assert.equal(result.intents.length, 0);
  assert.equal(result.shouldReconcile, false);
  assert.equal(result.diagnostics[0]?.code, 'calendar-plan-not-authoritative');
});
