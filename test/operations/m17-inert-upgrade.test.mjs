import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const previous =
  'a0354f63bcae4903d1b076eba1cb5fbbb152f0cd09203df617551a3fad4735b3';
const units = [
  'chalkwright-canary.service',
  'chalkwright-canary-powerschool-repair.service',
  'chalkwright-canary-plan-preflight.service',
  'chalkwright-canary-plan-refresh.service',
  'chalkwright-canary-plan-refresh.timer',
  'chalkwright-canary-classroom-preflight.service',
  'chalkwright-canary-classroom-refresh.service',
  'chalkwright-canary-classroom-refresh.timer',
  'chalkwright-canary-calendar-preflight.service',
  'chalkwright-canary-calendar-sync.service',
  'chalkwright-canary-calendar-sync.timer',
  'chalkwright-canary-comparison.service',
  'chalkwright-canary-comparison-observation.service',
  'chalkwright-canary-integrity.service',
  'chalkwright-canary-integrity.timer',
  'chalkwright-canary-backup.service',
  'chalkwright-canary-backup.timer',
];
const repairUnit = 'chalkwright-canary-powerschool-repair.service';
const previousRepairUnit = `${repairUnit}\n`;
const nextRepairUnit = previousRepairUnit;
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'm17-upgrade-'));
  const installRoot = join(root, 'opt/chalkwright-canary');
  const systemdRoot = join(root, 'etc/systemd/system');
  const runtime = join(root, 'runtime');
  const fake = join(root, 'fake');
  const archive = join(root, 'runtime.tar.gz');
  mkdirSync(join(installRoot, 'releases', previous, 'systemd/m17'), {
    recursive: true,
  });
  mkdirSync(systemdRoot, { recursive: true });
  mkdirSync(join(runtime, 'dist/entrypoints'), { recursive: true });
  mkdirSync(join(runtime, 'scripts/operations'), { recursive: true });
  mkdirSync(join(runtime, 'systemd/m17'), { recursive: true });
  mkdirSync(fake, { recursive: true });
  for (const path of [
    'm17-canary-server.js',
    'm17-powerschool-repair.js',
    'production-retained-plan-refresh.js',
    'm17-canary-calendar-sync.js',
    'm17-canary-activation-manifest.js',
  ])
    writeFileSync(join(runtime, 'dist/entrypoints', path), 'export {};\n');
  for (const path of ['activate-m17-canary.sh', 'stop-m17-canary.sh'])
    writeFileSync(join(runtime, 'scripts/operations', path), '#!/bin/sh\n');
  for (const unit of units) {
    writeFileSync(
      join(runtime, 'systemd/m17', `${unit}.in`),
      unit === repairUnit ? nextRepairUnit : `new ${unit}\n`,
    );
    writeFileSync(
      join(systemdRoot, unit),
      unit === repairUnit ? previousRepairUnit : `${unit}\n`,
    );
  }
  writeFileSync(
    join(
      installRoot,
      'releases',
      previous,
      'systemd/m17/chalkwright-canary-powerschool-repair.service.in',
    ),
    previousRepairUnit,
  );
  symlinkSync(`releases/${previous}`, join(installRoot, 'current'));
  const tar = spawnSync('/usr/bin/tar', ['-czf', archive, '-C', runtime, '.']);
  assert.equal(tar.status, 0);
  const digest = createHash('sha256')
    .update(readFileSync(archive))
    .digest('hex');
  const systemctl = join(fake, 'systemctl');
  writeFileSync(
    systemctl,
    `#!/bin/sh\nif [ "\${RACE_BEFORE_SWITCH:-}" = 1 ] && [ "\${1:-}" = daemon-reload ]; then rm -f '${join(installRoot, 'current')}'; ln -s releases/foreign '${join(installRoot, 'current')}'; fi\necho inactive\n`,
  );
  chmodSync(systemctl, 0o755);
  const chown = join(fake, 'chown');
  writeFileSync(chown, '#!/bin/sh\nexit 0\n');
  chmodSync(chown, 0o755);
  const move = join(fake, 'mv');
  writeFileSync(
    move,
    `#!/bin/sh\nkind=other\nfor argument do case "$argument" in *'/.rollback-'*) kind=rollback;; *'/.current-'*) kind=forward;; esac; done\nif [ "$kind" = rollback ] && [ "\${FAIL_ROLLBACK_MOVE:-}" = 1 ]; then exit 1; fi\n/usr/bin/mv "$@"\nif [ "$kind" = forward ]; then if [ "\${FAIL_AFTER_SWITCH:-}" = 1 ]; then rm -f '${join(installRoot, 'current')}'; ln -s releases/foreign '${join(installRoot, 'current')}'; fi; if [ "\${FAIL_AFTER_MOVE:-}" = 1 ]; then exit 1; fi; fi\n`,
  );
  chmodSync(move, 0o755);
  const remove = join(fake, 'rm');
  writeFileSync(
    remove,
    '#!/bin/sh\nif [ "${FAIL_SNAPSHOT_REMOVE:-}" = 1 ] && case "$*" in *.m17-upgrade-archive.*) true;; *) false;; esac; then exit 1; fi\nexec /usr/bin/rm "$@"\n',
  );
  chmodSync(remove, 0o755);
  const copy = join(fake, 'cp');
  writeFileSync(
    copy,
    `#!/bin/sh\nlast=\nfor argument do last=$argument; done\nif [ "\${FAIL_UNIT_COPY:-}" = 1 ] && [ "$last" = '${join(systemdRoot, 'chalkwright-canary-classroom-refresh.service')}' ]; then exit 1; fi\nexec /usr/bin/cp "$@"\n`,
  );
  chmodSync(copy, 0o755);
  let source = readFileSync(
    'scripts/operations/upgrade-m17-canary-inert.sh',
    'utf8',
  );
  source = source
    .replace('[[ ${EUID} -eq 0 ]]', 'true')
    .replace(
      '/usr/bin/install -d -o root -g root -m 0755 "$release"',
      '/usr/bin/mkdir -p "$release"',
    )
    .replace(
      '/usr/bin/install -o root -g root -m 0644 "$release/systemd/m17/chalkwright-canary-powerschool-repair.service.in" /etc/systemd/system/chalkwright-canary-powerschool-repair.service',
      '/usr/bin/cp "$release/systemd/m17/chalkwright-canary-powerschool-repair.service.in" /etc/systemd/system/chalkwright-canary-powerschool-repair.service',
    )
    .replaceAll('/tmp/chalkwright-m17-canary-runtime.tar.gz', archive)
    .replaceAll('/opt/chalkwright-canary', installRoot)
    .replaceAll('/etc/systemd/system', systemdRoot)
    .replaceAll('/usr/bin/systemctl', systemctl)
    .replaceAll('/usr/bin/chown', chown)
    .replaceAll('/usr/bin/cp', copy)
    .replaceAll('/usr/bin/mv', move)
    .replaceAll('/usr/bin/rm', remove);
  source = source
    .replace(
      '7b4b32aad77af5d59dc632aed543c1653c477f3866f8de7b7081b03d5abfb1e4',
      sha256(previousRepairUnit),
    )
    .replace(
      '7b4b32aad77af5d59dc632aed543c1653c477f3866f8de7b7081b03d5abfb1e4',
      sha256(nextRepairUnit),
    );
  const script = join(root, 'upgrade.sh');
  writeFileSync(script, source);
  chmodSync(script, 0o755);
  return { root, installRoot, archive, digest, script };
}

function run(paths, environment = {}) {
  return spawnSync(
    '/usr/bin/bash',
    [paths.script, paths.archive, paths.digest],
    {
      encoding: 'utf8',
      env: { LANG: 'C', PATH: '/usr/bin:/bin', ...environment },
    },
  );
}

test('inert upgrade snapshots, validates, and atomically advances the exact predecessor', () => {
  const paths = fixture();
  try {
    const result = run(paths);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      readlinkSync(join(paths.installRoot, 'current')),
      `releases/${paths.digest}`,
    );
    assert.equal(
      existsSync(join(paths.installRoot, 'releases', paths.digest)),
      true,
    );
    assert.equal(
      readFileSync(
        join(
          paths.root,
          'etc/systemd/system/chalkwright-canary-powerschool-repair.service',
        ),
        'utf8',
      ),
      nextRepairUnit,
    );
  } finally {
    rmSync(paths.root, { recursive: true, force: true });
  }
});

test('repair-unit drift blocks the upgrade without replacing the privileged unit', () => {
  const paths = fixture();
  try {
    const repairUnit = join(
      paths.root,
      'etc/systemd/system/chalkwright-canary-powerschool-repair.service',
    );
    writeFileSync(repairUnit, 'drifted privileged unit\n');
    const result = run(paths);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /m17-upgrade-repair-unit-drift/u);
    assert.equal(readFileSync(repairUnit, 'utf8'), 'drifted privileged unit\n');
    assert.equal(
      readlinkSync(join(paths.installRoot, 'current')),
      `releases/${previous}`,
    );
    assert.equal(
      existsSync(join(paths.installRoot, 'releases', paths.digest)),
      false,
    );
  } finally {
    rmSync(paths.root, { recursive: true, force: true });
  }
});

test('ambiguous post-switch failure retains both releases and never removes the selected target', () => {
  const paths = fixture();
  try {
    const result = run(paths, { FAIL_AFTER_SWITCH: '1' });
    assert.notEqual(result.status, 0);
    assert.equal(
      readlinkSync(join(paths.installRoot, 'current')),
      'releases/foreign',
    );
    assert.equal(
      existsSync(join(paths.installRoot, 'releases', paths.digest)),
      true,
    );
    assert.equal(
      existsSync(join(paths.installRoot, 'releases', previous)),
      true,
    );
  } finally {
    rmSync(paths.root, { recursive: true, force: true });
  }
});

test('a foreign predecessor change is refused and retains both releases for recovery', () => {
  const paths = fixture();
  try {
    const result = run(paths, { RACE_BEFORE_SWITCH: '1' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /m17-upgrade-predecessor-changed/u);
    assert.equal(
      readlinkSync(join(paths.installRoot, 'current')),
      'releases/foreign',
    );
    assert.equal(
      existsSync(join(paths.installRoot, 'releases', paths.digest)),
      true,
    );
    assert.equal(
      existsSync(join(paths.installRoot, 'releases', previous)),
      true,
    );
  } finally {
    rmSync(paths.root, { recursive: true, force: true });
  }
});

test('a cleanup failure after the verified switch retains the committed code and units', () => {
  const paths = fixture();
  try {
    const result = run(paths, { FAIL_SNAPSHOT_REMOVE: '1' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      readlinkSync(join(paths.installRoot, 'current')),
      `releases/${paths.digest}`,
    );
    assert.equal(
      existsSync(join(paths.installRoot, 'releases', paths.digest)),
      true,
    );
    assert.equal(
      existsSync(join(paths.installRoot, 'releases', previous)),
      true,
    );
  } finally {
    rmSync(paths.root, { recursive: true, force: true });
  }
});

test('a failure immediately after the symlink move restores coherent predecessor code and units', () => {
  const paths = fixture();
  try {
    const before = new Map(
      units.map((unit) => [
        unit,
        readFileSync(join(paths.root, 'etc/systemd/system', unit), 'utf8'),
      ]),
    );
    const result = run(paths, { FAIL_AFTER_MOVE: '1' });
    assert.notEqual(result.status, 0);
    assert.equal(
      readlinkSync(join(paths.installRoot, 'current')),
      `releases/${previous}`,
    );
    assert.equal(
      existsSync(join(paths.installRoot, 'releases', paths.digest)),
      false,
    );
    for (const [unit, content] of before) {
      assert.equal(
        readFileSync(join(paths.root, 'etc/systemd/system', unit), 'utf8'),
        content,
      );
    }
  } finally {
    rmSync(paths.root, { recursive: true, force: true });
  }
});

test('a failed rollback retains coherent new code and units for explicit recovery', () => {
  const paths = fixture();
  try {
    const result = run(paths, {
      FAIL_AFTER_MOVE: '1',
      FAIL_ROLLBACK_MOVE: '1',
    });
    assert.notEqual(result.status, 0);
    assert.equal(
      readlinkSync(join(paths.installRoot, 'current')),
      `releases/${paths.digest}`,
    );
    assert.equal(
      existsSync(join(paths.installRoot, 'releases', paths.digest)),
      true,
    );
    for (const unit of units) {
      const content = readFileSync(
        join(paths.root, 'etc/systemd/system', unit),
        'utf8',
      );
      assert.equal(
        content,
        unit === repairUnit ? previousRepairUnit : `new ${unit}\n`,
      );
    }
  } finally {
    rmSync(paths.root, { recursive: true, force: true });
  }
});

test('a mid-copy failure restores every installed unit and retains the predecessor', () => {
  const paths = fixture();
  try {
    const before = new Map(
      units.map((unit) => [
        unit,
        readFileSync(join(paths.root, 'etc/systemd/system', unit), 'utf8'),
      ]),
    );
    const result = run(paths, { FAIL_UNIT_COPY: '1' });
    assert.notEqual(result.status, 0);
    for (const [unit, content] of before) {
      assert.equal(
        readFileSync(join(paths.root, 'etc/systemd/system', unit), 'utf8'),
        content,
      );
    }
    assert.equal(
      readlinkSync(join(paths.installRoot, 'current')),
      `releases/${previous}`,
    );
    assert.equal(
      existsSync(join(paths.installRoot, 'releases', paths.digest)),
      false,
    );
  } finally {
    rmSync(paths.root, { recursive: true, force: true });
  }
});
