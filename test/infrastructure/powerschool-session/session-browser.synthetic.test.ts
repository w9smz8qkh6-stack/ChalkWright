import assert from 'node:assert/strict';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type {
  PowerSchoolBootstrapConfig,
  PowerSchoolRoutineConfig,
} from '../../../src/config/powerschool-session.js';
import type { RoomId } from '../../../src/domain/identities.js';
import { runPowerSchoolBellSupervisor } from '../../../src/entrypoints/powerschool-bell-collector.js';
import { PassivePowerSchoolBellScheduleSource } from '../../../src/infrastructure/powerschool-session/bell-schedule-source.js';
import { launchPowerSchoolSessionContext } from '../../../src/infrastructure/powerschool-session/browser-runtime.js';
import { bootstrapPowerSchoolSession } from '../../../src/infrastructure/powerschool-session/manual-bootstrap.js';
import { collectPassivePowerSchoolBell } from '../../../src/infrastructure/powerschool-session/passive-collector.js';
import {
  acquirePowerSchoolSessionLock,
  powerSchoolStatePath,
  temporaryProfilePrefix,
  writeFilteredPowerSchoolState,
  type FilteredPowerSchoolStorageState,
} from '../../../src/infrastructure/powerschool-session/protected-state.js';
import {
  startSyntheticPowerSchoolSessionServer,
  type SyntheticRoutineMode,
} from '../../support/powerschool-session-server.js';

const date = '2035-04-13';
const minimumSupportedChromeMajor = 150;

function bootstrapConfig(
  powerSchoolOrigin: string,
  identityOrigin: string,
  sessionDirectory: string,
): PowerSchoolBootstrapConfig {
  return {
    powerSchoolOrigin,
    bellPathTemplate: '/bell?target_date={date-us}',
    bellReadySelector: '#bell-ready',
    expectedSchoolText: 'Synthetic Academy',
    sessionDirectory,
    chromeExecutablePath: '/usr/bin/google-chrome',
    navigationTimeoutMs: 5_000,
    maxResponseBytes: 2 * 1024 * 1024,
    identityOrigin,
    allowedBootstrapResourceOrigins: [powerSchoolOrigin, identityOrigin],
    overallTimeoutMs: 10_000,
    maxTopLevelRequests: 16,
  };
}

function routineConfig(
  powerSchoolOrigin: string,
  sessionDirectory: string,
  overrides: Partial<PowerSchoolRoutineConfig> = {},
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
    ...overrides,
  };
}

function temporaryProfiles(): string[] {
  return readdirSync(tmpdir())
    .filter((name) => name.startsWith(temporaryProfilePrefix))
    .sort();
}

function seedState(directory: string, origin: string, value = 'valid'): void {
  const host = new URL(origin).hostname;
  const state: FilteredPowerSchoolStorageState = {
    cookies: [
      {
        name: 'synthetic_powerschool_session',
        value,
        domain: host,
        path: '/',
        expires: -1,
        httpOnly: true,
        secure: false,
        sameSite: 'Lax',
      },
    ],
    origins: [
      {
        origin,
        localStorage: [
          { name: 'synthetic_powerschool_storage', value: 'seeded' },
        ],
      },
    ],
  };
  writeFilteredPowerSchoolState(directory, origin, state);
}

test('manual bootstrap filters Google state, deletes its profile, and enables credential-free routine reads', async () => {
  const server = await startSyntheticPowerSchoolSessionServer();
  const parent = mkdtempSync(join(tmpdir(), 'm07c-browser-success-'));
  const sessionDirectory = join(parent, 'session');
  const beforeProfiles = temporaryProfiles();
  try {
    const bootstrap = await bootstrapPowerSchoolSession({
      config: bootstrapConfig(
        server.powerSchoolOrigin,
        server.identityOrigin,
        sessionDirectory,
      ),
      requestedDate: date,
      launchContext: (options) =>
        launchPowerSchoolSessionContext({ ...options, headless: true }),
    });
    assert.deepEqual(bootstrap, { status: 'authenticated' });
    const statePath = powerSchoolStatePath(sessionDirectory);
    const state = readFileSync(statePath, 'utf8');
    const saved = JSON.parse(state) as FilteredPowerSchoolStorageState;
    assert.equal(state.includes(server.identityOrigin), false);
    assert.equal(state.includes('synthetic_identity_session'), false);
    assert.equal(state.includes('synthetic_identity_storage'), false);
    assert.equal(saved.origins[0]?.origin, server.powerSchoolOrigin);
    assert.deepEqual(saved.origins[0]?.localStorage, [
      {
        name: 'synthetic_powerschool_storage',
        value: 'powerschool-only',
      },
    ]);
    assert.equal(statSync(statePath).mode & 0o777, 0o600);
    assert.deepEqual(temporaryProfiles(), beforeProfiles);

    const identityRequests = server.requests.filter(
      (request) => request.origin === 'identity',
    ).length;
    const routineRequestStart = server.requests.length;
    const source = new PassivePowerSchoolBellScheduleSource(
      routineConfig(server.powerSchoolOrigin, sessionDirectory),
      {
        environment: {
          PATH: process.env.PATH,
          OP_SERVICE_ACCOUNT_TOKEN: 'must-not-reach-chrome',
          CLASSROOM_HUB_POWERSCHOOL_GOOGLE_PASSWORD: 'must-not-reach-chrome',
        },
      },
    );
    const result = await source.readSchedule({
      date,
      roomId: 'room-synthetic' as RoomId,
    });
    assert.equal(result.status, 'observed', JSON.stringify(result));
    if (result.status === 'observed') {
      assert.equal(result.observation.periods.length, 2);
      assert.equal(result.observation.provenance.method, 'session-http');
      assert.equal(result.observation.verification, 'verified');
    }
    assert.equal(
      server.requests.filter((request) => request.origin === 'identity').length,
      identityRequests,
    );
    assert.match(
      readFileSync(statePath, 'utf8'),
      /synthetic_powerschool_session[^}]*refreshed/u,
    );
    assert.equal(
      readFileSync(statePath, 'utf8').includes('powerschool-only'),
      true,
    );
    const secondResult = await source.readSchedule({
      date,
      roomId: 'room-synthetic' as RoomId,
    });
    assert.equal(secondResult.status, 'observed', JSON.stringify(secondResult));
    const routineRequests = server.requests
      .slice(routineRequestStart)
      .filter(
        (request) =>
          request.origin === 'powerschool' &&
          (request.path.startsWith('/status') ||
            request.path.startsWith('/teachers/home.html') ||
            request.path.startsWith('/bell') ||
            request.path.startsWith('/teachers/aet_schedulebell.html')),
      );
    assert.equal(routineRequests.length, 4);
    for (const request of routineRequests) {
      assert.equal(request.referer, `${server.powerSchoolOrigin}/`);
      assertSupportedChromeUserAgent(request.userAgent ?? '');
      assert.doesNotMatch(request.userAgent ?? '', /HeadlessChrome/u);
    }
    assert.deepEqual(
      server.requests.filter(
        (request) =>
          request.origin === 'powerschool' &&
          request.method !== 'GET' &&
          request.method !== 'HEAD',
      ),
      [],
    );
    assert.deepEqual(temporaryProfiles(), beforeProfiles);
  } finally {
    await server.close();
    rmSync(parent, { recursive: true, force: true });
  }
});

function assertSupportedChromeUserAgent(userAgent: string): void {
  const match = /\bChrome\/(\d+)\./u.exec(userAgent);
  const major = Number.parseInt(match?.[1] ?? '', 10);
  assert.ok(
    Number.isInteger(major) && major >= minimumSupportedChromeMajor,
    `unsupported Chrome user agent ${userAgent}`,
  );
}

test('an authenticated exact-date bell page with no entries yields a verified no-class observation', async () => {
  const server = await startSyntheticPowerSchoolSessionServer({
    routineMode: 'no-classes',
  });
  const parent = mkdtempSync(join(tmpdir(), 'm07c-browser-no-classes-'));
  const sessionDirectory = join(parent, 'session');
  const beforeProfiles = temporaryProfiles();
  try {
    seedState(sessionDirectory, server.powerSchoolOrigin);
    const source = new PassivePowerSchoolBellScheduleSource(
      routineConfig(server.powerSchoolOrigin, sessionDirectory),
    );
    const result = await source.readSchedule({
      date,
      roomId: 'room-synthetic' as RoomId,
    });
    assert.equal(result.status, 'observed', JSON.stringify(result));
    if (result.status === 'observed') {
      assert.equal(result.observation.kind, 'no-classes');
      assert.deepEqual(result.observation.periods, []);
      assert.equal(result.observation.verification, 'verified');
      assert.equal(
        result.observation.diagnostics[0]?.code,
        'schedule-no-classes',
      );
    }
    assert.equal(
      server.requests.filter((request) => request.origin === 'identity').length,
      0,
    );
    assert.deepEqual(temporaryProfiles(), beforeProfiles);
  } finally {
    await server.close();
    rmSync(parent, { recursive: true, force: true });
  }
});

test('manual bootstrap cleans up after a browser launch failure', async () => {
  const server = await startSyntheticPowerSchoolSessionServer();
  const parent = mkdtempSync(join(tmpdir(), 'm07c-bootstrap-failures-'));
  const beforeProfiles = temporaryProfiles();
  try {
    const launchFailure = await bootstrapPowerSchoolSession({
      config: bootstrapConfig(
        server.powerSchoolOrigin,
        server.identityOrigin,
        join(parent, 'launch'),
      ),
      requestedDate: date,
      launchContext: async () => {
        throw new Error('synthetic-launch-failure');
      },
    });
    assert.deepEqual(launchFailure, {
      status: 'failed',
      code: 'browser-unavailable',
    });
    assert.deepEqual(temporaryProfiles(), beforeProfiles);
  } finally {
    await server.close();
    rmSync(parent, { recursive: true, force: true });
  }
});

test('manual bootstrap safely re-fulfills an encoded identity response', async () => {
  const server = await startSyntheticPowerSchoolSessionServer({
    gzipIdentityPage: true,
  });
  const parent = mkdtempSync(join(tmpdir(), 'm07c-bootstrap-gzip-'));
  const beforeProfiles = temporaryProfiles();
  try {
    const result = await bootstrapPowerSchoolSession({
      config: bootstrapConfig(
        server.powerSchoolOrigin,
        server.identityOrigin,
        join(parent, 'session'),
      ),
      requestedDate: date,
      launchContext: (options) =>
        launchPowerSchoolSessionContext({ ...options, headless: true }),
    });
    assert.deepEqual(result, { status: 'authenticated' });
    assert.deepEqual(temporaryProfiles(), beforeProfiles);
  } finally {
    await server.close();
    rmSync(parent, { recursive: true, force: true });
  }
});

test('manual bootstrap deletes its temporary profile after abort and timeout', async () => {
  const server = await startSyntheticPowerSchoolSessionServer({
    bootstrapStalls: true,
  });
  const parent = mkdtempSync(join(tmpdir(), 'm07c-browser-cleanup-'));
  const beforeProfiles = temporaryProfiles();
  try {
    const abortController = new AbortController();
    setTimeout(() => abortController.abort('synthetic-abort'), 400);
    const aborted = await bootstrapPowerSchoolSession({
      config: {
        ...bootstrapConfig(
          server.powerSchoolOrigin,
          server.identityOrigin,
          join(parent, 'abort-session'),
        ),
        overallTimeoutMs: 5_000,
      },
      requestedDate: date,
      signal: abortController.signal,
      launchContext: (options) =>
        launchPowerSchoolSessionContext({ ...options, headless: true }),
    });
    assert.deepEqual(aborted, { status: 'failed', code: 'aborted' });
    assert.deepEqual(temporaryProfiles(), beforeProfiles);

    const timedOut = await bootstrapPowerSchoolSession({
      config: {
        ...bootstrapConfig(
          server.powerSchoolOrigin,
          server.identityOrigin,
          join(parent, 'timeout-session'),
        ),
        overallTimeoutMs: 500,
      },
      requestedDate: date,
      launchContext: (options) =>
        launchPowerSchoolSessionContext({ ...options, headless: true }),
    });
    assert.deepEqual(timedOut, { status: 'failed', code: 'timeout' });
    assert.deepEqual(temporaryProfiles(), beforeProfiles);
  } finally {
    await server.close();
    rmSync(parent, { recursive: true, force: true });
  }
});

test('expired state returns repair-required without reaching identity or retaining a profile', async () => {
  const server = await startSyntheticPowerSchoolSessionServer();
  const parent = mkdtempSync(join(tmpdir(), 'm07c-browser-expired-'));
  const sessionDirectory = join(parent, 'session');
  const beforeProfiles = temporaryProfiles();
  try {
    seedState(sessionDirectory, server.powerSchoolOrigin, 'expired');
    const result = await collectPassivePowerSchoolBell({
      config: routineConfig(server.powerSchoolOrigin, sessionDirectory),
      requestedDate: date,
    });
    assert.deepEqual(result, {
      status: 'repair-required',
      code: 'bell-session-redirect-authentication',
    });
    assert.equal(
      server.requests.some((request) => request.origin === 'identity'),
      false,
    );
    assert.deepEqual(
      server.requests
        .filter((request) => request.origin === 'powerschool')
        .map((request) => request.path),
      [
        '/status',
        '/bell?target_date=04/13/2035',
        '/bell?target_date=04/13/2035',
      ],
    );
    assert.deepEqual(temporaryProfiles(), beforeProfiles);
  } finally {
    await server.close();
    rmSync(parent, { recursive: true, force: true });
  }
});

for (const scenario of [
  {
    mode: 'status-unauthorized',
    code: 'status-session-unauthorized',
  },
  { mode: 'status-forbidden', code: 'status-session-forbidden' },
] as const) {
  test(`sanitizes a ${scenario.mode} response without retaining provider content`, async () => {
    const server = await startSyntheticPowerSchoolSessionServer({
      routineMode: scenario.mode,
    });
    const parent = mkdtempSync(join(tmpdir(), `m07c-${scenario.mode}-`));
    const sessionDirectory = join(parent, 'session');
    const beforeProfiles = temporaryProfiles();
    try {
      seedState(sessionDirectory, server.powerSchoolOrigin, 'valid');
      const result = await collectPassivePowerSchoolBell({
        config: routineConfig(server.powerSchoolOrigin, sessionDirectory),
        requestedDate: date,
      });
      assert.deepEqual(result, {
        status: 'repair-required',
        code: scenario.code,
      });
      assert.deepEqual(temporaryProfiles(), beforeProfiles);
    } finally {
      await server.close();
      rmSync(parent, { recursive: true, force: true });
    }
  });
}

test('bell-session rejection is distinguished after the authenticated status read', async () => {
  const server = await startSyntheticPowerSchoolSessionServer({
    routineMode: 'bell-session-rejected',
  });
  const parent = mkdtempSync(join(tmpdir(), 'm07c-browser-bell-rejected-'));
  const sessionDirectory = join(parent, 'session');
  const beforeProfiles = temporaryProfiles();
  try {
    seedState(sessionDirectory, server.powerSchoolOrigin, 'valid');
    const result = await collectPassivePowerSchoolBell({
      config: routineConfig(server.powerSchoolOrigin, sessionDirectory),
      requestedDate: date,
    });
    assert.deepEqual(result, {
      status: 'repair-required',
      code: 'bell-session-redirect-authentication',
    });
    assert.equal(
      server.requests.some((request) => request.origin === 'identity'),
      false,
    );
    assert.deepEqual(temporaryProfiles(), beforeProfiles);
  } finally {
    await server.close();
    rmSync(parent, { recursive: true, force: true });
  }
});

test('browser-native bell fallback streams beneath the same finite body budget', async () => {
  const server = await startSyntheticPowerSchoolSessionServer({
    requireBrowserNavigationForBell: true,
    browserBellResponseBytes: 32 * 1024,
    omitBellContentLength: true,
  });
  const parent = mkdtempSync(join(tmpdir(), 'm07c-browser-native-budget-'));
  const sessionDirectory = join(parent, 'session');
  const beforeProfiles = temporaryProfiles();
  try {
    seedState(sessionDirectory, server.powerSchoolOrigin, 'valid');
    const result = await collectPassivePowerSchoolBell({
      config: routineConfig(server.powerSchoolOrigin, sessionDirectory, {
        maxResponseBytes: 1_024,
      }),
      requestedDate: date,
    });
    assert.deepEqual(result, {
      status: 'failed',
      code: 'response-budget-exceeded',
      retryable: false,
    });
    assert.equal(
      server.requests.some((request) => request.origin === 'identity'),
      false,
    );
    assert.deepEqual(temporaryProfiles(), beforeProfiles);
  } finally {
    await server.close();
    rmSync(parent, { recursive: true, force: true });
  }
});

test('browser-native control failure is not mislabeled as authentication repair', async () => {
  const server = await startSyntheticPowerSchoolSessionServer({
    requireBrowserNavigationForBell: true,
  });
  const parent = mkdtempSync(join(tmpdir(), 'm07c-browser-native-control-'));
  const sessionDirectory = join(parent, 'session');
  const beforeProfiles = temporaryProfiles();
  try {
    seedState(sessionDirectory, server.powerSchoolOrigin, 'valid');
    const result = await collectPassivePowerSchoolBell({
      config: routineConfig(server.powerSchoolOrigin, sessionDirectory),
      requestedDate: date,
      beforeStopBrowserLoading: async () => {
        throw new Error('synthetic-cdp-control-failure');
      },
    });
    assert.deepEqual(result, {
      status: 'failed',
      code: 'request-policy-violation',
      retryable: false,
    });
    assert.equal(
      server.requests.some((request) => request.origin === 'identity'),
      false,
    );
    assert.deepEqual(temporaryProfiles(), beforeProfiles);
  } finally {
    await server.close();
    rmSync(parent, { recursive: true, force: true });
  }
});

test('external abort remains distinct from timeout in the browser-native fallback', async () => {
  const server = await startSyntheticPowerSchoolSessionServer({
    requireBrowserNavigationForBell: true,
  });
  const parent = mkdtempSync(join(tmpdir(), 'm07c-browser-native-abort-'));
  const sessionDirectory = join(parent, 'session');
  const beforeProfiles = temporaryProfiles();
  const controller = new AbortController();
  try {
    seedState(sessionDirectory, server.powerSchoolOrigin, 'valid');
    const result = await collectPassivePowerSchoolBell({
      config: routineConfig(server.powerSchoolOrigin, sessionDirectory),
      requestedDate: date,
      signal: controller.signal,
      beforeStopBrowserLoading: async () => {
        controller.abort();
      },
    });
    assert.deepEqual(result, {
      status: 'failed',
      code: 'aborted',
      retryable: false,
    });
    assert.equal(
      server.requests.some((request) => request.origin === 'identity'),
      false,
    );
    assert.deepEqual(temporaryProfiles(), beforeProfiles);
  } finally {
    await server.close();
    rmSync(parent, { recursive: true, force: true });
  }
});

test('missing state requests manual repair before launching Chrome', async () => {
  const server = await startSyntheticPowerSchoolSessionServer();
  const parent = mkdtempSync(join(tmpdir(), 'm07c-browser-missing-'));
  const sessionDirectory = join(parent, 'session');
  const beforeProfiles = temporaryProfiles();
  try {
    const result = await collectPassivePowerSchoolBell({
      config: routineConfig(server.powerSchoolOrigin, sessionDirectory),
      requestedDate: date,
    });
    assert.deepEqual(result, {
      status: 'repair-required',
      code: 'session-state-missing',
    });
    assert.deepEqual(server.requests, []);
    assert.deepEqual(temporaryProfiles(), beforeProfiles);
  } finally {
    await server.close();
    rmSync(parent, { recursive: true, force: true });
  }
});

test('concurrent collection is refused before launching Chrome', async () => {
  const server = await startSyntheticPowerSchoolSessionServer();
  const parent = mkdtempSync(join(tmpdir(), 'm07c-browser-concurrent-'));
  const sessionDirectory = join(parent, 'session');
  const beforeProfiles = temporaryProfiles();
  const lock = acquirePowerSchoolSessionLock(sessionDirectory);
  try {
    const result = await collectPassivePowerSchoolBell({
      config: routineConfig(server.powerSchoolOrigin, sessionDirectory),
      requestedDate: date,
    });
    assert.deepEqual(result, {
      status: 'failed',
      code: 'collector-already-running',
      retryable: false,
    });
    assert.deepEqual(server.requests, []);
    assert.deepEqual(temporaryProfiles(), beforeProfiles);
  } finally {
    lock.release();
    await server.close();
    rmSync(parent, { recursive: true, force: true });
  }
});

test('routine deadline aborts a stalled read and deletes its profile', async () => {
  const server = await startSyntheticPowerSchoolSessionServer({
    routineMode: 'stall',
  });
  const parent = mkdtempSync(join(tmpdir(), 'm07c-browser-timeout-'));
  const sessionDirectory = join(parent, 'session');
  const beforeProfiles = temporaryProfiles();
  try {
    seedState(sessionDirectory, server.powerSchoolOrigin);
    const result = await collectPassivePowerSchoolBell({
      config: routineConfig(server.powerSchoolOrigin, sessionDirectory, {
        navigationTimeoutMs: 5_000,
        overallTimeoutMs: 3_000,
      }),
      requestedDate: date,
    });
    assert.deepEqual(result, {
      status: 'failed',
      code: 'timeout',
      retryable: true,
    });
    assert.equal(
      server.requests.some((request) => request.origin === 'identity'),
      false,
    );
    assert.deepEqual(temporaryProfiles(), beforeProfiles);
  } finally {
    await server.close();
    rmSync(parent, { recursive: true, force: true });
  }
});

test('real supervised timeout reserves cleanup time for profile and lock removal', async () => {
  const server = await startSyntheticPowerSchoolSessionServer({
    routineMode: 'stall',
  });
  const parent = mkdtempSync(join(tmpdir(), 'm07c-worker-timeout-'));
  const sessionDirectory = join(parent, 'session');
  const profilesBefore = temporaryProfiles();
  try {
    seedState(sessionDirectory, server.powerSchoolOrigin);
    const result = await runPowerSchoolBellSupervisor({
      arguments: [date],
      environment: {
        PATH: process.env.PATH,
        CLASSROOM_HUB_POWERSCHOOL_ROOM_ID: 'room-synthetic',
        CLASSROOM_HUB_POWERSCHOOL_ORIGIN: server.powerSchoolOrigin,
        CLASSROOM_HUB_POWERSCHOOL_STATUS_PATH: '/teachers/home.html',
        CLASSROOM_HUB_POWERSCHOOL_STATUS_READY_SELECTOR: '#status-ready',
        CLASSROOM_HUB_POWERSCHOOL_BELL_PATH_TEMPLATE:
          '/teachers/aet_schedulebell.html?target_date={date-us}',
        CLASSROOM_HUB_POWERSCHOOL_BELL_READY_SELECTOR: '#bell-ready',
        CLASSROOM_HUB_POWERSCHOOL_EXPECTED_SCHOOL_TEXT: 'Synthetic Academy',
        CLASSROOM_HUB_POWERSCHOOL_SESSION_DIRECTORY: sessionDirectory,
        CLASSROOM_HUB_POWERSCHOOL_NAVIGATION_TIMEOUT_SECONDS: '10',
        CLASSROOM_HUB_POWERSCHOOL_ROUTINE_TIMEOUT_SECONDS: '10',
      },
    });
    assert.equal(result.exitCode, 1);
    assert.equal(result.result?.status, 'failed');
    assert.deepEqual(temporaryProfiles(), profilesBefore);
    assert.equal(
      readdirSync(sessionDirectory).includes('.classroom-hub-session.lock'),
      false,
    );
  } finally {
    await server.close();
    rmSync(parent, { recursive: true, force: true });
  }
});

for (const [mode, expected] of [
  ['foreign-origin', 'repair-required'],
  ['foreign-path', 'repair-required'],
  ['invalid-redirect', 'repair-required'],
  ['status-oidc-redirect', 'captured'],
  ['status-oidc-bell-marker-missing', 'repair-required'],
  ['status-saml-redirect', 'captured'],
  ['teacher-redirect', 'repair-required'],
  ['post', 'captured'],
  ['popup', 'captured'],
  ['download', 'captured'],
  ['many-requests', 'captured'],
  ['oversize', 'failed'],
] as const) {
  test(`routine collector contains ${mode} without extra provider traffic`, async () => {
    const server = await startSyntheticPowerSchoolSessionServer({
      routineMode: mode as SyntheticRoutineMode,
    });
    const parent = mkdtempSync(join(tmpdir(), `m07c-${mode}-`));
    const sessionDirectory = join(parent, 'session');
    try {
      seedState(sessionDirectory, server.powerSchoolOrigin);
      const result = await collectPassivePowerSchoolBell({
        config: routineConfig(server.powerSchoolOrigin, sessionDirectory, {
          maxResponseBytes: mode === 'oversize' ? 1_024 : 2 * 1024 * 1024,
        }),
        requestedDate: date,
      });
      assert.equal(result.status, expected, JSON.stringify(result));
      if (mode === 'foreign-origin') {
        assert.deepEqual(result, {
          status: 'repair-required',
          code: 'status-session-redirect-cross-origin',
        });
      }
      if (mode === 'foreign-path') {
        assert.deepEqual(result, {
          status: 'repair-required',
          code: 'status-session-redirect-same-origin',
        });
      }
      if (mode === 'invalid-redirect') {
        assert.deepEqual(result, {
          status: 'repair-required',
          code: 'status-session-redirect-invalid',
        });
      }
      if (mode === 'status-saml-redirect' || mode === 'status-oidc-redirect') {
        assert.deepEqual(
          server.requests
            .filter((request) => request.origin === 'powerschool')
            .map((request) => request.path),
          ['/status', '/bell?target_date=04/13/2035'],
        );
      }
      if (mode === 'status-oidc-bell-marker-missing') {
        assert.deepEqual(result, {
          status: 'repair-required',
          code: 'bell-marker-missing',
        });
      }
      if (mode === 'teacher-redirect') {
        assert.deepEqual(result, {
          status: 'repair-required',
          code: 'status-session-redirect-teacher',
        });
      }
      assert.equal(
        server.requests.some((request) => request.origin === 'identity'),
        false,
      );
      assert.deepEqual(
        server.requests.filter(
          (request) => request.method !== 'GET' && request.method !== 'HEAD',
        ),
        [],
      );
    } finally {
      await server.close();
      rmSync(parent, { recursive: true, force: true });
    }
  });
}

test('service-worker markup stays inert while exact reads complete', async () => {
  const server = await startSyntheticPowerSchoolSessionServer({
    routineMode: 'service-worker',
  });
  const parent = mkdtempSync(join(tmpdir(), 'm07c-service-worker-'));
  const sessionDirectory = join(parent, 'session');
  try {
    seedState(sessionDirectory, server.powerSchoolOrigin);
    const result = await collectPassivePowerSchoolBell({
      config: routineConfig(server.powerSchoolOrigin, sessionDirectory),
      requestedDate: date,
    });
    assert.equal(result.status, 'captured', JSON.stringify(result));
    assert.deepEqual(
      server.requests
        .filter((request) => request.origin === 'powerschool')
        .map((request) => request.path),
      ['/status', '/bell?target_date=04/13/2035'],
    );
  } finally {
    await server.close();
    rmSync(parent, { recursive: true, force: true });
  }
});
