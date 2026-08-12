import assert from 'node:assert/strict';
import test from 'node:test';

import {
  auditCalendarOwnership,
  fingerprintEvent,
} from '../../../src/application/calendar/ownership-audit.js';
import { desiredCalendarEvents } from '../../../src/application/planning/calendar-intents.js';
import {
  contractVersion,
  type CalendarOwnership,
} from '../../../src/contracts/v1/index.js';
import type { ObservedCalendarEvent } from '../../../src/domain/calendar-audit.js';
import type { RoomId, ScreenId } from '../../../src/domain/identities.js';
import type { EffectiveDayPlan } from '../../../src/domain/plans.js';
import { buildMeeting } from '../../fixtures/builders.js';

const ownership: CalendarOwnership = {
  classification: 'verified-application-owned',
  scopeId: 'scope-alpha',
  ownershipMarker: 'classroom-hub-v1',
};

function effectivePlan(): EffectiveDayPlan {
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
        id: 'meeting-alpha',
        courseKey: 'course-alpha',
        blockLabel: 'Block A',
        checkInOpensAt: '2035-04-13T07:55:00.000Z',
        officialStartsAt: '2035-04-13T08:00:00.000Z',
        checkInClosesAt: '2035-04-13T08:00:00.000Z',
        contentStartsAt: '2035-04-13T08:00:00.000Z',
        dismissalStartsAt: '2035-04-13T08:55:00.000Z',
        officialEndsAt: '2035-04-13T09:00:00.000Z',
      }),
    ],
  };
}

function desired() {
  return desiredCalendarEvents({
    plan: effectivePlan(),
    scopeId: ownership.scopeId,
    summaries: { 'course-alpha': 'Synthetic class' },
    description: 'Synthetic schedule',
  });
}

function event(
  changes: Partial<ObservedCalendarEvent> = {},
): ObservedCalendarEvent {
  return {
    eventReference: 'event-alpha',
    summary: 'Synthetic class',
    description: 'Synthetic schedule',
    startsAt: '2035-04-13T08:00:00.000Z',
    endsAt: '2035-04-13T09:00:00.000Z',
    timeZone: 'Etc/UTC',
    eventType: 'default',
    recurringInstance: false,
    privateOwnership: {},
    ...changes,
  };
}

function audit(
  observed: readonly ObservedCalendarEvent[],
  options: {
    approvals?: Parameters<
      typeof auditCalendarOwnership
    >[0]['adoptionApprovals'];
    invalid?: number;
    unsupported?: number;
    calendarId?: string;
    timeMin?: string;
    timeMax?: string;
    ownership?: CalendarOwnership;
  } = {},
) {
  return auditCalendarOwnership({
    calendarId: options.calendarId ?? 'synthetic-calendar@example.test',
    timeMin: options.timeMin ?? '2035-04-13T00:00:00.000Z',
    timeMax: options.timeMax ?? '2035-04-14T00:00:00.000Z',
    plan: effectivePlan(),
    desired: desired(),
    observed,
    ownership: options.ownership ?? ownership,
    adoptionApprovals: options.approvals ?? [],
    invalidProviderItemCount: options.invalid ?? 0,
    unsupportedProviderItemCount: options.unsupported ?? 0,
    force: true,
  });
}

test('verified marker permits an inert exact no-op plan', () => {
  const result = audit([
    event({
      privateOwnership: {
        owner: 'classroom-hub',
        scopeId: ownership.scopeId,
        ownershipMarker: ownership.ownershipMarker,
      },
    }),
  ]);
  assert.equal(result.evidence.readyForReconciliation, true);
  assert.deepEqual(
    result.intents.map((intent) => intent.kind),
    ['no-op'],
  );
  assert.equal(result.evidence.counts.verifiedOwned, 1);
  assert.equal(result.evidence.attemptedExternalMutations, 0);
});

test('unmarked semantic matches require explicit adoption and suppress intents', () => {
  const candidate = event();
  const blocked = audit([candidate]);
  assert.equal(blocked.evidence.readyForReconciliation, false);
  assert.equal(blocked.evidence.counts.legacyCandidates, 1);
  assert.deepEqual(blocked.intents, []);
  assert.ok(
    blocked.evidence.blockerCodes.includes('calendar-legacy-adoption-required'),
  );
  assert.deepEqual(blocked.evidence.proposedIntentCounts, {
    noOp: 0,
    create: 1,
    replace: 0,
    delete: 0,
  });
  assert.doesNotMatch(
    JSON.stringify(blocked.evidence),
    /event-alpha|Synthetic/u,
  );

  const approved = audit([candidate], {
    approvals: [
      {
        eventReference: candidate.eventReference,
        eventFingerprint: fingerprintEvent(candidate),
        scopeId: ownership.scopeId,
        ownershipMarker: ownership.ownershipMarker,
        disposition: 'approved-adoption',
      },
    ],
  });
  assert.equal(approved.evidence.readyForReconciliation, true);
  assert.equal(approved.evidence.counts.approvedAdoptions, 1);
  assert.deepEqual(
    approved.intents.map((intent) => intent.kind),
    ['no-op'],
  );

  const unrelated = event({
    eventReference: 'approved-but-unrelated',
    summary: 'Unrelated synthetic meeting',
    description: 'Unrelated',
    startsAt: '2035-04-13T12:00:00.000Z',
    endsAt: '2035-04-13T13:00:00.000Z',
  });
  const rejectedApproval = audit([unrelated], {
    approvals: [
      {
        eventReference: unrelated.eventReference,
        eventFingerprint: fingerprintEvent(unrelated),
        scopeId: ownership.scopeId,
        ownershipMarker: ownership.ownershipMarker,
        disposition: 'approved-adoption',
      },
    ],
  });
  assert.equal(rejectedApproval.evidence.counts.ambiguous, 1);
  assert.deepEqual(rejectedApproval.intents, []);
  assert.ok(
    rejectedApproval.evidence.blockerCodes.includes(
      'calendar-ownership-ambiguous',
    ),
  );
});

test('partial markers, recurrence, stale approval, and invalid input fail closed', () => {
  const partial = audit([
    event({ privateOwnership: { owner: 'classroom-hub' } }),
    event({ eventReference: 'event-recurring', recurringInstance: true }),
  ]);
  assert.equal(partial.evidence.counts.ambiguous, 2);
  assert.deepEqual(partial.intents, []);
  assert.ok(
    partial.evidence.blockerCodes.includes('calendar-ownership-ambiguous'),
  );

  const stale = audit([], {
    approvals: [
      {
        eventReference: 'missing-event',
        eventFingerprint: `sha256:${'a'.repeat(64)}`,
        scopeId: ownership.scopeId,
        ownershipMarker: ownership.ownershipMarker,
        disposition: 'approved-adoption',
      },
    ],
  });
  assert.ok(
    stale.evidence.blockerCodes.includes('calendar-adoption-approval-stale'),
  );

  const malformed = audit([], { invalid: 1, unsupported: 1 });
  assert.deepEqual(malformed.intents, []);
  assert.ok(
    malformed.evidence.blockerCodes.includes('calendar-provider-items-invalid'),
  );
  assert.ok(
    malformed.evidence.blockerCodes.includes(
      'calendar-provider-items-unsupported',
    ),
  );

  const duplicate = audit([event(), event()]);
  assert.deepEqual(duplicate.intents, []);
  assert.deepEqual(duplicate.evidence.blockerCodes, [
    'calendar-observation-duplicate',
  ]);

  const invalidObservation = audit([
    event({ endsAt: '2035-04-13T07:00:00.000Z' }),
  ]);
  assert.deepEqual(invalidObservation.intents, []);
  assert.deepEqual(invalidObservation.evidence.blockerCodes, [
    'calendar-observation-invalid',
  ]);

  const invalidCounts = auditCalendarOwnership({
    calendarId: 'synthetic-calendar@example.test',
    timeMin: '2035-04-13T00:00:00.000Z',
    timeMax: '2035-04-14T00:00:00.000Z',
    plan: effectivePlan(),
    desired: desired(),
    observed: [],
    ownership,
    adoptionApprovals: [],
    invalidProviderItemCount: Number.NaN,
    unsupportedProviderItemCount: Number.POSITIVE_INFINITY,
    force: true,
  });
  assert.deepEqual(invalidCounts.intents, []);
  assert.equal(invalidCounts.evidence.counts.invalidProviderItems, 0);
  assert.equal(invalidCounts.evidence.counts.unsupportedProviderItems, 0);
  assert.deepEqual(invalidCounts.evidence.blockerCodes, [
    'calendar-adoption-manifest-invalid',
  ]);

  const markerDrift = audit([], {
    ownership: { ...ownership, ownershipMarker: 'other-marker' },
  });
  assert.deepEqual(markerDrift.intents, []);
  assert.deepEqual(markerDrift.evidence.blockerCodes, [
    'calendar-adoption-manifest-invalid',
  ]);
});

test('unrelated events remain untouched while a create intent is audited', () => {
  const result = audit([
    event({
      eventReference: 'unrelated-event',
      summary: 'Unrelated synthetic meeting',
      description: 'Unrelated',
      startsAt: '2035-04-13T12:00:00.000Z',
      endsAt: '2035-04-13T13:00:00.000Z',
    }),
  ]);
  assert.equal(result.evidence.readyForReconciliation, true);
  assert.equal(result.evidence.counts.unrelated, 1);
  assert.deepEqual(
    result.intents.map((intent) => intent.kind),
    ['create'],
  );
  assert.ok(result.intents.every((intent) => intent.notifyAttendees === false));
});

test('approval fingerprint binds calendar, window, every observation, and exact intents', () => {
  const marked = (eventReference: string) =>
    event({
      eventReference,
      privateOwnership: {
        owner: 'classroom-hub',
        scopeId: ownership.scopeId,
        ownershipMarker: ownership.ownershipMarker,
      },
    });
  const baseline = audit([marked('event-alpha')]);
  const otherTarget = audit([marked('event-beta')]);
  const otherCalendar = audit([marked('event-alpha')], {
    calendarId: 'other-synthetic-calendar@example.test',
  });
  const otherWindow = audit([marked('event-alpha')], {
    timeMin: '2035-04-12T00:00:00.000Z',
  });
  const unrelatedA = audit([
    event({
      eventReference: 'unrelated-a',
      summary: 'Unrelated A',
      startsAt: '2035-04-13T12:00:00.000Z',
      endsAt: '2035-04-13T13:00:00.000Z',
    }),
  ]);
  const unrelatedB = audit([
    event({
      eventReference: 'unrelated-b',
      summary: 'Unrelated B',
      startsAt: '2035-04-13T12:00:00.000Z',
      endsAt: '2035-04-13T13:00:00.000Z',
    }),
  ]);
  const partialOwner = audit([
    event({ privateOwnership: { owner: 'classroom-hub' } }),
  ]);
  const partialScope = audit([
    event({ privateOwnership: { scopeId: ownership.scopeId } }),
  ]);
  const recurring = audit([event({ recurringInstance: true })]);
  const fingerprints = [
    baseline,
    otherTarget,
    otherCalendar,
    otherWindow,
    unrelatedA,
    unrelatedB,
    partialOwner,
    partialScope,
    recurring,
  ].map((result) => result.evidence.auditFingerprint);
  assert.equal(new Set(fingerprints).size, fingerprints.length);
});
