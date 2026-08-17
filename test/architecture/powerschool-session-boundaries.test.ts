import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = process.cwd();
const read = (path: string): string => readFileSync(join(root, path), 'utf8');

test('routine collection has no credential, repair, identity, form, or 1Password capability', () => {
  for (const path of [
    'src/infrastructure/powerschool-session/passive-collector.ts',
    'src/infrastructure/powerschool-session/bell-schedule-source.ts',
  ]) {
    const source = read(path);
    assert.doesNotMatch(
      source,
      /from ['"][^'"]*(?:credential|manual-bootstrap|one-password|1password)[^'"]*['"]|identityOrigin|\.fill\(|\.click\(|\.type\(|\.press\(/iu,
      path,
    );
  }
});

test('manual repair is operator-driven and cannot retrieve or fill credentials', () => {
  const source = read(
    'src/infrastructure/powerschool-session/manual-bootstrap.ts',
  );
  assert.doesNotMatch(
    source,
    /from ['"][^'"]*(?:credential|one-password|1password)[^'"]*['"]|\.fill\(|\.click\(|\.type\(|\.press\(/iu,
  );
  assert.doesNotMatch(source, /screenshot|recordHar|recordVideo|tracing/iu);
  assert.match(source, /headless: false/u);
  assert.match(source, /removeTemporaryBrowserProfile/u);
});

test('accepted JIT repair authority is isolated from routine, scheduler, and Calendar paths', () => {
  const forbiddenConsumers = [
    'src/infrastructure/powerschool-session/passive-collector.ts',
    'src/infrastructure/powerschool-session/bell-schedule-source.ts',
    'src/app/production-server.ts',
    'src/app/shadow-server.ts',
    'src/application/operations/registry.ts',
    'src/application/calendar/production-trial.ts',
    'src/entrypoints/job.ts',
    'src/entrypoints/shadow-job.ts',
    'src/entrypoints/production-server.ts',
  ];
  for (const path of forbiddenConsumers) {
    const source = read(path);
    assert.doesNotMatch(
      source,
      /powerschool-jit-repair|jit-repair-browser|direct-cdp-browser|powerschool-repair-secrets|one-password/iu,
      path,
    );
  }
  const browser = read(
    'src/infrastructure/powerschool-session/jit-repair-browser.ts',
  );
  assert.doesNotMatch(browser, /one-password|1password|\bop\b/iu);
  assert.doesNotMatch(browser, /screenshot|recordHar|recordVideo|tracing/iu);
  assert.match(browser, /headless: options\.headless \?\? false/u);
  assert.match(browser, /removeTemporaryBrowserProfile/u);
  assert.match(browser, /installAuthenticatedNetworkBoundary/u);
});

test('persistent compatibility collection reuses identity state but cannot read credentials or drive forms', () => {
  const collector = read(
    'src/infrastructure/powerschool-session/persistent-compatibility-collector.ts',
  );
  assert.doesNotMatch(
    collector,
    /from ['"][^'"]*(?:jit-repair|credential|repair-secret|one-password|1password)[^'"]*['"]|\.fill\(|\.click\(|\.type\(|\.press\(/iu,
  );
  assert.doesNotMatch(collector, /screenshot|recordHar|recordVideo|tracing/iu);
  assert.match(collector, /persistentProfileDirectory/u);
  assert.match(collector, /installAuthenticatedNetworkBoundary/u);
  assert.match(collector, /minimalBrowserEnvironment/u);
  assert.match(collector, /statusPath/u);
  assert.match(collector, /bellPathTemplate/u);

  const boundary = read(
    'src/infrastructure/powerschool-session/authenticated-network-boundary.ts',
  );
  assert.match(boundary, /routeWebSocket/u);
  assert.match(boundary, /maxTopLevelRequests/u);
  assert.match(boundary, /blockedbyclient/u);
});

test('retained-profile collection is wired only to the dedicated credential-free M17 plan entrypoint', () => {
  for (const path of [
    'src/app/production-server.ts',
    'src/app/shadow-server.ts',
    'src/application/operations/registry.ts',
    'src/entrypoints/job.ts',
    'src/entrypoints/shadow-job.ts',
    'src/entrypoints/production-plan-refresh.ts',
    'systemd/classroom-hub.service.in',
    'systemd/classroom-hub-shadow-refresh.service',
    'systemd/classroom-hub-production-plan-refresh.service.in',
  ]) {
    assert.doesNotMatch(
      read(path),
      /persistent-compatibility|powerschool-compatibility/iu,
      path,
    );
  }
  const retained = read('src/entrypoints/production-retained-plan-refresh.ts');
  assert.match(retained, /runPowerSchoolCompatibilityBellSupervisor/u);
  assert.match(retained, /supervisedRetainedSource/u);
  assert.doesNotMatch(
    retained,
    /PersistentCompatibilityPowerSchoolBellScheduleSource/u,
  );
  assert.match(retained, /rejectAmbientProductionAuthority/u);
  assert.doesNotMatch(
    retained,
    /from ['"][^'"]*(?:jit-repair|repair-secret|one-password|1password)[^'"]*['"]|\.fill\(|\.click\(|\.type\(|\.press\(/iu,
  );
  assert.match(retained, /CLASSROOM_HUB_POWERSCHOOL_REPAIR_/u);
  assert.match(retained, /CLASSROOM_HUB_POWERSCHOOL_ONEPASSWORD_/u);
  assert.match(retained, /OP_SERVICE_ACCOUNT_TOKEN/u);
  for (const path of [
    'systemd/m17/chalkwright-canary-plan-preflight.service.in',
    'systemd/m17/chalkwright-canary-plan-refresh.service.in',
  ]) {
    const unit = read(path);
    assert.match(unit, /production-retained-plan-refresh\.js/u);
    assert.match(unit, /canary-powerschool-compatibility-profile/u);
    assert.match(
      unit,
      /CLASSROOM_HUB_POWERSCHOOL_IDENTITY_ORIGIN=https:\/\/accounts\.google\.com/u,
    );
    assert.doesNotMatch(unit, /powerschool-repair\.env|onepassword/iu);
  }
});

test('native M17 repair starts through an installed release symlink', () => {
  const repair = read('src/entrypoints/m17-powerschool-repair.ts');
  assert.match(
    repair,
    /isDirectEntrypoint\(import\.meta\.url, process\.argv\[1\]\)/u,
  );
  assert.doesNotMatch(repair, /pathToFileURL\(resolve\(invokedPath\)\)/u);
});

test('only the dedicated JIT supervisor can import the 1Password repair reader', () => {
  const allowed = 'src/entrypoints/powerschool-jit-repair.ts';
  for (const path of [
    allowed,
    'src/entrypoints/powerschool-jit-repair-child.ts',
    'src/entrypoints/powerschool-session-bootstrap.ts',
    'src/entrypoints/powerschool-session-bootstrap-child.ts',
    'src/infrastructure/powerschool-session/jit-repair-browser.ts',
    'src/infrastructure/powerschool-session/passive-collector.ts',
    'src/infrastructure/powerschool-session/persistent-compatibility-collector.ts',
  ]) {
    const source = read(path);
    const importsReader =
      /from ['"][^'"]*one-password\/powerschool-repair-secrets/iu.test(source);
    assert.equal(importsReader, path === allowed, path);
    const importsServiceAccount =
      /from ['"][^'"]*one-password\/service-account-authority/iu.test(source);
    assert.equal(importsServiceAccount, path === allowed, path);
  }
});

test('routing and saved state are installed before application navigation', () => {
  const source = read(
    'src/infrastructure/powerschool-session/passive-collector.ts',
  );
  const route = source.indexOf("context.route('**/*'");
  const state = source.indexOf('applyFilteredPowerSchoolState(context');
  const acquisition = source.indexOf('boundedSessionGet({');
  assert.ok(route >= 0 && state > route && acquisition > state);

  const protectedState = read(
    'src/infrastructure/powerschool-session/protected-state.ts',
  );
  const ordinaryState = protectedState.indexOf('context.setStorageState({');
  const partitionedCookies = protectedState.indexOf('context.addCookies(');
  assert.ok(ordinaryState >= 0 && partitionedCookies > ordinaryState);
});

test('locked browser launch disables downloads and service workers', () => {
  const source = read(
    'src/infrastructure/powerschool-session/browser-runtime.ts',
  );
  assert.match(source, /acceptDownloads: false/u);
  assert.match(source, /serviceWorkers: 'block'/u);
  assert.match(source, /chromiumSandbox: true/u);
});

test('direct CDP repair launch stays sandboxed, local, disposable, and repair-only', () => {
  const source = read(
    'src/infrastructure/powerschool-session/direct-cdp-browser.ts',
  );
  assert.match(source, /--remote-debugging-address=127\.0\.0\.1/u);
  assert.match(source, /--remote-debugging-port=0/u);
  assert.match(source, /--user-data-dir=/u);
  assert.match(source, /about:blank/u);
  assert.match(source, /connectOverCDP/u);
  assert.match(source, /acceptDownloads: false/u);
  assert.match(source, /serviceWorkers: 'block'/u);
  assert.doesNotMatch(source, /--no-sandbox|launchPersistentContext/iu);

  for (const path of [
    'src/infrastructure/powerschool-session/passive-collector.ts',
    'src/infrastructure/powerschool-session/manual-bootstrap.ts',
    'src/infrastructure/powerschool-session/browser-runtime.ts',
  ]) {
    assert.doesNotMatch(read(path), /direct-cdp-browser/iu, path);
  }
});

test('collector remains opt-in and absent from existing service/job wiring', () => {
  for (const path of [
    'src/index.ts',
    'src/entrypoints/job.ts',
    'src/entrypoints/rehearsal.ts',
  ]) {
    assert.equal(read(path).includes('powerschool-session'), false, path);
    assert.equal(
      read(path).includes('powerschool-bell-collector'),
      false,
      path,
    );
  }
  for (const path of [
    'systemd/classroom-hub.service.in',
    'systemd/classroom-hub-shadow.service',
    'systemd/classroom-hub-shadow-refresh.service',
    'systemd/classroom-hub-shadow-refresh.timer',
  ]) {
    assert.equal(read(path).includes('powerschool-jit-repair'), false, path);
    assert.equal(read(path).includes('powerschool-compatibility'), false, path);
  }
});

test('schemeful-site parsing uses one exact pinned Public Suffix dependency', () => {
  const manifest = JSON.parse(read('package.json')) as {
    dependencies?: Record<string, string>;
  };
  const lock = JSON.parse(read('package-lock.json')) as {
    packages?: Record<string, { version?: string }>;
  };
  assert.equal(manifest.dependencies?.tldts, '7.4.9');
  assert.equal(lock.packages?.['node_modules/tldts']?.version, '7.4.9');
  assert.equal(lock.packages?.['node_modules/tldts-core']?.version, '7.4.10');
  assert.match(
    read('src/infrastructure/powerschool-session/protected-state.ts'),
    /getDomain\(origin\.hostname,[\s\S]*allowPrivateDomains: true/u,
  );
});
