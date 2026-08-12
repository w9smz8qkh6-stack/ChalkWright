import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  recoverM14LiveQualification,
  runM14LiveQualification,
} from '../../../src/application/calendar/live-qualification.js';
import {
  hashCalendarProviderReference,
  providerEventIdForIntent,
} from '../../../src/application/calendar/writer-qualification.js';
import type { CalendarEventFields } from '../../../src/contracts/v1/index.js';
import { SqliteCalendarExecutionState } from '../../../src/infrastructure/sqlite/calendar-execution-state.js';
import { SqliteDatabase } from '../../../src/infrastructure/sqlite/database.js';
import type {
  CalendarMutationTransport,
  CalendarWriterDeleteRequest,
  CalendarWriterInsertRequest,
  CalendarWriterObservedEvent,
  CalendarWriterReadRequest,
  CalendarWriterReadResult,
  CalendarWriterUpdateRequest,
} from '../../../src/ports/calendar-mutation-transport.js';

const digest = (value: string): string =>
  `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;

class MemoryCalendarTransport implements CalendarMutationTransport {
  readonly events = new Map<string, CalendarWriterObservedEvent>();
  readonly calls: Array<{
    readonly method: 'get' | 'insert' | 'update' | 'delete';
    readonly eventReference: string;
    readonly sendUpdates?: 'none';
  }> = [];
  failGetAt: number | undefined;
  private getCount = 0;
  private etag = 0;

  async getEvent(
    request: CalendarWriterReadRequest,
  ): Promise<CalendarWriterReadResult> {
    this.getCount += 1;
    this.calls.push({ method: 'get', eventReference: request.eventReference });
    if (this.getCount === this.failGetAt)
      throw new Error('injected-read-failure');
    const event = this.events.get(request.eventReference);
    return event === undefined
      ? { status: 'not-found' }
      : { status: 'found', event };
  }

  async insertEvent(
    request: CalendarWriterInsertRequest,
  ): Promise<CalendarWriterObservedEvent> {
    this.calls.push({
      method: 'insert',
      eventReference: request.eventReference,
      sendUpdates: request.sendUpdates,
    });
    if (this.events.has(request.eventReference)) throw new Error('conflict');
    const event = this.observed(request.eventReference, request.desired, {
      owner: 'classroom-hub',
      scopeId: request.ownership.scopeId,
      ownershipMarker: request.ownership.ownershipMarker,
    });
    this.events.set(request.eventReference, event);
    return event;
  }

  async updateEvent(
    request: CalendarWriterUpdateRequest,
  ): Promise<CalendarWriterObservedEvent> {
    this.calls.push({
      method: 'update',
      eventReference: request.eventReference,
      sendUpdates: request.sendUpdates,
    });
    const current = this.events.get(request.eventReference);
    if (current?.etag !== request.expectedEtag) throw new Error('conflict');
    const event = this.observed(request.eventReference, request.desired, {
      owner: 'classroom-hub',
      scopeId: request.ownership.scopeId,
      ownershipMarker: request.ownership.ownershipMarker,
    });
    this.events.set(request.eventReference, event);
    return event;
  }

  async deleteEvent(request: CalendarWriterDeleteRequest): Promise<void> {
    this.calls.push({
      method: 'delete',
      eventReference: request.eventReference,
      sendUpdates: request.sendUpdates,
    });
    const current = this.events.get(request.eventReference);
    if (current?.etag !== request.expectedEtag) throw new Error('conflict');
    this.events.delete(request.eventReference);
  }

  private observed(
    eventReference: string,
    value: CalendarEventFields,
    ownership: CalendarWriterObservedEvent['ownership'],
  ): CalendarWriterObservedEvent {
    this.etag += 1;
    return {
      eventReference,
      etag: `etag-${this.etag}`,
      ownership,
      ...value,
    };
  }
}

test('qualifies injected convergence, exact readback, rollback, and empty cleanup', async () => {
  using database = new SqliteDatabase(':memory:', {
    migration: { appliedAt: '2026-08-10T08:00:00.000Z' },
  });
  const state = new SqliteCalendarExecutionState(database);
  const transport = new MemoryCalendarTransport();
  const calendarId = 'm14-live@example.test';

  const result = await runM14LiveQualification({
    calendarId,
    calendarReferenceHash: digest(calendarId),
    productionCalendarReferenceHash: digest('production@example.test'),
    qualificationRunId: 'm14-test-run-01',
    approvalExpiresAt: '2026-08-10T08:15:00.000Z',
    scopeId: 'classroom-hub-m14-auto-lesson-2',
    timeZone: 'Asia/Ho_Chi_Minh',
    requestTimeoutMs: 15_000,
    leaseDurationSeconds: 300,
    clock: () => '2026-08-10T08:00:00.000Z',
    signal: new AbortController().signal,
    state,
    transport,
  });

  assert.equal(result.status, 'succeeded', JSON.stringify(result));
  assert.equal(result.code, 'm14-live-qualified');
  assert.equal(result.injectedJournalFailureObserved, true);
  assert.equal(result.retryConvergenceObserved, true);
  assert.equal(result.forwardMutationCount, 5);
  assert.equal(result.rollbackMutationCount, 4);
  assert.equal(result.cleanupMutationCount, 1);
  assert.equal(result.finalOwnedEventCount, 0);
  assert.equal(transport.events.size, 0);
  const seededNoOpReference = providerEventIdForIntent(
    'm14-test-run-01-setup-replace',
  );
  const seedInsert = transport.calls.findIndex(
    (call) =>
      call.method === 'insert' && call.eventReference === seededNoOpReference,
  );
  assert.ok(seedInsert >= 0);
  const setupDeleteReference = providerEventIdForIntent(
    'm14-test-run-01-setup-delete',
  );
  const seedDeleteInsert = transport.calls.findIndex(
    (call) =>
      call.method === 'insert' && call.eventReference === setupDeleteReference,
  );
  assert.ok(seedDeleteInsert >= 0);
  const finalSetupInsert = Math.max(seedInsert, seedDeleteInsert);
  assert.deepEqual(transport.calls[finalSetupInsert + 1], {
    method: 'get',
    eventReference: seededNoOpReference,
  });
  const noOpJournal = await state.loadExecution(
    result.executionFingerprints[1]!,
  );
  assert.equal(noOpJournal?.status, 'succeeded');
  assert.deepEqual(noOpJournal?.steps, [
    {
      intentId: 'm14-test-run-01-main-noop',
      intentKind: 'no-op',
      status: 'succeeded',
      outcome: 'no-op',
      providerReferenceHash: hashCalendarProviderReference(seededNoOpReference),
    },
  ]);
  assert.ok(
    transport.calls
      .filter((call) => call.method !== 'get')
      .every((call) => call.sendUpdates === 'none'),
  );
});

test('cleans every exact owned test event after an ordinary partial failure', async () => {
  using database = new SqliteDatabase(':memory:', {
    migration: { appliedAt: '2026-08-10T08:00:00.000Z' },
  });
  const transport = new MemoryCalendarTransport();
  transport.failGetAt = 3;
  const calendarId = 'm14-live-failure@example.test';
  const result = await runM14LiveQualification({
    calendarId,
    calendarReferenceHash: digest(calendarId),
    productionCalendarReferenceHash: digest('production@example.test'),
    qualificationRunId: 'm14-test-run-failure',
    approvalExpiresAt: '2026-08-10T08:15:00.000Z',
    scopeId: 'classroom-hub-m14-auto-lesson-2',
    timeZone: 'Asia/Ho_Chi_Minh',
    requestTimeoutMs: 15_000,
    leaseDurationSeconds: 300,
    clock: () => '2026-08-10T08:00:00.000Z',
    signal: new AbortController().signal,
    state: new SqliteCalendarExecutionState(database),
    transport,
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.code, 'm14-live-execution-failed');
  assert.equal(result.cleanupMutationCount, 2);
  assert.equal(result.finalOwnedEventCount, 0);
  assert.equal(transport.events.size, 0);
  assert.ok(
    transport.calls
      .filter((call) => call.method !== 'get')
      .every((call) => call.sendUpdates === 'none'),
  );
});

test('explicit recovery refuses a foreign deterministic event before every mutation', async () => {
  using database = new SqliteDatabase(':memory:', {
    migration: { appliedAt: '2026-08-10T08:00:00.000Z' },
  });
  const transport = new MemoryCalendarTransport();
  const runId = 'm14-test-run-foreign';
  const eventReference = providerEventIdForIntent(`${runId}-setup-replace`);
  transport.events.set(eventReference, {
    eventReference,
    etag: 'foreign-etag',
    ownership: {
      owner: 'someone-else',
      scopeId: 'classroom-hub-m14-auto-lesson-2',
      ownershipMarker: 'classroom-hub-v1',
    },
    summary: 'M14 Qualification Seed Replace',
    description: 'Imported from PowerSchool Bell Schedule.',
    startsAt: '2035-04-13T01:00:00.000Z',
    endsAt: '2035-04-13T01:15:00.000Z',
    timeZone: 'Asia/Ho_Chi_Minh',
  });
  const calendarId = 'm14-live-recovery@example.test';
  const result = await recoverM14LiveQualification({
    calendarId,
    calendarReferenceHash: digest(calendarId),
    productionCalendarReferenceHash: digest('production@example.test'),
    qualificationRunId: runId,
    approvalExpiresAt: '2026-08-10T08:15:00.000Z',
    scopeId: 'classroom-hub-m14-auto-lesson-2',
    timeZone: 'Asia/Ho_Chi_Minh',
    requestTimeoutMs: 15_000,
    leaseDurationSeconds: 300,
    clock: () => '2026-08-10T08:00:00.000Z',
    signal: new AbortController().signal,
    state: new SqliteCalendarExecutionState(database),
    transport,
  });

  assert.equal(result.code, 'm14-live-cleanup-incomplete');
  assert.equal(result.cleanupMutationCount, 0);
  assert.equal(
    transport.calls.some((call) => call.method !== 'get'),
    false,
  );
  assert.equal(transport.events.has(eventReference), true);
});

test('refuses a production-equivalent target before provider access', async () => {
  using database = new SqliteDatabase(':memory:', {
    migration: { appliedAt: '2026-08-10T08:00:00.000Z' },
  });
  const transport = new MemoryCalendarTransport();
  const calendarId = 'production@example.test';
  const hash = digest(calendarId);
  const result = await runM14LiveQualification({
    calendarId,
    calendarReferenceHash: hash,
    productionCalendarReferenceHash: hash,
    qualificationRunId: 'm14-test-run-02',
    approvalExpiresAt: '2026-08-10T08:15:00.000Z',
    scopeId: 'classroom-hub-m14-auto-lesson-2',
    timeZone: 'Asia/Ho_Chi_Minh',
    requestTimeoutMs: 15_000,
    leaseDurationSeconds: 300,
    clock: () => '2026-08-10T08:00:00.000Z',
    signal: new AbortController().signal,
    state: new SqliteCalendarExecutionState(database),
    transport,
  });
  assert.equal(result.code, 'm14-live-input-invalid');
  assert.equal(transport.calls.length, 0);
});
