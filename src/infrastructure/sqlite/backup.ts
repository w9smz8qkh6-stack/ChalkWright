import { createHash } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  existsSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import {
  dirname,
  isAbsolute,
  join,
  parse,
  relative,
  resolve,
  sep,
} from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';

import { isIsoInstant } from '../../domain/runtime-validation.js';

const DAY_MILLISECONDS = 24 * 60 * 60 * 1_000;
const BACKUP_METADATA_VERSION = 1 as const;
const BACKUP_PREFIX = 'classroom-hub-';
const BACKUP_SUFFIX = '.sqlite';

export interface SqlitePathPolicy {
  /** A deployment-owned directory dedicated to application runtime state. */
  readonly managedRoot: string;
  readonly databasePath: string;
  readonly backupDirectory: string;
}

export interface BackupCatalogEntry {
  readonly version: typeof BACKUP_METADATA_VERSION;
  readonly backupFile: string;
  readonly createdAt: string;
  readonly checksumSha256: string;
  readonly byteLength: number;
  readonly pagesTransferred: number;
  readonly integrity: 'ok';
}

export interface BackupArtifact extends BackupCatalogEntry {
  readonly backupPath: string;
  readonly metadataPath: string;
}

export interface BackupRetentionSelection {
  readonly keepDaily: readonly BackupArtifact[];
  readonly keepWeekly: readonly BackupArtifact[];
  readonly remove: readonly BackupArtifact[];
}

export interface DataRetentionBoundaries {
  /** Records strictly older than this instant may be removed. */
  readonly jobAndComparisonDeleteBefore: string;
  /** Records strictly older than this instant may be removed. */
  readonly attendanceAndTemporaryDeleteBefore: string;
  /** School-year plans, content, and vocabulary remain protected through this date. */
  readonly academicYearStateRetainThrough: string;
}

export class SqliteBackupError extends Error {
  constructor(
    readonly category:
      | 'unsafe-path'
      | 'integrity-failed'
      | 'backup-exists'
      | 'restore-target-exists'
      | 'catalog-invalid'
      | 'checksum-mismatch'
      | 'operation-failed',
  ) {
    super(`SQLite backup operation rejected: ${category}`);
    this.name = 'SqliteBackupError';
  }
}

export async function createSqliteBackup(options: {
  readonly paths: SqlitePathPolicy;
  readonly now: Date;
}): Promise<BackupArtifact> {
  const paths = validatePathPolicy(options.paths);
  assertValidDate(options.now);
  assertDatabaseIntegrity(paths.databasePath);

  const backupFile = `${BACKUP_PREFIX}${compactTimestamp(options.now)}${BACKUP_SUFFIX}`;
  const backupPath = join(paths.backupDirectory, backupFile);
  const metadataPath = metadataPathFor(backupPath);
  if (existsSync(backupPath) || existsSync(metadataPath)) {
    throw new SqliteBackupError('backup-exists');
  }
  reserveNewFile(backupPath, 'backup-exists');
  try {
    reserveNewFile(metadataPath, 'backup-exists');
  } catch (error: unknown) {
    removeIfPresent(backupPath);
    throw error;
  }

  let source: DatabaseSync | undefined;
  let pagesTransferred = 0;
  try {
    source = new DatabaseSync(paths.databasePath, { readOnly: true });
    try {
      pagesTransferred = await backup(source, backupPath);
    } finally {
      source.close();
      source = undefined;
    }
    chmodSync(backupPath, 0o600);
    assertSingleLinkRegularFile(backupPath);
    assertDatabaseIntegrity(backupPath);
    const entry: BackupCatalogEntry = {
      version: BACKUP_METADATA_VERSION,
      backupFile,
      createdAt: options.now.toISOString(),
      checksumSha256: sha256File(backupPath),
      byteLength: statSync(backupPath).size,
      pagesTransferred,
      integrity: 'ok',
    };
    writeFileSync(metadataPath, `${JSON.stringify(entry, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'w',
      mode: 0o600,
    });
    assertSingleLinkRegularFile(metadataPath);
    return { ...entry, backupPath, metadataPath };
  } catch (error: unknown) {
    removeIfPresent(backupPath);
    removeIfPresent(metadataPath);
    source?.close();
    if (error instanceof SqliteBackupError) throw error;
    throw new SqliteBackupError('operation-failed');
  }
}

/**
 * Restores into a new, explicitly selected database file. Refusing every
 * existing target prevents replacement of a database that another connection
 * may have open; deployment cutover remains an operator-controlled later step.
 */
export async function restoreSqliteBackup(options: {
  readonly paths: SqlitePathPolicy;
  readonly backupPath: string;
  readonly restorePath: string;
  readonly expectedChecksumSha256?: string;
}): Promise<{ readonly restorePath: string; readonly checksumSha256: string }> {
  const paths = validatePathPolicy(options.paths);
  const backupPath = validateBackupArtifactPath(paths, options.backupPath);
  const restorePath = validateNewDatabasePath(paths, options.restorePath);
  if (existsSync(restorePath)) {
    throw new SqliteBackupError('restore-target-exists');
  }

  const metadata = readBackupCatalogEntry({ paths, backupPath });
  const actualChecksum = sha256File(backupPath);
  if (
    actualChecksum !== metadata.checksumSha256 ||
    (options.expectedChecksumSha256 !== undefined &&
      actualChecksum !== options.expectedChecksumSha256)
  ) {
    throw new SqliteBackupError('checksum-mismatch');
  }
  assertDatabaseIntegrity(backupPath);
  reserveNewFile(restorePath, 'restore-target-exists');

  let source: DatabaseSync | undefined;
  try {
    source = new DatabaseSync(backupPath, { readOnly: true });
    await backup(source, restorePath);
    chmodSync(restorePath, 0o600);
    assertDatabaseIntegrity(restorePath);
    return { restorePath, checksumSha256: sha256File(restorePath) };
  } catch (error: unknown) {
    removeIfPresent(restorePath);
    if (error instanceof SqliteBackupError) throw error;
    throw new SqliteBackupError('operation-failed');
  } finally {
    source?.close();
  }
}

export function readBackupCatalogEntry(options: {
  readonly paths: SqlitePathPolicy;
  readonly backupPath: string;
}): BackupArtifact {
  const paths = validatePathPolicy(options.paths);
  const backupPath = validateBackupArtifactPath(paths, options.backupPath);
  const metadataPath = metadataPathFor(backupPath);
  let parsed: unknown;
  try {
    const metadataStats = lstatSync(metadataPath);
    if (
      metadataStats.isSymbolicLink() ||
      !metadataStats.isFile() ||
      metadataStats.nlink !== 1
    ) {
      throw new SqliteBackupError('unsafe-path');
    }
    parsed = JSON.parse(readFileSync(metadataPath, 'utf8'));
  } catch (error: unknown) {
    if (error instanceof SqliteBackupError) throw error;
    throw new SqliteBackupError('catalog-invalid');
  }
  if (
    !isBackupCatalogEntry(parsed) ||
    parsed.backupFile !== parse(backupPath).base
  ) {
    throw new SqliteBackupError('catalog-invalid');
  }
  return { ...parsed, backupPath, metadataPath };
}

/** Revalidates a retained artifact, its catalog, checksum, and SQLite integrity. */
export function verifySqliteBackup(options: {
  readonly paths: SqlitePathPolicy;
  readonly backupPath: string;
}): BackupArtifact {
  const paths = validatePathPolicy(options.paths);
  const artifact = readBackupCatalogEntry({
    paths,
    backupPath: validateBackupArtifactPath(paths, options.backupPath),
  });
  assertCatalogMatchesBackupBytes(artifact);
  assertDatabaseIntegrity(artifact.backupPath);
  return artifact;
}

/**
 * Keeps one nightly recovery point for each of the latest 14 UTC dates, then
 * one older recovery point for each of the latest eight ISO weeks. This yields
 * distinct daily and weekly sets instead of double-counting recent backups.
 */
export function selectBackupRetention(
  artifacts: readonly BackupArtifact[],
): BackupRetentionSelection {
  const ordered = [...artifacts].sort(
    (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt),
  );
  const daily: BackupArtifact[] = [];
  const dailyDates = new Set<string>();
  for (const artifact of ordered) {
    const date = utcDateKey(artifact.createdAt);
    if (!dailyDates.has(date) && daily.length < 14) {
      daily.push(artifact);
      dailyDates.add(date);
    }
  }

  const dailyPaths = new Set(daily.map((artifact) => artifact.backupPath));
  const weekly: BackupArtifact[] = [];
  const weeklyKeys = new Set<string>();
  for (const artifact of ordered) {
    if (dailyPaths.has(artifact.backupPath)) continue;
    const week = isoWeekKey(artifact.createdAt);
    if (!weeklyKeys.has(week) && weekly.length < 8) {
      weekly.push(artifact);
      weeklyKeys.add(week);
    }
  }

  const keptPaths = new Set(
    [...daily, ...weekly].map((artifact) => artifact.backupPath),
  );
  return {
    keepDaily: daily,
    keepWeekly: weekly,
    remove: ordered.filter((artifact) => !keptPaths.has(artifact.backupPath)),
  };
}

export function pruneBackupRetention(options: {
  readonly paths: SqlitePathPolicy;
  readonly artifacts: readonly BackupArtifact[];
}): BackupRetentionSelection {
  const paths = validatePathPolicy(options.paths);
  const validatedArtifacts = options.artifacts.map((artifact) => {
    const backupPath = validateBackupArtifactPath(paths, artifact.backupPath);
    const expectedMetadataPath = metadataPathFor(backupPath);
    if (
      artifact.backupPath !== backupPath ||
      artifact.metadataPath !== expectedMetadataPath
    ) {
      throw new SqliteBackupError('unsafe-path');
    }
    const catalogArtifact = readBackupCatalogEntry({
      paths,
      backupPath,
    });
    assertMatchingCatalogIdentity(artifact, catalogArtifact);
    assertCatalogMatchesBackupBytes(catalogArtifact);
    return catalogArtifact;
  });
  const selection = selectBackupRetention(validatedArtifacts);
  for (const removal of selection.remove) {
    unlinkSync(removal.backupPath);
    unlinkSync(removal.metadataPath);
  }
  return selection;
}

function assertCatalogMatchesBackupBytes(catalog: BackupArtifact): void {
  if (
    statSync(catalog.backupPath).size !== catalog.byteLength ||
    sha256File(catalog.backupPath) !== catalog.checksumSha256
  ) {
    throw new SqliteBackupError('checksum-mismatch');
  }
}

function assertMatchingCatalogIdentity(
  candidate: BackupArtifact,
  catalog: BackupArtifact,
): void {
  const catalogKeys: readonly (keyof BackupCatalogEntry)[] = [
    'version',
    'backupFile',
    'createdAt',
    'checksumSha256',
    'byteLength',
    'pagesTransferred',
    'integrity',
  ];
  if (catalogKeys.some((key) => candidate[key] !== catalog[key])) {
    throw new SqliteBackupError('catalog-invalid');
  }
}

export function calculateDataRetentionBoundaries(options: {
  readonly now: Date;
  /** Explicit ISO date supplied by academic-year policy/configuration. */
  readonly academicYearEndsOn: string;
}): DataRetentionBoundaries {
  assertValidDate(options.now);
  const academicYearEnd = parseIsoDate(options.academicYearEndsOn);
  return {
    jobAndComparisonDeleteBefore: new Date(
      options.now.getTime() - 90 * DAY_MILLISECONDS,
    ).toISOString(),
    attendanceAndTemporaryDeleteBefore: new Date(
      options.now.getTime() - 30 * DAY_MILLISECONDS,
    ).toISOString(),
    academicYearStateRetainThrough: formatIsoDate(
      new Date(academicYearEnd.getTime() + 90 * DAY_MILLISECONDS),
    ),
  };
}

export function configurationRetainThrough(supersededAt: string): string {
  if (!isIsoInstant(supersededAt)) {
    throw new RangeError(
      'Configuration supersession instant must be canonical UTC',
    );
  }
  const timestamp = new Date(supersededAt);
  const originalMonth = timestamp.getUTCMonth();
  timestamp.setUTCFullYear(timestamp.getUTCFullYear() + 1);
  if (timestamp.getUTCMonth() !== originalMonth) timestamp.setUTCDate(0);
  return timestamp.toISOString();
}

function validatePathPolicy(paths: SqlitePathPolicy): {
  readonly managedRoot: string;
  readonly databasePath: string;
  readonly backupDirectory: string;
} {
  if (
    !isAbsolute(paths.managedRoot) ||
    !isAbsolute(paths.databasePath) ||
    !isAbsolute(paths.backupDirectory)
  ) {
    throw new SqliteBackupError('unsafe-path');
  }
  const managedRoot = resolve(paths.managedRoot);
  if (managedRoot === parse(managedRoot).root) {
    throw new SqliteBackupError('unsafe-path');
  }
  assertRealDirectoryWithoutSymlink(managedRoot);
  const databasePath = resolve(paths.databasePath);
  const backupDirectory = resolve(paths.backupDirectory);
  assertContained(managedRoot, databasePath);
  assertContained(managedRoot, backupDirectory);
  assertRealDirectoryWithoutSymlink(dirname(databasePath));
  assertRealDirectoryWithoutSymlink(backupDirectory);
  if (
    databasePath === backupDirectory ||
    isContained(backupDirectory, databasePath)
  ) {
    throw new SqliteBackupError('unsafe-path');
  }
  if (existsSync(databasePath)) {
    assertSingleLinkRegularFile(databasePath);
  }
  return { managedRoot, databasePath, backupDirectory };
}

function validateBackupArtifactPath(
  paths: ReturnType<typeof validatePathPolicy>,
  candidate: string,
): string {
  if (!isAbsolute(candidate)) throw new SqliteBackupError('unsafe-path');
  const resolved = resolve(candidate);
  const artifactStats = existsSync(resolved) ? lstatSync(resolved) : undefined;
  if (
    dirname(resolved) !== paths.backupDirectory ||
    !parse(resolved).base.startsWith(BACKUP_PREFIX) ||
    !resolved.endsWith(BACKUP_SUFFIX) ||
    artifactStats === undefined ||
    artifactStats.isSymbolicLink() ||
    !artifactStats.isFile() ||
    artifactStats.nlink !== 1
  ) {
    throw new SqliteBackupError('unsafe-path');
  }
  return resolved;
}

function assertSingleLinkRegularFile(path: string): void {
  const stats = lstatSync(path);
  if (stats.isSymbolicLink() || !stats.isFile() || stats.nlink !== 1) {
    throw new SqliteBackupError('unsafe-path');
  }
}

function validateNewDatabasePath(
  paths: ReturnType<typeof validatePathPolicy>,
  candidate: string,
): string {
  if (!isAbsolute(candidate)) throw new SqliteBackupError('unsafe-path');
  const resolved = resolve(candidate);
  assertContained(paths.managedRoot, resolved);
  assertRealDirectoryWithoutSymlink(dirname(resolved));
  if (isContained(paths.backupDirectory, resolved)) {
    throw new SqliteBackupError('unsafe-path');
  }
  return resolved;
}

function assertDatabaseIntegrity(databasePath: string): void {
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(databasePath, { readOnly: true });
    const integrityRows = database
      .prepare('PRAGMA integrity_check')
      .all() as readonly Record<string, unknown>[];
    const foreignKeyRows = database.prepare('PRAGMA foreign_key_check').all();
    if (
      integrityRows.length !== 1 ||
      Object.values(integrityRows[0] ?? {}).some((value) => value !== 'ok') ||
      foreignKeyRows.length !== 0
    ) {
      throw new SqliteBackupError('integrity-failed');
    }
  } catch (error: unknown) {
    if (error instanceof SqliteBackupError) throw error;
    throw new SqliteBackupError('integrity-failed');
  } finally {
    database?.close();
  }
}

function assertContained(root: string, candidate: string): void {
  if (!isContained(root, candidate)) throw new SqliteBackupError('unsafe-path');
}

function isContained(root: string, candidate: string): boolean {
  const child = relative(root, candidate);
  return (
    child !== '' &&
    child !== '..' &&
    !child.startsWith(`..${sep}`) &&
    !isAbsolute(child)
  );
}

function assertRealDirectoryWithoutSymlink(path: string): void {
  try {
    if (!lstatSync(path).isDirectory() || lstatSync(path).isSymbolicLink()) {
      throw new SqliteBackupError('unsafe-path');
    }
    if (realpathSync(path) !== resolve(path))
      throw new SqliteBackupError('unsafe-path');
  } catch (error: unknown) {
    if (error instanceof SqliteBackupError) throw error;
    throw new SqliteBackupError('unsafe-path');
  }
}

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function metadataPathFor(backupPath: string): string {
  return `${backupPath}.metadata.json`;
}

function removeIfPresent(path: string): void {
  if (existsSync(path)) rmSync(path, { force: true });
}

function reserveNewFile(
  path: string,
  existsCategory: 'backup-exists' | 'restore-target-exists',
): void {
  try {
    closeSync(openSync(path, 'wx', 0o600));
  } catch (error: unknown) {
    if (existsSync(path)) throw new SqliteBackupError(existsCategory);
    throw new SqliteBackupError('operation-failed');
  }
}

function isBackupCatalogEntry(value: unknown): value is BackupCatalogEntry {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value).sort();
  const expected = [
    'backupFile',
    'byteLength',
    'checksumSha256',
    'createdAt',
    'integrity',
    'pagesTransferred',
    'version',
  ].sort();
  return (
    keys.length === expected.length &&
    keys.every((key, index) => key === expected[index]) &&
    value.version === BACKUP_METADATA_VERSION &&
    typeof value.backupFile === 'string' &&
    /^classroom-hub-\d{8}T\d{9}Z\.sqlite$/.test(value.backupFile) &&
    isIsoInstant(value.createdAt) &&
    value.backupFile ===
      `${BACKUP_PREFIX}${compactTimestamp(new Date(value.createdAt))}${BACKUP_SUFFIX}` &&
    typeof value.checksumSha256 === 'string' &&
    /^[a-f0-9]{64}$/.test(value.checksumSha256) &&
    typeof value.byteLength === 'number' &&
    Number.isSafeInteger(value.byteLength) &&
    value.byteLength > 0 &&
    typeof value.pagesTransferred === 'number' &&
    Number.isSafeInteger(value.pagesTransferred) &&
    value.pagesTransferred >= 0 &&
    value.integrity === 'ok'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function compactTimestamp(now: Date): string {
  return now
    .toISOString()
    .replaceAll('-', '')
    .replaceAll(':', '')
    .replace('.', '');
}

function utcDateKey(instant: string): string {
  const parsed = new Date(instant);
  assertValidDate(parsed);
  return formatIsoDate(parsed);
}

function isoWeekKey(instant: string): string {
  const parsed = new Date(instant);
  assertValidDate(parsed);
  const day = parsed.getUTCDay() || 7;
  parsed.setUTCDate(parsed.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(parsed.getUTCFullYear(), 0, 1));
  const week = Math.ceil(
    ((parsed.getTime() - yearStart.getTime()) / DAY_MILLISECONDS + 1) / 7,
  );
  return `${parsed.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function parseIsoDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new RangeError('Expected an ISO date.');
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || formatIsoDate(parsed) !== value) {
    throw new RangeError('Expected a valid ISO date.');
  }
  return parsed;
}

function formatIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function assertValidDate(value: Date): void {
  if (!Number.isFinite(value.getTime()))
    throw new RangeError('Expected a valid date.');
}
