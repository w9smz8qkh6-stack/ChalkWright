import assert from 'node:assert/strict';
import test from 'node:test';

import {
  executeCalendarRollbackQualification,
  fingerprintCalendarRollbackActions,
  type CalendarRollbackExecutionManifest,
  type CalendarRollbackQualificationOptions,
} from '../../../src/application/calendar/rollback-qualification.js';
import {
  planCalendarRollback,
  providerRestoredEventIdForIntent,
} from '../../../src/application/calendar/rollback-planner.js';
import {
  hashCalendarReference,
  hashCalendarProviderReference,
  providerEventIdForIntent,
} from '../../../src/application/calendar/writer-qualification.js';
import {
  contractVersion,
  type CalendarEventFields,
  type CalendarMutationIntent,
  type CalendarOwnership,
} from '../../../src/contracts/v1/index.js';
import type {
  CalendarExecutionJournalRecord,
  CalendarExecutionStatePort,
  CalendarExecutionStepRecord,
  CalendarWriterLease,
  CalendarWriterLeaseAcquisition,
} from '../../../src/ports/calendar-execution-state.js';
import type {
  CalendarMutationTransport,
  CalendarWriterDeleteRequest,
  CalendarWriterInsertRequest,
  CalendarWriterObservedEvent,
  CalendarWriterReadRequest,
  CalendarWriterReadResult,
  CalendarWriterUpdateRequest,
} from '../../../src/ports/calendar-mutation-transport.js';

const now = '2035-04-13T07:00:00.000Z';
const calendarId = 'm14-rollback@example.test';
const scopeId = 'classroom-hub-m14-test';
const sourceExecutionFingerprint = `sha256:${'1'.repeat(64)}`;
const ownership: CalendarOwnership = {
  classification: 'verified-application-owned',
  scopeId,
  ownershipMarker: 'classroom-hub-v1',
};

function fields(summary: string): CalendarEventFields {
  return {
    summary,
    description: 'Imported from PowerSchool Bell Schedule.',
    startsAt: '2035-04-13T08:00:00.000Z',
    endsAt: '2035-04-13T09:00:00.000Z',
    timeZone: 'Etc/UTC',
  };
}

const intents: readonly CalendarMutationIntent[] = [
  {
    contractVersion,
    intentId: 'intent-create',
    planId: 'plan-alpha',
    notifyAttendees: false,
    kind: 'create',
    ownership,
    desired: fields('Created'),
  },
  {
    contractVersion,
    intentId: 'intent-replace',
    planId: 'plan-alpha',
    notifyAttendees: false,
    kind: 'replace',
    ownership,
    existingEventReference: 'abcde67890',
    desired: fields('Replacement'),
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

const beforeSnapshots = [
  {
    intentId: 'intent-replace',
    eventReference: 'abcde67890',
    ownership,
    ...fields('Original replacement'),
  },
  {
    intentId: 'intent-delete',
    eventReference: 'abcde12345',
    ownership,
    ...fields('Original deletion'),
  },
] as const;

class MemoryState implements CalendarExecutionStatePort {
  readonly leases = new Map<string, CalendarWriterLease>();
  readonly executions = new Map<string, CalendarExecutionJournalRecord>();
  failSucceededStepOnce = false;

  async acquireLease(request: {
    readonly scopeId: string;
    readonly leaseId: string;
    readonly ownerId: string;
    readonly now: string;
    readonly expiresAt: string;
  }): Promise<CalendarWriterLeaseAcquisition> {
    const current = this.leases.get(request.scopeId);
    if (
      current !== undefined &&
      Date.parse(current.expiresAt) > Date.parse(request.now) &&
      (current.leaseId !== request.leaseId ||
        current.ownerId !== request.ownerId)
    )
      return { status: 'conflict' };
    const lease: CalendarWriterLease = {
      ...request,
      acquiredAt: request.now,
    };
    this.leases.set(request.scopeId, lease);
    return { status: 'acquired', lease };
  }

  async releaseLease(request: {
    readonly scopeId: string;
    readonly leaseId: string;
    readonly ownerId: string;
  }): Promise<void> {
    const current = this.leases.get(request.scopeId);
    if (
      current?.leaseId === request.leaseId &&
      current.ownerId === request.ownerId
    )
      this.leases.delete(request.scopeId);
  }

  async loadExecution(
    fingerprint: string,
  ): Promise<CalendarExecutionJournalRecord | undefined> {
    return this.executions.get(fingerprint);
  }

  async beginExecution(record: CalendarExecutionJournalRecord): Promise<void> {
    if (!this.executions.has(record.executionFingerprint))
      this.executions.set(record.executionFingerprint, record);
  }

  async resumeExecution(request: {
    readonly executionFingerprint: string;
  }): Promise<void> {
    const current = this.executions.get(request.executionFingerprint);
    if (current?.status !== 'failed') throw new Error('invalid-resume');
    const { finishedAt: _finishedAt, ...running } = current;
    this.executions.set(request.executionFingerprint, {
      ...running,
      status: 'running',
    });
  }

  async recordStep(request: {
    readonly executionFingerprint: string;
    readonly step: CalendarExecutionStepRecord;
  }): Promise<void> {
    if (
      this.failSucceededStepOnce &&
      request.step.status === 'succeeded' &&
      request.step.outcome === 'mutated'
    ) {
      this.failSucceededStepOnce = false;
      throw new Error('journal-failure');
    }
    const current = this.executions.get(request.executionFingerprint);
    if (current === undefined) throw new Error('missing-execution');
    this.executions.set(request.executionFingerprint, {
      ...current,
      steps: [
        ...current.steps.filter(
          (step) => step.intentId !== request.step.intentId,
        ),
        request.step,
      ],
    });
  }

  async finishExecution(request: {
    readonly executionFingerprint: string;
    readonly status: 'succeeded' | 'failed';
    readonly finishedAt: string;
  }): Promise<void> {
    const current = this.executions.get(request.executionFingerprint);
    if (current === undefined) throw new Error('missing-execution');
    this.executions.set(request.executionFingerprint, {
      ...current,
      status: request.status,
      finishedAt: request.finishedAt,
    });
  }
}

class SyntheticTransport implements CalendarMutationTransport {
  readonly events = new Map<string, CalendarWriterObservedEvent>();
  readonly calls: Array<{
    readonly method: 'get' | 'insert' | 'update' | 'delete';
    readonly sendUpdates?: 'none';
  }> = [];
  etag = 1;

  async getEvent(
    request: CalendarWriterReadRequest,
  ): Promise<CalendarWriterReadResult> {
    this.calls.push({ method: 'get' });
    const event = this.events.get(request.eventReference);
    return event === undefined
      ? { status: 'not-found' }
      : { status: 'found', event };
  }

  async insertEvent(
    request: CalendarWriterInsertRequest,
  ): Promise<CalendarWriterObservedEvent> {
    this.calls.push({ method: 'insert', sendUpdates: request.sendUpdates });
    if (this.events.has(request.eventReference)) throw new Error('conflict');
    const event = this.observed(request.eventReference, request.desired);
    this.events.set(request.eventReference, event);
    return event;
  }

  async updateEvent(
    request: CalendarWriterUpdateRequest,
  ): Promise<CalendarWriterObservedEvent> {
    this.calls.push({ method: 'update', sendUpdates: request.sendUpdates });
    const current = this.events.get(request.eventReference);
    if (current?.etag !== request.expectedEtag) throw new Error('conflict');
    const event = this.observed(request.eventReference, request.desired);
    this.events.set(request.eventReference, event);
    return event;
  }

  async deleteEvent(request: CalendarWriterDeleteRequest): Promise<void> {
    this.calls.push({ method: 'delete', sendUpdates: request.sendUpdates });
    const current = this.events.get(request.eventReference);
    if (current?.etag !== request.expectedEtag) throw new Error('conflict');
    this.events.delete(request.eventReference);
  }

  observed(
    eventReference: string,
    eventFields: CalendarEventFields,
    eventOwnership: CalendarWriterObservedEvent['ownership'] = {
      owner: 'classroom-hub',
      scopeId,
      ownershipMarker: 'classroom-hub-v1',
    },
  ): CalendarWriterObservedEvent {
    return {
      eventReference,
      etag: `etag-${this.etag++}`,
      ownership: eventOwnership,
      ...eventFields,
    };
  }
}

function manifest(): CalendarRollbackExecutionManifest {
  const plan = planCalendarRollback({
    scopeId,
    intents,
    steps,
    beforeSnapshots,
  });
  assert.equal(plan.status, 'ready');
  return {
    version: 1,
    kind: 'calendar-writer-rollback-approval',
    environment: 'non-production',
    approvalId: 'rollback-approval-alpha',
    scopeId,
    calendarReferenceHash: hashCalendarReference(calendarId),
    sourceExecutionFingerprint,
    rollbackEvidenceFingerprint: plan.fingerprint,
    actionSetFingerprint: fingerprintCalendarRollbackActions(plan.actions),
    allowedRollbackIds: plan.actions.map((action) => action.rollbackId),
    issuedAt: '2035-04-13T06:59:00.000Z',
    expiresAt: '2035-04-13T07:10:00.000Z',
  };
}

function options(
  state = new MemoryState(),
  transport = new SyntheticTransport(),
): CalendarRollbackQualificationOptions {
  return {
    environment: 'non-production',
    calendarId,
    scopeId,
    sourceExecutionFingerprint,
    intents,
    steps,
    beforeSnapshots,
    manifest: manifest(),
    leaseId: 'rollback-lease-alpha',
    ownerId: 'rollback-owner-alpha',
    leaseDurationSeconds: 120,
    requestTimeoutMs: 5_000,
    clock: () => now,
    signal: new AbortController().signal,
    state,
    transport,
  };
}

function seedMutatedState(transport: SyntheticTransport): void {
  transport.events.set(
    providerEventIdForIntent('intent-create'),
    transport.observed(
      providerEventIdForIntent('intent-create'),
      fields('Created'),
    ),
  );
  transport.events.set(
    'abcde67890',
    transport.observed('abcde67890', fields('Replacement')),
  );
}

test('executes exact delete, restore-update, and restore-insert with suppressed notifications', async () => {
  const state = new MemoryState();
  const transport = new SyntheticTransport();
  seedMutatedState(transport);

  const result = await executeCalendarRollbackQualification(
    options(state, transport),
  );

  assert.equal(result.status, 'succeeded');
  assert.equal(result.code, 'calendar-rollback-qualified');
  assert.equal(result.attemptedExternalMutations, 3);
  assert.equal(result.completedExternalMutations, 3);
  assert.equal(
    transport.events.has(providerEventIdForIntent('intent-create')),
    false,
  );
  assert.equal(
    transport.events.get('abcde67890')?.summary,
    'Original replacement',
  );
  assert.equal(
    transport.events.get(providerRestoredEventIdForIntent('intent-delete'))
      ?.summary,
    'Original deletion',
  );
  assert.deepEqual(
    transport.calls
      .filter((call) => call.method !== 'get')
      .map((call) => [call.method, call.sendUpdates]),
    [
      ['delete', 'none'],
      ['update', 'none'],
      ['insert', 'none'],
    ],
  );

  const callsAfterSuccess = transport.calls.length;
  const replay = await executeCalendarRollbackQualification(
    options(state, transport),
  );
  assert.equal(replay.code, 'calendar-rollback-replayed');
  assert.equal(transport.calls.length, callsAfterSuccess);
});

test('converges after provider mutation succeeds but the journal write fails', async () => {
  const state = new MemoryState();
  const transport = new SyntheticTransport();
  seedMutatedState(transport);
  state.failSucceededStepOnce = true;

  const first = await executeCalendarRollbackQualification(
    options(state, transport),
  );
  assert.equal(first.code, 'calendar-rollback-state-unavailable');
  assert.equal(first.completedExternalMutations, 1);

  const second = await executeCalendarRollbackQualification(
    options(state, transport),
  );
  assert.equal(second.status, 'succeeded');
  assert.equal(second.stepCounts.alreadyConverged, 1);
  assert.equal(
    transport.calls.filter((call) => call.method === 'delete').length,
    1,
  );
});

test('refuses foreign ownership and missing replacement evidence before rollback mutation', async () => {
  const foreignTransport = new SyntheticTransport();
  seedMutatedState(foreignTransport);
  foreignTransport.events.set(
    providerEventIdForIntent('intent-create'),
    foreignTransport.observed(
      providerEventIdForIntent('intent-create'),
      fields('Created'),
      {
        owner: 'someone-else',
        scopeId,
        ownershipMarker: 'classroom-hub-v1',
      },
    ),
  );
  const foreign = await executeCalendarRollbackQualification(
    options(new MemoryState(), foreignTransport),
  );
  assert.equal(foreign.code, 'calendar-rollback-ownership-refused');
  assert.equal(
    foreignTransport.calls.some((call) => call.method !== 'get'),
    false,
  );

  const missingReplacement = new SyntheticTransport();
  missingReplacement.events.set(
    providerEventIdForIntent('intent-create'),
    missingReplacement.observed(
      providerEventIdForIntent('intent-create'),
      fields('Created'),
    ),
  );
  const missing = await executeCalendarRollbackQualification(
    options(new MemoryState(), missingReplacement),
  );
  assert.equal(missing.code, 'calendar-rollback-ownership-refused');
  assert.equal(
    missingReplacement.calls.some((call) => call.method === 'insert'),
    false,
  );
});

test('rejects primary and drifted rollback approvals before state or transport access', async () => {
  const state = new MemoryState();
  const transport = new SyntheticTransport();
  const primary = await executeCalendarRollbackQualification({
    ...options(state, transport),
    calendarId: 'primary',
  });
  assert.equal(primary.code, 'calendar-rollback-input-invalid');
  assert.equal(state.executions.size, 0);
  assert.equal(transport.calls.length, 0);

  const drifted = await executeCalendarRollbackQualification({
    ...options(state, transport),
    manifest: {
      ...manifest(),
      allowedRollbackIds: ['rollback-unapproved'],
    },
  });
  assert.equal(drifted.code, 'calendar-rollback-approval-invalid');
  assert.equal(state.executions.size, 0);
  assert.equal(transport.calls.length, 0);
});

test('rejects forged completed rollback records before provider access', async () => {
  for (const corrupt of [
    (record: CalendarExecutionJournalRecord) => ({
      ...record,
      executionFingerprint: `sha256:${'e'.repeat(64)}`,
    }),
    (record: CalendarExecutionJournalRecord) => ({
      ...record,
      steps: record.steps.map((step) => ({
        ...step,
        outcome: 'no-op' as const,
      })),
    }),
  ]) {
    const state = new MemoryState();
    const transport = new SyntheticTransport();
    seedMutatedState(transport);
    const first = await executeCalendarRollbackQualification(
      options(state, transport),
    );
    assert.equal(first.status, 'succeeded');
    const key = [...state.executions.keys()][0]!;
    state.executions.set(key, corrupt(state.executions.get(key)!));
    const calls = transport.calls.length;
    const replay = await executeCalendarRollbackQualification(
      options(state, transport),
    );
    assert.equal(replay.code, 'calendar-rollback-state-unavailable');
    assert.equal(transport.calls.length, calls);
  }
});
