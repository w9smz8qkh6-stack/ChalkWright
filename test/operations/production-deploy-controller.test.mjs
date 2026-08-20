import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const deploy = readFileSync(
  'scripts/operations/deploy-production-from-main.sh',
  'utf8',
);
const sudoPolicy = readFileSync(
  'scripts/operations/install-chalkwright-production-sudo-policy.sh',
  'utf8',
);
const repair = readFileSync(
  'scripts/operations/repair-production-powerschool.sh',
  'utf8',
);
const repairUnit = readFileSync(
  'systemd/production/chalkwright-powerschool-repair.service.in',
  'utf8',
);

test('production deploy waits for restarted display liveness before rollback', () => {
  const restart = deploy.indexOf('systemctl restart chalkwright.service');
  const waitLoop = deploy.indexOf('for _ in {1..20}; do');
  const sleep = deploy.indexOf('/usr/bin/sleep 0.25');
  const finalHealthGate = deploy.indexOf(
    'reject production-deploy-health-failed',
  );

  assert.ok(restart > 0, 'deploy must restart the display service');
  assert.ok(
    waitLoop > restart,
    'deploy must wait only after attempting the service restart',
  );
  assert.ok(sleep > waitLoop, 'deploy liveness loop must be bounded');
  assert.ok(
    finalHealthGate > sleep,
    'deploy must rollback only after the bounded liveness wait',
  );
});

test('production deploy defers plan-dependent readiness to activation', () => {
  assert.doesNotMatch(deploy, /\$health_url\/ready/u);
});

test('production deploy defers Calendar preflight until activation establishes a canonical plan', () => {
  assert.doesNotMatch(deploy, /production-calendar-sync\.js" --preflight/u);
  assert.match(
    deploy,
    /calendarPreflight\\?":\\?"deferred-until-canonical-plan/u,
  );
});

test('production sudo policy pins the current deploy controller digest', () => {
  const expected = createHash('sha256').update(deploy).digest('hex');
  assert.match(
    sudoPolicy,
    new RegExp(`^deploy_digest=${expected}$`, 'mu'),
    'sudo policy must pin the checked-in deploy script exactly',
  );
});

test('headed PowerSchool repair uses a desktop-owner staging lane', () => {
  assert.match(repair, /desktop_user=bren/u);
  assert.match(repair, /production-powerschool-desktop-profile/u);
  assert.match(repair, /production-powerschool-repair-session/u);
  assert.match(repair, /desktop_provider=\$runtime\/provider/u);
  assert.match(repair, /CHALKWRIGHT_M17_REPAIR_DATE/u);
  assert.match(
    repair,
    /if \(!\/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\/\.test\(date\)\)/u,
  );
  assert.doesNotMatch(repair, /if \(!\/\^\\\\d/u);
  assert.match(repair, /powerschool-session\.json/u);
  assert.match(repair, /systemctl start "\$unit"/u);
  assert.doesNotMatch(repair, /Xvfb|xhost|xauth|--no-sandbox|openclaw/iu);
});

test('headed PowerSchool repair runs as the desktop owner with dedicated paths', () => {
  assert.match(repairUnit, /^User=bren$/mu);
  assert.match(repairUnit, /^Group=bren$/mu);
  assert.match(
    repairUnit,
    /EnvironmentFile=\/run\/chalkwright-production-repair\/desktop-repair\.env/u,
  );
  assert.match(
    repairUnit,
    /ReadWritePaths=\/var\/lib\/chalkwright\/production-powerschool-desktop-profile \/var\/lib\/chalkwright\/production-powerschool-repair-session/u,
  );
});

test('production sudo policy pins the current PowerSchool repair controller digest', () => {
  const expected = createHash('sha256').update(repair).digest('hex');
  assert.match(
    sudoPolicy,
    new RegExp(`^repair_digest=${expected}$`, 'mu'),
    'sudo policy must pin the checked-in repair script exactly',
  );
});
