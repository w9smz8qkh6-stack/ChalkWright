import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { loadProductionServerConfig } from '../../src/config/production.js';
import { writeNewProtectedJson } from '../../src/infrastructure/filesystem/protected-json.js';

function payload(root: string) {
  return {
    version: 1 as const,
    instanceId: 'classroom-hub-c509-production',
    roomId: 'room-c509',
    screenId: 'screen-c509-production',
    screenLabel: 'C509 Classroom Display',
    host: '127.0.0.1',
    port: 4317,
    timeZone: 'Asia/Ho_Chi_Minh',
    academicYearEnd: '2027-06-30',
    managedRoot: join(root, 'classroom-hub-production'),
    databasePath: join(
      root,
      'classroom-hub-production',
      'state',
      'classroom-hub.sqlite',
    ),
    backupDirectory: join(root, 'classroom-hub-production', 'backups'),
    operatorTokenReference: join(root, 'secrets', 'operator-token'),
    courseMappings: [
      {
        classId: 'class-c509-a',
        sectionCode: 'Synthetic C509 CODE-A',
        providerCourseKey: '123456789',
        attendanceClassCode: 'C509-A',
        attendanceCheckInUrl: 'https://attendance.example.invalid/check-in',
      },
    ],
    checkInOpenMinutesBefore: 5,
    dismissalWarningMinutesBefore: 5,
  };
}

test('loads one exact owner-only production server reference without provider authority', () => {
  const root = mkdtempSync(join(tmpdir(), 'classroom-hub-production-config-'));
  try {
    chmodSync(root, 0o700);
    const repositoryRoot = join(root, 'synthetic-repository');
    const reference = join(root, 'server.json');
    writeNewProtectedJson(reference, payload(root));
    const config = loadProductionServerConfig(reference, repositoryRoot);
    assert.equal(config.instanceId, 'classroom-hub-c509-production');
    assert.equal(config.port, 4317);
    assert.equal(config.screenId, 'screen-c509-production');
    assert.equal(config.courseMappings[0]?.roomId, 'room-c509');
    assert.equal(
      config.courseMappings[0]?.attendanceCheckInUrl,
      'https://attendance.example.invalid/check-in',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('accepts one optional external digest-bound dismissal media reference', () => {
  const root = mkdtempSync(join(tmpdir(), 'classroom-hub-production-config-'));
  try {
    chmodSync(root, 0o700);
    const reference = join(root, 'server.json');
    const mediaPath = join(root, 'site-assets', 'dismissal.mp4');
    writeNewProtectedJson(reference, {
      ...payload(root),
      dismissalMedia: {
        path: mediaPath,
        byteLength: 4_591_479,
        sha256: 'a'.repeat(64),
      },
    });
    const config = loadProductionServerConfig(
      reference,
      join(root, 'synthetic-repository'),
    );
    assert.deepEqual(config.dismissalMedia, {
      path: mediaPath,
      byteLength: 4_591_479,
      sha256: 'a'.repeat(64),
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects augmented, shadow, broad, and state-coupled production configuration', () => {
  const root = mkdtempSync(join(tmpdir(), 'classroom-hub-production-config-'));
  try {
    chmodSync(root, 0o700);
    const repositoryRoot = join(root, 'synthetic-repository');
    const base = payload(root);
    const candidates = [
      { ...base, extra: true },
      { ...base, instanceId: 'classroom-hub-shadow' },
      { ...base, host: '0.0.0.0' },
      { ...base, managedRoot: join(root, 'state') },
      {
        ...base,
        operatorTokenReference: join(
          root,
          'classroom-hub-production',
          'operator-token',
        ),
      },
      {
        ...base,
        backupDirectory: join(
          root,
          'classroom-hub-production',
          'state',
          'classroom-hub.sqlite',
          'backups',
        ),
      },
      { ...base, courseMappings: [] },
      { ...base, checkInOpenMinutesBefore: 121 },
      {
        ...base,
        dismissalMedia: {
          path: join(root, 'media.mp4'),
          byteLength: 1,
          sha256: 'not-a-digest',
        },
      },
    ];
    for (const [index, candidate] of candidates.entries()) {
      const reference = join(root, `invalid-${index}.json`);
      writeNewProtectedJson(reference, candidate);
      assert.throws(
        () => loadProductionServerConfig(reference, repositoryRoot),
        Error,
        String(index),
      );
    }

    const repositoryReference = join(
      repositoryRoot,
      'protected',
      'server.json',
    );
    chmodSync(root, 0o700);
    mkdirSync(join(repositoryRoot, 'protected'), {
      recursive: true,
      mode: 0o700,
    });
    writeNewProtectedJson(repositoryReference, base);
    assert.throws(
      () => loadProductionServerConfig(repositoryReference, repositoryRoot),
      /production-config-invalid/u,
    );

    const externalReference = join(root, 'repository-paths.json');
    writeNewProtectedJson(externalReference, {
      ...base,
      managedRoot: join(repositoryRoot, 'classroom-hub-production'),
      databasePath: join(
        repositoryRoot,
        'classroom-hub-production',
        'state.sqlite',
      ),
      backupDirectory: join(
        repositoryRoot,
        'classroom-hub-production',
        'backups',
      ),
    });
    assert.throws(
      () => loadProductionServerConfig(externalReference, repositoryRoot),
      /production-config-invalid/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
