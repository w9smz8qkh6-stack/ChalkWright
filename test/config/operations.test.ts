import assert from 'node:assert/strict';
import test from 'node:test';

import { loadOperationsConfig } from '../../src/config/operations.js';

const valid = {
  CLASSROOM_HUB_INSTANCE_ID: 'synthetic-instance',
  CLASSROOM_HUB_OPERATIONS_SCOPE_ID: 'synthetic-operations',
  CLASSROOM_HUB_TIME_ZONE: 'America/New_York',
  CLASSROOM_HUB_MANAGED_ROOT: '/synthetic/classroom-hub',
  CLASSROOM_HUB_DATABASE_PATH: '/synthetic/classroom-hub/state/app.sqlite',
  CLASSROOM_HUB_BACKUP_DIRECTORY: '/synthetic/classroom-hub/backups',
  CLASSROOM_HUB_ACADEMIC_YEAR_END: '2035-06-15',
} satisfies NodeJS.ProcessEnv;

test('loads a bounded report-only operational configuration', () => {
  assert.deepEqual(loadOperationsConfig(valid), {
    instanceId: 'synthetic-instance',
    scopeId: 'synthetic-operations',
    timeZone: 'America/New_York',
    managedRoot: '/synthetic/classroom-hub',
    databasePath: '/synthetic/classroom-hub/state/app.sqlite',
    backupDirectory: '/synthetic/classroom-hub/backups',
    academicYearEnd: '2035-06-15',
    jobDeadlineSeconds: 300,
    alertDeliveryMode: 'report-only',
  });
});

test('requires explicit fake repeat policy without inventing production delivery', () => {
  assert.deepEqual(
    loadOperationsConfig({
      ...valid,
      CLASSROOM_HUB_ALERT_DELIVERY_MODE: 'fake',
      CLASSROOM_HUB_ALERT_REPEAT_SECONDS: '900',
    }).alertRepeatSeconds,
    900,
  );
  assert.throws(() =>
    loadOperationsConfig({
      ...valid,
      CLASSROOM_HUB_ALERT_DELIVERY_MODE: 'fake',
    }),
  );
  assert.throws(() =>
    loadOperationsConfig({
      ...valid,
      CLASSROOM_HUB_ALERT_REPEAT_SECONDS: '900',
    }),
  );
});

test('rejects missing, broad, escaping, nested, and malformed values', () => {
  const cases: NodeJS.ProcessEnv[] = [
    {},
    { ...valid, CLASSROOM_HUB_MANAGED_ROOT: '/' },
    { ...valid, CLASSROOM_HUB_DATABASE_PATH: '/outside/app.sqlite' },
    {
      ...valid,
      CLASSROOM_HUB_DATABASE_PATH:
        '/synthetic/classroom-hub/backups/app.sqlite',
    },
    { ...valid, CLASSROOM_HUB_TIME_ZONE: 'Mars/Olympus' },
    { ...valid, CLASSROOM_HUB_ACADEMIC_YEAR_END: '2035-02-30' },
    { ...valid, CLASSROOM_HUB_JOB_DEADLINE_SECONDS: '0' },
    { ...valid, CLASSROOM_HUB_INSTANCE_ID: '../escape' },
  ];
  for (const candidate of cases)
    assert.throws(() => loadOperationsConfig(candidate));
});

test('operational scope IDs exactly match the health-report scope contract', () => {
  assert.equal(loadOperationsConfig(valid).scopeId, 'synthetic-operations');
  assert.equal(
    loadOperationsConfig({
      ...valid,
      CLASSROOM_HUB_OPERATIONS_SCOPE_ID: `s${'a'.repeat(95)}`,
    }).scopeId.length,
    96,
  );
  for (const scopeId of ['screen:b407', `s${'a'.repeat(96)}`]) {
    assert.throws(
      () =>
        loadOperationsConfig({
          ...valid,
          CLASSROOM_HUB_OPERATIONS_SCOPE_ID: scopeId,
        }),
      /operational scope identifier/,
    );
  }
});
