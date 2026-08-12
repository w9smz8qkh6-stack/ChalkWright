import assert from 'node:assert/strict';
import test from 'node:test';

import {
  planCalendarRollback,
  providerRestoredEventIdForIntent,
} from '../../../src/application/calendar/rollback-planner.js';
import {
  hashCalendarProviderReference,
  providerEventIdForIntent,
} from '../../../src/application/calendar/writer-qualification.js';
import {
  contractVersion,
  type CalendarEventFields,
  type CalendarMutationIntent,
  type CalendarOwnership,
} from '../../../src/contracts/v1/index.js';
import type { CalendarExecutionStepRecord } from '../../../src/ports/calendar-execution-state.js';

const ownership: CalendarOwnership = {
  classification: 'verified-application-owned',
  scopeId: 'scope-alpha',
  ownershipMarker: 'classroom-hub-v1',
};
const eventFields: CalendarEventFields = {
  summary: 'Block A',
  description: 'Imported from PowerSchool Bell Schedule.',
  startsAt: '2035-04-13T08:00:00.000Z',
  endsAt: '2035-04-13T09:00:00.000Z',
  timeZone: 'Etc/UTC',
};
const intents: readonly CalendarMutationIntent[] = [
  {
    contractVersion,
    intentId: 'intent-create',
    planId: 'plan-alpha',
    notifyAttendees: false,
    kind: 'create',
    ownership,
    desired: eventFields,
  },
  {
    contractVersion,
    intentId: 'intent-replace',
    planId: 'plan-alpha',
    notifyAttendees: false,
    kind: 'replace',
    ownership,
    existingEventReference: 'event-replace',
    desired: { ...eventFields, summary: 'Block B' },
  },
  {
    contractVersion,
    intentId: 'intent-delete',
    planId: 'plan-alpha',
    notifyAttendees: false,
    kind: 'delete',
    ownership,
    existingEventReference: 'abcde12345',
    reason: 'obsolete-owned-event',
  },
];
const steps: readonly CalendarExecutionStepRecord[] = intents.map((intent) => {
  const eventReference =
    intent.kind === 'create'
      ? providerEventIdForIntent(intent.intentId)
      : intent.existingEventReference;
  return {
    intentId: intent.intentId,
    intentKind: intent.kind,
    status: 'succeeded',
    outcome: 'mutated',
    providerReferenceHash: hashCalendarProviderReference(eventReference),
  };
});

test('plans exact inverse actions for completed create, replace, and delete effects', () => {
  const result = planCalendarRollback({
    scopeId: ownership.scopeId,
    intents,
    steps,
    beforeSnapshots: [
      {
        intentId: 'intent-replace',
        eventReference: 'event-replace',
        ownership,
        ...eventFields,
      },
      {
        intentId: 'intent-delete',
        eventReference: 'abcde12345',
        ownership,
        ...eventFields,
      },
    ],
  });
  assert.equal(result.status, 'ready');
  assert.deepEqual(
    result.actions.map((action) => action.kind),
    ['delete-created', 'restore-event', 'restore-event'],
  );
  assert.equal(
    result.actions[0]?.eventReference,
    providerEventIdForIntent('intent-create'),
  );
  assert.deepEqual(
    result.actions
      .filter((action) => action.kind === 'restore-event')
      .map((action) => action.desired.summary),
    ['Block A', 'Block A'],
  );
  assert.equal(
    result.actions[2]?.eventReference,
    providerRestoredEventIdForIntent('intent-delete'),
  );
});

test('ignores non-mutating steps and rejects missing, foreign, or augmented rollback evidence', () => {
  const noEffects = planCalendarRollback({
    scopeId: ownership.scopeId,
    intents: [intents[0]!],
    steps: [{ ...steps[0]!, outcome: 'already-converged' }],
    beforeSnapshots: [],
  });
  assert.deepEqual(noEffects.status === 'ready' ? noEffects.actions : null, []);

  const validSnapshots = [
    {
      intentId: 'intent-replace',
      eventReference: 'event-replace',
      ownership,
      ...eventFields,
    },
    {
      intentId: 'intent-delete',
      eventReference: 'abcde12345',
      ownership,
      ...eventFields,
    },
  ] as const;
  for (const beforeSnapshots of [
    validSnapshots.slice(1),
    [
      { ...validSnapshots[0], ownership: { ...ownership, scopeId: 'foreign' } },
      validSnapshots[1],
    ],
    [{ ...validSnapshots[0], unexpected: true }, validSnapshots[1]],
  ]) {
    const result = planCalendarRollback({
      scopeId: ownership.scopeId,
      intents,
      steps,
      beforeSnapshots,
    });
    assert.equal(result.status, 'blocked');
    assert.deepEqual(result.actions, []);
  }
});

test('blocks hostile rollback containers without throwing', () => {
  let invoked = 0;
  const hostile = new Proxy(steps, {
    get() {
      invoked += 1;
      throw new Error('hostile-rollback-steps');
    },
  });
  const result = planCalendarRollback({
    scopeId: ownership.scopeId,
    intents,
    steps: hostile,
    beforeSnapshots: [],
  });
  assert.equal(result.status, 'blocked');
  assert.ok(invoked >= 1);
  assert.deepEqual(result.actions, []);
});

test('requires a complete exact reconciled forward journal before rollback planning', () => {
  const validSnapshots = [
    {
      intentId: 'intent-replace',
      eventReference: 'event-replace',
      ownership,
      ...eventFields,
    },
    {
      intentId: 'intent-delete',
      eventReference: 'abcde12345',
      ownership,
      ...eventFields,
    },
  ] as const;
  const invalidSteps = [
    steps.slice(1),
    steps.map((step, index) =>
      index === 0 ? { ...step, intentKind: 'delete' as const } : step,
    ),
    steps.map((step, index) =>
      index === 0
        ? { ...step, providerReferenceHash: `sha256:${'f'.repeat(64)}` }
        : step,
    ),
  ];
  for (const candidateSteps of invalidSteps) {
    const result = planCalendarRollback({
      scopeId: ownership.scopeId,
      intents,
      steps: candidateSteps,
      beforeSnapshots: validSnapshots,
    });
    assert.equal(result.status, 'blocked');
  }

  const augmentedIntent = { ...intents[0]!, unexpected: true };
  const augmented = planCalendarRollback({
    scopeId: ownership.scopeId,
    intents: [augmentedIntent, ...intents.slice(1)],
    steps,
    beforeSnapshots: validSnapshots,
  });
  assert.equal(augmented.status, 'blocked');

  const extraSnapshot = planCalendarRollback({
    scopeId: ownership.scopeId,
    intents,
    steps: steps.map((step, index) =>
      index === 1 ? { ...step, outcome: 'already-converged' as const } : step,
    ),
    beforeSnapshots: validSnapshots,
  });
  assert.equal(extraSnapshot.status, 'blocked');
});
