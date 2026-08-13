import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  compareM17CanarySemantics,
  type M17SemanticComparisonInput,
} from '../../src/application/comparison/m17-canary.js';
import { verifyM17ActivationManifest } from '../../src/entrypoints/m17-canary-activation-manifest.js';
import { loadM17ActivationManifest } from '../../src/config/m17-activation-manifest.js';
import { loadM17CanaryCalendarConfig } from '../../src/config/m17-canary.js';
import { loadProductionServerConfig } from '../../src/config/production.js';
import { SqliteDatabase } from '../../src/infrastructure/sqlite/database.js';
import { SqliteApplicationStateRepository } from '../../src/infrastructure/sqlite/repository.js';
import type { ScreenId } from '../../src/domain/identities.js';

const hash = (value: string) =>
  `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;

test('activation requires the exact fresh equal retained comparison evidence', async () => {
  const root = mkdtempSync(join(tmpdir(), 'chalkwright-m17-activation-'));
  chmodSync(root, 0o700);
  const protectedRoot = join(root, 'protected');
  const managedRoot = join(root, 'canary-production');
  const state = join(managedRoot, 'state');
  const backups = join(managedRoot, 'backups');
  for (const directory of [protectedRoot, managedRoot, state, backups]) {
    mkdirSync(directory, { mode: 0o700 });
    chmodSync(directory, 0o700);
  }
  const databasePath = join(state, 'chalkwright.sqlite');
  const now = '2035-04-13T00:30:00.000Z';
  const screenId = 'screen-c509-canary-production' as ScreenId;
  const snapshot = {
    date: '2035-04-13',
    timeZone: 'Asia/Ho_Chi_Minh',
    meetings: [],
    calendar: [],
    ownershipCoverage: 'all-owned',
    readiness: 'ready',
    displayState: 'morning_overview',
    planVerification: 'verified',
  } as const;
  const comparison: M17SemanticComparisonInput = {
    version: 1,
    kind: 'chalkwright-m17-semantic-comparison',
    comparedAt: now,
    date: '2035-04-13',
    screenId,
    reference: snapshot,
    candidate: snapshot,
  };
  const result = compareM17CanarySemantics(comparison);
  const database = new SqliteDatabase(databasePath, {
    migration: { appliedAt: now },
  });
  const repository = new SqliteApplicationStateRepository(database, {
    clock: { now: () => now },
    nextRevision: () => 'm17-test-revision',
    academicYearEndForDate: () => '2035-06-30',
  });
  assert.equal(
    (await repository.storeRecord(result.evidence)).status,
    'stored',
  );
  database.close();
  const write = (name: string, value: unknown) => {
    const path = join(protectedRoot, name);
    writeFileSync(path, `${JSON.stringify(value)}\n`, { mode: 0o600 });
    return path;
  };
  const operator = write('operator-token', 'x'.repeat(48));
  const production = write('production.json', {
    version: 1,
    instanceId: 'chalkwright-c509-canary-production',
    roomId: 'room-c509',
    screenId,
    screenLabel: 'C509',
    host: '127.0.0.1',
    port: 4319,
    timeZone: 'Asia/Ho_Chi_Minh',
    academicYearEnd: '2035-06-30',
    managedRoot,
    databasePath,
    backupDirectory: backups,
    operatorTokenReference: operator,
    courseMappings: [
      {
        classId: 'mict02-2',
        sectionCode: 'MICT02.2',
        providerCourseKey: '12345',
      },
    ],
    checkInOpenMinutesBefore: 10,
    dismissalWarningMinutesBefore: 5,
  });
  const calendarId = 'auto-lesson-2@example.test';
  const calendar = write('calendar.json', {
    version: 1,
    kind: 'chalkwright-m17-parallel-canary',
    calendarSummary: 'Auto Lesson 2',
    calendarId,
    calendarReferenceHash: hash(calendarId),
    deniedCalendarReferenceHashes: [
      hash('primary'),
      hash('legacy@example.test'),
    ],
    scopeId: 'chalkwright-c509-canary',
    timeZone: 'Asia/Ho_Chi_Minh',
    productionConfigReference: production,
    credentialReferencePath: join(protectedRoot, 'credential.json'),
    databasePath,
    requestTimeoutMs: 15_000,
    overallTimeoutMs: 180_000,
    leaseDurationSeconds: 300,
    maximumPages: 5,
    maximumEvents: 100,
  });
  const release = 'a'.repeat(64);
  const manifest = write('manifest.json', {
    version: 1,
    kind: 'chalkwright-m17-activation-manifest',
    releaseSha256: release,
    calendarReferenceHash: hash(calendarId),
    deniedCalendarReferenceHashes: [
      hash('primary'),
      hash('legacy@example.test'),
    ],
    tailnetTarget:
      'https://chalkwright.example-tailnet.ts.net/classroom-screen',
    legacyRouteFingerprint: `sha256:${'b'.repeat(64)}`,
    stopCommand:
      '/opt/chalkwright-canary/current/scripts/operations/stop-m17-canary.sh',
    observationStartsAt: '2035-04-13T00:00:00.000Z',
    observationEndsAt: '2035-04-16T00:00:00.000Z',
    comparisonEvidenceFingerprint: result.evidenceFingerprint,
    comparisonRecordKey: result.evidence.recordKey,
    comparisonDate: '2035-04-13',
    screenId,
  });
  try {
    assert.equal(loadM17ActivationManifest(manifest).releaseSha256, release);
    assert.equal(loadM17CanaryCalendarConfig(calendar).calendarId, calendarId);
    assert.equal(loadProductionServerConfig(production).screenId, screenId);
    assert.deepEqual(
      await verifyM17ActivationManifest({
        arguments: ['--verify', manifest, release],
        calendarConfigReference: calendar,
        now: () => now,
      }),
      { exitCode: 0, status: 'm17-activation-manifest-verified' },
    );
    assert.equal(
      (
        await verifyM17ActivationManifest({
          arguments: ['--verify', manifest, 'c'.repeat(64)],
          calendarConfigReference: calendar,
          now: () => now,
        })
      ).exitCode,
      1,
    );
    const afterFreshnessWindow = '2035-04-14T01:00:00.000Z';
    assert.equal(
      (
        await verifyM17ActivationManifest({
          arguments: ['--verify', manifest, release],
          calendarConfigReference: calendar,
          now: () => afterFreshnessWindow,
        })
      ).exitCode,
      1,
    );
    assert.deepEqual(
      await verifyM17ActivationManifest({
        arguments: ['--verify-current', manifest],
        calendarConfigReference: calendar,
        currentReleaseSha256: () => release,
        now: () => afterFreshnessWindow,
      }),
      { exitCode: 0, status: 'm17-activation-manifest-verified' },
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
