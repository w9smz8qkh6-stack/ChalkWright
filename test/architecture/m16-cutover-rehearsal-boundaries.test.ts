import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const application = readFileSync(
  'src/application/cutover/rehearsal.ts',
  'utf8',
);
const entrypoint = readFileSync('src/entrypoints/m16-rehearsal.ts', 'utf8');

test('M-16 rehearsal has no live service, route, provider, credential, or command capability', () => {
  for (const forbidden of [
    'node:child_process',
    'execFile',
    'spawn(',
    'systemctl',
    'tailscale',
    'openclaw',
    '@googleapis',
    'powerschool',
    'credential',
    'oauth',
    '/etc/systemd',
    '/srv/openclaw',
    ['/home', '/bren'].join(''),
  ]) {
    assert.equal(
      application.toLowerCase().includes(forbidden.toLowerCase()),
      false,
      forbidden,
    );
    assert.equal(
      entrypoint.toLowerCase().includes(forbidden.toLowerCase()),
      false,
      forbidden,
    );
  }
  assert.match(entrypoint, /mkdtempSync/u);
  assert.match(entrypoint, /127\.0\.0\.1/u);
  assert.match(entrypoint, /attemptedExternalMutations/u);
  assert.match(entrypoint, /liveOperationalChanges/u);
});

test('routine services and jobs cannot import M-16 rehearsal authority', () => {
  for (const file of [
    'src/entrypoints/job.ts',
    'src/entrypoints/shadow-job.ts',
    'src/entrypoints/shadow-server.ts',
    'src/app/shadow-server.ts',
    'src/application/operations/registry.ts',
  ]) {
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /m16|cutover\/rehearsal/iu, file);
  }
});

test('the inert production reader has local SQLite/display authority but no provider, scheduler, route, or command capability', () => {
  const source = [
    'src/config/production.ts',
    'src/app/production-server.ts',
    'src/entrypoints/production-server.ts',
  ]
    .map((path) => readFileSync(path, 'utf8'))
    .join('\n')
    .toLowerCase();
  for (const forbidden of [
    'node:child_process',
    'systemctl',
    'tailscale',
    'openclaw',
    '@googleapis',
    'powerschool',
    'google-classroom',
    'calendar-reconcile',
    'calendar-writer',
    'oauth',
    '/etc/systemd',
    '/srv/openclaw',
    ['/home', '/bren'].join(''),
  ]) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
  assert.match(source, /127\.0\.0\.1/u);
  assert.match(source, /classroom-screen/u);
  assert.match(source, /operatortokenreference/u);
});

test('offline Telegram qualification is unreachable from jobs, services, and production reader', () => {
  for (const path of [
    'src/entrypoints/job.ts',
    'src/application/operations/handlers.ts',
    'src/app/production-server.ts',
    'src/entrypoints/production-server.ts',
  ]) {
    const source = readFileSync(path, 'utf8');
    assert.doesNotMatch(
      source,
      /from ['"][^'"]*(?:telegram-alert-transport|config\/alert-delivery)/u,
    );
  }
  const qualification = readFileSync(
    'src/entrypoints/m16-alert-live-qualification.ts',
    'utf8',
  );
  assert.match(qualification, /telegram-alert-transport/u);
  assert.match(qualification, /--execute/u);
  assert.match(qualification, /alert-delivery\.json/u);
  assert.doesNotMatch(qualification, /systemctl|tailscale/iu);
  assert.doesNotMatch(
    qualification,
    /from ['"][^'"]*(?:child_process|@google|googleapis|powerschool|calendar)/iu,
  );
  for (const name of readdirSync('systemd').filter(
    (entry) => entry.endsWith('.service') || entry.endsWith('.service.in'),
  )) {
    const path = `systemd/${name}`;
    const capabilityBearingSource = readFileSync(path, 'utf8').replace(
      /^InaccessiblePaths=.*$/gmu,
      '',
    );
    assert.doesNotMatch(capabilityBearingSource, /telegram|alert-delivery/iu);
  }
});

test('active-class refresh policy is provider-neutral and wired only to the inert isolated candidate', () => {
  const trigger = readFileSync(
    'src/application/classroom/active-job-handler.ts',
    'utf8',
  );
  assert.doesNotMatch(
    trigger,
    /google-classroom|official-client|process\.env|node:https|credential/iu,
  );
  assert.match(trigger, /'pre_checkin'/u);
  assert.match(trigger, /'in_class_content'/u);
  for (const path of [
    'src/entrypoints/job.ts',
    'src/entrypoints/shadow-job.ts',
    'src/app/production-server.ts',
    'src/entrypoints/production-server.ts',
    'src/entrypoints/production-plan-refresh.ts',
  ]) {
    assert.doesNotMatch(
      readFileSync(path, 'utf8'),
      /classroom\/active-job-handler/iu,
      path,
    );
  }
  assert.match(
    readFileSync('src/entrypoints/production-classroom-refresh.ts', 'utf8'),
    /classroom\/active-job-handler/u,
  );
});

test('inert production provider jobs keep PowerSchool and Classroom authority isolated', () => {
  const plan = readFileSync(
    'src/entrypoints/production-plan-refresh.ts',
    'utf8',
  );
  const classroom = readFileSync(
    'src/entrypoints/production-classroom-refresh.ts',
    'utf8',
  );
  assert.match(plan, /powerschool-session/u);
  assert.doesNotMatch(
    plan,
    /from ['"][^'"]*(?:google-classroom|google-calendar|telegram|jit-repair|one-password)/iu,
  );
  assert.match(classroom, /google-classroom/u);
  assert.doesNotMatch(
    classroom,
    /from ['"][^'"]*(?:powerschool|google-calendar|telegram|jit-repair|one-password)/iu,
  );
});
