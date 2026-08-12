import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { contractVersion } from '../../../src/contracts/v1/common.js';
import { SqliteDatabase } from '../../../src/infrastructure/sqlite/database.js';
import { SqliteApplicationStateRepository } from '../../../src/infrastructure/sqlite/repository.js';
import type {
  AlertCheckpoint,
  OperationsJobRunRecord,
} from '../../../src/ports/operations.js';

const instant = '2035-04-13T07:00:00Z';

function checkpoint(overrides: Partial<AlertCheckpoint> = {}): AlertCheckpoint {
  return {
    activeIssueFingerprints: ['fnv1a64:1111111111111111'],
    lastSuccessfulIssueFingerprints: [],
    lastDecision: 'no-send',
    decidedAt: instant,
    deliveryMode: 'report-only',
    deliveryState: 'not-attempted',
    ...overrides,
  };
}

function jobRun(
  recordKey: string,
  jobName: string,
  startedAt: string,
): OperationsJobRunRecord {
  return {
    kind: 'job-run',
    recordKey,
    scope: {},
    data: {
      outcome: {
        contractVersion,
        runId: recordKey,
        jobName,
        startedAt,
        finishedAt: startedAt,
        diagnostics: [],
        category: 'succeeded',
        attemptedExternalMutations: 0,
        completedExternalMutations: 0,
      },
      errorCodes: [],
      incidentCodes: [],
      requestedDates: [],
      provenanceReferences: [],
    },
  };
}

async function withRepository(
  run: (
    repository: SqliteApplicationStateRepository,
    database: SqliteDatabase,
  ) => Promise<void> | void,
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'classroom-hub-operations-state-'));
  const database = new SqliteDatabase(join(root, 'state.sqlite'), {
    migration: { appliedAt: instant },
  });
  let revision = 0;
  const repository = new SqliteApplicationStateRepository(database, {
    clock: { now: () => instant },
    nextRevision: () => `revision-${++revision}`,
  });
  try {
    await run(repository, database);
  } finally {
    database.close();
    rmSync(root, { recursive: true, force: true });
  }
}

test('alert checkpoint is fixed-scope, restart-safe, and a semantic no-op', async () => {
  await withRepository(async (repository) => {
    assert.equal(await repository.loadAlertCheckpoint(), undefined);
    const first = await repository.storeAlertCheckpoint(checkpoint());
    const same = await repository.storeAlertCheckpoint(
      structuredClone(checkpoint()),
    );
    assert.equal(first.status, 'stored');
    assert.deepEqual(same, {
      status: 'unchanged',
      revision: first.status === 'stored' ? first.revision : '',
    });
    assert.deepEqual(await repository.loadAlertCheckpoint(), checkpoint());

    const deliveredAt = '2035-04-13T07:00:01Z';
    assert.equal(
      (
        await repository.storeAlertCheckpoint(
          checkpoint({
            lastDecision: 'new',
            deliveryMode: 'fake',
            deliveryState: 'delivered',
            lastSuccessfulIssueFingerprints: ['fnv1a64:1111111111111111'],
            lastSuccessfulDeliveryAt: deliveredAt,
          }),
        )
      ).status,
      'stored',
    );
  });
});

test('alert checkpoint rejects unknown, unsafe, and inconsistent data', async () => {
  await withRepository(async (repository) => {
    for (const invalid of [
      { ...checkpoint(), recipient: 'operator@example.invalid' },
      { ...checkpoint(), decidedAt: '2035-02-30T00:00:00Z' },
      {
        ...checkpoint(),
        activeIssueFingerprints: ['fnv1a64:1111111111111111'],
        lastSuccessfulIssueFingerprints: [
          'fnv1a64:1111111111111111',
          'fnv1a64:1111111111111111',
        ],
      },
      {
        ...checkpoint(),
        activeIssueFingerprints: [],
        lastDecision: 'recovery',
        deliveryMode: 'https://example.invalid',
      },
      {
        ...checkpoint(),
        activeIssueFingerprints: ['duplicate', 'duplicate'],
      },
      {
        ...checkpoint(),
        lastSuccessfulIssueFingerprints: ['fnv1a64:2222222222222222'],
      },
      {
        ...checkpoint(),
        lastDecision: 'new',
        deliveryMode: 'fake',
        deliveryState: 'delivered',
        lastSuccessfulIssueFingerprints: ['fnv1a64:2222222222222222'],
        lastSuccessfulDeliveryAt: instant,
      },
      {
        ...checkpoint(),
        lastDecision: 'no-send',
        deliveryMode: 'fake',
        deliveryState: 'failed',
      },
    ]) {
      assert.equal(
        (
          await repository.storeAlertCheckpoint(
            invalid as unknown as AlertCheckpoint,
          )
        ).status,
        'rejected',
      );
    }
  });
});

test('run ledger stores validated records and applies bounded filters', async () => {
  await withRepository(async (repository) => {
    const first = jobRun(
      'run-alpha',
      'operations-report',
      '2035-04-13T07:00:00Z',
    );
    const second = jobRun('run-beta', 'sqlite-backup', '2035-04-13T08:00:00Z');
    const third = jobRun(
      'run-gamma',
      'operations-report',
      '2035-04-13T09:00:00Z',
    );
    for (const run of [first, second, third])
      assert.equal((await repository.storeJobRun(run)).status, 'stored');

    assert.deepEqual(
      (await repository.listJobRuns({ limit: 2 })).map((run) => run.recordKey),
      ['run-gamma', 'run-beta'],
    );
    assert.deepEqual(
      (
        await repository.listJobRuns({
          jobName: 'operations-report',
          startedAtOrAfter: '2035-04-13T08:00:00Z',
          limit: 10,
        })
      ).map((run) => run.recordKey),
      ['run-gamma'],
    );
    for (const query of [
      { limit: 0 },
      { limit: 101 },
      { limit: 1.5 },
      { limit: 1, startedAtOrAfter: 'not-an-instant' },
      { limit: 1, unexpected: true },
    ]) {
      await assert.rejects(
        repository.listJobRuns(query as never),
        /operations-run-query-invalid/,
      );
    }
  });
});

test('run-ledger writer rejects non-run records and oversized evidence', async () => {
  await withRepository(async (repository) => {
    const wrongKind = {
      kind: 'temporary-operational-state',
      recordKey: 'not-a-run',
      scope: {},
      data: { state: 'ready', code: 'synthetic', observedAt: instant },
    } as unknown as OperationsJobRunRecord;
    assert.equal((await repository.storeJobRun(wrongKind)).status, 'rejected');

    const oversized = jobRun('run-oversized', 'operations-report', instant);
    const invalid = {
      ...oversized,
      data: {
        ...oversized.data,
        errorCodes: Array.from({ length: 129 }, (_, index) => `error-${index}`),
      },
    };
    assert.equal((await repository.storeJobRun(invalid)).status, 'rejected');

    for (const malformed of [
      {
        ...jobRun('run-name', 'operations-report', instant),
        data: {
          ...jobRun('run-name', 'operations-report', instant).data,
          outcome: {
            ...jobRun('run-name', 'operations-report', instant).data.outcome,
            jobName: 'not-registered',
          },
        },
      },
      {
        ...jobRun('run-key', 'operations-report', instant),
        recordKey: 'different-run',
      },
      {
        ...jobRun('run-scope', 'operations-report', instant),
        scope: { date: '2035-04-13' },
      },
      {
        ...jobRun('run-expiry', 'operations-report', instant),
        expiresAt: instant,
      },
    ]) {
      assert.equal(
        (await repository.storeJobRun(malformed as OperationsJobRunRecord))
          .status,
        'rejected',
      );
    }
  });
});

test('corrupt checkpoint and run rows fail closed', async () => {
  await withRepository(async (repository, database) => {
    assert.equal(
      (await repository.storeAlertCheckpoint(checkpoint())).status,
      'stored',
    );
    const newer = checkpoint({
      activeIssueFingerprints: ['fnv1a64:2222222222222222'],
    });
    assert.equal(
      (await repository.storeAlertCheckpoint(newer)).status,
      'stored',
    );
    assert.equal(
      (
        await repository.storeJobRun(
          jobRun('run-alpha', 'operations-report', instant),
        )
      ).status,
      'stored',
    );
    database.connection
      .prepare(
        "UPDATE application_records SET payload_json = json_set(payload_json, '$.data.deliveryMode', 'smtp') WHERE record_kind = 'alert-state' AND superseded_at IS NULL",
      )
      .run();
    database.connection
      .prepare(
        "UPDATE application_records SET semantic_hash = 'tampered' WHERE record_kind = 'job-run'",
      )
      .run();
    assert.deepEqual(await repository.loadAlertCheckpoint(), checkpoint());
    assert.equal(
      (await repository.storeAlertCheckpoint(newer)).status,
      'stored',
    );
    assert.deepEqual(await repository.loadAlertCheckpoint(), newer);
    assert.deepEqual(await repository.listJobRuns({ limit: 10 }), []);
  });
});

test('retention removes aged superseded alert history but preserves the current checkpoint', async () => {
  await withRepository(async (repository, database) => {
    assert.equal(
      (await repository.storeAlertCheckpoint(checkpoint())).status,
      'stored',
    );
    assert.equal(
      (
        await repository.storeAlertCheckpoint(
          checkpoint({
            activeIssueFingerprints: ['fnv1a64:2222222222222222'],
          }),
        )
      ).status,
      'stored',
    );
    database.connection
      .prepare(
        "UPDATE application_records SET superseded_at = '2034-01-01T00:00:00Z' WHERE record_kind = 'alert-state' AND superseded_at IS NOT NULL",
      )
      .run();
    assert.equal(repository.pruneRetentionPolicy(instant), 1);
    assert.equal(
      Number(
        database.connection
          .prepare(
            "SELECT count(*) AS count FROM application_records WHERE record_kind = 'alert-state'",
          )
          .get()?.count,
      ),
      1,
    );
    assert.deepEqual(
      await repository.loadAlertCheckpoint(),
      checkpoint({ activeIssueFingerprints: ['fnv1a64:2222222222222222'] }),
    );
  });
});
