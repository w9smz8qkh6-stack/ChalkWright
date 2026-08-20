import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';

import type {
  PowerSchoolBootstrapConfig,
  PowerSchoolRoutineConfig,
} from '../../../src/config/powerschool-session.js';
import type { RoomId } from '../../../src/domain/identities.js';
import { PassivePowerSchoolBellScheduleSource } from '../../../src/infrastructure/powerschool-session/bell-schedule-source.js';
import { launchPowerSchoolSessionContext } from '../../../src/infrastructure/powerschool-session/browser-runtime.js';
import { repairPowerSchoolSessionWithCredentials } from '../../../src/infrastructure/powerschool-session/jit-repair-browser.js';
import {
  acquirePowerSchoolSessionLock,
  jitRepairTemporaryProfilePrefix,
  powerSchoolStatePath,
} from '../../../src/infrastructure/powerschool-session/protected-state.js';
import { startSyntheticPowerSchoolSessionServer } from '../../support/powerschool-session-server.js';

const date = '2035-04-13';
const credentials = {
  username: 'teacher@example.invalid',
  password: 'synthetic-password',
  totp: '123456',
};

function repairConfig(
  powerSchoolOrigin: string,
  identityOrigin: string,
  sessionDirectory: string,
  overallTimeoutMs = 30_000,
): PowerSchoolBootstrapConfig {
  return {
    powerSchoolOrigin,
    bellPathTemplate: '/bell?target_date={date-us}',
    bellReadySelector: '#bell-ready',
    expectedSchoolText: 'Synthetic Academy',
    sessionDirectory,
    chromeExecutablePath: '/usr/bin/google-chrome',
    navigationTimeoutMs: Math.min(overallTimeoutMs, 10_000),
    maxResponseBytes: 2 * 1024 * 1024,
    identityOrigin,
    allowedBootstrapResourceOrigins: [powerSchoolOrigin, identityOrigin],
    overallTimeoutMs,
    maxTopLevelRequests: 16,
  };
}

function routineConfig(
  powerSchoolOrigin: string,
  sessionDirectory: string,
): PowerSchoolRoutineConfig {
  return {
    roomId: 'room-synthetic',
    powerSchoolOrigin,
    statusPath: '/status',
    statusReadySelector: '#status-ready',
    bellPathTemplate: '/bell?target_date={date-us}',
    bellReadySelector: '#bell-ready',
    expectedSchoolText: 'Synthetic Academy',
    sessionDirectory,
    chromeExecutablePath: '/usr/bin/google-chrome',
    navigationTimeoutMs: 5_000,
    overallTimeoutMs: 10_000,
    maxResponseBytes: 2 * 1024 * 1024,
    utcOffset: 'Z',
  };
}

function profiles(): string[] {
  return readdirSync(tmpdir())
    .filter((name) => name.startsWith(jitRepairTemporaryProfilePrefix))
    .sort();
}

async function waitForProfiles(expected: readonly string[]): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (JSON.stringify(profiles()) === JSON.stringify(expected)) return;
    await sleep(100);
  }
  assert.deepEqual(profiles(), expected);
}

const headlessLauncher: typeof launchPowerSchoolSessionContext = (options) =>
  launchPowerSchoolSessionContext({ ...options, headless: true });

const navigationInterruptedLauncher: typeof launchPowerSchoolSessionContext =
  async (options) => {
    const context = await headlessLauncher(options);
    const page = context.pages()[0] ?? (await context.newPage());
    const goto = page.goto.bind(page);
    let firstNavigation = true;
    page.goto = async (...arguments_) => {
      const response = await goto(...arguments_);
      if (firstNavigation) {
        firstNavigation = false;
        throw new Error('synthetic-navigation-interrupted');
      }
      return response;
    };
    return context;
  };

test('fixed username/password/TOTP repair retains only PowerSchool state and enables routine reuse', async () => {
  const server = await startSyntheticPowerSchoolSessionServer({
    repairFlow: 'credentials-totp',
  });
  const parent = mkdtempSync(join(tmpdir(), 'jit-repair-success-'));
  const sessionDirectory = join(parent, 'session');
  const before = profiles();
  try {
    const result = await repairPowerSchoolSessionWithCredentials({
      config: repairConfig(
        server.powerSchoolOrigin,
        server.identityOrigin,
        sessionDirectory,
      ),
      requestedDate: date,
      credentials,
      launchContext: headlessLauncher,
    });
    assert.deepEqual(result, {
      status: 'authenticated',
      phoneApprovalObserved: false,
    });
    const state = readFileSync(powerSchoolStatePath(sessionDirectory), 'utf8');
    assert.equal(state.includes(server.identityOrigin), false);
    assert.equal(state.includes('synthetic_identity'), false);
    assert.equal(state.includes(credentials.username), false);
    assert.equal(state.includes(credentials.password), false);
    assert.equal(state.includes(credentials.totp), false);
    await waitForProfiles(before);
    assert.deepEqual(
      server.requests
        .filter((request) => request.origin === 'identity')
        .map(({ method, path }) => ({
          method,
          path: new URL(path, server.identityOrigin).pathname,
        })),
      [
        { method: 'GET', path: '/authorize' },
        { method: 'POST', path: '/identifier' },
        { method: 'POST', path: '/password' },
        { method: 'POST', path: '/totp' },
      ],
    );

    const identityRequests = server.requests.filter(
      (request) => request.origin === 'identity',
    ).length;
    const routine = await new PassivePowerSchoolBellScheduleSource(
      routineConfig(server.powerSchoolOrigin, sessionDirectory),
      {
        environment: {
          PATH: process.env.PATH,
          OP_SERVICE_ACCOUNT_TOKEN: 'must-not-reach-routine',
        },
      },
    ).readSchedule({
      date,
      roomId: 'room-synthetic' as RoomId,
    });
    assert.equal(routine.status, 'observed', JSON.stringify(routine));
    assert.equal(
      server.requests.filter((request) => request.origin === 'identity').length,
      identityRequests,
    );
    await waitForProfiles(before);
  } finally {
    await server.close();
    rmSync(parent, { recursive: true, force: true });
  }
});

test('repair reserves a bounded startup allowance without extending page navigation', async () => {
  const server = await startSyntheticPowerSchoolSessionServer({
    repairFlow: 'credentials-totp',
  });
  const parent = mkdtempSync(join(tmpdir(), 'jit-repair-launch-budget-'));
  const sessionDirectory = join(parent, 'session');
  let observedLaunchTimeoutMs: number | undefined;
  try {
    const result = await repairPowerSchoolSessionWithCredentials({
      config: repairConfig(
        server.powerSchoolOrigin,
        server.identityOrigin,
        sessionDirectory,
        60_000,
      ),
      requestedDate: date,
      credentials,
      launchContext: async (options) => {
        observedLaunchTimeoutMs = options.timeoutMs;
        return await headlessLauncher(options);
      },
    });
    assert.deepEqual(result, {
      status: 'authenticated',
      phoneApprovalObserved: false,
    });
    assert.equal(observedLaunchTimeoutMs, 30_000);
  } finally {
    rmSync(parent, { force: true, recursive: true });
    await server.close();
  }
});

test('native repair and credential-free routine reuse one normalized Chrome request identity', async () => {
  const server = await startSyntheticPowerSchoolSessionServer({
    repairFlow: 'credentials-totp',
    bindSessionToUserAgent: true,
    requireBrowserNavigationForBell: true,
    browserBellSubresource: true,
  });
  const parent = mkdtempSync(join(tmpdir(), 'jit-repair-user-agent-'));
  const sessionDirectory = join(parent, 'session');
  try {
    assert.deepEqual(
      await repairPowerSchoolSessionWithCredentials({
        config: repairConfig(
          server.powerSchoolOrigin,
          server.identityOrigin,
          sessionDirectory,
        ),
        requestedDate: date,
        credentials,
        headless: true,
      }),
      { status: 'authenticated', phoneApprovalObserved: false },
    );
    const subresourceRequestsBeforeRoutine = server.requests.filter(
      (request) => request.path === '/browser-native-subresource',
    ).length;
    const routine = await new PassivePowerSchoolBellScheduleSource(
      routineConfig(server.powerSchoolOrigin, sessionDirectory),
    ).readSchedule({
      date,
      roomId: 'room-synthetic' as RoomId,
    });
    assert.equal(routine.status, 'observed', JSON.stringify(routine));
    if (routine.status === 'observed') {
      assert.equal(routine.observation.provenance.method, 'browser-read');
    }
    const authenticatedRequests = server.requests.filter(
      (request) =>
        request.origin === 'powerschool' &&
        (request.path.startsWith('/auth/callback') ||
          request.path.startsWith('/status') ||
          request.path.startsWith('/bell')),
    );
    assert.ok(authenticatedRequests.length >= 4);
    for (const request of authenticatedRequests) {
      assert.match(request.userAgent ?? '', /\bChrome\/\d+/u);
      assert.doesNotMatch(request.userAgent ?? '', /HeadlessChrome/u);
    }
    const routineBellRequests = authenticatedRequests.filter((request) =>
      request.path.startsWith('/bell'),
    );
    assert.ok(routineBellRequests.length >= 4);
    assert.equal(routineBellRequests.at(-2)?.method, 'GET');
    assert.equal(
      routineBellRequests.at(-2)?.path,
      '/bell?target_date=04/13/2035',
    );
    assert.equal(routineBellRequests.at(-1)?.method, 'GET');
    assert.equal(
      routineBellRequests.at(-1)?.path,
      '/bell?target_date=04/13/2035',
    );
    assert.equal(
      server.requests.filter(
        (request) => request.path === '/browser-native-subresource',
      ).length,
      subresourceRequestsBeforeRoutine,
    );
  } finally {
    await server.close();
    rmSync(parent, { recursive: true, force: true });
  }
});

test('recognized Google challenge-selection password and authenticator choices complete without broad interaction', async () => {
  const server = await startSyntheticPowerSchoolSessionServer({
    repairFlow: 'challenge-selection',
  });
  const parent = mkdtempSync(join(tmpdir(), 'jit-repair-selection-'));
  const before = profiles();
  try {
    assert.deepEqual(
      await repairPowerSchoolSessionWithCredentials({
        config: repairConfig(
          server.powerSchoolOrigin,
          server.identityOrigin,
          join(parent, 'session'),
        ),
        requestedDate: date,
        credentials,
        launchContext: headlessLauncher,
      }),
      { status: 'authenticated', phoneApprovalObserved: false },
    );
    assert.deepEqual(
      server.requests
        .filter((request) => request.origin === 'identity')
        .map(({ method, path }) => ({
          method,
          path: new URL(path, server.identityOrigin).pathname,
        })),
      [
        { method: 'GET', path: '/authorize' },
        { method: 'POST', path: '/identifier' },
        { method: 'GET', path: '/challenge/selection/password' },
        { method: 'GET', path: '/challenge/pwd' },
        { method: 'POST', path: '/password' },
        { method: 'GET', path: '/challenge/selection/totp' },
        { method: 'GET', path: '/challenge/totp' },
        { method: 'POST', path: '/totp' },
      ],
    );
    await waitForProfiles(before);
  } finally {
    await server.close();
    rmSync(parent, { recursive: true, force: true });
  }
});

test('one explicit Try another way transition may reveal the recognized authenticator choice', async () => {
  const server = await startSyntheticPowerSchoolSessionServer({
    repairFlow: 'try-another-totp',
  });
  const parent = mkdtempSync(join(tmpdir(), 'jit-repair-alternate-'));
  const before = profiles();
  try {
    assert.deepEqual(
      await repairPowerSchoolSessionWithCredentials({
        config: repairConfig(
          server.powerSchoolOrigin,
          server.identityOrigin,
          join(parent, 'session'),
        ),
        requestedDate: date,
        credentials,
        launchContext: headlessLauncher,
      }),
      { status: 'authenticated', phoneApprovalObserved: false },
    );
    assert.deepEqual(
      server.requests
        .filter((request) => request.origin === 'identity')
        .map(({ method, path }) => ({
          method,
          path: new URL(path, server.identityOrigin).pathname,
        })),
      [
        { method: 'GET', path: '/authorize' },
        { method: 'POST', path: '/identifier' },
        { method: 'POST', path: '/password' },
        { method: 'GET', path: '/challenge/security-key' },
        { method: 'GET', path: '/challenge/selection/totp' },
        { method: 'GET', path: '/challenge/totp' },
        { method: 'POST', path: '/totp' },
      ],
    );
    await waitForProfiles(before);
  } finally {
    await server.close();
    rmSync(parent, { recursive: true, force: true });
  }
});

test('an interrupted initial navigation may continue only from a recognized provider origin', async () => {
  const server = await startSyntheticPowerSchoolSessionServer({
    repairFlow: 'credentials-totp',
  });
  const parent = mkdtempSync(join(tmpdir(), 'jit-repair-navigation-'));
  const before = profiles();
  try {
    assert.deepEqual(
      await repairPowerSchoolSessionWithCredentials({
        config: repairConfig(
          server.powerSchoolOrigin,
          server.identityOrigin,
          join(parent, 'session'),
        ),
        requestedDate: date,
        credentials,
        launchContext: navigationInterruptedLauncher,
      }),
      { status: 'authenticated', phoneApprovalObserved: false },
    );
    await waitForProfiles(before);
  } finally {
    await server.close();
    rmSync(parent, { recursive: true, force: true });
  }
});

test('an explicitly allowed resource iframe is not treated as a top-level navigation', async () => {
  const server = await startSyntheticPowerSchoolSessionServer({
    repairFlow: 'credentials-totp',
    bootstrapResourceIframe: true,
  });
  const parent = mkdtempSync(join(tmpdir(), 'jit-repair-resource-frame-'));
  const before = profiles();
  try {
    const config = repairConfig(
      server.powerSchoolOrigin,
      server.identityOrigin,
      join(parent, 'session'),
    );
    assert.deepEqual(
      await repairPowerSchoolSessionWithCredentials({
        config: {
          ...config,
          allowedBootstrapResourceOrigins: [
            ...config.allowedBootstrapResourceOrigins,
            server.foreignOrigin,
          ],
        },
        requestedDate: date,
        credentials,
        launchContext: headlessLauncher,
      }),
      { status: 'authenticated', phoneApprovalObserved: false },
    );
    assert.deepEqual(
      server.requests
        .filter((request) => request.origin === 'foreign')
        .map(({ method, path }) => ({ method, path })),
      [{ method: 'GET', path: '/resource-frame' }],
    );
    await waitForProfiles(before);
  } finally {
    await server.close();
    rmSync(parent, { recursive: true, force: true });
  }
});

test('only an actual browser launch failure is reported separately', async () => {
  const server = await startSyntheticPowerSchoolSessionServer();
  const parent = mkdtempSync(join(tmpdir(), 'jit-repair-launch-'));
  const before = profiles();
  try {
    assert.deepEqual(
      await repairPowerSchoolSessionWithCredentials({
        config: {
          ...repairConfig(
            server.powerSchoolOrigin,
            server.identityOrigin,
            join(parent, 'session'),
          ),
          chromeExecutablePath: '/missing/classroom-hub-google-chrome',
        },
        requestedDate: date,
        credentials,
        headless: true,
      }),
      { status: 'failed', code: 'browser-launch-failed' },
    );
    await waitForProfiles(before);
  } finally {
    await server.close();
    rmSync(parent, { recursive: true, force: true });
  }
});

test('a failed managed-context launch is reported without browser detail', async () => {
  const server = await startSyntheticPowerSchoolSessionServer();
  const parent = mkdtempSync(join(tmpdir(), 'jit-repair-cdp-unreachable-'));
  const before = profiles();
  try {
    assert.deepEqual(
      await repairPowerSchoolSessionWithCredentials({
        config: repairConfig(
          server.powerSchoolOrigin,
          server.identityOrigin,
          join(parent, 'session'),
        ),
        requestedDate: date,
        credentials,
        launchContext: async () => {
          throw new Error('managed browser launch failed');
        },
      }),
      { status: 'failed', code: 'browser-launch-failed' },
    );
    await waitForProfiles(before);
  } finally {
    await server.close();
    rmSync(parent, { recursive: true, force: true });
  }
});

test('a closed managed browser returns a finite launch diagnostic', async () => {
  const server = await startSyntheticPowerSchoolSessionServer();
  const parent = mkdtempSync(join(tmpdir(), 'jit-repair-launch-closed-'));
  const before = profiles();
  try {
    assert.deepEqual(
      await repairPowerSchoolSessionWithCredentials({
        config: repairConfig(
          server.powerSchoolOrigin,
          server.identityOrigin,
          join(parent, 'session'),
        ),
        requestedDate: date,
        credentials,
        launchContext: async () => {
          throw new Error('Target page, context or browser has been closed');
        },
      }),
      { status: 'failed', code: 'browser-launch-closed' },
    );
    await waitForProfiles(before);
  } finally {
    await server.close();
    rmSync(parent, { recursive: true, force: true });
  }
});

test('phone approval is observed passively and the browser completes after external approval', async () => {
  const server = await startSyntheticPowerSchoolSessionServer({
    repairFlow: 'phone-approval',
  });
  const parent = mkdtempSync(join(tmpdir(), 'jit-repair-phone-'));
  const before = profiles();
  try {
    assert.deepEqual(
      await repairPowerSchoolSessionWithCredentials({
        config: repairConfig(
          server.powerSchoolOrigin,
          server.identityOrigin,
          join(parent, 'session'),
        ),
        requestedDate: date,
        credentials,
        launchContext: headlessLauncher,
      }),
      { status: 'authenticated', phoneApprovalObserved: true },
    );
    await waitForProfiles(before);
  } finally {
    await server.close();
    rmSync(parent, { recursive: true, force: true });
  }
});

test('a delayed recognized identity step is observed without acting on transitional markup', async () => {
  const server = await startSyntheticPowerSchoolSessionServer({
    repairFlow: 'delayed-totp',
  });
  const parent = mkdtempSync(join(tmpdir(), 'jit-repair-delayed-step-'));
  const before = profiles();
  try {
    assert.deepEqual(
      await repairPowerSchoolSessionWithCredentials({
        config: repairConfig(
          server.powerSchoolOrigin,
          server.identityOrigin,
          join(parent, 'session'),
        ),
        requestedDate: date,
        credentials,
        headless: true,
      }),
      { status: 'authenticated', phoneApprovalObserved: false },
    );
    assert.deepEqual(profiles(), before);
  } finally {
    await server.close();
    rmSync(parent, { recursive: true, force: true });
  }
});

test('unknown challenge and popup-to-foreign-origin fail closed and delete the profile', async () => {
  for (const options of [
    { repairFlow: 'bad-password' as const },
    { repairFlow: 'unknown-challenge' as const },
    { repairFlow: 'credentials-totp' as const, bootstrapPopup: true },
  ]) {
    const server = await startSyntheticPowerSchoolSessionServer(options);
    const parent = mkdtempSync(join(tmpdir(), 'jit-repair-refusal-'));
    const before = profiles();
    try {
      const result = await repairPowerSchoolSessionWithCredentials({
        config: repairConfig(
          server.powerSchoolOrigin,
          server.identityOrigin,
          join(parent, 'session'),
          options.repairFlow === 'unknown-challenge' ? 15_000 : 10_000,
        ),
        requestedDate: date,
        credentials,
        launchContext: headlessLauncher,
      });
      assert.equal(result.status, 'failed');
      if (options.repairFlow === 'unknown-challenge') {
        assert.deepEqual(result, {
          status: 'failed',
          code: 'unexpected-challenge',
          challengeCategory: 'passkey-or-security-key-required',
        });
      }
      assert.equal(
        server.requests.filter((request) => request.origin === 'foreign')
          .length,
        0,
      );
      await waitForProfiles(before);
    } finally {
      await server.close();
      rmSync(parent, { recursive: true, force: true });
    }
  }
});

test('abort, timeout, and concurrency refusal leave no disposable profile', async () => {
  const server = await startSyntheticPowerSchoolSessionServer({
    bootstrapStalls: true,
  });
  const parent = mkdtempSync(join(tmpdir(), 'jit-repair-bounds-'));
  const before = profiles();
  try {
    const abort = new AbortController();
    setTimeout(() => abort.abort('synthetic-abort'), 250);
    assert.deepEqual(
      await repairPowerSchoolSessionWithCredentials({
        config: repairConfig(
          server.powerSchoolOrigin,
          server.identityOrigin,
          join(parent, 'abort'),
          5_000,
        ),
        requestedDate: date,
        credentials,
        signal: abort.signal,
        headless: true,
      }),
      { status: 'failed', code: 'aborted' },
    );
    assert.deepEqual(
      await repairPowerSchoolSessionWithCredentials({
        config: repairConfig(
          server.powerSchoolOrigin,
          server.identityOrigin,
          join(parent, 'timeout'),
          300,
        ),
        requestedDate: date,
        credentials,
        headless: true,
      }),
      { status: 'failed', code: 'timeout' },
    );
    const lockedDirectory = join(parent, 'locked');
    const lock = acquirePowerSchoolSessionLock(lockedDirectory);
    try {
      assert.deepEqual(
        await repairPowerSchoolSessionWithCredentials({
          config: repairConfig(
            server.powerSchoolOrigin,
            server.identityOrigin,
            lockedDirectory,
          ),
          requestedDate: date,
          credentials,
          launchContext: headlessLauncher,
        }),
        { status: 'failed', code: 'collector-already-running' },
      );
    } finally {
      lock.release();
    }
    await waitForProfiles(before);
  } finally {
    await server.close();
    rmSync(parent, { recursive: true, force: true });
  }
});
