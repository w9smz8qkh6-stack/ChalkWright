import assert from 'node:assert/strict';
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import {
  parseJobArguments,
  runJobEntrypoint,
} from '../../src/entrypoints/job.js';
import { SqliteDatabase } from '../../src/infrastructure/sqlite/database.js';
import { schemaMigrations } from '../../src/infrastructure/sqlite/migrations.js';

test('job parser accepts exactly one finite name', () => {
  assert.equal(parseJobArguments(['operations-report']), 'operations-report');
  for (const value of [
    [],
    ['OPERATIONS-REPORT'],
    ['unknown'],
    ['operations-report', 'extra'],
  ])
    assert.throws(() => parseJobArguments(value), /job-usage-invalid/);
});

test('unknown jobs fail before environment or filesystem access', async () => {
  const result = await runJobEntrypoint({
    arguments: ['unknown'],
    hardStop: () => {
      throw new Error('unexpected-hard-stop');
    },
    environment: new Proxy(
      {},
      {
        get: () => {
          throw new Error('environment accessed');
        },
      },
    ),
  });
  assert.deepEqual(result, { exitCode: 64, errorCode: 'job-usage-invalid' });
});

test('bounded report job records a redacted result in temporary SQLite', async () => {
  const root = mkdtempSync(join(tmpdir(), 'classroom-hub-job-entrypoint-'));
  const backups = join(root, 'backups');
  mkdirSync(backups);
  try {
    const databasePath = join(root, 'state.sqlite');
    const database = new SqliteDatabase(databasePath, {
      migration: { appliedAt: '2035-04-13T07:00:00Z' },
    });
    database.close();
    const result = await runJobEntrypoint({
      arguments: ['operations-report'],
      environment: {
        CLASSROOM_HUB_INSTANCE_ID: 'synthetic-instance',
        CLASSROOM_HUB_OPERATIONS_SCOPE_ID: 'screen-b407',
        CLASSROOM_HUB_TIME_ZONE: 'America/Chicago',
        CLASSROOM_HUB_MANAGED_ROOT: root,
        CLASSROOM_HUB_DATABASE_PATH: databasePath,
        CLASSROOM_HUB_BACKUP_DIRECTORY: backups,
        CLASSROOM_HUB_ACADEMIC_YEAR_END: '2035-05-31',
        CLASSROOM_HUB_JOB_DEADLINE_SECONDS: '300',
        CLASSROOM_HUB_ALERT_DELIVERY_MODE: 'report-only',
      },
      now: () => '2035-04-13T07:00:00Z',
      nextId: () => 'synthetic-run',
      hardStop: () => {
        throw new Error('unexpected-hard-stop');
      },
    });
    assert.equal(result.exitCode, 0);
    assert.equal(result.result?.category, 'succeeded');
    assert.equal(result.result?.attemptedExternalMutations, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('recognized jobs never create or follow an unsafe managed database', async () => {
  const root = mkdtempSync(join(tmpdir(), 'classroom-hub-job-paths-'));
  const externalRoot = mkdtempSync(join(tmpdir(), 'classroom-hub-external-'));
  const backups = join(root, 'backups');
  mkdirSync(backups);
  const databasePath = join(root, 'state.sqlite');
  const environment = {
    CLASSROOM_HUB_INSTANCE_ID: 'synthetic-instance',
    CLASSROOM_HUB_OPERATIONS_SCOPE_ID: 'screen-b407',
    CLASSROOM_HUB_TIME_ZONE: 'America/Chicago',
    CLASSROOM_HUB_MANAGED_ROOT: root,
    CLASSROOM_HUB_DATABASE_PATH: databasePath,
    CLASSROOM_HUB_BACKUP_DIRECTORY: backups,
    CLASSROOM_HUB_ACADEMIC_YEAR_END: '2035-05-31',
    CLASSROOM_HUB_JOB_DEADLINE_SECONDS: '300',
    CLASSROOM_HUB_ALERT_DELIVERY_MODE: 'report-only',
  };
  const invoke = () =>
    runJobEntrypoint({
      arguments: ['sqlite-integrity'],
      environment,
      now: () => '2035-04-13T07:00:00Z',
      nextId: () => 'synthetic-run',
      hardStop: () => {
        throw new Error('unexpected-hard-stop');
      },
    });
  try {
    assert.deepEqual(await invoke(), {
      exitCode: 1,
      errorCode: 'job-startup-failed',
    });
    assert.equal(existsSync(databasePath), false);

    mkdirSync(databasePath);
    assert.equal((await invoke()).exitCode, 1);
    rmSync(databasePath, { recursive: true });

    const external = join(externalRoot, 'state.sqlite');
    const database = new SqliteDatabase(external, {
      migration: { appliedAt: '2035-04-13T07:00:00Z' },
    });
    database.close();
    symlinkSync(external, databasePath);
    assert.equal((await invoke()).exitCode, 1);
    rmSync(databasePath);

    linkSync(external, databasePath);
    const before = new DatabaseSync(external, { readOnly: true });
    const beforeRuns = Number(
      before
        .prepare(
          `SELECT count(*) AS count FROM application_records WHERE record_kind = 'job-run'`,
        )
        .get()?.count,
    );
    before.close();
    assert.equal((await invoke()).exitCode, 1);
    const after = new DatabaseSync(external, { readOnly: true });
    assert.equal(
      Number(
        after
          .prepare(
            `SELECT count(*) AS count FROM application_records WHERE record_kind = 'job-run'`,
          )
          .get()?.count,
      ),
      beforeRuns,
    );
    after.close();
    rmSync(databasePath);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(externalRoot, { recursive: true, force: true });
  }
});

test('integrity job checks an existing supported schema before and after migration', async () => {
  const root = mkdtempSync(join(tmpdir(), 'classroom-hub-integrity-job-'));
  const backups = join(root, 'backups');
  const databasePath = join(root, 'state.sqlite');
  mkdirSync(backups);
  try {
    const database = new SqliteDatabase(databasePath, {
      migration: { appliedAt: '2035-04-13T07:00:00Z', targetVersion: 2 },
    });
    database.close();
    const before = new DatabaseSync(databasePath, { readOnly: true });
    assert.equal(before.prepare('PRAGMA user_version').get()?.user_version, 2);
    before.close();
    const result = await runJobEntrypoint({
      arguments: ['sqlite-integrity'],
      environment: {
        CLASSROOM_HUB_INSTANCE_ID: 'synthetic-instance',
        CLASSROOM_HUB_OPERATIONS_SCOPE_ID: 'screen-b407',
        CLASSROOM_HUB_TIME_ZONE: 'America/Chicago',
        CLASSROOM_HUB_MANAGED_ROOT: root,
        CLASSROOM_HUB_DATABASE_PATH: databasePath,
        CLASSROOM_HUB_BACKUP_DIRECTORY: backups,
        CLASSROOM_HUB_ACADEMIC_YEAR_END: '2035-05-31',
        CLASSROOM_HUB_ALERT_DELIVERY_MODE: 'report-only',
      },
      now: () => '2035-04-13T07:01:00Z',
      nextId: () => 'synthetic-integrity-run',
      hardStop: () => {
        throw new Error('unexpected-hard-stop');
      },
    });
    assert.equal(result.result?.category, 'succeeded');
    const after = new DatabaseSync(databasePath, { readOnly: true });
    assert.equal(
      after.prepare('PRAGMA user_version').get()?.user_version,
      schemaMigrations.at(-1)?.version,
    );
    after.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
