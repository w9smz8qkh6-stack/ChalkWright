import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('M-11 shadow entrypoints cannot construct Calendar, routing, or operator mutation capability', () => {
  const source = [
    'src/entrypoints/shadow-job.ts',
    'src/entrypoints/shadow-server.ts',
    'src/app/shadow-server.ts',
    'src/application/shadow/source-handler.ts',
    'src/application/integration/plan-refresh-handler.ts',
  ]
    .map((path) => readFileSync(path, 'utf8'))
    .join('\n');
  assert.doesNotMatch(
    source,
    /calendar-writer|calendar-intents|tailscale|operatorToken|mutationToken/u,
  );
  assert.doesNotMatch(source, /calendar-reconcile/u);
  assert.match(source, /attemptedExternalMutations: 0/u);
  assert.match(source, /completedExternalMutations: 0/u);
});

test('seven-day timer has six Sunday-through-Friday executions and no Saturday', () => {
  const timer = readFileSync(
    'systemd/classroom-hub-shadow-refresh.timer',
    'utf8',
  );
  const calendars = timer
    .split(/\r?\n/u)
    .filter((line) => line.startsWith('OnCalendar='));
  assert.equal(calendars.length, 6);
  assert.ok(
    calendars.every((line) => line.endsWith('07:20:00 Asia/Ho_Chi_Minh')),
  );
  assert.doesNotMatch(timer, /Sat/u);
  assert.match(timer, /Persistent=false/u);
  assert.doesNotMatch(timer, /Persistent=true/u);
});

test('persistent shadow readers receive no provider environment or external IP authority', () => {
  const server = readFileSync('systemd/classroom-hub-shadow.service', 'utf8');
  const backup = readFileSync(
    'systemd/classroom-hub-shadow-backup.service',
    'utf8',
  );
  const refresh = readFileSync(
    'systemd/classroom-hub-shadow-refresh.service',
    'utf8',
  );
  for (const unit of [server, backup]) {
    assert.match(unit, /^User=classroom-hub$/mu);
    assert.match(unit, /^Group=classroom-hub$/mu);
    assert.match(
      unit,
      /^EnvironmentFile=\/etc\/classroom-hub\/shadow\/server\.env$/mu,
    );
    assert.doesNotMatch(unit, /^EnvironmentFile=.*\/shadow\/refresh\.env$/mu);
    assert.match(unit, /InaccessiblePaths=.*\/shadow\/refresh\.env/u);
    assert.match(
      unit,
      /InaccessiblePaths=.*google-classroom\/authorized-user/u,
    );
    assert.match(unit, /InaccessiblePaths=.*powerschool-session/u);
  }
  assert.match(refresh, /^User=classroom-hub$/mu);
  assert.match(
    refresh,
    /^EnvironmentFile=\/etc\/classroom-hub\/shadow\/refresh\.env$/mu,
  );
  assert.deepEqual(
    refresh
      .split(/\r?\n/u)
      .filter((line) => line.startsWith('RestrictNamespaces=')),
    ['RestrictNamespaces=user pid net'],
  );
  assert.match(server, /IPAddressDeny=any/u);
  assert.match(server, /IPAddressAllow=localhost/u);
});
