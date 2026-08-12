import assert from 'node:assert/strict';
import test from 'node:test';

import {
  executeCalendarWriterQualification,
  fingerprintCalendarIntentSet,
  hashCalendarReference,
  providerEventIdForIntent,
  type CalendarWriterExecutionManifest,
  type CalendarWriterQualificationOptions,
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
import {
  CalendarMutationTransportError,
  type CalendarMutationTransport,
  type CalendarWriterDeleteRequest,
  type CalendarWriterInsertRequest,
  type CalendarWriterObservedEvent,
  type CalendarWriterReadRequest,
  type CalendarWriterReadResult,
  type CalendarWriterUpdateRequest,
} from '../../../src/ports/calendar-mutation-transport.js';

const now = '2035-04-13T07:00:00.000Z';
const calendarId = 'm14-synthetic@example.test';
const scopeId = 'classroom-hub-m14-test';
const auditFingerprint = `sha256:${'a'.repeat(64)}`;
const ownership: CalendarOwnership = {
  classification: 'verified-application-owned',
  scopeId,
  ownershipMarker: 'classroom-hub-v1',
};

function fields(summary = 'Block A'): CalendarEventFields {
  return {
    summary,
    description: 'Imported from PowerSchool Bell Schedule.',
    startsAt: '2035-04-13T08:00:00.000Z',
    endsAt: '2035-04-13T09:00:00.000Z',
    timeZone: 'Etc/UTC',
  };
}

function createIntent(id = 'intent-create'): CalendarMutationIntent {
  return {
    contractVersion,
    intentId: id,
    planId: 'plan-alpha',
    notifyAttendees: false,
    kind: 'create',
    ownership,
    desired: fields('Block A'),
  };
}

function replaceIntent(id = 'intent-replace'): CalendarMutationIntent {
  return {
    contractVersion,
    intentId: id,
    planId: 'plan-alpha',
    notifyAttendees: false,
    kind: 'replace',
    ownership,
    existingEventReference: 'event-replace',
    desired: fields('Block B'),
  };
}

function deleteIntent(id = 'intent-delete'): CalendarMutationIntent {
  return {
    contractVersion,
    intentId: id,
    planId: 'plan-alpha',
    notifyAttendees: false,
    kind: 'delete',
    ownership,
    existingEventReference: 'event-delete',
    reason: 'obsolete-owned-event',
  };
}

function noopIntent(id = 'intent-noop'): CalendarMutationIntent {
  return {
    contractVersion,
    intentId: id,
    planId: 'plan-alpha',
    notifyAttendees: false,
    kind: 'no-op',
    existingEventReference: 'event-noop',
    reason: 'semantic-match',
  };
}

function manifest(
  intents: readonly CalendarMutationIntent[],
): CalendarWriterExecutionManifest {
  return {
    version: 1,
    kind: 'calendar-writer-execution-approval',
    environment: 'non-production',
    approvalId: 'approval-alpha',
    scopeId,
    calendarReferenceHash: hashCalendarReference(calendarId),
    auditFingerprint,
    intentSetFingerprint: fingerprintCalendarIntentSet(intents),
    allowedIntentIds: intents.map((intent) => intent.intentId),
    issuedAt: '2035-04-13T06:59:00.000Z',
    expiresAt: '2035-04-13T07:10:00.000Z',
  };
}

class MemoryExecutionState implements CalendarExecutionStatePort {
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
    const existing = this.leases.get(request.scopeId);
    if (
      existing !== undefined &&
      Date.parse(existing.expiresAt) > Date.parse(request.now) &&
      (existing.leaseId !== request.leaseId ||
        existing.ownerId !== request.ownerId)
    )
      return { status: 'conflict' };
    const lease: CalendarWriterLease = {
      scopeId: request.scopeId,
      leaseId: request.leaseId,
      ownerId: request.ownerId,
      acquiredAt: request.now,
      expiresAt: request.expiresAt,
    };
    this.leases.set(request.scopeId, lease);
    return { status: 'acquired', lease };
  }

  async releaseLease(request: {
    readonly scopeId: string;
    readonly leaseId: string;
    readonly ownerId: string;
  }): Promise<void> {
    const existing = this.leases.get(request.scopeId);
    if (
      existing?.leaseId === request.leaseId &&
      existing.ownerId === request.ownerId
    )
      this.leases.delete(request.scopeId);
  }

  async loadExecution(
    executionFingerprint: string,
  ): Promise<CalendarExecutionJournalRecord | undefined> {
    return this.executions.get(executionFingerprint);
  }

  async beginExecution(record: CalendarExecutionJournalRecord): Promise<void> {
    if (!this.executions.has(record.executionFingerprint))
      this.executions.set(record.executionFingerprint, record);
  }

  async resumeExecution(request: {
    readonly executionFingerprint: string;
  }): Promise<void> {
    const record = this.executions.get(request.executionFingerprint);
    if (record?.status !== 'failed')
      throw new Error('synthetic-resume-invalid');
    const { finishedAt: _finishedAt, ...unfinished } = record;
    this.executions.set(request.executionFingerprint, {
      ...unfinished,
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
      throw new Error('synthetic-journal-failure');
    }
    const record = this.executions.get(request.executionFingerprint);
    if (record === undefined) throw new Error('synthetic-execution-missing');
    this.executions.set(request.executionFingerprint, {
      ...record,
      steps: [
        ...record.steps.filter(
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
    const record = this.executions.get(request.executionFingerprint);
    if (record === undefined) throw new Error('synthetic-execution-missing');
    this.executions.set(request.executionFingerprint, {
      ...record,
      status: request.status,
      finishedAt: request.finishedAt,
    });
  }
}

class SyntheticMutationTransport implements CalendarMutationTransport {
  readonly events = new Map<string, CalendarWriterObservedEvent>();
  readonly calls: Array<{
    readonly method: 'get' | 'insert' | 'update' | 'delete';
    readonly sendUpdates?: 'none';
  }> = [];
  nextEtag = 1;
  getFailure: CalendarMutationTransportError | undefined = undefined;
  malformedInsertResponse = false;

  async getEvent(
    request: CalendarWriterReadRequest,
  ): Promise<CalendarWriterReadResult> {
    this.calls.push({ method: 'get' });
    if (this.getFailure !== undefined) throw this.getFailure;
    const event = this.events.get(request.eventReference);
    return event === undefined
      ? { status: 'not-found' }
      : { status: 'found', event };
  }

  async insertEvent(
    request: CalendarWriterInsertRequest,
  ): Promise<CalendarWriterObservedEvent> {
    this.calls.push({ method: 'insert', sendUpdates: request.sendUpdates });
    if (this.events.has(request.eventReference))
      throw new Error('synthetic-conflict');
    const event = this.observed(request.eventReference, request.desired, {
      owner: 'classroom-hub',
      scopeId: request.ownership.scopeId,
      ownershipMarker: request.ownership.ownershipMarker,
    });
    this.events.set(request.eventReference, event);
    return this.malformedInsertResponse
      ? ({ ...event, etag: '' } as CalendarWriterObservedEvent)
      : event;
  }

  async updateEvent(
    request: CalendarWriterUpdateRequest,
  ): Promise<CalendarWriterObservedEvent> {
    this.calls.push({ method: 'update', sendUpdates: request.sendUpdates });
    const existing = this.events.get(request.eventReference);
    if (existing?.etag !== request.expectedEtag)
      throw new Error('synthetic-conflict');
    const event = this.observed(request.eventReference, request.desired, {
      owner: 'classroom-hub',
      scopeId: request.ownership.scopeId,
      ownershipMarker: request.ownership.ownershipMarker,
    });
    this.events.set(request.eventReference, event);
    return event;
  }

  async deleteEvent(request: CalendarWriterDeleteRequest): Promise<void> {
    this.calls.push({ method: 'delete', sendUpdates: request.sendUpdates });
    const existing = this.events.get(request.eventReference);
    if (existing?.etag !== request.expectedEtag)
      throw new Error('synthetic-conflict');
    this.events.delete(request.eventReference);
  }

  observed(
    eventReference: string,
    value: CalendarEventFields,
    eventOwnership: CalendarWriterObservedEvent['ownership'] = {
      owner: 'classroom-hub',
      scopeId: ownership.scopeId,
      ownershipMarker: ownership.ownershipMarker,
    },
  ): CalendarWriterObservedEvent {
    return {
      eventReference,
      etag: `etag-${this.nextEtag++}`,
      ownership: eventOwnership,
      ...value,
    };
  }
}

function options(
  intents: readonly CalendarMutationIntent[],
  state = new MemoryExecutionState(),
  transport = new SyntheticMutationTransport(),
): CalendarWriterQualificationOptions {
  return {
    environment: 'non-production',
    calendarId,
    scopeId,
    auditFingerprint,
    intents,
    manifest: manifest(intents),
    leaseId: 'lease-alpha',
    ownerId: 'writer-alpha',
    leaseDurationSeconds: 120,
    requestTimeoutMs: 5_000,
    clock: () => now,
    signal: new AbortController().signal,
    state,
    transport,
  };
}

test('qualifies exact create, no-op, replace, and delete with suppressed notifications', async () => {
  const intents = [
    createIntent(),
    noopIntent(),
    replaceIntent(),
    deleteIntent(),
  ];
  const state = new MemoryExecutionState();
  const transport = new SyntheticMutationTransport();
  transport.events.set(
    'event-replace',
    transport.observed('event-replace', fields('Old Block')),
  );
  transport.events.set(
    'event-delete',
    transport.observed('event-delete', fields('Obsolete')),
  );

  const result = await executeCalendarWriterQualification(
    options(intents, state, transport),
  );

  assert.equal(result.status, 'succeeded');
  assert.equal(result.attemptedExternalMutations, 3);
  assert.equal(result.completedExternalMutations, 3);
  assert.deepEqual(result.stepCounts, {
    noOp: 1,
    mutated: 3,
    alreadyConverged: 0,
    refused: 0,
  });
  assert.deepEqual(
    transport.calls
      .filter((call) => call.method !== 'get')
      .map((call) => [call.method, call.sendUpdates]),
    [
      ['insert', 'none'],
      ['update', 'none'],
      ['delete', 'none'],
    ],
  );
  assert.ok(transport.events.has(providerEventIdForIntent('intent-create')));
  assert.equal(transport.events.get('event-replace')?.summary, 'Block B');
  assert.equal(transport.events.has('event-delete'), false);
  assert.equal(state.leases.size, 0);
});

test('replays a completed approval without any provider access', async () => {
  const intents = [createIntent()];
  const state = new MemoryExecutionState();
  const transport = new SyntheticMutationTransport();
  const first = await executeCalendarWriterQualification(
    options(intents, state, transport),
  );
  const calls = transport.calls.length;
  const second = await executeCalendarWriterQualification(
    options(intents, state, transport),
  );

  assert.equal(first.status, 'succeeded');
  assert.equal(second.code, 'calendar-write-replayed');
  assert.equal(second.attemptedExternalMutations, 0);
  assert.equal(transport.calls.length, calls);
});

test('rejects a forged incomplete completed journal before provider access', async () => {
  const intents = [createIntent()];
  const state = new MemoryExecutionState();
  const transport = new SyntheticMutationTransport();
  const first = await executeCalendarWriterQualification(
    options(intents, state, transport),
  );
  assert.equal(first.status, 'succeeded');
  const key = [...state.executions.keys()][0]!;
  state.executions.set(key, { ...state.executions.get(key)!, steps: [] });
  const calls = transport.calls.length;
  const replay = await executeCalendarWriterQualification(
    options(intents, state, transport),
  );
  assert.equal(replay.code, 'calendar-write-state-unavailable');
  assert.equal(transport.calls.length, calls);
});

test('rejects completed replay records with a mismatched key or impossible step outcome', async () => {
  for (const corrupt of [
    (record: CalendarExecutionJournalRecord) => ({
      ...record,
      executionFingerprint: `sha256:${'f'.repeat(64)}`,
    }),
    (record: CalendarExecutionJournalRecord) => ({
      ...record,
      steps: record.steps.map((step) => ({
        ...step,
        outcome: 'no-op' as const,
      })),
    }),
  ]) {
    const intents = [createIntent()];
    const state = new MemoryExecutionState();
    const transport = new SyntheticMutationTransport();
    const first = await executeCalendarWriterQualification(
      options(intents, state, transport),
    );
    assert.equal(first.status, 'succeeded');
    const key = [...state.executions.keys()][0]!;
    state.executions.set(key, corrupt(state.executions.get(key)!));
    const calls = transport.calls.length;
    const replay = await executeCalendarWriterQualification(
      options(intents, state, transport),
    );
    assert.equal(replay.code, 'calendar-write-state-unavailable');
    assert.equal(transport.calls.length, calls);
  }
});

test('converges after the provider changed but the success journal write failed', async () => {
  const intents = [createIntent()];
  const state = new MemoryExecutionState();
  state.failSucceededStepOnce = true;
  const transport = new SyntheticMutationTransport();

  const first = await executeCalendarWriterQualification(
    options(intents, state, transport),
  );
  const mutationsAfterFirst = transport.calls.filter(
    (call) => call.method !== 'get',
  ).length;
  const second = await executeCalendarWriterQualification({
    ...options(intents, state, transport),
    leaseId: 'lease-retry',
  });

  assert.equal(first.code, 'calendar-write-state-unavailable');
  assert.equal(first.completedExternalMutations, 1);
  assert.equal(second.status, 'succeeded');
  assert.equal(second.completedExternalMutations, 0);
  assert.equal(second.stepCounts.mutated, 1);
  assert.equal(second.stepCounts.alreadyConverged, 0);
  assert.equal(
    transport.calls.filter((call) => call.method !== 'get').length,
    mutationsAfterFirst,
  );
});

test('refuses foreign ownership and an active competing lease before mutation', async () => {
  const intent = replaceIntent();
  const transport = new SyntheticMutationTransport();
  transport.events.set(
    'event-replace',
    transport.observed('event-replace', fields('Old Block'), {
      owner: 'classroom-hub',
      scopeId: 'foreign-scope',
      ownershipMarker: ownership.ownershipMarker,
    }),
  );
  const ownershipResult = await executeCalendarWriterQualification(
    options([intent], new MemoryExecutionState(), transport),
  );
  assert.equal(ownershipResult.code, 'calendar-write-ownership-refused');
  assert.equal(ownershipResult.attemptedExternalMutations, 0);

  const state = new MemoryExecutionState();
  state.leases.set(scopeId, {
    scopeId,
    leaseId: 'competing-lease',
    ownerId: 'other-writer',
    acquiredAt: '2035-04-13T06:59:00.000Z',
    expiresAt: '2035-04-13T07:05:00.000Z',
  });
  const conflictTransport = new SyntheticMutationTransport();
  const conflict = await executeCalendarWriterQualification(
    options([createIntent()], state, conflictTransport),
  );
  assert.equal(conflict.code, 'calendar-write-lease-conflict');
  assert.equal(conflictTransport.calls.length, 0);
});

test('rejects primary, expired, augmented, and intent-drift approvals before capability access', async () => {
  const intents = [createIntent()];
  const cases: CalendarWriterQualificationOptions[] = [
    { ...options(intents), calendarId: 'primary' },
    {
      ...options(intents),
      manifest: {
        ...manifest(intents),
        expiresAt: '2035-04-13T07:00:00.000Z',
      },
    },
    {
      ...options(intents),
      manifest: {
        ...manifest(intents),
        unexpected: true,
      } as CalendarWriterExecutionManifest,
    },
    {
      ...options(intents),
      manifest: {
        ...manifest(intents),
        allowedIntentIds: ['different-intent'],
      },
    },
    { ...options(intents), leaseDurationSeconds: 5 },
  ];
  for (const candidate of cases) {
    const state = candidate.state as MemoryExecutionState;
    const transport = candidate.transport as SyntheticMutationTransport;
    const result = await executeCalendarWriterQualification(candidate);
    assert.equal(result.status, 'refused');
    assert.equal(state.executions.size, 0);
    assert.equal(state.leases.size, 0);
    assert.equal(transport.calls.length, 0);
  }
});

test('sanitizes provider read failure and accounts for a completed mutation with an invalid response', async () => {
  const readFailure = new SyntheticMutationTransport();
  readFailure.getFailure = new CalendarMutationTransportError(
    'calendar-write-rate-limited',
    true,
  );
  const unavailable = await executeCalendarWriterQualification(
    options([createIntent()], new MemoryExecutionState(), readFailure),
  );
  assert.equal(unavailable.code, 'calendar-write-rate-limited');
  assert.equal(unavailable.attemptedExternalMutations, 0);
  assert.equal(unavailable.completedExternalMutations, 0);

  const malformed = new SyntheticMutationTransport();
  malformed.malformedInsertResponse = true;
  const uncertain = await executeCalendarWriterQualification(
    options([createIntent()], new MemoryExecutionState(), malformed),
  );
  assert.equal(uncertain.code, 'calendar-write-unavailable');
  assert.equal(uncertain.attemptedExternalMutations, 1);
  assert.equal(uncertain.completedExternalMutations, 1);
  assert.ok(malformed.events.has(providerEventIdForIntent('intent-create')));
});

test('explicitly resumes a failed journal before a safe retry', async () => {
  const intents = [createIntent()];
  const state = new MemoryExecutionState();
  const transport = new SyntheticMutationTransport();
  transport.getFailure = new CalendarMutationTransportError(
    'calendar-write-rate-limited',
    true,
  );
  const first = await executeCalendarWriterQualification(
    options(intents, state, transport),
  );
  assert.equal(first.status, 'failed');
  assert.equal([...state.executions.values()][0]?.status, 'failed');
  transport.getFailure = undefined;
  const second = await executeCalendarWriterQualification({
    ...options(intents, state, transport),
    leaseId: 'lease-retry',
  });
  assert.equal(second.status, 'succeeded');
  assert.equal([...state.executions.values()][0]?.status, 'succeeded');
});

test('fails closed for hostile manifest and intent containers before capabilities', async () => {
  const intents = [createIntent()];
  const hostileManifest = new Proxy(manifest(intents), {
    ownKeys() {
      throw new Error('hostile-manifest');
    },
  });
  const hostileIntents = new Proxy(intents, {
    get() {
      throw new Error('hostile-intents');
    },
  });
  for (const candidate of [
    { ...options(intents), manifest: hostileManifest },
    {
      ...options(intents),
      intents: hostileIntents,
    },
  ]) {
    const state = candidate.state as MemoryExecutionState;
    const transport = candidate.transport as SyntheticMutationTransport;
    const result = await executeCalendarWriterQualification(candidate);
    assert.equal(result.status, 'refused');
    assert.equal(state.executions.size, 0);
    assert.equal(transport.calls.length, 0);
  }
});

test('rejects mixed plans and duplicate provider targets before state or transport access', async () => {
  const duplicateDelete = {
    ...deleteIntent('intent-delete-two'),
    existingEventReference: 'event-replace',
  } as CalendarMutationIntent;
  const mixedPlan = {
    ...createIntent('intent-create-two'),
    planId: 'plan-beta',
  } as CalendarMutationIntent;
  for (const intents of [
    [replaceIntent(), duplicateDelete],
    [createIntent(), mixedPlan],
  ]) {
    const candidate = options(intents);
    const result = await executeCalendarWriterQualification(candidate);
    assert.equal(result.code, 'calendar-write-input-invalid');
    assert.equal((candidate.state as MemoryExecutionState).executions.size, 0);
    assert.equal(
      (candidate.transport as SyntheticMutationTransport).calls.length,
      0,
    );
  }
});
