import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { contractVersion } from '../../../src/contracts/v1/common.js';
import { calendarOwnershipMarker } from '../../../src/config/google-calendar.js';
import type { EffectiveDayPlan } from '../../../src/domain/plans.js';
import {
  roomIdFromLocation,
  screenIdFromLocation,
} from '../../../src/domain/identities.js';
import { stableSerialize } from '../../../src/domain/pure-values.js';
import type {
  CalendarExecutionJournalRecord,
  CalendarExecutionStatePort,
  CalendarExecutionStepRecord,
  CalendarWriterLease,
} from '../../../src/ports/calendar-execution-state.js';
import type {
  CalendarProductionTrialTransport,
  CalendarProductionTrialRestoreRequest,
  CalendarWriterUpdateRequest,
  CalendarWriterObservedEvent,
} from '../../../src/ports/calendar-mutation-transport.js';
import { calendarEventEvidenceReference } from '../../../src/application/calendar/ownership-audit.js';
import {
  buildM15ProductionTrialApproval,
  createSyntheticM15ProductionTrialEngine,
  type M15ApprovedEvidencePolicy,
  type M15ProductionTrialOptions,
} from '../../../src/application/calendar/production-trial.js';
import { projectCalendarDay } from '../../../src/application/calendar/projection-policy.js';
import type { CalendarEventListTransport } from '../../../src/infrastructure/google-calendar/contracts.js';

const now = '2035-04-13T07:00:00.000Z';
const calendarId = 'synthetic-production-calendar@example.invalid';
const scopeId = 'classroom-hub-c509-2026-27';
const timeMin = '2035-04-12T17:00:00.000Z';
const timeMax = '2035-04-13T17:00:00.000Z';

class MemoryExecutionState implements CalendarExecutionStatePort {
  private lease: CalendarWriterLease | undefined;
  readonly records = new Map<string, CalendarExecutionJournalRecord>();

  async acquireLease(request: {
    readonly scopeId: string;
    readonly leaseId: string;
    readonly ownerId: string;
    readonly now: string;
    readonly expiresAt: string;
  }) {
    if (this.lease !== undefined) return { status: 'conflict' as const };
    const lease: CalendarWriterLease = {
      scopeId: request.scopeId,
      leaseId: request.leaseId,
      ownerId: request.ownerId,
      acquiredAt: request.now,
      expiresAt: request.expiresAt,
    };
    this.lease = lease;
    return { status: 'acquired' as const, lease };
  }

  async releaseLease(request: {
    readonly scopeId: string;
    readonly leaseId: string;
    readonly ownerId: string;
  }) {
    if (
      this.lease?.scopeId === request.scopeId &&
      this.lease.leaseId === request.leaseId &&
      this.lease.ownerId === request.ownerId
    )
      this.lease = undefined;
  }

  async loadExecution(executionFingerprint: string) {
    return this.records.get(executionFingerprint);
  }

  async beginExecution(record: CalendarExecutionJournalRecord) {
    this.records.set(record.executionFingerprint, record);
  }

  async resumeExecution(request: { readonly executionFingerprint: string }) {
    const record = this.records.get(request.executionFingerprint)!;
    this.records.set(request.executionFingerprint, {
      ...record,
      status: 'running',
    });
  }

  async recordStep(request: {
    readonly executionFingerprint: string;
    readonly step: CalendarExecutionStepRecord;
  }) {
    const record = this.records.get(request.executionFingerprint)!;
    this.records.set(request.executionFingerprint, {
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
  }) {
    const record = this.records.get(request.executionFingerprint)!;
    this.records.set(request.executionFingerprint, {
      ...record,
      status: request.status,
      finishedAt: request.finishedAt,
    });
  }
}

class SyntheticCalendar
  implements CalendarEventListTransport, CalendarProductionTrialTransport
{
  readonly events = new Map<string, CalendarWriterObservedEvent>();
  updateCalls = 0;
  failUpdateNumber: number | undefined;

  constructor(events: readonly CalendarWriterObservedEvent[]) {
    for (const event of events) this.events.set(event.eventReference, event);
  }

  async listEvents() {
    return {
      items: [...this.events.values()].map((event) => ({
        id: event.eventReference,
        etag: event.etag,
        status: 'confirmed',
        eventType: 'default',
        summary: event.summary,
        description: event.description,
        start: { dateTime: event.startsAt, timeZone: event.timeZone },
        end: { dateTime: event.endsAt, timeZone: event.timeZone },
        extendedProperties: {
          private: {
            ...(event.ownership.owner === undefined
              ? {}
              : { classroomHubOwner: event.ownership.owner }),
            ...(event.ownership.scopeId === undefined
              ? {}
              : { classroomHubScope: event.ownership.scopeId }),
            ...(event.ownership.ownershipMarker === undefined
              ? {}
              : {
                  classroomHubOwnershipMarker: event.ownership.ownershipMarker,
                }),
          },
        },
      })),
    };
  }

  async getEvent(request: { readonly eventReference: string }) {
    const event = this.events.get(request.eventReference);
    return event === undefined
      ? ({ status: 'not-found' } as const)
      : ({ status: 'found', event } as const);
  }

  async getAdoptionCandidateEvent(request: {
    readonly eventReference: string;
  }) {
    const read = await this.getEvent(request);
    return read.status === 'found'
      ? {
          status: 'found' as const,
          event: {
            ...read.event,
            reminderPolicy: 'provider-default' as const,
          },
        }
      : read;
  }

  async insertEvent(): Promise<CalendarWriterObservedEvent> {
    throw new Error('unexpected-insert');
  }

  async updateEvent(request: CalendarWriterUpdateRequest) {
    this.updateCalls += 1;
    if (this.failUpdateNumber === this.updateCalls)
      throw new Error('synthetic-update-failure');
    const existing = this.events.get(request.eventReference)!;
    assert.equal(existing.etag, request.expectedEtag);
    const updated: CalendarWriterObservedEvent = {
      eventReference: request.eventReference,
      etag: `etag-${this.updateCalls + 10}`,
      ownership: {
        owner: 'classroom-hub',
        scopeId: request.ownership.scopeId,
        ownershipMarker: request.ownership.ownershipMarker,
      },
      summary: request.desired.summary,
      description: request.desired.description,
      startsAt: request.desired.startsAt,
      endsAt: request.desired.endsAt,
      timeZone: request.desired.timeZone,
    };
    this.events.set(request.eventReference, updated);
    return updated;
  }

  async updateAdoptedEvent(
    request: CalendarWriterUpdateRequest & {
      readonly reminderPolicy: 'provider-default';
    },
  ) {
    assert.equal(request.reminderPolicy, 'provider-default');
    return {
      ...(await this.updateEvent(request)),
      reminderPolicy: 'provider-default' as const,
    };
  }

  async deleteEvent() {
    throw new Error('unexpected-delete');
  }

  async restoreAdoptedEvent(request: CalendarProductionTrialRestoreRequest) {
    assert.equal(request.reminderPolicy, 'provider-default');
    return {
      ...(await this.updateEvent({
        calendarId: request.calendarId,
        eventReference: request.eventReference,
        expectedEtag: request.expectedEtag,
        desired: request.desiredLegacySnapshot,
        ownership: request.ownership,
        sendUpdates: request.sendUpdates,
        timeoutMs: request.timeoutMs,
        signal: request.signal,
      })),
      reminderPolicy: 'provider-default' as const,
    };
  }
}

test('preflights the exact approved legacy set and performs three bounded adoptions', async () => {
  const harness = syntheticHarness();
  const prepared = await harness.engine.prepare(harness.options);
  assert.equal(prepared.status, 'ready', JSON.stringify(prepared));
  if (prepared.status !== 'ready') return;
  assert.equal(harness.calendar.updateCalls, 0);
  const approval = buildM15ProductionTrialApproval({
    prepared: prepared.prepared,
    approvalId: 'm15-synthetic-approval',
    issuedAt: '2035-04-13T06:59:00.000Z',
    expiresAt: '2035-04-13T07:10:00.000Z',
  });
  const result = await harness.engine.execute(
    harness.options,
    prepared.prepared,
    approval,
  );
  assert.equal(
    result.status,
    'succeeded',
    JSON.stringify({ result, records: [...harness.state.records.values()] }),
  );
  assert.equal(result.exactReadOnlyNoOpPreflight, true);
  assert.equal(result.completedExternalMutations, 3);
  assert.equal(result.replacedEventCount, 3);
  assert.equal(result.rollbackReadyCount, 3);
  assert.equal(harness.calendar.updateCalls, 3);
  for (const event of harness.calendar.events.values()) {
    assert.equal(event.description, 'Imported from PowerSchool Bell Schedule.');
    assert.deepEqual(event.ownership, {
      owner: 'classroom-hub',
      scopeId,
      ownershipMarker: calendarOwnershipMarker,
    });
  }
});

test('compensates completed adoptions when a later production update fails', async () => {
  const harness = syntheticHarness();
  const prepared = await harness.engine.prepare(harness.options);
  assert.equal(prepared.status, 'ready');
  if (prepared.status !== 'ready') return;
  harness.calendar.failUpdateNumber = 2;
  const approval = buildM15ProductionTrialApproval({
    prepared: prepared.prepared,
    approvalId: 'm15-synthetic-approval',
    issuedAt: '2035-04-13T06:59:00.000Z',
    expiresAt: '2035-04-13T07:10:00.000Z',
  });
  const result = await harness.engine.execute(
    harness.options,
    prepared.prepared,
    approval,
  );
  assert.equal(result.status, 'failed');
  assert.equal(result.code, 'm15-production-trial-execution-failed');
  assert.equal(result.rollbackCompletedExternalMutations, 1);
  assert.notEqual(result.code, 'm15-production-trial-rollback-incomplete');
  for (const event of harness.calendar.events.values())
    assert.match(
      event.description,
      /^Imported from PowerSchool Bell Schedule \(/u,
    );
});

test('refuses exact-event drift after preparation without any mutation', async () => {
  const harness = syntheticHarness();
  const prepared = await harness.engine.prepare(harness.options);
  assert.equal(prepared.status, 'ready');
  if (prepared.status !== 'ready') return;
  const first = harness.calendar.events.values().next()
    .value as CalendarWriterObservedEvent;
  harness.calendar.events.set(first.eventReference, {
    ...first,
    summary: `${first.summary} drift`,
  });
  const approval = buildM15ProductionTrialApproval({
    prepared: prepared.prepared,
    approvalId: 'm15-synthetic-approval',
    issuedAt: '2035-04-13T06:59:00.000Z',
    expiresAt: '2035-04-13T07:10:00.000Z',
  });
  const result = await harness.engine.execute(
    harness.options,
    prepared.prepared,
    approval,
  );
  assert.equal(result.status, 'refused');
  assert.equal(result.code, 'm15-production-trial-preflight-drift');
  assert.equal(result.attemptedExternalMutations, 0);
  assert.equal(harness.calendar.updateCalls, 0);
});

test('refuses augmented prepared state and every changed approval binding', async () => {
  const harness = syntheticHarness();
  const preparation = await harness.engine.prepare(harness.options);
  assert.equal(preparation.status, 'ready');
  if (preparation.status !== 'ready') return;
  const prepared = preparation.prepared;
  const approval = buildM15ProductionTrialApproval({
    prepared,
    approvalId: 'm15-synthetic-approval',
    issuedAt: '2035-04-13T06:59:00.000Z',
    expiresAt: '2035-04-13T07:10:00.000Z',
  });
  const augmented = { ...prepared, unexpected: true } as typeof prepared;
  const augmentedResult = await harness.engine.execute(
    harness.options,
    augmented,
    approval,
  );
  assert.equal(augmentedResult.code, 'm15-production-trial-input-invalid');
  const approvalVariants = [
    { ...approval, proposalFingerprint: digest('different') },
    { ...approval, backupFingerprint: digest('different') },
    { ...approval, implementationFingerprint: digest('different') },
    { ...approval, legacyWriterExclusionFingerprint: digest('different') },
    { ...approval, expiresAt: '2035-04-13T07:00:00.000Z' },
  ];
  for (const variant of approvalVariants) {
    const result = await harness.engine.execute(
      harness.options,
      prepared,
      variant,
    );
    assert.equal(result.code, 'm15-production-trial-approval-invalid');
  }
  assert.equal(harness.calendar.updateCalls, 0);
});

function syntheticHarness() {
  const plan = syntheticPlan();
  const projection = projectCalendarDay({ plan, scopeId, timeMin, timeMax });
  assert.equal(projection.status, 'projected');
  if (projection.status !== 'projected') throw new Error('projection-failed');
  const observed = projection.desired.map((desired, index) => ({
    eventReference: `legacy-event-${index + 1}`,
    eventType: 'default' as const,
    recurringInstance: false,
    privateOwnership: {},
    summary: desired.summary,
    description: `Imported from PowerSchool Bell Schedule (Synthetic ${index + 1}).`,
    startsAt: desired.startsAt,
    endsAt: desired.endsAt,
    timeZone: desired.timeZone,
  }));
  const references = observed.map(calendarEventEvidenceReference);
  assert.equal(references.length, 3);
  const policy: M15ApprovedEvidencePolicy = {
    date: plan.date,
    // The promoted audit is lineage; the fresh plan-bound audit is separately
    // retained and approved by the M-15 proposal.
    auditFingerprint: digest('promoted-m13-audit'),
    candidateEvidenceReferences: [
      references[0]!,
      references[1]!,
      references[2]!,
    ],
  };
  const calendar = new SyntheticCalendar(
    observed.map((event, index) => ({
      eventReference: event.eventReference,
      etag: `etag-${index + 1}`,
      ownership: {},
      summary: event.summary,
      description: event.description,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      timeZone: event.timeZone,
    })),
  );
  const state = new MemoryExecutionState();
  const options: M15ProductionTrialOptions = {
    calendarId,
    scopeId,
    timeMin,
    timeMax,
    plan,
    requestTimeoutMs: 1_000,
    maximumPages: 1,
    maximumEvents: 10,
    maximumWindowDays: 1,
    leaseDurationSeconds: 60,
    overallTimeoutMs: 60_000,
    legacyWriterExclusionFingerprint: digest('legacy-disabled'),
    backupFingerprint: digest('backup'),
    implementationFingerprint: digest('implementation'),
    clock: () => now,
    signal: new AbortController().signal,
    listTransport: calendar,
    mutationTransport: calendar,
    state,
  };
  return {
    calendar,
    state,
    options,
    engine: createSyntheticM15ProductionTrialEngine(policy),
  };
}

function syntheticPlan(): EffectiveDayPlan {
  const roomId = roomIdFromLocation('C509');
  const screenId = screenIdFromLocation('screen-c509');
  if (roomId === undefined || screenId === undefined)
    throw new Error('synthetic-identity-invalid');
  const starts = [
    ['2035-04-13T01:00:00.000Z', '2035-04-13T01:45:00.000Z'],
    ['2035-04-13T02:00:00.000Z', '2035-04-13T02:45:00.000Z'],
    ['2035-04-13T03:00:00.000Z', '2035-04-13T03:45:00.000Z'],
  ] as const;
  return {
    contractVersion,
    effectivePlanId: 'effective-plan-m15',
    canonicalPlanId: 'canonical-plan-m15',
    date: '2035-04-13',
    timeZone: 'Asia/Ho_Chi_Minh',
    roomId,
    screenId,
    verification: 'verified',
    meetings: starts.map(([officialStartsAt, officialEndsAt], index) => {
      const start = Date.parse(officialStartsAt);
      const end = Date.parse(officialEndsAt);
      return {
        meetingId: `meeting-${index + 1}`,
        courseKey: `course-${index + 1}`,
        blockLabel: `Block ${index + 1}`,
        checkInOpensAt: new Date(start - 10 * 60_000).toISOString(),
        officialStartsAt,
        checkInClosesAt: officialStartsAt,
        contentStartsAt: officialStartsAt,
        dismissalStartsAt: new Date(end - 5 * 60_000).toISOString(),
        officialEndsAt,
      };
    }),
    diagnostics: [],
  };
}

function digest(value: unknown): string {
  return `sha256:${createHash('sha256').update(stableSerialize(value)).digest('hex')}`;
}
