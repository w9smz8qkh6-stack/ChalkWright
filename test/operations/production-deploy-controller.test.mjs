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

test('production deploy waits for restarted display readiness before rollback', () => {
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
  assert.ok(sleep > waitLoop, 'deploy readiness loop must be bounded');
  assert.ok(
    finalHealthGate > sleep,
    'deploy must rollback only after the bounded readiness wait',
  );
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
