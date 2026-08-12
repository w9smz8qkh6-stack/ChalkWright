import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  executeCalendarRollbackQualification,
  fingerprintCalendarRollbackActions,
} from '../../../src/application/calendar/rollback-qualification.js';
import { planCalendarRollback } from '../../../src/application/calendar/rollback-planner.js';
import {
  executeCalendarWriterQualification,
  fingerprintCalendarIntentSet,
  hashCalendarReference,
  providerEventIdForIntent,
} from '../../../src/application/calendar/writer-qualification.js';
import {
  contractVersion,
  type CalendarMutationIntent,
} from '../../../src/contracts/v1/index.js';
import {
  createOfflineQualifiedCalendarMutationTransport,
  type NarrowCalendarMutationClient,
} from '../../../src/infrastructure/google-calendar/offline-writer-adapter.js';
import { SqliteCalendarExecutionState } from '../../../src/infrastructure/sqlite/calendar-execution-state.js';
import { SqliteDatabase } from '../../../src/infrastructure/sqlite/database.js';
import type { CalendarExecutionStepRecord } from '../../../src/ports/calendar-execution-state.js';

test('executes and rolls back through the exact adapter with durable restart replay', async () => {
  const root = mkdtempSync(join(tmpdir(), 'classroom-hub-m14-integration-'));
  const databasePath = join(root, 'state.sqlite');
  const calendarId = 'm14-synthetic@example.test';
  const scopeId = 'scope-alpha';
  const auditFingerprint = `sha256:${'a'.repeat(64)}`;
  const desired = {
    summary: 'Block A',
    description: 'Imported from PowerSchool Bell Schedule.',
    startsAt: '2035-04-13T08:00:00.000Z',
    endsAt: '2035-04-13T09:00:00.000Z',
    timeZone: 'Etc/UTC',
  };
  const intent: CalendarMutationIntent = {
    contractVersion,
    intentId: 'intent-create',
    planId: 'plan-alpha',
    notifyAttendees: false,
    kind: 'create',
    ownership: {
      classification: 'verified-application-owned',
      scopeId,
      ownershipMarker: 'classroom-hub-v1',
    },
    desired,
  };
  const providerId = providerEventIdForIntent(intent.intentId);
  let providerMutations = 0;
  let providerExists = false;
  const client: NarrowCalendarMutationClient = {
    events: {
      async get() {
        return !providerExists
          ? Promise.reject({ response: { status: 404 } })
          : Promise.resolve({ data: responseEvent() });
      },
      async insert() {
        providerMutations += 1;
        providerExists = true;
        return { data: responseEvent() };
      },
      async update() {
        throw new Error('unexpected-update');
      },
      async delete() {
        providerMutations += 1;
        providerExists = false;
        return { data: undefined };
      },
    },
  };
  let sourceExecutionFingerprint = '';
  let forwardSteps: readonly CalendarExecutionStepRecord[] = [];
  const manifest = {
    version: 1 as const,
    kind: 'calendar-writer-execution-approval' as const,
    environment: 'non-production' as const,
    approvalId: 'approval-alpha',
    scopeId,
    calendarReferenceHash: hashCalendarReference(calendarId),
    auditFingerprint,
    intentSetFingerprint: fingerprintCalendarIntentSet([intent]),
    allowedIntentIds: [intent.intentId],
    issuedAt: '2035-04-13T06:59:00.000Z',
    expiresAt: '2035-04-13T07:10:00.000Z',
  };
  const common = {
    environment: 'non-production' as const,
    calendarId,
    scopeId,
    auditFingerprint,
    intents: [intent],
    manifest,
    leaseId: 'lease-alpha',
    ownerId: 'writer-alpha',
    leaseDurationSeconds: 120,
    requestTimeoutMs: 5_000,
    clock: () => '2035-04-13T07:00:00.000Z',
    signal: new AbortController().signal,
    transport: createOfflineQualifiedCalendarMutationTransport(client),
  };
  try {
    {
      using database = new SqliteDatabase(databasePath, {
        migration: { appliedAt: '2035-04-13T06:00:00.000Z' },
      });
      const state = new SqliteCalendarExecutionState(database);
      const result = await executeCalendarWriterQualification({
        ...common,
        state,
      });
      assert.equal(result.status, 'succeeded', JSON.stringify(result));
      assert.equal(result.completedExternalMutations, 1);
      sourceExecutionFingerprint = result.executionFingerprint;
      forwardSteps = (await state.loadExecution(result.executionFingerprint))!
        .steps;
    }
    {
      using database = new SqliteDatabase(databasePath, {
        migration: { appliedAt: '2035-04-13T07:01:00.000Z' },
      });
      const replay = await executeCalendarWriterQualification({
        ...common,
        leaseId: 'lease-replay',
        state: new SqliteCalendarExecutionState(database),
      });
      assert.equal(replay.code, 'calendar-write-replayed');
      assert.equal(replay.attemptedExternalMutations, 0);
      assert.equal(providerMutations, 1);
    }
    const rollbackPlan = planCalendarRollback({
      scopeId,
      intents: [intent],
      steps: forwardSteps,
      beforeSnapshots: [],
    });
    assert.equal(rollbackPlan.status, 'ready');
    const rollbackManifest = {
      version: 1 as const,
      kind: 'calendar-writer-rollback-approval' as const,
      environment: 'non-production' as const,
      approvalId: 'rollback-approval-alpha',
      scopeId,
      calendarReferenceHash: hashCalendarReference(calendarId),
      sourceExecutionFingerprint,
      rollbackEvidenceFingerprint: rollbackPlan.fingerprint,
      actionSetFingerprint: fingerprintCalendarRollbackActions(
        rollbackPlan.actions,
      ),
      allowedRollbackIds: rollbackPlan.actions.map(
        (action) => action.rollbackId,
      ),
      issuedAt: '2035-04-13T07:01:00.000Z',
      expiresAt: '2035-04-13T07:10:00.000Z',
    };
    const rollbackCommon = {
      environment: 'non-production' as const,
      calendarId,
      scopeId,
      sourceExecutionFingerprint,
      intents: [intent],
      steps: forwardSteps,
      beforeSnapshots: [],
      manifest: rollbackManifest,
      leaseId: 'rollback-lease-alpha',
      ownerId: 'rollback-writer-alpha',
      leaseDurationSeconds: 120,
      requestTimeoutMs: 5_000,
      clock: () => '2035-04-13T07:02:00.000Z',
      signal: new AbortController().signal,
      transport: createOfflineQualifiedCalendarMutationTransport(client),
    };
    {
      using database = new SqliteDatabase(databasePath, {
        migration: { appliedAt: '2035-04-13T07:02:00.000Z' },
      });
      const rollback = await executeCalendarRollbackQualification({
        ...rollbackCommon,
        state: new SqliteCalendarExecutionState(database),
      });
      assert.equal(rollback.status, 'succeeded', JSON.stringify(rollback));
      assert.equal(rollback.completedExternalMutations, 1);
      assert.equal(providerExists, false);
    }
    {
      using database = new SqliteDatabase(databasePath, {
        migration: { appliedAt: '2035-04-13T07:03:00.000Z' },
      });
      const replay = await executeCalendarRollbackQualification({
        ...rollbackCommon,
        leaseId: 'rollback-lease-replay',
        state: new SqliteCalendarExecutionState(database),
      });
      assert.equal(replay.code, 'calendar-rollback-replayed');
      assert.equal(replay.attemptedExternalMutations, 0);
      assert.equal(providerMutations, 2);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  function responseEvent() {
    return {
      id: providerId,
      etag: '"etag-alpha"',
      status: 'confirmed',
      eventType: 'default',
      summary: desired.summary,
      description: desired.description,
      start: { dateTime: desired.startsAt, timeZone: desired.timeZone },
      end: { dateTime: desired.endsAt, timeZone: desired.timeZone },
      extendedProperties: {
        private: {
          classroomHubOwner: 'classroom-hub',
          classroomHubScope: scopeId,
          classroomHubOwnershipMarker: 'classroom-hub-v1',
        },
      },
      reminders: { useDefault: false, overrides: [] },
    };
  }
});
