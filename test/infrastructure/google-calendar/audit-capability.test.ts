import assert from 'node:assert/strict';
import test from 'node:test';

import { runConfiguredCalendarOwnershipAudit } from '../../../src/infrastructure/google-calendar/audit-capability.js';
import { calendarProjectionDescription } from '../../../src/application/calendar/projection-policy.js';
import { contractVersion } from '../../../src/contracts/v1/index.js';
import type { RoomId, ScreenId } from '../../../src/domain/identities.js';
import type { EffectiveDayPlan } from '../../../src/domain/plans.js';
import { buildMeeting } from '../../fixtures/builders.js';

function plan(): EffectiveDayPlan {
  return {
    contractVersion,
    effectivePlanId: 'effective-alpha',
    canonicalPlanId: 'canonical-alpha',
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

const config = {
  credentialReferencePath: '/external/synthetic-calendar-reference.json',
  calendarId: 'synthetic-calendar@example.test',
  scopeId: 'scope-alpha',
  requestTimeoutMs: 5_000,
  maximumPages: 2,
  maximumEvents: 20,
  maximumWindowDays: 2,
} as const;

const request = {
  config,
  plan: plan(),
  timeMin: '2035-04-13T00:00:00.000Z',
  timeMax: '2035-04-14T00:00:00.000Z',
  adoptionApprovals: [],
  force: true,
} as const;

test('binds configured calendar, marker, budgets, and desired-plan derivation', async () => {
  const calls: {
    readonly calendarId: string;
    readonly timeMin: string;
    readonly timeMax: string;
    readonly maximumResults: number;
    readonly timeoutMs: number;
    readonly signal: AbortSignal;
  }[] = [];
  const result = await runConfiguredCalendarOwnershipAudit({
    ...request,
    transport: {
      async listEvents(read) {
        calls.push(read);
        return {
          items: [
            {
              id: 'event-alpha',
              status: 'confirmed',
              eventType: 'default',
              summary: 'Block A',
              description: calendarProjectionDescription,
              start: {
                dateTime: '2035-04-13T08:00:00.000Z',
                timeZone: 'Etc/UTC',
              },
              end: {
                dateTime: '2035-04-13T09:00:00.000Z',
                timeZone: 'Etc/UTC',
              },
              extendedProperties: {
                private: {
                  classroomHubOwner: 'classroom-hub',
                  classroomHubScope: 'scope-alpha',
                  classroomHubOwnershipMarker: 'classroom-hub-v1',
                },
              },
            },
          ],
        };
      },
    },
  });
  assert.equal(result.status, 'observed');
  if (result.status !== 'observed') return;
  assert.deepEqual(
    result.audit.intents.map((intent) => intent.kind),
    ['no-op'],
  );
  assert.equal(result.audit.evidence.readyForReconciliation, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.calendarId, config.calendarId);
  assert.equal(calls[0]?.timeMin, request.timeMin);
  assert.equal(calls[0]?.timeMax, request.timeMax);
  assert.equal(calls[0]?.maximumResults, config.maximumEvents);
  assert.equal(calls[0]?.timeoutMs, config.requestTimeoutMs);
  assert.ok(calls[0]?.signal instanceof AbortSignal);
});

test('fails before transport when the requested window exceeds configuration', async () => {
  let calls = 0;
  const result = await runConfiguredCalendarOwnershipAudit({
    ...request,
    timeMax: '2035-04-16T00:00:00.000Z',
    transport: {
      async listEvents() {
        calls += 1;
        return { items: [] };
      },
    },
  });
  assert.equal(result.status, 'failed');
  if (result.status === 'failed')
    assert.equal(result.code, 'calendar-audit-request-invalid');
  assert.equal(calls, 0);
  assert.equal(result.attemptedExternalMutations, 0);
  assert.equal(result.completedExternalMutations, 0);
});

test('rejects partial or wrong-day windows before constructing source authority', async () => {
  for (const window of [
    {
      timeMin: '2035-04-13T07:00:00.000Z',
      timeMax: '2035-04-14T00:00:00.000Z',
    },
    {
      timeMin: '2035-04-12T00:00:00.000Z',
      timeMax: '2035-04-13T00:00:00.000Z',
    },
  ] as const) {
    let calls = 0;
    const result = await runConfiguredCalendarOwnershipAudit({
      ...request,
      ...window,
      transport: {
        async listEvents() {
          calls += 1;
          return { items: [] };
        },
      },
    });
    assert.equal(result.status, 'failed');
    if (result.status === 'failed')
      assert.equal(result.code, 'calendar-audit-request-invalid');
    assert.equal(calls, 0);
  }
});

test('rejects noncanonical projection labels before transport', async () => {
  for (const blockLabel of [
    '',
    ' padded ',
    'x'.repeat(257),
    'line\nbreak',
    'line\u2028break',
    'line\u2029break',
    'lone-\ud800-surrogate',
  ]) {
    let calls = 0;
    const invalidPlan: EffectiveDayPlan = {
      ...plan(),
      meetings: [
        {
          ...plan().meetings[0]!,
          blockLabel,
        },
      ],
    };
    const result = await runConfiguredCalendarOwnershipAudit({
      ...request,
      plan: invalidPlan,
      transport: {
        async listEvents() {
          calls += 1;
          return { items: [] };
        },
      },
    });
    assert.equal(result.status, 'failed');
    if (result.status === 'failed')
      assert.equal(result.code, 'calendar-audit-request-invalid');
    assert.equal(calls, 0);
  }
});

test('uses the verified plan timezone for an exact non-UTC local day', async () => {
  const localPlan: EffectiveDayPlan = {
    ...plan(),
    timeZone: 'Asia/Ho_Chi_Minh',
    meetings: [
      buildMeeting({
        id: 'meeting-local',
        courseKey: 'course-local',
        blockLabel: 'Local Block',
        checkInOpensAt: '2035-04-13T00:55:00.000Z',
        officialStartsAt: '2035-04-13T01:00:00.000Z',
        checkInClosesAt: '2035-04-13T01:00:00.000Z',
        contentStartsAt: '2035-04-13T01:00:00.000Z',
        dismissalStartsAt: '2035-04-13T01:55:00.000Z',
        officialEndsAt: '2035-04-13T02:00:00.000Z',
      }),
    ],
  };
  let calls = 0;
  const result = await runConfiguredCalendarOwnershipAudit({
    ...request,
    plan: localPlan,
    timeMin: '2035-04-12T17:00:00.000Z',
    timeMax: '2035-04-13T17:00:00.000Z',
    transport: {
      async listEvents(read) {
        calls += 1;
        assert.equal(read.timeMin, '2035-04-12T17:00:00.000Z');
        assert.equal(read.timeMax, '2035-04-13T17:00:00.000Z');
        return { items: [] };
      },
    },
  });
  assert.equal(result.status, 'observed');
  assert.equal(calls, 1);
});

test('recognizes only the narrow legacy description variant as adoptable', async () => {
  const legacyEvent = {
    eventReference: 'event-legacy',
    eventType: 'default' as const,
    recurringInstance: false,
    privateOwnership: {},
    summary: 'Block A',
    description:
      'Imported from PowerSchool Bell Schedule (Synthetic Day (Cycle A)).',
    startsAt: '2035-04-13T08:00:00.000Z',
    endsAt: '2035-04-13T09:00:00.000Z',
    timeZone: 'Etc/UTC',
  };
  const { fingerprintEvent } =
    await import('../../../src/application/calendar/ownership-audit.js');
  const result = await runConfiguredCalendarOwnershipAudit({
    ...request,
    adoptionApprovals: [
      {
        eventReference: legacyEvent.eventReference,
        eventFingerprint: fingerprintEvent(legacyEvent),
        scopeId: config.scopeId,
        ownershipMarker: 'classroom-hub-v1',
        disposition: 'approved-adoption',
      },
    ],
    transport: {
      async listEvents() {
        return {
          items: [
            {
              id: legacyEvent.eventReference,
              status: 'confirmed',
              eventType: 'default',
              summary: legacyEvent.summary,
              description: legacyEvent.description,
              start: {
                dateTime: legacyEvent.startsAt,
                timeZone: legacyEvent.timeZone,
              },
              end: {
                dateTime: legacyEvent.endsAt,
                timeZone: legacyEvent.timeZone,
              },
            },
          ],
        };
      },
    },
  });
  assert.equal(result.status, 'observed');
  if (result.status !== 'observed') return;
  assert.equal(result.audit.evidence.counts.approvedAdoptions, 1);
  assert.deepEqual(
    result.audit.intents.map((intent) => intent.kind),
    ['replace'],
  );
});

test('rejects malformed historical description labels even with approval', async () => {
  const { fingerprintEvent } =
    await import('../../../src/application/calendar/ownership-audit.js');
  for (const description of [
    'Imported from PowerSchool Bell Schedule (Synthetic (Cycle A).',
    'Imported from PowerSchool Bell Schedule (Synthetic\nDay).',
    'Imported from PowerSchool Bell Schedule ( padded ).',
    `Imported from PowerSchool Bell Schedule (${'x'.repeat(257)}).`,
  ]) {
    const observed = {
      eventReference: 'event-invalid-legacy',
      eventType: 'default' as const,
      recurringInstance: false,
      privateOwnership: {},
      summary: 'Block A',
      description,
      startsAt: '2035-04-13T08:00:00.000Z',
      endsAt: '2035-04-13T09:00:00.000Z',
      timeZone: 'Etc/UTC',
    };
    const result = await runConfiguredCalendarOwnershipAudit({
      ...request,
      adoptionApprovals: [
        {
          eventReference: observed.eventReference,
          eventFingerprint: fingerprintEvent(observed),
          scopeId: config.scopeId,
          ownershipMarker: 'classroom-hub-v1',
          disposition: 'approved-adoption',
        },
      ],
      transport: {
        async listEvents() {
          return {
            items: [
              {
                id: observed.eventReference,
                status: 'confirmed',
                eventType: observed.eventType,
                summary: observed.summary,
                description: observed.description,
                start: {
                  dateTime: observed.startsAt,
                  timeZone: observed.timeZone,
                },
                end: {
                  dateTime: observed.endsAt,
                  timeZone: observed.timeZone,
                },
              },
            ],
          };
        },
      },
    });
    assert.equal(result.status, 'observed');
    if (result.status !== 'observed') continue;
    assert.equal(result.audit.evidence.counts.ambiguous, 1);
    assert.deepEqual(result.audit.intents, []);
  }
});
