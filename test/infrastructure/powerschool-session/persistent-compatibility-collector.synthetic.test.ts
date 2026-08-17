import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  statSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { PowerSchoolCompatibilityConfig } from '../../../src/config/powerschool-session.js';
import type { RoomId } from '../../../src/domain/identities.js';
import { launchPowerSchoolSessionContext } from '../../../src/infrastructure/powerschool-session/browser-runtime.js';
import { repairPowerSchoolSessionWithCredentials } from '../../../src/infrastructure/powerschool-session/jit-repair-browser.js';
import { collectPersistentPowerSchoolBell } from '../../../src/infrastructure/powerschool-session/persistent-compatibility-collector.js';
import { PersistentCompatibilityPowerSchoolBellScheduleSource } from '../../../src/infrastructure/powerschool-session/persistent-compatibility-source.js';
import {
  acquirePowerSchoolSessionLock,
  powerSchoolStatePath,
} from '../../../src/infrastructure/powerschool-session/protected-state.js';
import { startSyntheticPowerSchoolSessionServer } from '../../support/powerschool-session-server.js';
import type { SyntheticRoutineMode } from '../../support/powerschool-session-server.js';

const date = '2035-04-13';
const credentials = {
  username: 'teacher@example.invalid',
  password: 'synthetic-password',
  totp: '123456',
};

function compatibilityConfig(
  powerSchoolOrigin: string,
  identityOrigin: string,
  sessionDirectory: string,
  persistentProfileDirectory: string,
): PowerSchoolCompatibilityConfig {
  return {
    roomId: 'room-synthetic',
    powerSchoolOrigin,
    statusPath: '/status',
    statusReadySelector: '#status-ready',
    bellPathTemplate: '/bell?target_date={date-us}',
    bellReadySelector: '#bell-ready',
    expectedSchoolText: 'Synthetic Academy',
    sessionDirectory,
    persistentProfileDirectory,
    chromeExecutablePath: '/usr/bin/google-chrome',
    navigationTimeoutMs: 5_000,
    overallTimeoutMs: 15_000,
    maxResponseBytes: 2 * 1024 * 1024,
    utcOffset: 'Z',
    identityOrigin,
    allowedBootstrapResourceOrigins: [powerSchoolOrigin, identityOrigin],
    maxTopLevelRequests: 16,
  };
}

const headlessLauncher: typeof launchPowerSchoolSessionContext = (options) =>
  launchPowerSchoolSessionContext({ ...options, headless: true });

test('persistent profile silently renews an expired PowerSchool session without credentials', async () => {
  const server = await startSyntheticPowerSchoolSessionServer({
    repairFlow: 'credentials-totp',
  });
  const parent = mkdtempSync(join(tmpdir(), 'powerschool-compatibility-'));
  const sessionDirectory = join(parent, 'session');
  const persistentProfileDirectory = join(parent, 'persistent-profile');
  const config = compatibilityConfig(
    server.powerSchoolOrigin,
    server.identityOrigin,
    sessionDirectory,
    persistentProfileDirectory,
  );
  try {
    assert.deepEqual(
      await repairPowerSchoolSessionWithCredentials({
        config,
        requestedDate: date,
        credentials,
        persistentProfileDirectory,
        launchContext: headlessLauncher,
      }),
      { status: 'authenticated', phoneApprovalObserved: false },
    );
    assert.equal(existsSync(persistentProfileDirectory), true);
    assert.equal(statSync(persistentProfileDirectory).mode & 0o777, 0o700);
    rmSync(powerSchoolStatePath(sessionDirectory));

    const context = await headlessLauncher({
      profileDirectory: persistentProfileDirectory,
      chromeExecutablePath: config.chromeExecutablePath,
      headless: true,
      javaScriptEnabled: true,
      timeoutMs: config.navigationTimeoutMs,
      environment: { ...process.env, HOME: persistentProfileDirectory },
    });
    await context.clearCookies({ name: 'synthetic_powerschool_session' });
    await context.close();

    const identityBefore = server.requests.filter(
      (request) => request.origin === 'identity',
    ).length;
    const capture = await collectPersistentPowerSchoolBell({
      config,
      requestedDate: date,
      launchContext: headlessLauncher,
    });
    assert.equal(capture.status, 'captured', JSON.stringify(capture));
    if (capture.status === 'captured') {
      assert.equal(capture.capture.method, 'browser-read');
    }
    const silentIdentityRequests = server.requests
      .filter((request) => request.origin === 'identity')
      .slice(identityBefore);
    assert.deepEqual(
      silentIdentityRequests.map(({ method, path }) => ({
        method,
        pathname: new URL(path, server.identityOrigin).pathname,
      })),
      [{ method: 'GET', pathname: '/authorize' }],
    );

    const identityAfterSilentRenewal = server.requests.filter(
      (request) => request.origin === 'identity',
    ).length;
    const observed =
      await new PersistentCompatibilityPowerSchoolBellScheduleSource(config, {
        collect: (options) =>
          collectPersistentPowerSchoolBell({
            ...options,
            launchContext: headlessLauncher,
          }),
      }).readSchedule({
        date,
        roomId: 'room-synthetic' as RoomId,
      });
    assert.equal(observed.status, 'observed', JSON.stringify(observed));
    assert.deepEqual(
      server.requests
        .filter((request) => request.origin === 'identity')
        .slice(identityAfterSilentRenewal)
        .map(({ method, path }) => ({
          method,
          pathname: new URL(path, server.identityOrigin).pathname,
        })),
      [{ method: 'GET', pathname: '/authorize' }],
    );
    assert.equal(existsSync(persistentProfileDirectory), true);
    assert.equal(existsSync(powerSchoolStatePath(sessionDirectory)), false);
  } finally {
    await server.close();
    rmSync(parent, { recursive: true, force: true });
  }
});

test('empty persistent profile requests repair without submitting identity forms', async () => {
  const server = await startSyntheticPowerSchoolSessionServer({
    repairFlow: 'credentials-totp',
  });
  const parent = mkdtempSync(
    join(tmpdir(), 'powerschool-compatibility-empty-'),
  );
  const config = compatibilityConfig(
    server.powerSchoolOrigin,
    server.identityOrigin,
    join(parent, 'session'),
    join(parent, 'persistent-profile'),
  );
  try {
    assert.deepEqual(
      await collectPersistentPowerSchoolBell({
        config,
        requestedDate: date,
        launchContext: headlessLauncher,
      }),
      {
        status: 'repair-required',
        code: 'compatibility-authentication-required',
      },
    );
    assert.deepEqual(
      server.requests
        .filter((request) => request.origin === 'identity')
        .map(({ method, path }) => ({
          method,
          pathname: new URL(path, server.identityOrigin).pathname,
        })),
      [{ method: 'GET', pathname: '/authorize' }],
    );
  } finally {
    await server.close();
    rmSync(parent, { recursive: true, force: true });
  }
});

test('retained-profile production boundary rejects popup, download, POST, WebSocket, declared oversize, and top-level budget drift', async () => {
  const cases = [
    'popup',
    'download',
    'post',
    'websocket',
    'oversize',
    'top-level-budget',
  ] as const satisfies readonly (SyntheticRoutineMode | 'top-level-budget')[];
  const expectedReason = {
    popup: 'untrusted-navigation',
    download: 'download-attempted',
    post: 'powerschool-method-blocked',
    websocket: 'websocket-attempted',
    oversize: 'declared-response-oversize',
    'top-level-budget': 'top-level-budget-exceeded',
  } as const;
  for (const caseId of cases) {
    const server = await startSyntheticPowerSchoolSessionServer({
      repairFlow: 'credentials-totp',
      routineMode: caseId === 'top-level-budget' ? 'normal' : caseId,
    });
    const parent = mkdtempSync(
      join(tmpdir(), `powerschool-compatibility-${caseId}-`),
    );
    const config = compatibilityConfig(
      server.powerSchoolOrigin,
      server.identityOrigin,
      join(parent, 'session'),
      join(parent, 'persistent-profile'),
    );
    try {
      assert.deepEqual(
        await repairPowerSchoolSessionWithCredentials({
          config,
          requestedDate: date,
          credentials,
          persistentProfileDirectory: config.persistentProfileDirectory,
          launchContext: headlessLauncher,
        }),
        { status: 'authenticated', phoneApprovalObserved: false },
        caseId,
      );
      const result = await collectPersistentPowerSchoolBell({
        config: {
          ...config,
          ...(caseId === 'oversize' ? { maxResponseBytes: 1_024 } : {}),
          ...(caseId === 'top-level-budget' ? { maxTopLevelRequests: 1 } : {}),
        },
        requestedDate: date,
        launchContext: headlessLauncher,
      });
      assert.equal(result.status, 'failed', caseId);
      if (result.status === 'failed') {
        assert.equal(result.code, 'request-policy-violation', caseId);
        assert.equal(result.policyReason, expectedReason[caseId], caseId);
        assert.equal(result.retryable, false, caseId);
      }
    } finally {
      await server.close();
      rmSync(parent, { recursive: true, force: true });
    }
  }
});

test('unsafe persistent profile fails before browser launch and releases the shared lock', async () => {
  const parent = mkdtempSync(
    join(tmpdir(), 'powerschool-compatibility-unsafe-'),
  );
  const sessionDirectory = join(parent, 'session');
  const realProfile = join(parent, 'real-profile');
  const linkedProfile = join(parent, 'linked-profile');
  mkdirSync(realProfile, { mode: 0o700 });
  symlinkSync(realProfile, linkedProfile);
  const config = compatibilityConfig(
    'http://127.0.0.1:41001',
    'http://127.0.0.1:41002',
    sessionDirectory,
    linkedProfile,
  );
  try {
    let launched = false;
    assert.deepEqual(
      await collectPersistentPowerSchoolBell({
        config,
        requestedDate: date,
        launchContext: async () => {
          launched = true;
          throw new Error('must-not-launch');
        },
      }),
      { status: 'failed', code: 'session-state-unsafe', retryable: false },
    );
    assert.equal(launched, false);
    const lock = acquirePowerSchoolSessionLock(sessionDirectory);
    lock.release();
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});
