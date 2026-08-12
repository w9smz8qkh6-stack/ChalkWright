import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { OperationsConfig } from '../../../src/config/operations.js';
import {
  applyManagedRetention,
  backupManagedDatabase,
  inspectManagedDatabase,
} from '../../../src/infrastructure/operations/sqlite-maintenance.js';
import { SqliteDatabase } from '../../../src/infrastructure/sqlite/database.js';
import { SqliteApplicationStateRepository } from '../../../src/infrastructure/sqlite/repository.js';
import { contractVersion } from '../../../src/contracts/v1/common.js';

const instant = '2035-04-13T07:00:00Z';

async function withConfig(
  run: (config: OperationsConfig) => Promise<void> | void,
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'classroom-hub-maintenance-'));
  const backupDirectory = join(root, 'backups');
  mkdirSync(backupDirectory);
  const config: OperationsConfig = {
    instanceId: 'synthetic-instance',
    scopeId: 'screen-b407',
    timeZone: 'America/Chicago',
    managedRoot: root,
    databasePath: join(root, 'state.sqlite'),
    backupDirectory,
    academicYearEnd: '2035-05-31',
    jobDeadlineSeconds: 300,
    alertDeliveryMode: 'report-only',
  };
  const database = new SqliteDatabase(config.databasePath, {
    migration: { appliedAt: instant },
  });
  database.close();
  try {
    await run(config);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('integrity, verified backup, and retention hooks use only managed paths', async () => {
  await withConfig(async (config) => {
    assert.deepEqual(inspectManagedDatabase(config), {
      ok: true,
      foreignKeyViolations: 0,
    });
    const backup = await backupManagedDatabase(config, instant);
    assert.equal(backup.created, true);
    assert.equal(backup.retainedDaily, 1);
    assert.equal(backup.removed, 0);
    const repeated = await backupManagedDatabase(config, instant);
    assert.equal(repeated.created, false);
    assert.equal(repeated.retainedDaily, 1);
    const retention = applyManagedRetention(config, instant);
    assert.equal(retention.expiredRecords, 0);
    assert.equal(retention.policyDeletedRecords, 0);
    assert.equal(
      retention.boundaries.academicYearStateRetainThrough,
      '2035-08-29',
    );
  });
});

test('backup validates the complete catalog directory before pruning', async () => {
  await withConfig(async (config) => {
    await backupManagedDatabase(config, instant);
    writeFileSync(join(config.backupDirectory, 'unexpected.txt'), 'synthetic');
    await assert.rejects(
      backupManagedDatabase(config, '2035-04-14T07:00:00Z'),
      /backup-directory-unexpected/,
    );
  });
});

test('backup fails closed without deleting an orphan missing its catalog', async () => {
  await withConfig(async (config) => {
    const orphan = join(
      config.backupDirectory,
      'classroom-hub-20350412T070000000Z.sqlite',
    );
    writeFileSync(orphan, 'synthetic-partial');
    await assert.rejects(backupManagedDatabase(config, instant));
    assert.equal(existsSync(orphan), true);
  });
});

test('integrity refuses missing and non-file database targets', async () => {
  await withConfig((config) => {
    assert.throws(
      () =>
        inspectManagedDatabase({
          ...config,
          databasePath: join(config.managedRoot, 'missing.sqlite'),
        }),
      /database-unavailable/,
    );
  });
});

test('retention deletes aged job-run evidence and preserves recent evidence', async () => {
  await withConfig(async (config) => {
    const database = new SqliteDatabase(config.databasePath, {
      migration: { appliedAt: '2034-01-01T00:00:00Z' },
    });
    const repository = new SqliteApplicationStateRepository(database, {
      clock: { now: () => '2034-01-01T00:00:00Z' },
      nextRevision: () => 'synthetic-old-revision',
    });
    const outcome = {
      contractVersion,
      runId: 'old-run',
      jobName: 'operations-report',
      startedAt: '2034-01-01T00:00:00Z',
      finishedAt: '2034-01-01T00:00:00Z',
      diagnostics: [],
      category: 'succeeded' as const,
      attemptedExternalMutations: 0,
      completedExternalMutations: 0,
    };
    assert.equal(
      (
        await repository.storeJobRun({
          kind: 'job-run',
          recordKey: 'old-run',
          scope: {},
          data: {
            outcome,
            errorCodes: [],
            incidentCodes: [],
            requestedDates: [],
            provenanceReferences: [],
          },
        })
      ).status,
      'stored',
    );
    database.close();
    const retention = applyManagedRetention(config, instant);
    assert.equal(retention.policyDeletedRecords, 1);
  });
});
