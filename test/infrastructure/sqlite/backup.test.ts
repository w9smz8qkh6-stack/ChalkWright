import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, test } from 'node:test';

import {
  calculateDataRetentionBoundaries,
  configurationRetainThrough,
  createSqliteBackup,
  pruneBackupRetention,
  readBackupCatalogEntry,
  restoreSqliteBackup,
  selectBackupRetention,
  SqliteBackupError,
  type BackupArtifact,
  type SqlitePathPolicy,
} from '../../../src/infrastructure/sqlite/backup.js';

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe('SQLite backup and restore', () => {
  test('creates an integrity-checked backup with checksum catalog metadata and restores it', async () => {
    const fixture = createFixture();
    const database = new DatabaseSync(fixture.paths.databasePath);
    database.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE parent (id INTEGER PRIMARY KEY) STRICT;
      CREATE TABLE child (
        id INTEGER PRIMARY KEY,
        parent_id INTEGER NOT NULL REFERENCES parent(id),
        value TEXT NOT NULL
      ) STRICT;
      INSERT INTO parent VALUES (1);
      INSERT INTO child VALUES (1, 1, 'synthetic continuity state');
    `);
    database.close();

    const artifact = await createSqliteBackup({
      paths: fixture.paths,
      now: new Date('2035-01-02T03:04:05.000Z'),
    });
    assert.equal(
      artifact.backupFile,
      'classroom-hub-20350102T030405000Z.sqlite',
    );
    assert.match(artifact.checksumSha256, /^[a-f0-9]{64}$/);
    assert.ok(artifact.byteLength > 0);
    assert.equal(artifact.integrity, 'ok');
    assert.equal(statSync(artifact.backupPath).mode & 0o777, 0o600);
    assert.equal(statSync(artifact.metadataPath).mode & 0o777, 0o600);
    assert.deepEqual(
      readBackupCatalogEntry({
        paths: fixture.paths,
        backupPath: artifact.backupPath,
      }),
      artifact,
    );
    assert.equal(
      JSON.parse(readFileSync(artifact.metadataPath, 'utf8')).databasePath,
      undefined,
    );

    const restorePath = join(fixture.root, 'restored.sqlite');
    await restoreSqliteBackup({
      paths: fixture.paths,
      backupPath: artifact.backupPath,
      restorePath,
    });
    const restored = new DatabaseSync(restorePath, { readOnly: true });
    assert.equal(statSync(restorePath).mode & 0o777, 0o600);
    assert.deepEqual(
      { ...restored.prepare('SELECT * FROM child').get() },
      {
        id: 1,
        parent_id: 1,
        value: 'synthetic continuity state',
      },
    );
    assert.deepEqual(
      { ...restored.prepare('PRAGMA integrity_check').get() },
      {
        integrity_check: 'ok',
      },
    );
    assert.deepEqual(restored.prepare('PRAGMA foreign_key_check').all(), []);
    restored.close();
  });

  test('checks source integrity before backup', async () => {
    const fixture = createFixture();
    writeFileSync(fixture.paths.databasePath, 'not a sqlite database', {
      mode: 0o600,
    });
    await assert.rejects(
      createSqliteBackup({
        paths: fixture.paths,
        now: new Date('2035-01-02T03:04:05Z'),
      }),
      (error: unknown) =>
        error instanceof SqliteBackupError &&
        error.category === 'integrity-failed',
    );
    assert.deepEqual(readBackupNames(fixture.paths.backupDirectory), []);
  });

  test('never overwrites an existing backup artifact', async () => {
    const fixture = createFixtureWithDatabase();
    const backupPath = join(
      fixture.paths.backupDirectory,
      'classroom-hub-20350102T030405000Z.sqlite',
    );
    writeFileSync(backupPath, 'synthetic sentinel', { mode: 0o600 });
    await assert.rejects(
      createSqliteBackup({
        paths: fixture.paths,
        now: new Date('2035-01-02T03:04:05.000Z'),
      }),
      (error: unknown) =>
        error instanceof SqliteBackupError &&
        error.category === 'backup-exists',
    );
    assert.equal(readFileSync(backupPath, 'utf8'), 'synthetic sentinel');
  });

  test('detects corruption before restore without exposing file paths', async () => {
    const fixture = createFixtureWithDatabase();
    const artifact = await createSqliteBackup({
      paths: fixture.paths,
      now: new Date('2035-01-02T03:04:05Z'),
    });
    writeFileSync(artifact.backupPath, 'corrupted synthetic backup', {
      mode: 0o600,
    });

    const restorePath = join(fixture.root, 'restore.sqlite');
    await assert.rejects(
      restoreSqliteBackup({
        paths: fixture.paths,
        backupPath: artifact.backupPath,
        restorePath,
      }),
      (error: unknown) => {
        assert.ok(error instanceof SqliteBackupError);
        assert.equal(error.category, 'checksum-mismatch');
        assert.equal(error.message.includes(fixture.root), false);
        return true;
      },
    );
    assert.equal(existsSync(restorePath), false);
  });

  test('never overwrites an existing or open restore target', async () => {
    const fixture = createFixtureWithDatabase();
    const artifact = await createSqliteBackup({
      paths: fixture.paths,
      now: new Date('2035-01-02T03:04:05Z'),
    });
    const restorePath = join(fixture.root, 'already-open.sqlite');
    const openTarget = new DatabaseSync(restorePath);
    openTarget.exec('CREATE TABLE sentinel (value TEXT NOT NULL) STRICT');

    await assert.rejects(
      restoreSqliteBackup({
        paths: fixture.paths,
        backupPath: artifact.backupPath,
        restorePath,
      }),
      (error: unknown) =>
        error instanceof SqliteBackupError &&
        error.category === 'restore-target-exists',
    );
    assert.deepEqual(
      {
        ...openTarget
          .prepare("SELECT name FROM sqlite_schema WHERE name = 'sentinel'")
          .get(),
      },
      {
        name: 'sentinel',
      },
    );
    openTarget.close();
  });

  test('rejects broad, relative, escaping, backup-nested, and arbitrary external paths', async () => {
    const fixture = createFixtureWithDatabase();
    const validArtifact = await createSqliteBackup({
      paths: fixture.paths,
      now: new Date('2035-01-02T03:04:05Z'),
    });
    const outside = mkdtempSync(join(tmpdir(), 'classroom-hub-outside-'));
    temporaryRoots.push(outside);

    const unsafePolicies: SqlitePathPolicy[] = [
      { ...fixture.paths, managedRoot: '/' },
      { ...fixture.paths, databasePath: 'relative.sqlite' },
      { ...fixture.paths, databasePath: join(outside, 'arbitrary.sqlite') },
      { ...fixture.paths, backupDirectory: outside },
    ];
    for (const paths of unsafePolicies) {
      await assert.rejects(
        createSqliteBackup({ paths, now: new Date('2035-01-03T03:04:05Z') }),
        (error: unknown) =>
          error instanceof SqliteBackupError &&
          error.category === 'unsafe-path',
      );
    }

    await assert.rejects(
      restoreSqliteBackup({
        paths: fixture.paths,
        backupPath: validArtifact.backupPath,
        restorePath: join(fixture.paths.backupDirectory, 'nested.sqlite'),
      }),
      (error: unknown) =>
        error instanceof SqliteBackupError && error.category === 'unsafe-path',
    );
    await assert.rejects(
      restoreSqliteBackup({
        paths: fixture.paths,
        backupPath: join(outside, 'arbitrary.sqlite'),
        restorePath: join(fixture.root, 'restore.sqlite'),
      }),
      (error: unknown) =>
        error instanceof SqliteBackupError && error.category === 'unsafe-path',
    );
  });

  test('rejects malformed or path-mismatched catalog metadata', async () => {
    const fixture = createFixtureWithDatabase();
    const artifact = await createSqliteBackup({
      paths: fixture.paths,
      now: new Date('2035-01-02T03:04:05Z'),
    });
    writeFileSync(
      artifact.metadataPath,
      '{"backupFile":"different.sqlite"}\n',
      { mode: 0o600 },
    );
    assert.throws(
      () =>
        readBackupCatalogEntry({
          paths: fixture.paths,
          backupPath: artifact.backupPath,
        }),
      (error: unknown) =>
        error instanceof SqliteBackupError &&
        error.category === 'catalog-invalid',
    );
  });

  test('does not follow a catalog sidecar symlink', async () => {
    const fixture = createFixtureWithDatabase();
    const artifact = await createSqliteBackup({
      paths: fixture.paths,
      now: new Date('2035-01-02T03:04:05Z'),
    });
    const outside = mkdtempSync(
      join(tmpdir(), 'classroom-hub-catalog-outside-'),
    );
    temporaryRoots.push(outside);
    const outsideCatalog = join(outside, 'catalog.json');
    writeFileSync(outsideCatalog, readFileSync(artifact.metadataPath));
    unlinkSync(artifact.metadataPath);
    symlinkSync(outsideCatalog, artifact.metadataPath);

    assert.throws(
      () =>
        readBackupCatalogEntry({
          paths: fixture.paths,
          backupPath: artifact.backupPath,
        }),
      (error: unknown) =>
        error instanceof SqliteBackupError && error.category === 'unsafe-path',
    );
  });

  test('rejects hard-linked backup and catalog files before reading them', async () => {
    const fixture = createFixture();
    const database = new DatabaseSync(fixture.paths.databasePath);
    database.exec('CREATE TABLE synthetic (id INTEGER PRIMARY KEY) STRICT;');
    database.close();
    const artifact = await createSqliteBackup({
      paths: fixture.paths,
      now: new Date('2035-01-02T03:04:05.000Z'),
    });
    const outside = mkdtempSync(join(tmpdir(), 'classroom-hub-hardlink-'));
    temporaryRoots.push(outside);
    linkSync(artifact.backupPath, join(outside, 'backup.sqlite'));
    assert.throws(
      () =>
        readBackupCatalogEntry({
          paths: fixture.paths,
          backupPath: artifact.backupPath,
        }),
      (error: unknown) =>
        error instanceof SqliteBackupError && error.category === 'unsafe-path',
    );
    unlinkSync(join(outside, 'backup.sqlite'));
    linkSync(artifact.metadataPath, join(outside, 'catalog.json'));
    assert.throws(
      () =>
        readBackupCatalogEntry({
          paths: fixture.paths,
          backupPath: artifact.backupPath,
        }),
      (error: unknown) =>
        error instanceof SqliteBackupError && error.category === 'unsafe-path',
    );
  });
});

describe('backup retention', () => {
  test('retains exactly 14 distinct daily and 8 older weekly recovery points', () => {
    const artifacts = Array.from({ length: 80 }, (_, offset) =>
      catalogFixture(new Date(Date.UTC(2035, 5, 30 - offset, 3))),
    );
    const selection = selectBackupRetention(artifacts);
    assert.equal(selection.keepDaily.length, 14);
    assert.equal(selection.keepWeekly.length, 8);
    assert.equal(selection.remove.length, 58);
    assert.equal(
      new Set(
        [...selection.keepDaily, ...selection.keepWeekly].map(
          (artifact) => artifact.backupPath,
        ),
      ).size,
      22,
    );
  });

  test('keeps all artifacts at the exact 14 daily plus 8 weekly boundary', () => {
    const daily = Array.from({ length: 14 }, (_, offset) =>
      catalogFixture(new Date(Date.UTC(2035, 5, 30 - offset, 3))),
    );
    const weekly = Array.from({ length: 8 }, (_, offset) =>
      catalogFixture(new Date(Date.UTC(2035, 5, 7 - offset * 7, 3))),
    );
    const selection = selectBackupRetention([...daily, ...weekly]);
    assert.equal(selection.keepDaily.length, 14);
    assert.equal(selection.keepWeekly.length, 8);
    assert.equal(selection.remove.length, 0);
  });

  test('prunes only cataloged files beneath the managed backup directory', () => {
    const fixture = createFixture();
    const artifacts = Array.from({ length: 80 }, (_, offset) => {
      return materializeCatalogFixture(
        catalogFixture(
          new Date(Date.UTC(2035, 5, 30 - offset, 3)),
          fixture.paths.backupDirectory,
        ),
        `synthetic backup ${offset}`,
      );
    });
    const selection = pruneBackupRetention({ paths: fixture.paths, artifacts });
    assert.equal(selection.keepDaily.length, 14);
    assert.equal(selection.keepWeekly.length, 8);
    assert.equal(selection.remove.length, 58);
    assert.ok(
      selection.remove.every((artifact) => !existsSync(artifact.backupPath)),
    );
    assert.ok(
      selection.keepDaily.every((artifact) => existsSync(artifact.backupPath)),
    );
    assert.ok(
      selection.keepWeekly.every((artifact) => existsSync(artifact.backupPath)),
    );
  });

  test('validates every retention entry before removing any file', () => {
    const fixture = createFixture();
    const safe = catalogFixture(
      new Date('2035-06-30T03:00:00Z'),
      fixture.paths.backupDirectory,
    );
    const materializedSafe = materializeCatalogFixture(safe);
    const outside = mkdtempSync(
      join(tmpdir(), 'classroom-hub-retention-outside-'),
    );
    temporaryRoots.push(outside);
    const unsafe = catalogFixture(new Date('2035-07-01T03:00:00Z'), outside);
    const materializedUnsafe = materializeCatalogFixture(unsafe);

    assert.throws(
      () =>
        pruneBackupRetention({
          paths: fixture.paths,
          artifacts: [materializedUnsafe, materializedSafe],
        }),
      (error: unknown) =>
        error instanceof SqliteBackupError && error.category === 'unsafe-path',
    );
    assert.equal(existsSync(materializedSafe.backupPath), true);
  });

  test('rejects a malformed catalog before deleting any candidate', () => {
    const fixture = createFixture();
    const artifacts = createPruneCandidates(fixture, 24);
    writeFileSync(artifacts.at(-1)!.metadataPath, '{}\n', { mode: 0o600 });

    assert.throws(
      () => pruneBackupRetention({ paths: fixture.paths, artifacts }),
      (error: unknown) =>
        error instanceof SqliteBackupError &&
        error.category === 'catalog-invalid',
    );
    assert.ok(
      artifacts.every(
        (artifact) =>
          existsSync(artifact.backupPath) && existsSync(artifact.metadataPath),
      ),
    );
  });

  test('rejects a missing catalog before deleting any candidate', () => {
    const fixture = createFixture();
    const artifacts = createPruneCandidates(fixture, 24);
    unlinkSync(artifacts.at(-1)!.metadataPath);

    assert.throws(
      () => pruneBackupRetention({ paths: fixture.paths, artifacts }),
      (error: unknown) =>
        error instanceof SqliteBackupError &&
        error.category === 'catalog-invalid',
    );
    assert.ok(artifacts.every((artifact) => existsSync(artifact.backupPath)));
  });

  test('rejects a symlinked catalog before deleting any candidate', () => {
    const fixture = createFixture();
    const artifacts = createPruneCandidates(fixture, 24);
    const symlinked = artifacts.at(-1)!;
    const outside = mkdtempSync(
      join(tmpdir(), 'classroom-hub-prune-catalog-outside-'),
    );
    temporaryRoots.push(outside);
    const outsideCatalog = join(outside, 'catalog.json');
    writeFileSync(outsideCatalog, readFileSync(symlinked.metadataPath));
    unlinkSync(symlinked.metadataPath);
    symlinkSync(outsideCatalog, symlinked.metadataPath);

    assert.throws(
      () => pruneBackupRetention({ paths: fixture.paths, artifacts }),
      (error: unknown) =>
        error instanceof SqliteBackupError && error.category === 'unsafe-path',
    );
    assert.ok(artifacts.every((artifact) => existsSync(artifact.backupPath)));
  });

  test('rejects a path-mismatched catalog before deleting any candidate', () => {
    const fixture = createFixture();
    const artifacts = createPruneCandidates(fixture, 24);
    const mismatched = artifacts.at(-1)!;
    writeCatalog({
      ...mismatched,
      backupFile: 'classroom-hub-20300101T030000000Z.sqlite',
    });

    assert.throws(
      () => pruneBackupRetention({ paths: fixture.paths, artifacts }),
      (error: unknown) =>
        error instanceof SqliteBackupError &&
        error.category === 'catalog-invalid',
    );
    assert.ok(artifacts.every((artifact) => existsSync(artifact.backupPath)));
  });

  test('rejects caller and catalog timestamp disagreement before deleting anything', () => {
    const fixture = createFixture();
    const artifacts = createPruneCandidates(fixture, 24);
    const mismatched = artifacts.at(-1)!;
    writeCatalog({
      ...mismatched,
      createdAt: '2030-01-01T03:00:00.000Z',
    });

    assert.throws(
      () => pruneBackupRetention({ paths: fixture.paths, artifacts }),
      (error: unknown) =>
        error instanceof SqliteBackupError &&
        error.category === 'catalog-invalid',
    );
    assert.ok(artifacts.every((artifact) => existsSync(artifact.backupPath)));
  });

  test('rejects caller and catalog identity disagreement before deleting anything', () => {
    const fixture = createFixture();
    const artifacts = createPruneCandidates(fixture, 24);
    const mismatched = artifacts.at(-1)!;
    writeCatalog({ ...mismatched, checksumSha256: 'b'.repeat(64) });

    assert.throws(
      () => pruneBackupRetention({ paths: fixture.paths, artifacts }),
      (error: unknown) =>
        error instanceof SqliteBackupError &&
        error.category === 'catalog-invalid',
    );
    assert.ok(artifacts.every((artifact) => existsSync(artifact.backupPath)));
  });

  test('rejects a backup whose bytes no longer match its catalog before deleting anything', () => {
    const fixture = createFixture();
    const artifacts = createPruneCandidates(fixture, 24);
    const tampered = artifacts.at(-1)!;
    const bytes = readFileSync(tampered.backupPath);
    bytes[0] = bytes[0]! ^ 0xff;
    writeFileSync(tampered.backupPath, bytes, { mode: 0o600 });

    assert.throws(
      () => pruneBackupRetention({ paths: fixture.paths, artifacts }),
      (error: unknown) =>
        error instanceof SqliteBackupError &&
        error.category === 'checksum-mismatch',
    );
    assert.ok(
      artifacts.every(
        (artifact) =>
          existsSync(artifact.backupPath) && existsSync(artifact.metadataPath),
      ),
    );
  });

  test('rejects a catalog byte-length mismatch before deleting anything', () => {
    const fixture = createFixture();
    const artifacts = [...createPruneCandidates(fixture, 24)];
    const original = artifacts.at(-1)!;
    const mismatched = { ...original, byteLength: original.byteLength + 1 };
    artifacts[artifacts.length - 1] = mismatched;
    writeCatalog(mismatched);

    assert.throws(
      () => pruneBackupRetention({ paths: fixture.paths, artifacts }),
      (error: unknown) =>
        error instanceof SqliteBackupError &&
        error.category === 'checksum-mismatch',
    );
    assert.ok(
      artifacts.every(
        (artifact) =>
          existsSync(artifact.backupPath) && existsSync(artifact.metadataPath),
      ),
    );
  });
});

describe('approved data-retention boundaries', () => {
  test('calculates 90-day, 30-day, and explicit academic-year-plus-90-day boundaries', () => {
    assert.deepEqual(
      calculateDataRetentionBoundaries({
        now: new Date('2035-10-01T12:00:00.000Z'),
        academicYearEndsOn: '2035-06-15',
      }),
      {
        jobAndComparisonDeleteBefore: '2035-07-03T12:00:00.000Z',
        attendanceAndTemporaryDeleteBefore: '2035-09-01T12:00:00.000Z',
        academicYearStateRetainThrough: '2035-09-13',
      },
    );
    assert.equal(
      configurationRetainThrough('2035-04-05T06:07:08.000Z'),
      '2036-04-05T06:07:08.000Z',
    );
  });

  test('requires the academic-year end instead of guessing it', () => {
    assert.throws(
      () =>
        calculateDataRetentionBoundaries({
          now: new Date('2035-10-01T12:00:00.000Z'),
          academicYearEndsOn: '2035-02-30',
        }),
      RangeError,
    );
  });

  test('requires a real canonical UTC instant for configuration retention', () => {
    for (const supersededAt of [
      '2035-02-30T00:00:00Z',
      '2035-04-13',
      '2035-04-13T00:00:00+01:00',
    ]) {
      assert.throws(
        () => configurationRetainThrough(supersededAt),
        RangeError,
        supersededAt,
      );
    }
  });

  test('retains valid boundary instants for one calendar year', () => {
    assert.equal(
      configurationRetainThrough('2036-02-29T23:59:59Z'),
      '2037-02-28T23:59:59.000Z',
    );
    assert.equal(
      configurationRetainThrough('2035-12-31T23:59:59.999Z'),
      '2036-12-31T23:59:59.999Z',
    );
  });
});

function createFixture(): {
  readonly root: string;
  readonly paths: SqlitePathPolicy;
} {
  const root = mkdtempSync(join(tmpdir(), 'classroom-hub-backup-'));
  temporaryRoots.push(root);
  const backupDirectory = join(root, 'backups');
  mkdirSync(backupDirectory, { mode: 0o700 });
  return {
    root,
    paths: {
      managedRoot: root,
      databasePath: join(root, 'application.sqlite'),
      backupDirectory,
    },
  };
}

function createFixtureWithDatabase(): ReturnType<typeof createFixture> {
  const fixture = createFixture();
  const database = new DatabaseSync(fixture.paths.databasePath);
  database.exec(
    "CREATE TABLE state (id INTEGER PRIMARY KEY, value TEXT NOT NULL) STRICT; INSERT INTO state VALUES (1, 'safe');",
  );
  database.close();
  return fixture;
}

function catalogFixture(
  now: Date,
  backupDirectory = '/synthetic/managed/backups',
): BackupArtifact {
  const compact = now
    .toISOString()
    .replaceAll('-', '')
    .replaceAll(':', '')
    .replace('.', '');
  const backupFile = `classroom-hub-${compact}.sqlite`;
  const backupPath = join(backupDirectory, backupFile);
  return {
    version: 1,
    backupFile,
    backupPath,
    metadataPath: `${backupPath}.metadata.json`,
    createdAt: now.toISOString(),
    checksumSha256: 'a'.repeat(64),
    byteLength: 4096,
    pagesTransferred: 1,
    integrity: 'ok',
  };
}

function createPruneCandidates(
  fixture: ReturnType<typeof createFixture>,
  count: number,
): readonly BackupArtifact[] {
  return Array.from({ length: count }, (_, offset) => {
    return materializeCatalogFixture(
      catalogFixture(
        new Date(Date.UTC(2035, 5, 30 - offset, 3)),
        fixture.paths.backupDirectory,
      ),
      `synthetic backup ${offset}`,
    );
  });
}

function materializeCatalogFixture(
  artifact: BackupArtifact,
  contents = 'synthetic backup',
): BackupArtifact {
  const bytes = Buffer.from(contents);
  writeFileSync(artifact.backupPath, bytes, { mode: 0o600 });
  const materialized = {
    ...artifact,
    checksumSha256: createHash('sha256').update(bytes).digest('hex'),
    byteLength: bytes.byteLength,
  };
  writeCatalog(materialized);
  return materialized;
}

function writeCatalog(artifact: BackupArtifact): void {
  const {
    backupPath: _backupPath,
    metadataPath: _metadataPath,
    ...catalog
  } = artifact;
  writeFileSync(artifact.metadataPath, `${JSON.stringify(catalog)}\n`, {
    mode: 0o600,
  });
}

function readBackupNames(backupDirectory: string): readonly string[] {
  return readdirSync(backupDirectory).sort();
}
