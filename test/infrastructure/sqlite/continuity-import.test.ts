import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';

import { planContinuityImport } from '../../../src/application/persistence/continuity-importer.js';
import { stableSerialize } from '../../../src/domain/pure-values.js';
import {
  applyContinuityImport,
  ContinuityImportApplyError,
} from '../../../src/infrastructure/sqlite/continuity-import.js';
import { SqliteDatabase } from '../../../src/infrastructure/sqlite/database.js';

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'classroom-hub-import-'));
  temporaryRoots.push(root);
  const database = new SqliteDatabase(join(root, 'state.sqlite'), {
    migration: { appliedAt: '2035-08-01T00:00:00Z' },
  });
  let sequence = 0;
  return {
    database,
    options(sourceReference: string, plan = safePlan()) {
      return {
        database,
        sourceReference,
        plan,
        clock: { now: () => '2035-09-04T12:30:00Z' },
        nextImportId: () => `import-${++sequence}`,
      };
    },
  };
}

function safeDocument(targetKey = 'room-alpha') {
  return {
    formatVersion: 1,
    mappings: [
      {
        mappingId: 'mapping-alpha',
        kind: 'class-to-room',
        sourceKey: 'class-alpha',
        targetKey,
        activeFrom: '2035-08-01T00:00:00Z',
      },
      {
        mappingId: 'mapping-beta',
        kind: 'class-to-room',
        sourceKey: 'class-beta',
        targetKey: 'room-beta',
        activeFrom: '2035-08-01T00:00:00Z',
      },
    ],
  };
}

function safePlan(targetKey = 'room-alpha') {
  return planContinuityImport(safeDocument(targetKey));
}

function scalar(
  database: SqliteDatabase,
  sql: string,
  ...parameters: string[]
): number {
  const row = database.connection.prepare(sql).get(...parameters) as unknown as
    { readonly count: number } | undefined;
  return Number(row?.count ?? 0);
}

test('applies a validated batch atomically with injected evidence values', () => {
  const item = fixture();
  const result = applyContinuityImport(item.options('fixture:m04-alpha'));

  assert.deepEqual(
    {
      status: result.status,
      importId: result.importId,
      accepted: result.acceptedCount,
      inserted: result.insertedCount,
      unchanged: result.unchangedCount,
      rejected: result.rejectedCount,
    },
    {
      status: 'imported',
      importId: 'import-1',
      accepted: 2,
      inserted: 2,
      unchanged: 0,
      rejected: 0,
    },
  );
  assert.equal(
    scalar(item.database, 'SELECT count(*) AS count FROM continuity_records'),
    2,
  );
  assert.deepEqual(
    {
      ...item.database.connection
        .prepare(
          `SELECT source_reference, started_at, finished_at, status
             FROM import_runs WHERE import_id = ?`,
        )
        .get('import-1'),
    },
    {
      source_reference: 'fixture:m04-alpha',
      started_at: '2035-09-04T12:30:00Z',
      finished_at: '2035-09-04T12:30:00Z',
      status: 'imported',
    },
  );
  item.database.close();
});

test('is idempotent for repeated sources and a semantic no-op across sources', () => {
  const item = fixture();
  const plan = safePlan();
  const first = applyContinuityImport(item.options('fixture:first', plan));
  const repeated = applyContinuityImport(item.options('fixture:first', plan));
  const alternate = applyContinuityImport(item.options('fixture:second', plan));

  assert.equal(first.status, 'imported');
  assert.equal(repeated.status, 'unchanged');
  assert.equal(repeated.importId, first.importId);
  assert.equal(alternate.status, 'unchanged');
  assert.equal(alternate.insertedCount, 0);
  assert.equal(alternate.unchangedCount, 2);
  assert.equal(
    scalar(item.database, 'SELECT count(*) AS count FROM continuity_records'),
    2,
  );
  assert.equal(
    scalar(item.database, 'SELECT count(*) AS count FROM import_runs'),
    2,
  );
  item.database.close();
});

test('rejects identity conflicts without changing any continuity record', () => {
  const item = fixture();
  applyContinuityImport(item.options('fixture:initial'));
  const before = item.database.connection
    .prepare(
      `SELECT collection, identity, checksum, record_json
         FROM continuity_records ORDER BY collection, identity`,
    )
    .all();

  const result = applyContinuityImport(
    item.options('fixture:conflict', safePlan('room-conflicting')),
  );

  assert.equal(result.status, 'rejected');
  assert.equal(result.insertedCount, 0);
  assert.deepEqual(result.rejections, [
    {
      category: 'corrupt-record',
      code: 'existing-record-conflict',
      path: '$.operations[0]',
    },
  ]);
  assert.deepEqual(
    item.database.connection
      .prepare(
        `SELECT collection, identity, checksum, record_json
           FROM continuity_records ORDER BY collection, identity`,
      )
      .all(),
    before,
  );
  assert.equal(
    scalar(
      item.database,
      'SELECT count(*) AS count FROM import_rejections WHERE import_id = ?',
      result.importId,
    ),
    1,
  );
  item.database.close();
});

test('rejects a stored record whose JSON no longer matches its checksum', () => {
  const item = fixture();
  applyContinuityImport(item.options('fixture:initial'));
  item.database.connection
    .prepare(
      `UPDATE continuity_records
          SET record_json = ?
        WHERE collection = ? AND identity = ?`,
    )
    .run(
      JSON.stringify({
        mappingId: 'mapping-alpha',
        kind: 'class-to-room',
        sourceKey: 'class-alpha',
        targetKey: 'room-tampered',
        activeFrom: '2035-08-01T00:00:00Z',
      }),
      'mappings',
      'mapping-alpha',
    );
  const corruptedRecords = item.database.connection
    .prepare(
      `SELECT collection, identity, checksum, record_json
         FROM continuity_records ORDER BY collection, identity`,
    )
    .all();

  const result = applyContinuityImport(
    item.options('fixture:another-source', safePlan()),
  );

  assert.equal(result.status, 'rejected');
  assert.equal(result.insertedCount, 0);
  assert.equal(result.unchangedCount, 0);
  assert.deepEqual(result.rejections, [
    {
      category: 'corrupt-record',
      code: 'existing-record-corrupt',
      path: '$.operations[0]',
    },
  ]);
  assert.deepEqual(
    item.database.connection
      .prepare(
        `SELECT collection, identity, checksum, record_json
           FROM continuity_records ORDER BY collection, identity`,
      )
      .all(),
    corruptedRecords,
  );
  assert.equal(
    scalar(
      item.database,
      'SELECT count(*) AS count FROM import_rejections WHERE import_id = ?',
      result.importId,
    ),
    1,
  );
  item.database.close();
});

test('rejects malformed stored JSON without changing continuity records', () => {
  const item = fixture();
  const plan = safePlan();
  applyContinuityImport(item.options('fixture:initial', plan));
  item.database.connection.exec('PRAGMA ignore_check_constraints = ON');
  item.database.connection
    .prepare(
      `UPDATE continuity_records
          SET record_json = ?
        WHERE collection = ? AND identity = ?`,
    )
    .run('{', 'mappings', 'mapping-alpha');
  item.database.connection.exec('PRAGMA ignore_check_constraints = OFF');
  const corruptedRecords = item.database.connection
    .prepare(
      `SELECT collection, identity, checksum, record_json
         FROM continuity_records ORDER BY collection, identity`,
    )
    .all();

  const result = applyContinuityImport(
    item.options('fixture:another-source', plan),
  );

  assert.equal(result.status, 'rejected');
  assert.deepEqual(result.rejections, [
    {
      category: 'corrupt-record',
      code: 'existing-record-corrupt',
      path: '$.operations[0]',
    },
  ]);
  assert.deepEqual(
    item.database.connection
      .prepare(
        `SELECT collection, identity, checksum, record_json
           FROM continuity_records ORDER BY collection, identity`,
      )
      .all(),
    corruptedRecords,
  );
  item.database.close();
});

test('rejects checksum-consistent stored JSON that violates its collection contract', () => {
  const item = fixture();
  const plan = safePlan();
  applyContinuityImport(item.options('fixture:initial', plan));
  const row = item.database.connection
    .prepare(
      `SELECT record_json FROM continuity_records
        WHERE collection = ? AND identity = ?`,
    )
    .get('mappings', 'mapping-alpha') as unknown as
    { readonly record_json: string } | undefined;
  assert.ok(row);
  const record = JSON.parse(row.record_json) as Record<string, unknown>;
  record.unreviewed = true;
  const recordJson = stableSerialize(record);
  const checksum = createHash('sha256').update(recordJson).digest('hex');
  item.database.connection
    .prepare(
      `UPDATE continuity_records
          SET record_json = ?, checksum = ?
        WHERE collection = ? AND identity = ?`,
    )
    .run(recordJson, checksum, 'mappings', 'mapping-alpha');
  const before = item.database.connection
    .prepare(
      `SELECT collection, identity, checksum, record_json
         FROM continuity_records ORDER BY collection, identity`,
    )
    .all();

  const result = applyContinuityImport(
    item.options('fixture:another-source', plan),
  );

  assert.equal(result.status, 'rejected');
  assert.deepEqual(result.rejections, [
    {
      category: 'corrupt-record',
      code: 'existing-record-corrupt',
      path: '$.operations[0]',
    },
  ]);
  assert.deepEqual(
    item.database.connection
      .prepare(
        `SELECT collection, identity, checksum, record_json
           FROM continuity_records ORDER BY collection, identity`,
      )
      .all(),
    before,
  );
  item.database.close();
});

test('persists only redacted rejection evidence for an invalid document', () => {
  const item = fixture();
  const sensitiveValue = 'synthetic-sensitive-value-not-for-storage';
  const rejected = planContinuityImport({
    formatVersion: 1,
    mappings: [
      {
        mappingId: 'mapping-alpha',
        kind: 'class-to-room',
        sourceKey: 'class-alpha',
        targetKey: 'room-alpha',
        activeFrom: '2035-08-01T00:00:00Z',
        oauthToken: sensitiveValue,
      },
    ],
  });
  const result = applyContinuityImport(
    item.options('fixture:rejected', rejected),
  );

  assert.equal(result.status, 'rejected');
  assert.ok(result.rejectedCount > 0);
  assert.equal(
    scalar(item.database, 'SELECT count(*) AS count FROM continuity_records'),
    0,
  );
  const evidence = stableDatabaseEvidence(item.database);
  assert.equal(evidence.includes(sensitiveValue), false);
  assert.equal(evidence.includes('forbidden-storage-surface'), true);
  const repeated = applyContinuityImport(
    item.options('fixture:rejected', rejected),
  );
  assert.equal(repeated.status, 'rejected');
  assert.equal(repeated.importId, result.importId);
  assert.equal(
    scalar(item.database, 'SELECT count(*) AS count FROM import_runs'),
    1,
  );
  item.database.close();
});

test('rolls back records and import evidence after an injected failure', () => {
  const item = fixture();
  assert.throws(
    () =>
      applyContinuityImport({
        ...item.options('fixture:rollback'),
        beforeCommit: () => {
          throw new Error('synthetic failure');
        },
      }),
    (error: unknown) =>
      error instanceof ContinuityImportApplyError &&
      error.code === 'storage-failed',
  );
  assert.equal(
    scalar(item.database, 'SELECT count(*) AS count FROM continuity_records'),
    0,
  );
  assert.equal(
    scalar(item.database, 'SELECT count(*) AS count FROM import_runs'),
    0,
  );
  item.database.close();
});

test('rejects unsafe source references before retaining evidence', () => {
  const item = fixture();
  for (const unsafe of [
    '/private/runtime/state.sqlite',
    'oauth-token-reference',
  ]) {
    assert.throws(
      () => applyContinuityImport(item.options(unsafe)),
      (error: unknown) => {
        assert.ok(error instanceof ContinuityImportApplyError);
        assert.equal(error.code, 'unsafe-source-reference');
        assert.equal(error.message.includes(unsafe), false);
        return true;
      },
    );
  }
  assert.equal(
    scalar(item.database, 'SELECT count(*) AS count FROM import_runs'),
    0,
  );
  item.database.close();
});

function stableDatabaseEvidence(database: SqliteDatabase): string {
  return JSON.stringify({
    runs: database.connection
      .prepare('SELECT * FROM import_runs ORDER BY import_id')
      .all(),
    rejections: database.connection
      .prepare('SELECT * FROM import_rejections ORDER BY import_id, ordinal')
      .all(),
    records: database.connection
      .prepare('SELECT * FROM continuity_records ORDER BY collection, identity')
      .all(),
  });
}
