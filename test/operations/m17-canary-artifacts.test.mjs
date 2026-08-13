import assert from 'node:assert/strict';
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { verifyM17Canary } from '../../scripts/operations/verify-m17-canary.mjs';

test('verifies the exact inert M-17 parallel-canary topology', () => {
  assert.equal(verifyM17Canary(resolve('.')).status, 'verified-inert');
});

test('rejects activation and legacy-boundary drift', () => {
  const root = mkdtempSync(join(tmpdir(), 'chalkwright-m17-units-'));
  try {
    cpSync('systemd/m17', join(root, 'systemd/m17'), { recursive: true });
    const path = join(root, 'systemd/m17/chalkwright-canary.service.in');
    writeFileSync(
      path,
      `${readFileSync(path, 'utf8')}\n[Install]\nWantedBy=multi-user.target\n`,
    );
    assert.throws(() => verifyM17Canary(root), /must remain inert/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects broadened or duplicate service hardening assignments', () => {
  for (const drift of [
    '\nRestrictNamespaces=user pid net mnt\n',
    '\nRestrictNamespaces=mnt\n',
    '\nNoNewPrivileges=false\n',
  ]) {
    const root = mkdtempSync(join(tmpdir(), 'chalkwright-m17-hardening-'));
    try {
      cpSync('systemd/m17', join(root, 'systemd/m17'), { recursive: true });
      const path = join(
        root,
        'systemd/m17/chalkwright-canary-plan-refresh.service.in',
      );
      writeFileSync(path, `${readFileSync(path, 'utf8')}${drift}`);
      assert.throws(() => verifyM17Canary(root), /must contain exactly one/u);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test('release and lifecycle scripts remain digest-bound and candidate-only', () => {
  const build = readFileSync(
    'scripts/operations/build-m17-canary-release.sh',
    'utf8',
  );
  const install = readFileSync(
    'scripts/operations/install-m17-canary-inert.sh',
    'utf8',
  );
  const upgrade = readFileSync(
    'scripts/operations/upgrade-m17-canary-inert.sh',
    'utf8',
  );
  const activate = readFileSync(
    'scripts/operations/activate-m17-canary.sh',
    'utf8',
  );
  const stop = readFileSync('scripts/operations/stop-m17-canary.sh', 'utf8');
  const bind = readFileSync(
    'scripts/operations/bind-m17-activation-manifest.mjs',
    'utf8',
  );
  const supersede = readFileSync(
    'scripts/operations/supersede-m17-activation-manifest.mjs',
    'utf8',
  );
  assert.match(build, /gzip -n -9/u);
  assert.match(install, /sha256sum/u);
  assert.doesNotMatch(
    `${install}\n${upgrade}\n${activate}\n${stop}`,
    /systemctl enable|tailscale|openclaw|Telegram|calendarCleanupPerformed\\?":1/iu,
  );
  assert.ok(
    activate.indexOf('start chalkwright-canary.service') <
      activate.indexOf('start chalkwright-canary-calendar-sync.service'),
  );
  assert.ok(
    activate.indexOf('/classroom-screen/health') <
      activate.indexOf('start chalkwright-canary-calendar-sync.service'),
  );
  assert.ok(
    activate.indexOf('/classroom-screen/ready') <
      activate.indexOf('start chalkwright-canary-calendar-sync.service'),
  );
  for (const unit of [
    'chalkwright-canary-calendar-sync.service',
    'chalkwright-canary-calendar-preflight.service',
    'chalkwright-canary-comparison.service',
    'chalkwright-canary-comparison-observation.service',
    'chalkwright-canary-classroom-preflight.service',
    'chalkwright-canary-classroom-refresh.service',
    'chalkwright-canary-plan-preflight.service',
    'chalkwright-canary-plan-refresh.service',
    'chalkwright-canary-backup.service',
    'chalkwright-canary-integrity.service',
  ])
    assert.match(stop, new RegExp(unit.replaceAll('.', '\\.')));
  assert.match(stop, /calendarCleanupPerformed":0/u);
  assert.match(activate, /m17-canary-activation-manifest\.js --verify/u);
  assert.match(bind, /comparisonEvidenceFingerprint/u);
  assert.match(
    readFileSync(
      'systemd/m17/chalkwright-canary-comparison.service.in',
      'utf8',
    ),
    /m17-canary-comparison\.js --preactivation/u,
  );
  assert.doesNotMatch(
    readFileSync(
      'systemd/m17/chalkwright-canary-comparison-observation.service.in',
      'utf8',
    ),
    /--preactivation/u,
  );
  assert.match(bind, /legacyRouteFingerprint/u);
  assert.match(bind, /observationStartsAt/u);
  assert.match(bind, /stop-m17-canary\.sh/u);
  assert.match(supersede, /2fda6668afbd28b2b3ee843e5ed42438/u);
  assert.match(supersede, /renameSync/u);
  assert.match(supersede, /fsyncSync/u);
  assert.doesNotMatch(supersede, /rmSync|unlinkSync/u);
  assert.match(install, /chmod 0755.*activate-m17-canary\.sh/u);
  assert.match(upgrade, /a1061444548f4f47d0d632e83425f1e5df24cd34e27631/u);
  assert.match(upgrade, /systemctl show --property=ActiveState/u);
  assert.match(upgrade, /env -i LANG=C LC_ALL=C SYSTEMD_COLORS=0/u);
  assert.match(upgrade, /timeout --signal=KILL 5s/u);
  assert.match(upgrade, /mktemp --tmpdir="\$root"/u);
  assert.match(upgrade, /cp --reflink=never/u);
  assert.match(upgrade, /timeout --signal=KILL 30s/u);
  assert.match(upgrade, /sha256sum "\$snapshot"/u);
  assert.match(upgrade, /-xzf "\$snapshot"/u);
  assert.match(upgrade, /cmp -s/u);
  assert.match(upgrade, /mv -T/u);
  assert.match(upgrade, /releases\/\$previous.*\$rollback/u);
  assert.equal((upgrade.match(/readlink "\$current"/gu) ?? []).length, 4);
  assert.equal(
    (upgrade.match(/systemctl show --property=ActiveState/gu) ?? []).length,
    2,
  );
  assert.doesNotMatch(
    upgrade,
    /systemctl (?:start|stop|enable|disable)|tailscale/u,
  );
  assert.match(supersede, /e84fdcc9a9ba7155d5b6382a3f191eae/u);
  assert.match(supersede, /3ef42b8d902a61b9add8afd6f15812f2/u);
  assert.match(supersede, /69ccff3c358f0edd3cbd7a09f9e4d3ec/u);
  assert.match(supersede, /41cc8a7ea7e73ba514862bdf72faaaa28/u);
});
