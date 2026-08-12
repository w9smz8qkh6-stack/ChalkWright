import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { startProductionApplication } from '../../src/app/production-server.js';
import type { ProductionServerConfig } from '../../src/config/production.js';
import type { ClassId } from '../../src/domain/identities.js';
import { b407Plan } from '../../src/infrastructure/fixture/b407.js';
import { SqliteDatabase } from '../../src/infrastructure/sqlite/database.js';
import { SqliteApplicationStateRepository } from '../../src/infrastructure/sqlite/repository.js';

const token = 'synthetic-production-operator-authority';

test('starts the inert non-fixture production composition on the exact legacy mount', async () => {
  const root = mkdtempSync(join(tmpdir(), 'classroom-hub-production-app-'));
  const managedRoot = join(root, 'runtime-production');
  const stateDirectory = join(managedRoot, 'state');
  const backupDirectory = join(managedRoot, 'backups');
  const secretsDirectory = join(root, 'synthetic-secrets');
  mkdirSync(managedRoot, { mode: 0o700 });
  mkdirSync(stateDirectory, { mode: 0o700 });
  mkdirSync(backupDirectory, { mode: 0o700 });
  mkdirSync(secretsDirectory, { mode: 0o700 });
  const databasePath = join(stateDirectory, 'classroom-hub.sqlite');
  const config: ProductionServerConfig = {
    version: 1,
    instanceId: 'classroom-hub-b407-production',
    roomId: b407Plan.roomId,
    screenId: b407Plan.screenId,
    screenLabel: 'Synthetic Production Display',
    host: '127.0.0.1',
    port: 0,
    timeZone: b407Plan.timeZone,
    academicYearEnd: '2035-06-30',
    managedRoot,
    databasePath,
    backupDirectory,
    operatorTokenReference: join(secretsDirectory, 'operator-token'),
    courseMappings: [
      {
        classId: 'class-b407-a' as ClassId,
        sectionCode: 'Synthetic course-a',
        providerCourseKey: '1',
        roomId: b407Plan.roomId,
      },
      {
        classId: 'class-b407-b' as ClassId,
        sectionCode: 'Synthetic course-b',
        providerCourseKey: '2',
        roomId: b407Plan.roomId,
      },
    ],
    checkInOpenMinutesBefore: 5,
    dismissalWarningMinutesBefore: 5,
  };
  const database = new SqliteDatabase(databasePath, {
    migration: { appliedAt: '2035-04-13T00:00:00.000Z' },
  });
  const repository = new SqliteApplicationStateRepository(database, {
    clock: { now: () => '2035-04-13T00:00:00.000Z' },
    nextRevision: () => 'production-test-revision',
    academicYearEndForDate: () => config.academicYearEnd,
  });
  assert.equal((await repository.storeEffective(b407Plan)).status, 'stored');
  database.close();

  try {
    const application = await startProductionApplication(
      config,
      token,
      process.cwd(),
      { clock: { now: () => '2035-04-13T08:00:00.000Z' } },
    );
    try {
      assert.equal(existsSync(databasePath), true);
      const display = await fetch(
        `${application.origin}/classroom-screen/b407`,
      );
      assert.equal(display.status, 200);
      assert.match(await display.text(), /state-in_class_content/u);
      assert.equal(
        (await fetch(`${application.origin}/classroom-screen/api/target/b407`))
          .status,
        200,
      );
      assert.equal(
        (await fetch(`${application.origin}/classroom-screen/ready`)).status,
        200,
      );
      assert.equal((await fetch(`${application.origin}/ready`)).status, 404);

      const unauthorized = await fetch(
        `${application.origin}/classroom-screen/overrides/${config.screenId}`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            screenId: config.screenId,
            date: b407Plan.date,
            announcement: 'Synthetic scoped notice',
          }),
        },
      );
      assert.equal(unauthorized.status, 401);
      const authorized = await fetch(
        `${application.origin}/classroom-screen/overrides/${config.screenId}`,
        {
          method: 'PUT',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            screenId: config.screenId,
            date: b407Plan.date,
            announcement: 'Synthetic scoped notice',
          }),
        },
      );
      assert.equal(authorized.status, 200);
    } finally {
      await application.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('refuses unsafe or unavailable managed production state before startup', async () => {
  const root = mkdtempSync(join(tmpdir(), 'classroom-hub-production-unsafe-'));
  const managedRoot = join(root, 'runtime-production');
  const realState = join(root, 'real-state');
  const backupDirectory = join(managedRoot, 'backups');
  mkdirSync(managedRoot, { mode: 0o700 });
  mkdirSync(realState, { mode: 0o700 });
  mkdirSync(backupDirectory, { mode: 0o700 });
  symlinkSync(realState, join(managedRoot, 'state'));
  const config: ProductionServerConfig = {
    version: 1,
    instanceId: 'classroom-hub-c509-production',
    roomId: b407Plan.roomId,
    screenId: b407Plan.screenId,
    screenLabel: 'Synthetic Production Display',
    host: '127.0.0.1',
    port: 0,
    timeZone: b407Plan.timeZone,
    academicYearEnd: '2035-06-30',
    managedRoot,
    databasePath: join(managedRoot, 'state', 'classroom-hub.sqlite'),
    backupDirectory,
    operatorTokenReference: join(root, 'operator-token'),
    courseMappings: [
      {
        classId: 'class-b407-a' as ClassId,
        sectionCode: 'Synthetic course-a',
        providerCourseKey: '1',
        roomId: b407Plan.roomId,
      },
    ],
    checkInOpenMinutesBefore: 5,
    dismissalWarningMinutesBefore: 5,
  };
  try {
    await assert.rejects(
      startProductionApplication(config, token),
      /managed-directory-unsafe|database-unavailable/u,
    );
    assert.equal(existsSync(join(realState, 'classroom-hub.sqlite')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
