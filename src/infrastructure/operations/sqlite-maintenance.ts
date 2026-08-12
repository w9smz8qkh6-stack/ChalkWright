import { existsSync, lstatSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { OperationsConfig } from '../../config/operations.js';
import { isIsoInstant } from '../../domain/runtime-validation.js';
import {
  calculateDataRetentionBoundaries,
  createSqliteBackup,
  pruneBackupRetention,
  readBackupCatalogEntry,
  type BackupArtifact,
  type DataRetentionBoundaries,
  type SqlitePathPolicy,
} from '../sqlite/backup.js';
import { SqliteDatabase } from '../sqlite/database.js';
import { SqliteApplicationStateRepository } from '../sqlite/repository.js';

export interface ManagedStatePaths {
  readonly managedRoot: string;
  readonly databasePath: string;
  readonly backupDirectory: string;
}

export interface IntegrityObservation {
  readonly ok: boolean;
  readonly foreignKeyViolations: number;
}

export interface BackupObservation {
  readonly created: boolean;
  readonly retainedDaily: number;
  readonly retainedWeekly: number;
  readonly removed: number;
}

export interface RetentionObservation {
  readonly expiredRecords: number;
  readonly policyDeletedRecords: number;
  readonly boundaries: DataRetentionBoundaries;
}

/** Physical path preflight shared by every managed operational entry point. */
export function validateManagedStatePaths(config: ManagedStatePaths): void {
  const directories = [
    config.managedRoot,
    dirname(config.databasePath),
    config.backupDirectory,
  ];
  for (const directory of directories) {
    const stats = lstatSync(directory);
    if (
      !stats.isDirectory() ||
      stats.isSymbolicLink() ||
      realpathSync(directory) !== resolve(directory)
    )
      throw new Error('managed-directory-unsafe');
  }
  if (!existsSync(config.databasePath)) throw new Error('database-unavailable');
  const database = lstatSync(config.databasePath);
  if (
    !database.isFile() ||
    database.isSymbolicLink() ||
    database.nlink !== 1 ||
    realpathSync(config.databasePath) !== resolve(config.databasePath)
  )
    throw new Error('database-path-unsafe');
}

function paths(config: OperationsConfig): SqlitePathPolicy {
  return {
    managedRoot: config.managedRoot,
    databasePath: config.databasePath,
    backupDirectory: config.backupDirectory,
  };
}

/** Read-only integrity inspection; it neither creates nor migrates a database. */
export function inspectManagedDatabase(
  config: OperationsConfig,
): IntegrityObservation {
  validateManagedStatePaths(config);
  const database = new DatabaseSync(config.databasePath, {
    readOnly: true,
    allowExtension: false,
    defensive: true,
    enableDoubleQuotedStringLiterals: false,
  });
  try {
    const integrity = database.prepare('PRAGMA integrity_check').all() as {
      readonly integrity_check: string;
    }[];
    const foreignKeys = database.prepare('PRAGMA foreign_key_check').all();
    return {
      ok:
        integrity.length === 1 &&
        integrity[0]?.integrity_check === 'ok' &&
        foreignKeys.length === 0,
      foreignKeyViolations: foreignKeys.length,
    };
  } finally {
    database.close();
  }
}

export async function backupManagedDatabase(
  config: OperationsConfig,
  now: string,
): Promise<BackupObservation> {
  if (!isIsoInstant(now)) throw new Error('backup-instant-invalid');
  const policy = paths(config);
  // Validate the existing managed set before creating or deleting anything.
  const existing = loadManagedBackupCatalog(policy);
  const repeated = existing.some(
    (artifact) => Date.parse(artifact.createdAt) === Date.parse(now),
  );
  if (!repeated)
    await createSqliteBackup({ paths: policy, now: new Date(now) });
  const artifacts = loadManagedBackupCatalog(policy);
  const selection = pruneBackupRetention({ paths: policy, artifacts });
  return {
    created: !repeated,
    retainedDaily: selection.keepDaily.length,
    retainedWeekly: selection.keepWeekly.length,
    removed: selection.remove.length,
  };
}

/**
 * M-06 only wires policy hooks. Category history removal remains a later
 * schema-specific operation; this transition safely expires due records.
 */
export function applyManagedRetention(
  config: OperationsConfig,
  now: string,
): RetentionObservation {
  if (!isIsoInstant(now)) throw new Error('retention-instant-invalid');
  validateManagedStatePaths(config);
  const boundaries = calculateDataRetentionBoundaries({
    now: new Date(now),
    academicYearEndsOn: config.academicYearEnd,
  });
  const database = new SqliteDatabase(config.databasePath, {
    migration: { appliedAt: now },
  });
  try {
    let revision = 0;
    const repository = new SqliteApplicationStateRepository(database, {
      clock: { now: () => now },
      nextRevision: () => `m06-retention-${++revision}`,
    });
    const expiredRecords = repository.pruneExpired(now);
    const policyDeletedRecords = repository.pruneRetentionPolicy(now);
    return { expiredRecords, policyDeletedRecords, boundaries };
  } finally {
    database.close();
  }
}

function loadManagedBackupCatalog(
  policy: SqlitePathPolicy,
): readonly BackupArtifact[] {
  const names = readdirSync(policy.backupDirectory).sort();
  const unexpected = names.filter(
    (name) =>
      !/^classroom-hub-\d{8}T\d{9}Z\.sqlite(?:\.metadata\.json)?$/u.test(name),
  );
  if (unexpected.length > 0) throw new Error('backup-directory-unexpected');
  const backupNames = names.filter((name) => name.endsWith('.sqlite'));
  if (backupNames.length * 2 !== names.length)
    throw new Error('backup-catalog-incomplete');
  return backupNames.map((name) =>
    readBackupCatalogEntry({
      paths: policy,
      backupPath: join(policy.backupDirectory, name),
    }),
  );
}
