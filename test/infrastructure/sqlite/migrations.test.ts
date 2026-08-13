import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, test } from 'node:test';

import { SqliteDatabase } from '../../../src/infrastructure/sqlite/database.js';
import {
  applyMigrations,
  migrationChecksum,
  schemaMigrations,
} from '../../../src/infrastructure/sqlite/migrations.js';

const temporaryRoots: string[] = [];
const appliedAt = '2035-01-02T03:04:05.000Z';

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('forward-only SQLite migrations', () => {
  test('rejects invalid generated migration timestamps before schema writes', () => {
    const path = temporaryDatabasePath();
    const connection = new DatabaseSync(path);
    for (const invalid of ['junk', '2035-02-30T03:04:05.000Z']) {
      assert.throws(
        () => applyMigrations(connection, { appliedAt: invalid }),
        /schema-migration-applied-at-invalid/,
      );
      assert.equal(userVersion(connection), 0);
      assert.deepEqual(tableNames(connection), []);
    }
    connection.close();
  });

  test('migrates an empty database to the current schema', () => {
    const path = temporaryDatabasePath();
    using database = openDatabase(path);

    assert.equal(userVersion(database.connection), schemaMigrations.length);
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.deepEqual(appliedVersions(database.connection), [1, 2, 3, 4, 5, 6]);
    assert.deepEqual(
      appliedMigrationRows(database.connection),
      schemaMigrations.map((migration) => ({
        version: migration.version,
        name: migration.name,
        checksum: migrationChecksum(migration),
        applied_at: appliedAt,
      })),
    );
    assert.deepEqual(tableNames(database.connection), [
      'application_records',
      'calendar_execution_journal',
      'calendar_execution_steps',
      'calendar_writer_leases',
      'classroom_enrichment_cache',
      'continuity_records',
      'import_rejections',
      'import_runs',
      'plan_snapshots',
      'schema_migrations',
    ]);
  });

  test('supports every explicit target without applying later migrations', () => {
    const expectedTables = [
      ['schema_migrations'],
      ['application_records', 'plan_snapshots', 'schema_migrations'],
      [
        'application_records',
        'continuity_records',
        'import_rejections',
        'import_runs',
        'plan_snapshots',
        'schema_migrations',
      ],
      [
        'application_records',
        'continuity_records',
        'import_rejections',
        'import_runs',
        'plan_snapshots',
        'schema_migrations',
      ],
      [
        'application_records',
        'classroom_enrichment_cache',
        'continuity_records',
        'import_rejections',
        'import_runs',
        'plan_snapshots',
        'schema_migrations',
      ],
      [
        'application_records',
        'calendar_execution_journal',
        'calendar_execution_steps',
        'calendar_writer_leases',
        'classroom_enrichment_cache',
        'continuity_records',
        'import_rejections',
        'import_runs',
        'plan_snapshots',
        'schema_migrations',
      ],
      [
        'application_records',
        'calendar_execution_journal',
        'calendar_execution_steps',
        'calendar_writer_leases',
        'classroom_enrichment_cache',
        'continuity_records',
        'import_rejections',
        'import_runs',
        'plan_snapshots',
        'schema_migrations',
      ],
    ];

    for (
      let targetVersion = 0;
      targetVersion <= schemaMigrations.length;
      targetVersion += 1
    ) {
      const path = temporaryDatabasePath();
      using database = openDatabase(path, targetVersion);
      assert.equal(userVersion(database.connection), targetVersion);
      assert.deepEqual(
        appliedVersions(database.connection),
        Array.from({ length: targetVersion }, (_, index) => index + 1),
      );
      assert.deepEqual(
        tableNames(database.connection),
        expectedTables[targetVersion],
      );
    }
  });

  test('migrates a version-one database through the remaining sequence', () => {
    const path = temporaryDatabasePath();
    {
      using versionOne = openDatabase(path, 1);
      versionOne.connection
        .prepare(
          `INSERT INTO application_records(
             record_id, record_kind, record_key, payload_json, semantic_hash,
             revision, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          'record-synthetic',
          'configuration',
          'configuration-synthetic',
          '{}',
          'hash-synthetic',
          'revision-synthetic',
          appliedAt,
        );
    }

    using current = openDatabase(path);
    assert.equal(userVersion(current.connection), schemaMigrations.length);
    assert.deepEqual(appliedVersions(current.connection), [1, 2, 3, 4, 5, 6]);
    assert.equal(
      scalar(
        current.connection,
        "SELECT count(*) AS value FROM application_records WHERE record_id = 'record-synthetic'",
      ),
      1,
    );
    assert.ok(tableNames(current.connection).includes('continuity_records'));
  });

  test('version three admits only the finite operations alert-state kind', () => {
    const path = temporaryDatabasePath();
    using database = openDatabase(path);
    const insert = database.connection.prepare(
      `INSERT INTO application_records(
         record_id, record_kind, record_key, payload_json, semantic_hash,
         revision, created_at
       ) VALUES (?, ?, ?, '{}', ?, ?, ?)`,
    );
    assert.doesNotThrow(() =>
      insert.run(
        'alert-record',
        'alert-state',
        'operations-alert-checkpoint',
        'synthetic-hash',
        'synthetic-revision',
        appliedAt,
      ),
    );
    assert.throws(
      () =>
        insert.run(
          'unknown-record',
          'unknown-operational-state',
          'unknown',
          'synthetic-hash',
          'synthetic-revision',
          appliedAt,
        ),
      /CHECK constraint failed/,
    );
  });

  test('version six preserves journals and admits only bounded composed intent identities', () => {
    const path = temporaryDatabasePath();
    {
      using versionFive = openDatabase(path, 5);
      versionFive.connection
        .prepare(
          `INSERT INTO calendar_execution_journal(
             execution_fingerprint, manifest_fingerprint, scope_id, status,
             started_at, finished_at
           ) VALUES (?, ?, ?, 'running', ?, NULL)`,
        )
        .run(
          `sha256:${'a'.repeat(64)}`,
          `sha256:${'b'.repeat(64)}`,
          'scope-canary',
          appliedAt,
        );
      versionFive.connection
        .prepare(
          `INSERT INTO calendar_execution_steps(
             execution_fingerprint, intent_id, intent_kind, status
           ) VALUES (?, ?, 'create', 'pending')`,
        )
        .run(`sha256:${'a'.repeat(64)}`, 'legacy-short-intent');
    }
    using current = openDatabase(path);
    assert.equal(
      scalar(
        current.connection,
        "SELECT count(*) AS value FROM calendar_execution_steps WHERE intent_id = 'legacy-short-intent'",
      ),
      1,
    );
    const insert = current.connection.prepare(
      `INSERT INTO calendar_execution_steps(
         execution_fingerprint, intent_id, intent_kind, status
       ) VALUES (?, ?, 'create', 'pending')`,
    );
    assert.doesNotThrow(() =>
      insert.run(`sha256:${'a'.repeat(64)}`, `intent-${'c'.repeat(500)}`),
    );
    assert.throws(
      () => insert.run(`sha256:${'a'.repeat(64)}`, `intent-${'d'.repeat(506)}`),
      /CHECK constraint failed/u,
    );
  });

  test('rolls back the entire failed migration before recording its version', () => {
    const path = temporaryDatabasePath();
    const connection = new DatabaseSync(path);
    applyMigrations(connection, { appliedAt, targetVersion: 1 });

    assert.throws(
      () =>
        applyMigrations(connection, {
          appliedAt,
          beforeCommit: (migration) => {
            if (migration.version === 2)
              throw new Error('injected-migration-failure');
          },
        }),
      /injected-migration-failure/,
    );
    assert.equal(connection.isTransaction, false);
    assert.equal(userVersion(connection), 1);
    assert.deepEqual(appliedVersions(connection), [1]);
    assert.equal(tableNames(connection).includes('import_runs'), false);
    assert.equal(tableNames(connection).includes('continuity_records'), false);

    applyMigrations(connection, { appliedAt });
    assert.deepEqual(appliedVersions(connection), [1, 2, 3, 4, 5, 6]);
    connection.close();
  });

  test('rolls back the version-three table rebuild without losing version-two state', () => {
    const path = temporaryDatabasePath();
    const connection = new DatabaseSync(path);
    applyMigrations(connection, { appliedAt, targetVersion: 2 });
    connection
      .prepare(
        `INSERT INTO application_records(
           record_id, record_kind, record_key, payload_json, semantic_hash,
           revision, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'record-before-v3',
        'configuration',
        'configuration-before-v3',
        '{}',
        'hash-before-v3',
        'revision-before-v3',
        appliedAt,
      );

    assert.throws(
      () =>
        applyMigrations(connection, {
          appliedAt,
          beforeCommit: (migration) => {
            if (migration.version === 3) throw new Error('injected-v3-failure');
          },
        }),
      /injected-v3-failure/,
    );
    assert.equal(userVersion(connection), 2);
    assert.deepEqual(appliedVersions(connection), [1, 2]);
    assert.equal(
      scalar(
        connection,
        "SELECT count(*) AS value FROM application_records WHERE record_id = 'record-before-v3'",
      ),
      1,
    );
    assert.equal(
      tableNames(connection).includes('application_records_v3'),
      false,
    );

    applyMigrations(connection, { appliedAt });
    assert.equal(userVersion(connection), 6);
    assert.deepEqual(appliedVersions(connection), [1, 2, 3, 4, 5, 6]);
    assert.equal(
      scalar(
        connection,
        "SELECT count(*) AS value FROM application_records WHERE record_id = 'record-before-v3'",
      ),
      1,
    );
    connection.close();
  });

  test('rejects asynchronous migration callbacks without partial advancement', () => {
    for (const callback of [
      async () => undefined,
      () => ({ then: () => undefined }),
    ]) {
      const path = temporaryDatabasePath();
      const connection = new DatabaseSync(path);
      applyMigrations(connection, { appliedAt, targetVersion: 1 });
      assert.throws(
        () =>
          applyMigrations(connection, { appliedAt, beforeCommit: callback }),
        /async-sqlite-migration-callback-not-supported/,
      );
      assert.equal(connection.isTransaction, false);
      assert.equal(userVersion(connection), 1);
      assert.deepEqual(appliedVersions(connection), [1]);
      assert.equal(tableNames(connection).includes('import_runs'), false);
      assert.equal(
        tableNames(connection).includes('continuity_records'),
        false,
      );
      connection.close();
    }
  });

  test('rejects tampered migration history', () => {
    const path = migratedDatabasePath();
    const tamper = new DatabaseSync(path);
    tamper
      .prepare(
        "UPDATE schema_migrations SET checksum = 'tampered' WHERE version = 1",
      )
      .run();
    tamper.close();

    assert.throws(() => openDatabase(path), /schema-migration-history-invalid/);
  });

  test('rejects migration-history gaps', () => {
    const path = migratedDatabasePath();
    const tamper = new DatabaseSync(path);
    tamper.prepare('DELETE FROM schema_migrations WHERE version = 1').run();
    tamper.close();

    assert.throws(() => openDatabase(path), /schema-migration-history-invalid/);
  });

  test('rejects user_version lower or higher than the checksummed ledger', () => {
    const currentPath = migratedDatabasePath();
    const lower = new DatabaseSync(currentPath);
    lower.exec('PRAGMA user_version = 1');
    lower.close();
    assert.throws(
      () => openDatabase(currentPath),
      /schema-user-version-mismatch/,
    );

    const versionOnePath = temporaryDatabasePath();
    {
      using versionOne = openDatabase(versionOnePath, 1);
    }
    const higher = new DatabaseSync(versionOnePath);
    higher.exec('PRAGMA user_version = 2');
    higher.close();
    assert.throws(
      () => openDatabase(versionOnePath),
      /schema-user-version-mismatch/,
    );
  });

  test('rejects downgrade and invalid target requests', () => {
    const path = migratedDatabasePath();
    const connection = new DatabaseSync(path);
    assert.throws(
      () => applyMigrations(connection, { appliedAt, targetVersion: 1 }),
      /schema-downgrade-not-supported/,
    );
    assert.throws(
      () => applyMigrations(connection, { appliedAt, targetVersion: -1 }),
      /schema-migration-target-invalid/,
    );
    assert.throws(
      () =>
        applyMigrations(connection, {
          appliedAt,
          targetVersion: schemaMigrations.length + 1,
        }),
      /schema-migration-target-invalid/,
    );
    assert.throws(
      () => applyMigrations(connection, { appliedAt, targetVersion: 1.5 }),
      /schema-migration-target-invalid/,
    );
    connection.close();
  });
});

describe('SQLite lifecycle integrity and transaction boundaries', () => {
  test('enables foreign keys and reports clean integrity', () => {
    const path = temporaryDatabasePath();
    using database = openDatabase(path);
    assert.equal(pragmaNumber(database.connection, 'foreign_keys'), 1);
    assert.equal(pragmaNumber(database.connection, 'trusted_schema'), 0);
    assert.deepEqual(database.integrityCheck(), {
      ok: true,
      integrityMessages: ['ok'],
      foreignKeyViolations: 0,
    });

    assert.throws(
      () =>
        database.connection
          .prepare(
            `INSERT INTO import_rejections(
               import_id, ordinal, category, code, field_path
             ) VALUES (?, ?, ?, ?, ?)`,
          )
          .run('missing-import', 0, 'corrupt-record', 'synthetic', '$.record'),
      /FOREIGN KEY constraint failed/,
    );
    assert.deepEqual(database.integrityCheck(), {
      ok: true,
      integrityMessages: ['ok'],
      foreignKeyViolations: 0,
    });

    database.connection.exec('PRAGMA foreign_keys = OFF');
    database.connection
      .prepare(
        `INSERT INTO import_rejections(
           import_id, ordinal, category, code, field_path
         ) VALUES (?, ?, ?, ?, ?)`,
      )
      .run('missing-import', 0, 'corrupt-record', 'synthetic', '$.record');
    database.connection.exec('PRAGMA foreign_keys = ON');
    assert.deepEqual(database.integrityCheck(), {
      ok: false,
      integrityMessages: ['ok'],
      foreignKeyViolations: 1,
    });
  });

  test('schema exposes no sensitive or raw-capture storage surface', () => {
    const path = temporaryDatabasePath();
    using database = openDatabase(path);
    const schema = database.connection
      .prepare(
        `SELECT group_concat(sql, ' ') AS value
           FROM sqlite_schema
          WHERE sql IS NOT NULL`,
      )
      .get() as unknown as { readonly value: string };
    for (const forbidden of [
      'oauth',
      'credential',
      'secret',
      'password',
      'access_token',
      'refresh_token',
      'cookie',
      'browser',
      'raw_capture',
      'raw_html',
      'student',
      'unrestricted_log',
    ]) {
      assert.equal(schema.value.toLowerCase().includes(forbidden), false);
    }
  });

  test('commits successful work and rolls back thrown failures', () => {
    const path = temporaryDatabasePath();
    using database = openDatabase(path);
    database.connection.exec(
      'CREATE TABLE transaction_probe (value TEXT PRIMARY KEY) STRICT',
    );

    const result = database.transaction(() => {
      database.connection
        .prepare('INSERT INTO transaction_probe VALUES (?)')
        .run('committed');
      return 'result';
    });
    assert.equal(result, 'result');

    assert.throws(
      () =>
        database.transaction(() => {
          database.connection
            .prepare('INSERT INTO transaction_probe VALUES (?)')
            .run('rolled-back');
          throw new Error('injected-operation-failure');
        }),
      /injected-operation-failure/,
    );
    assert.equal(database.connection.isTransaction, false);
    assert.deepEqual(probeValues(database.connection), ['committed']);
  });

  test('rejects nested transactions and rolls back the outer operation', () => {
    const path = temporaryDatabasePath();
    using database = openDatabase(path);
    database.connection.exec(
      'CREATE TABLE transaction_probe (value TEXT PRIMARY KEY) STRICT',
    );

    assert.throws(
      () =>
        database.transaction(() => {
          database.connection
            .prepare('INSERT INTO transaction_probe VALUES (?)')
            .run('outer');
          database.transaction(() => 'nested');
        }),
      /nested-sqlite-transaction-not-supported/,
    );
    assert.equal(database.connection.isTransaction, false);
    assert.deepEqual(probeValues(database.connection), []);
  });

  test('rejects asynchronous transaction callbacks and rolls back synchronous writes', () => {
    const path = temporaryDatabasePath();
    using database = openDatabase(path);
    database.connection.exec(
      'CREATE TABLE transaction_probe (value TEXT PRIMARY KEY) STRICT',
    );

    assert.throws(
      () =>
        database.transaction(async () => {
          database.connection
            .prepare('INSERT INTO transaction_probe VALUES (?)')
            .run('async');
        }),
      /async-sqlite-transaction-not-supported/,
    );
    assert.equal(database.connection.isTransaction, false);
    assert.deepEqual(probeValues(database.connection), []);

    assert.throws(
      () =>
        database.transaction(() => {
          database.connection
            .prepare('INSERT INTO transaction_probe VALUES (?)')
            .run('thenable');
          return { then: () => undefined };
        }),
      /async-sqlite-transaction-not-supported/,
    );
    assert.equal(database.connection.isTransaction, false);
    assert.deepEqual(probeValues(database.connection), []);
  });
});

function openDatabase(path: string, targetVersion?: number): SqliteDatabase {
  return new SqliteDatabase(path, {
    migration:
      targetVersion === undefined
        ? { appliedAt }
        : { appliedAt, targetVersion },
  });
}

function temporaryDatabasePath(): string {
  const root = mkdtempSync(join(tmpdir(), 'classroom-hub-migrations-'));
  temporaryRoots.push(root);
  return join(root, 'application.sqlite');
}

function migratedDatabasePath(): string {
  const path = temporaryDatabasePath();
  using database = openDatabase(path);
  assert.equal(userVersion(database.connection), schemaMigrations.length);
  return path;
}

function tableNames(connection: DatabaseSync): readonly string[] {
  return connection
    .prepare(
      `SELECT name FROM sqlite_schema
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
       ORDER BY name`,
    )
    .all()
    .map((row) => String(row.name));
}

function appliedVersions(connection: DatabaseSync): readonly number[] {
  return connection
    .prepare('SELECT version FROM schema_migrations ORDER BY version')
    .all()
    .map((row) => Number(row.version));
}

function appliedMigrationRows(
  connection: DatabaseSync,
): readonly Record<string, unknown>[] {
  return connection
    .prepare(
      'SELECT version, name, checksum, applied_at FROM schema_migrations ORDER BY version',
    )
    .all()
    .map((row) => ({ ...row }));
}

function userVersion(connection: DatabaseSync): number {
  return pragmaNumber(connection, 'user_version');
}

function pragmaNumber(connection: DatabaseSync, pragma: string): number {
  const row = connection.prepare(`PRAGMA ${pragma}`).get();
  return Number(row?.[pragma]);
}

function scalar(connection: DatabaseSync, sql: string): number {
  return Number(connection.prepare(sql).get()?.value);
}

function probeValues(connection: DatabaseSync): readonly string[] {
  return connection
    .prepare('SELECT value FROM transaction_probe ORDER BY value')
    .all()
    .map((row) => String(row.value));
}
