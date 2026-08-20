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

test('headed PowerSchool repair uses the desktop owner user manager', () => {
  assert.match(repair, /desktop_user=bren/u);
  assert.match(repair, /desktop_profile=\$runtime\/profile/u);
  assert.match(repair, /production-powerschool-repair-session/u);
  assert.match(repair, /desktop_provider=\$runtime\/provider/u);
  assert.match(repair, /CHALKWRIGHT_M17_REPAIR_DATE/u);
  assert.match(repair, /^HOME="\$desktop_profile"$/mu);
  assert.match(repair, /\/etc\/systemd\/user\/\$unit/u);
  assert.match(repair, /\/usr\/bin\/systemctl --user/u);
  assert.match(repair, /"\$\{user_systemctl\[@\]\}" start "\$unit"/u);
  assert.match(repair, /desktop_xauthority == "\$desktop_runtime"\/\*/u);
  assert.match(
    repair,
    /if \(!\/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\/\.test\(date\)\)/u,
  );
  assert.doesNotMatch(repair, /if \(!\/\^\\\\d/u);
  assert.match(repair, /powerschool-session\.json/u);
  assert.doesNotMatch(repair, /^XAUTHORITY=/mu);
  assert.doesNotMatch(
    repair,
    /Xvfb|xhost|\/usr\/bin\/xauth|--no-sandbox|openclaw/iu,
  );
});

test('headed PowerSchool repair inherits the user manager desktop with dedicated paths', () => {
  assert.doesNotMatch(repairUnit, /^(?:User|Group|Environment=DISPLAY)=/mu);
  assert.match(
    repairUnit,
    /EnvironmentFile=%t\/chalkwright-production-repair\/desktop-repair\.env/u,
  );
  assert.doesNotMatch(repairUnit, /^Environment=HOME=/mu);
  assert.match(repairUnit, /^UnsetEnvironment=.*OP_SERVICE_ACCOUNT_TOKEN/mu);
  assert.doesNotMatch(
    repairUnit,
    /^(?:NoNewPrivileges|PrivateDevices|ProtectHome|ProtectSystem|RestrictNamespaces|RestrictSUIDSGID)=/mu,
  );
  assert.match(repairUnit, /^MemoryMax=768M$/mu);
  assert.match(repairUnit, /^TasksMax=192$/mu);
});

test('production sudo policy pins the current PowerSchool repair controller digest', () => {
  const expected = createHash('sha256').update(repair).digest('hex');
  assert.match(
    sudoPolicy,
    new RegExp(`^repair_digest=${expected}$`, 'mu'),
    'sudo policy must pin the checked-in repair script exactly',
  );
});
