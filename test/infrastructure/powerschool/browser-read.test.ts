import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, test } from 'node:test';

import {
  awaitBoundedBrowserQuiescence,
  isDesignatedManagedPowerSchoolProfilePath,
  PassiveBrowserReadSession,
  type PassiveBrowserReadRequest,
} from '../../../src/infrastructure/powerschool/browser-read.js';
import {
  startPowerSchoolLikeServer,
  syntheticPowerSchoolBrowserPolicy,
  type RunningPowerSchoolLikeServer,
} from '../../support/powerschool-like-server.js';

const profiles: string[] = [];
const servers: RunningPowerSchoolLikeServer[] = [];
const sessions: PassiveBrowserReadSession[] = [];

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <
    Value,
  >() => Value extends Right ? 1 : 2
    ? true
    : false;
const passiveSessionSurfaceIsExact: Equal<
  keyof PassiveBrowserReadSession,
  'close' | 'cookies' | 'forbiddenAttempted' | 'read'
> = true;
const passiveRequestSurfaceIsExact: Equal<
  keyof PassiveBrowserReadRequest,
  'waitForSelector'
> = true;

afterEach(async () => {
  await Promise.all(sessions.splice(0).map(async (session) => session.close()));
  await Promise.all(servers.splice(0).map(async (server) => server.close()));
  for (const profile of profiles.splice(0)) {
    rmSync(profile, { recursive: true, force: true });
  }
});

describe('passive PowerSchool browser boundary', () => {
  test('bounds a never-settling browser phase and cleanup confirmation', async () => {
    const never = new Promise<void>(() => undefined);
    const startedAt = performance.now();
    assert.equal(
      await awaitBoundedBrowserQuiescence(never, async () => never, 25),
      false,
    );
    assert.ok(performance.now() - startedAt < 250);
  });

  test('exposes no form, input, script, or mutation capability', () => {
    assert.equal(passiveSessionSurfaceIsExact, true);
    assert.equal(passiveRequestSurfaceIsExact, true);
  });

  test('synthetic source detects and rejects unexpected mutation methods', async () => {
    const server = await fixtureServer();
    const response = await fetch(`${server.origin}/unexpected-mutation`, {
      method: 'POST',
      body: 'synthetic',
    });

    assert.equal(response.status, 405);
    assert.deepEqual(server.mutationAttempts, [
      { method: 'POST', path: '/unexpected-mutation' },
    ]);
    assert.deepEqual(server.readMutationAttempts, []);
  });

  test('reads valid static and dynamic sessions with origin-scoped cookies', async () => {
    const server = await fixtureServer();
    const session = await browserSession(server);

    const staticPage = await session.read('/session/valid');
    assert.equal(staticPage.status, 200);
    assert.equal(staticPage.title, 'Friday, April 13, 2035 Synthetic schedule');
    assert.match(staticPage.text, /Period 1.*8:00 AM - 8:45 AM/su);
    assert.equal(
      server.requests.some(({ path }) => path === '/assets/schedule.css'),
      true,
    );

    const dynamicPage = await session.read('/schedule/dynamic', {
      waitForSelector: '[data-powerschool-ready="true"]',
    });
    assert.match(dynamicPage.text, /Period 1.*8:00 AM - 8:45 AM/su);
    assert.deepEqual(
      (await session.cookies()).map(({ name, value }) => ({ name, value })),
      [{ name: 'synthetic_session', value: 'valid' }],
    );
    assert.equal(session.forbiddenAttempted, false);
  });

  test('keeps expired, SSO, and manual repair blockers passive', async () => {
    const server = await fixtureServer();
    const session = await browserSession(server);

    const expired = await session.read('/session/expired');
    assert.match(expired.url, /\/login$/u);
    assert.match(expired.html, /data-auth-state="login-required"/u);
    assert.match(
      (await session.read('/sso')).text,
      /Manual SSO repair required/u,
    );
    assert.match(
      (await session.read('/manual')).text,
      /Manual challenge required/u,
    );
    assert.deepEqual(server.mutationAttempts, []);
    assert.deepEqual(server.readMutationAttempts, []);
  });

  test('aborts mutation and cross-origin attempts before the wire', async () => {
    const crossOrigin = await fixtureServer();
    const server = await fixtureServer(
      `${crossOrigin.origin}/unexpected-cross-origin-read`,
    );
    const session = await browserSession(server);

    await session.read('/hostile');
    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.equal(session.forbiddenAttempted, true);
    assert.deepEqual(server.mutationAttempts, []);
    assert.deepEqual(server.readMutationAttempts, []);
    assert.equal(
      server.requests.some(({ path }) => path === '/unexpected-mutation'),
      false,
    );
    assert.deepEqual(crossOrigin.requests, []);
    assert.deepEqual(server.readMutationAttempts, []);
    assert.equal(
      server.requests.some(({ path }) => path === '/assets/schedule.css'),
      false,
    );
  });

  test('enforces navigation timeout, body bound, session closure, and profile exclusivity', async () => {
    const server = await fixtureServer();
    const profile = fixtureProfile();
    const session = await PassiveBrowserReadSession.launch({
      userDataDir: profile,
      allowedOrigin: server.origin,
      timeoutMs: 2_000,
      maxBodyBytes: 1_024,
      ...syntheticPowerSchoolBrowserPolicy(),
    });
    sessions.push(session);

    await assert.rejects(session.read('/delay?ms=2500'), /Timeout/u);
    assert.match((await session.read('/login')).text, /Sign in manually/u);
    await assert.rejects(
      session.read('/large?bytes=2048'),
      /browser-body-too-large/u,
    );
    await assert.rejects(
      session.read('/large-chunked?bytes=2048'),
      /browser-body-too-large/u,
    );
    await assert.rejects(
      PassiveBrowserReadSession.launch({
        userDataDir: profile,
        allowedOrigin: server.origin,
        timeoutMs: 2_000,
        maxBodyBytes: 1_024,
        ...syntheticPowerSchoolBrowserPolicy(),
      }),
      /browser-profile-in-use/u,
    );
    await session.close();
    await assert.rejects(session.read('/login'), /browser-session-closed/u);
  });

  test('bounds navigation and selector extraction under one overall deadline', async () => {
    const server = await fixtureServer();
    const session = await PassiveBrowserReadSession.launch({
      userDataDir: fixtureProfile(),
      allowedOrigin: server.origin,
      timeoutMs: 1_000,
      maxBodyBytes: 128 * 1024,
      ...syntheticPowerSchoolBrowserPolicy(),
    });
    sessions.push(session);
    const startedAt = performance.now();
    await assert.rejects(
      session.read('/delay?ms=700', { waitForSelector: '[data-never]' }),
      /bounded-operation-timeout/u,
    );
    assert.ok(performance.now() - startedAt < 1_450);
  });

  test('rejects concurrent reads and leaves the first read isolated', async () => {
    const server = await fixtureServer();
    const session = await browserSession(server);
    const first = session.read('/delay?ms=700');

    await assert.rejects(session.read('/login'), /browser-read-in-progress/u);
    assert.equal((await first).status, 200);
    assert.match((await session.read('/login')).text, /Sign in manually/u);
  });

  test('closes the disposable page before delayed allowlisted requests can run', async () => {
    const server = await fixtureServer();
    const session = await browserSession(server);

    assert.match(
      (
        await session.read('/delayed-script', {
          waitForSelector: '[data-powerschool-ready="true"]',
        })
      ).text,
      /Ready before delayed request/u,
    );
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.equal(
      server.requests.some(({ path }) => path === '/delayed-allowed-resource'),
      false,
    );
  });

  test('aborts request authorization before a timed-out page can issue a late allowed fetch', async () => {
    const server = await fixtureServer();
    const session = await PassiveBrowserReadSession.launch({
      userDataDir: fixtureProfile(),
      allowedOrigin: server.origin,
      timeoutMs: 1_000,
      maxBodyBytes: 128 * 1024,
      ...syntheticPowerSchoolBrowserPolicy(),
    });
    sessions.push(session);
    await assert.rejects(
      session.read('/timeout-delayed-script', {
        waitForSelector: '[data-never]',
      }),
      /bounded-operation-timeout/u,
    );
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.equal(
      server.requests.some(({ path }) => path === '/delayed-allowed-resource'),
      false,
    );
  });

  test('supports exact date templates in paths and configured dynamic fragments', async () => {
    const server = await fixtureServer();
    const session = await browserSession(server);
    await session.read('/session/valid');
    await assert.rejects(
      session.read('/schedule/2035-02-30'),
      /browser-route-forbidden/u,
    );
    await assert.rejects(
      session.read('/schedule/%32%30%33%35-04-13'),
      /browser-route-forbidden/u,
    );
    assert.equal((await session.read('/schedule/2035-04-13')).status, 200);
    const dynamic = await session.read('/schedule/dynamic#2035-04-13', {
      waitForSelector: '[data-powerschool-ready="true"]',
    });
    assert.equal(new URL(dynamic.url).hash, '#2035-04-13');
  });

  test('supports only real MM/DD/YYYY values for an explicitly configured tenant route', async () => {
    const server = await fixtureServer();
    const session = await PassiveBrowserReadSession.launch({
      userDataDir: fixtureProfile(),
      allowedOrigin: server.origin,
      timeoutMs: 5_000,
      maxBodyBytes: 128 * 1024,
      dateValueFormat: 'mm/dd/yyyy',
      expectedDate: '2026-08-10',
      allowedRoutes: [{ pathTemplate: '/session/valid?target_date={date}' }],
      allowedResources: [],
    });
    sessions.push(session);

    assert.equal(
      (await session.read('/session/valid?target_date=08/10/2026')).status,
      200,
    );
    for (const path of [
      '/session/valid?target_date=2026-08-10',
      '/session/valid?target_date=02/30/2026',
      '/session/valid?target_date=08%2F10%2F2026',
      '/session/valid?target_date=08/11/2026',
      '/session/valid?target_date=08/10/2026&action=save',
    ]) {
      await assert.rejects(session.read(path), /browser-route-forbidden/u);
    }
    assert.equal(
      server.requests.filter(({ path }) => path === '/session/valid').length,
      1,
    );
  });

  test('rejects broad, relative, non-directory, symlink, and malformed origin inputs', async () => {
    const server = await fixtureServer();
    const valid = fixtureProfile();
    const container = mkdtempSync(
      join(tmpdir(), 'classroom-hub-profile-inputs-'),
    );
    profiles.push(container);
    const file = join(container, `${Date.now()}-profile-file`);
    writeFileSync(file, 'synthetic');
    const target = join(container, `${Date.now()}-target`);
    mkdirSync(target);
    const link = join(
      tmpdir(),
      `classroom-hub-powerschool-profile-link-${Date.now()}`,
    );
    symlinkSync(target, link);
    profiles.push(link);

    for (const userDataDir of ['relative-profile', tmpdir(), file, link]) {
      await assert.rejects(
        PassiveBrowserReadSession.launch({
          userDataDir,
          allowedOrigin: server.origin,
          timeoutMs: 1_000,
          maxBodyBytes: 1_024,
          ...syntheticPowerSchoolBrowserPolicy(),
        }),
      );
    }
    await assert.rejects(
      PassiveBrowserReadSession.launch({
        userDataDir: valid,
        allowedOrigin: `${server.origin}/not-an-origin`,
        timeoutMs: 1_000,
        maxBodyBytes: 1_024,
        ...syntheticPowerSchoolBrowserPolicy(),
      }),
      /browser-origin-invalid/u,
    );
  });

  test('rejects personal, lookalike, malformed, repository, and symlinked managed profile paths', async () => {
    const server = await fixtureServer();
    const root = mkdtempSync(join(tmpdir(), 'classroom-hub-managed-invalid-'));
    profiles.push(root);
    const arbitrary = join(root, 'arbitrary-profile');
    mkdirSync(arbitrary);
    const personal = join(root, '.config', 'google-chrome', 'Default');
    mkdirSync(personal, { recursive: true });
    const wrongShape = join(
      root,
      '.openclaw-workonly',
      'browser',
      'not-powerschool',
    );
    mkdirSync(wrongShape, { recursive: true });
    const nonDirectory = join(
      root,
      'non-directory',
      '.openclaw-workonly',
      'browser',
      'powerschool',
    );
    mkdirSync(join(nonDirectory, '..'), { recursive: true });
    writeFileSync(nonDirectory, 'synthetic');
    const symlinkTarget = join(root, 'symlink-target');
    mkdirSync(symlinkTarget);
    const symlinked = join(
      root,
      'symlinked',
      '.openclaw-workonly',
      'browser',
      'powerschool',
    );
    mkdirSync(join(symlinked, '..'), { recursive: true });
    symlinkSync(symlinkTarget, symlinked);
    const canonicalManaged = fixtureManagedProfile();

    for (const userDataDir of [
      tmpdir(),
      process.cwd(),
      fixtureProfile(),
      arbitrary,
      personal,
      wrongShape,
      nonDirectory,
      symlinked,
      `${canonicalManaged}/../powerschool`,
    ]) {
      await assert.rejects(
        PassiveBrowserReadSession.launch({
          userDataDir,
          profileMode: 'managed-powerschool',
          allowedOrigin: server.origin,
          timeoutMs: 1_000,
          maxBodyBytes: 1_024,
          ...syntheticPowerSchoolBrowserPolicy(),
        }),
      );
    }
  });

  test('managed identity ignores the supervisor disposable HOME', () => {
    const previousHome = process.env.HOME;
    process.env.HOME = join(tmpdir(), 'classroom-hub-m07b-runtime-home');
    try {
      const designated = join(
        userInfo({ encoding: 'utf8' }).homedir,
        '.openclaw-workonly',
        'browser',
        'powerschool',
      );
      assert.equal(isDesignatedManagedPowerSchoolProfilePath(designated), true);
      assert.equal(
        isDesignatedManagedPowerSchoolProfilePath(
          join(
            process.env.HOME,
            '.openclaw-workonly',
            'browser',
            'powerschool',
          ),
        ),
        false,
      );
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
    }
  });

  test('rejects same-origin GET paths outside the finite route policy', async () => {
    const server = await fixtureServer();
    const session = await browserSession(server);

    await assert.rejects(
      session.read('/unexpected-get-mutation'),
      /browser-route-forbidden/u,
    );
    assert.equal(session.forbiddenAttempted, true);
    assert.deepEqual(server.readMutationAttempts, []);
    assert.equal(
      server.requests.some(({ path }) => path === '/unexpected-get-mutation'),
      false,
    );
  });
});

async function fixtureServer(
  hostileCrossOriginTarget?: string,
): Promise<RunningPowerSchoolLikeServer> {
  const server = await startPowerSchoolLikeServer(
    hostileCrossOriginTarget === undefined ? {} : { hostileCrossOriginTarget },
  );
  servers.push(server);
  return server;
}

function fixtureProfile(): string {
  const profile = mkdtempSync(
    join(tmpdir(), 'classroom-hub-powerschool-profile-'),
  );
  profiles.push(profile);
  return profile;
}

function fixtureManagedProfile(): string {
  const root = mkdtempSync(join(tmpdir(), 'classroom-hub-managed-profile-'));
  profiles.push(root);
  const profile = join(root, '.openclaw-workonly', 'browser', 'powerschool');
  mkdirSync(profile, { recursive: true });
  return profile;
}

async function browserSession(
  server: RunningPowerSchoolLikeServer,
): Promise<PassiveBrowserReadSession> {
  const session = await PassiveBrowserReadSession.launch({
    userDataDir: fixtureProfile(),
    allowedOrigin: server.origin,
    timeoutMs: 5_000,
    maxBodyBytes: 128 * 1024,
    ...syntheticPowerSchoolBrowserPolicy(),
  });
  sessions.push(session);
  return session;
}
