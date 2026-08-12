import assert from 'node:assert/strict';
import test from 'node:test';

import {
  loadPowerSchoolBootstrapConfig,
  loadPowerSchoolCompatibilityConfig,
  loadPowerSchoolRoutineConfig,
  renderPowerSchoolBellPath,
} from '../../src/config/powerschool-session.js';

function commonEnvironment(): NodeJS.ProcessEnv {
  return {
    CLASSROOM_HUB_POWERSCHOOL_ORIGIN: 'https://powerschool.invalid',
    CLASSROOM_HUB_POWERSCHOOL_BELL_PATH_TEMPLATE:
      '/teachers/aet_schedulebell.html?target_date={date-us}',
    CLASSROOM_HUB_POWERSCHOOL_BELL_READY_SELECTOR: '#bell-ready',
    CLASSROOM_HUB_POWERSCHOOL_SESSION_DIRECTORY:
      '/tmp/classroom-hub-powerschool-session-test',
  };
}

test('loads routine policy without an identity or credential capability', () => {
  const config = loadPowerSchoolRoutineConfig({
    ...commonEnvironment(),
    CLASSROOM_HUB_POWERSCHOOL_ROOM_ID: 'room-synthetic',
    CLASSROOM_HUB_POWERSCHOOL_STATUS_PATH: '/teachers/home.html',
    CLASSROOM_HUB_POWERSCHOOL_STATUS_READY_SELECTOR: '#status-ready',
  });
  assert.equal(config.powerSchoolOrigin, 'https://powerschool.invalid');
  assert.equal(config.overallTimeoutMs, 120_000);
  assert.equal('identityOrigin' in config, false);
  assert.equal('credentials' in config, false);
});

test('loads the separate operator-present bootstrap policy', () => {
  const config = loadPowerSchoolBootstrapConfig({
    ...commonEnvironment(),
    CLASSROOM_HUB_POWERSCHOOL_IDENTITY_ORIGIN: 'https://accounts.google.com',
  });
  assert.equal(config.identityOrigin, 'https://accounts.google.com');
  assert.equal(config.overallTimeoutMs, 300_000);
  assert.deepEqual(config.allowedBootstrapResourceOrigins, [
    'https://powerschool.invalid',
    'https://accounts.google.com',
  ]);
  assert.equal('roomId' in config, false);
});

test('loads the separate persistent compatibility policy', () => {
  const config = loadPowerSchoolCompatibilityConfig({
    ...commonEnvironment(),
    CLASSROOM_HUB_POWERSCHOOL_ROOM_ID: 'room-synthetic',
    CLASSROOM_HUB_POWERSCHOOL_STATUS_PATH: '/teachers/home.html',
    CLASSROOM_HUB_POWERSCHOOL_STATUS_READY_SELECTOR: '#status-ready',
    CLASSROOM_HUB_POWERSCHOOL_IDENTITY_ORIGIN: 'https://accounts.google.com',
    CLASSROOM_HUB_POWERSCHOOL_COMPATIBILITY_PROFILE_DIRECTORY:
      '/tmp/classroom-hub-powerschool-compatibility-test',
  });
  assert.equal(config.identityOrigin, 'https://accounts.google.com');
  assert.equal(
    config.persistentProfileDirectory,
    '/tmp/classroom-hub-powerschool-compatibility-test',
  );
  assert.equal(config.overallTimeoutMs, 120_000);
  assert.equal('credentials' in config, false);
});

test('keeps the compatibility profile external and separate from filtered state', () => {
  const environment: NodeJS.ProcessEnv = {
    ...commonEnvironment(),
    CLASSROOM_HUB_POWERSCHOOL_ROOM_ID: 'room-synthetic',
    CLASSROOM_HUB_POWERSCHOOL_STATUS_PATH: '/teachers/home.html',
    CLASSROOM_HUB_POWERSCHOOL_STATUS_READY_SELECTOR: '#status-ready',
    CLASSROOM_HUB_POWERSCHOOL_IDENTITY_ORIGIN: 'https://accounts.google.com',
  };
  const sessionDirectory =
    environment.CLASSROOM_HUB_POWERSCHOOL_SESSION_DIRECTORY!;
  for (const profile of [
    sessionDirectory,
    `${sessionDirectory}/profile`,
    process.cwd(),
  ]) {
    assert.throws(
      () =>
        loadPowerSchoolCompatibilityConfig({
          ...environment,
          CLASSROOM_HUB_POWERSCHOOL_COMPATIBILITY_PROFILE_DIRECTORY: profile,
        }),
      /separate from the filtered session directory|outside the repository/u,
    );
  }
});

test('rejects cross-origin and ambiguous path contracts', () => {
  assert.throws(
    () =>
      loadPowerSchoolRoutineConfig({
        ...commonEnvironment(),
        CLASSROOM_HUB_POWERSCHOOL_ROOM_ID: 'room-synthetic',
        CLASSROOM_HUB_POWERSCHOOL_STATUS_PATH: '//other.invalid/status',
        CLASSROOM_HUB_POWERSCHOOL_STATUS_READY_SELECTOR: '#status-ready',
      }),
    /exact bounded same-origin path/u,
  );
  assert.throws(
    () =>
      loadPowerSchoolRoutineConfig({
        ...commonEnvironment(),
        CLASSROOM_HUB_POWERSCHOOL_ROOM_ID: 'room-synthetic',
        CLASSROOM_HUB_POWERSCHOOL_STATUS_PATH: '/teachers/home.html',
        CLASSROOM_HUB_POWERSCHOOL_STATUS_READY_SELECTOR: '#status-ready',
        CLASSROOM_HUB_POWERSCHOOL_BELL_PATH_TEMPLATE:
          '/bell?first={date}&second={date}',
      }),
    /exactly one date placeholder/u,
  );
  assert.throws(
    () =>
      loadPowerSchoolRoutineConfig({
        ...commonEnvironment(),
        CLASSROOM_HUB_POWERSCHOOL_ROOM_ID: 'room-synthetic',
        CLASSROOM_HUB_POWERSCHOOL_STATUS_PATH: '/different-status',
        CLASSROOM_HUB_POWERSCHOOL_STATUS_READY_SELECTOR: '#status-ready',
      }),
    /approved PowerSchool path contract/u,
  );
});

test('requires HTTPS outside loopback and durable state outside the repository', () => {
  assert.throws(
    () =>
      loadPowerSchoolRoutineConfig({
        ...commonEnvironment(),
        CLASSROOM_HUB_POWERSCHOOL_ORIGIN: 'http://powerschool.invalid',
        CLASSROOM_HUB_POWERSCHOOL_ROOM_ID: 'room-synthetic',
        CLASSROOM_HUB_POWERSCHOOL_STATUS_PATH: '/teachers/home.html',
        CLASSROOM_HUB_POWERSCHOOL_STATUS_READY_SELECTOR: '#status-ready',
      }),
    /must use HTTPS/u,
  );
  assert.throws(
    () =>
      loadPowerSchoolRoutineConfig({
        ...commonEnvironment(),
        CLASSROOM_HUB_POWERSCHOOL_ROOM_ID: 'room-synthetic',
        CLASSROOM_HUB_POWERSCHOOL_STATUS_PATH: '/teachers/home.html',
        CLASSROOM_HUB_POWERSCHOOL_STATUS_READY_SELECTOR: '#status-ready',
        CLASSROOM_HUB_POWERSCHOOL_SESSION_DIRECTORY: process.cwd(),
      }),
    /outside the repository/u,
  );
});

test('renders the exact PowerSchool US date query', () => {
  assert.equal(
    renderPowerSchoolBellPath(
      '/teachers/aet_schedulebell.html?target_date={date-us}',
      '2035-04-13',
    ),
    '/teachers/aet_schedulebell.html?target_date=04/13/2035',
  );
});
