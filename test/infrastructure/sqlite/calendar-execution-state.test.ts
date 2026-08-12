import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';

import { SqliteCalendarExecutionState } from '../../../src/infrastructure/sqlite/calendar-execution-state.js';
import { SqliteDatabase } from '../../../src/infrastructure/sqlite/database.js';

const roots: string[] = [];
const fingerprint = `sha256:${'a'.repeat(64)}`;
const manifestFingerprint = `sha256:${'b'.repeat(64)}`;

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function open() {
  const root = mkdtempSync(join(tmpdir(), 'classroom-hub-m14-state-'));
  roots.push(root);
  const database = new SqliteDatabase(join(root, 'state.sqlite'), {
    migration: { appliedAt: '2035-04-13T06:00:00.000Z' },
  });
  return { database, state: new SqliteCalendarExecutionState(database) };
}

test('persists one finite lease, refuses a competitor, and permits expiry recovery', async () => {
  const { database, state } = open();
  try {
    const first = await state.acquireLease({
      scopeId: 'scope-alpha',
      leaseId: 'lease-alpha',
      ownerId: 'writer-alpha',
      now: '2035-04-13T07:00:00.000Z',
      expiresAt: '2035-04-13T07:02:00.000Z',
    });
    assert.equal(first.status, 'acquired');
    assert.equal(
      (
        await state.acquireLease({
          scopeId: 'scope-alpha',
          leaseId: 'lease-alpha',
          ownerId: 'different-writer',
          now: '2035-04-13T07:01:00.000Z',
          expiresAt: '2035-04-13T07:03:00.000Z',
        })
      ).status,
      'conflict',
    );
    assert.equal(
      (
        await state.acquireLease({
          scopeId: 'scope-alpha',
          leaseId: 'lease-beta',
          ownerId: 'writer-beta',
          now: '2035-04-13T07:01:00.000Z',
          expiresAt: '2035-04-13T07:03:00.000Z',
        })
      ).status,
      'conflict',
    );
    const recovered = await state.acquireLease({
      scopeId: 'scope-alpha',
      leaseId: 'lease-beta',
      ownerId: 'writer-beta',
      now: '2035-04-13T07:02:00.000Z',
      expiresAt: '2035-04-13T07:04:00.000Z',
    });
    assert.equal(recovered.status, 'acquired');
    await state.releaseLease({
      scopeId: 'scope-alpha',
      leaseId: 'lease-beta',
      ownerId: 'different-writer',
    });
    assert.equal(
      Number(
        (
          database.connection
            .prepare('SELECT count(*) AS value FROM calendar_writer_leases')
            .get() as { readonly value: number }
        ).value,
      ),
      1,
    );
    await state.releaseLease({
      scopeId: 'scope-alpha',
      leaseId: 'lease-beta',
      ownerId: 'writer-beta',
    });
    assert.equal(
      Number(
        (
          database.connection
            .prepare('SELECT count(*) AS value FROM calendar_writer_leases')
            .get() as { readonly value: number }
        ).value,
      ),
      0,
    );
  } finally {
    database.close();
  }
});

test('round-trips only sanitized execution evidence and survives reopening', async () => {
  const { database, state } = open();
  const path = database.databasePath;
  await state.beginExecution({
    executionFingerprint: fingerprint,
    manifestFingerprint,
    scopeId: 'scope-alpha',
    status: 'running',
    startedAt: '2035-04-13T07:00:00.000Z',
    steps: [],
  });
  await state.recordStep({
    executionFingerprint: fingerprint,
    step: {
      intentId: 'intent-alpha',
      intentKind: 'create',
      status: 'attempted',
      providerReferenceHash: `sha256:${'c'.repeat(64)}`,
    },
  });
  await state.recordStep({
    executionFingerprint: fingerprint,
    step: {
      intentId: 'intent-alpha',
      intentKind: 'create',
      status: 'succeeded',
      outcome: 'mutated',
      providerReferenceHash: `sha256:${'c'.repeat(64)}`,
    },
  });
  await state.finishExecution({
    executionFingerprint: fingerprint,
    status: 'succeeded',
    finishedAt: '2035-04-13T07:00:05.000Z',
  });
  await assert.rejects(
    state.recordStep({
      executionFingerprint: fingerprint,
      step: {
        intentId: 'intent-alpha',
        intentKind: 'create',
        status: 'succeeded',
        outcome: 'mutated',
        providerReferenceHash: `sha256:${'c'.repeat(64)}`,
      },
    }),
    /calendar-execution-state-invalid/,
  );
  assert.deepEqual(await state.loadExecution(fingerprint), {
    executionFingerprint: fingerprint,
    manifestFingerprint,
    scopeId: 'scope-alpha',
    status: 'succeeded',
    startedAt: '2035-04-13T07:00:00.000Z',
    finishedAt: '2035-04-13T07:00:05.000Z',
    steps: [
      {
        intentId: 'intent-alpha',
        intentKind: 'create',
        status: 'succeeded',
        outcome: 'mutated',
        providerReferenceHash: `sha256:${'c'.repeat(64)}`,
      },
    ],
  });
  database.close();

  using reopened = new SqliteDatabase(path, {
    migration: { appliedAt: '2035-04-13T07:01:00.000Z' },
  });
  const reopenedState = new SqliteCalendarExecutionState(reopened);
  assert.equal(
    (await reopenedState.loadExecution(fingerprint))?.status,
    'succeeded',
  );
  const columns = reopened.connection
    .prepare('PRAGMA table_info(calendar_execution_journal)')
    .all()
    .map((row) => String((row as { readonly name: unknown }).name));
  assert.deepEqual(columns, [
    'execution_fingerprint',
    'manifest_fingerprint',
    'scope_id',
    'status',
    'started_at',
    'finished_at',
  ]);
});

test('requires an explicit failed-to-running resume before retry steps', async () => {
  const { database, state } = open();
  const retryFingerprint = `sha256:${'d'.repeat(64)}`;
  try {
    await state.beginExecution({
      executionFingerprint: retryFingerprint,
      manifestFingerprint,
      scopeId: 'scope-alpha',
      status: 'running',
      startedAt: '2035-04-13T07:00:00.000Z',
      steps: [],
    });
    await state.recordStep({
      executionFingerprint: retryFingerprint,
      step: {
        intentId: 'intent-alpha',
        intentKind: 'create',
        status: 'failed',
        outcome: 'refused',
        providerReferenceHash: `sha256:${'c'.repeat(64)}`,
        errorCode: 'calendar-write-unavailable',
      },
    });
    await state.finishExecution({
      executionFingerprint: retryFingerprint,
      status: 'failed',
      finishedAt: '2035-04-13T07:00:05.000Z',
    });
    await assert.rejects(
      state.recordStep({
        executionFingerprint: retryFingerprint,
        step: {
          intentId: 'intent-alpha',
          intentKind: 'create',
          status: 'attempted',
          providerReferenceHash: `sha256:${'c'.repeat(64)}`,
        },
      }),
      /calendar-execution-state-invalid/,
    );
    await state.resumeExecution({ executionFingerprint: retryFingerprint });
    await state.recordStep({
      executionFingerprint: retryFingerprint,
      step: {
        intentId: 'intent-alpha',
        intentKind: 'create',
        status: 'attempted',
        providerReferenceHash: `sha256:${'c'.repeat(64)}`,
      },
    });
    assert.equal(
      (await state.loadExecution(retryFingerprint))?.status,
      'running',
    );
  } finally {
    database.close();
  }
});

test('rejects invalid records and detects corrupt journal rows without leaking values', async () => {
  const { database, state } = open();
  try {
    await assert.rejects(
      state.acquireLease({
        scopeId: 'scope-alpha',
        leaseId: 'lease-alpha',
        ownerId: 'writer-alpha',
        now: 'not-an-instant',
        expiresAt: '2035-04-13T07:02:00.000Z',
      }),
      /calendar-execution-state-invalid/,
    );
    database.connection
      .prepare(
        `INSERT INTO calendar_execution_journal(
           execution_fingerprint, manifest_fingerprint, scope_id, status,
           started_at, finished_at
         ) VALUES (?, ?, ?, 'running', ?, NULL)`,
      )
      .run(
        fingerprint,
        manifestFingerprint,
        'scope-alpha',
        'not-an-instant-but-sql-allows-it',
      );
    await assert.rejects(
      state.loadExecution(fingerprint),
      (error: unknown) =>
        error instanceof Error &&
        error.message === 'calendar-execution-state-invalid',
    );
  } finally {
    database.close();
  }
});
