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
  'a1061444548f4f47d0d632e83425f1e5df24cd34e27631ecfa4ed751b52b5fdf';
const units = [
  'chalkwright-canary.service',
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

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'm17-upgrade-'));
  const installRoot = join(root, 'opt/chalkwright-canary');
  const systemdRoot = join(root, 'etc/systemd/system');
  const runtime = join(root, 'runtime');
  const fake = join(root, 'fake');
  const archive = join(root, 'runtime.tar.gz');
  mkdirSync(join(installRoot, 'releases', previous), { recursive: true });
  mkdirSync(systemdRoot, { recursive: true });
  mkdirSync(join(runtime, 'dist/entrypoints'), { recursive: true });
  mkdirSync(join(runtime, 'scripts/operations'), { recursive: true });
  mkdirSync(join(runtime, 'systemd/m17'), { recursive: true });
  mkdirSync(fake, { recursive: true });
  for (const path of [
    'm17-canary-server.js',
    'm17-canary-calendar-sync.js',
    'm17-canary-activation-manifest.js',
  ])
    writeFileSync(join(runtime, 'dist/entrypoints', path), 'export {};\n');
  for (const path of ['activate-m17-canary.sh', 'stop-m17-canary.sh'])
    writeFileSync(join(runtime, 'scripts/operations', path), '#!/bin/sh\n');
  for (const unit of units) {
    writeFileSync(join(runtime, 'systemd/m17', `${unit}.in`), `${unit}\n`);
    writeFileSync(join(systemdRoot, unit), `${unit}\n`);
  }
  symlinkSync(`releases/${previous}`, join(installRoot, 'current'));
  const tar = spawnSync('/usr/bin/tar', ['-czf', archive, '-C', runtime, '.']);
  assert.equal(tar.status, 0);
  const digest = createHash('sha256')
    .update(readFileSync(archive))
    .digest('hex');
  const systemctl = join(fake, 'systemctl');
  writeFileSync(systemctl, '#!/bin/sh\necho inactive\n');
  chmodSync(systemctl, 0o755);
  const chown = join(fake, 'chown');
  writeFileSync(chown, '#!/bin/sh\nexit 0\n');
  chmodSync(chown, 0o755);
  const move = join(fake, 'mv');
  writeFileSync(
    move,
    `#!/bin/sh\n/usr/bin/mv "$@"\nif [ "\${FAIL_AFTER_SWITCH:-}" = 1 ]; then rm -f '${join(installRoot, 'current')}'; ln -s releases/foreign '${join(installRoot, 'current')}'; fi\n`,
  );
  chmodSync(move, 0o755);
  const compare = join(fake, 'cmp');
  const compareCount = join(root, 'compare-count');
  writeFileSync(
    compare,
    `#!/bin/sh\n/usr/bin/cmp "$@" || exit $?\nif [ "\${RACE_BEFORE_SWITCH:-}" = 1 ]; then count=$(cat '${compareCount}' 2>/dev/null || echo 0); count=$((count + 1)); echo "$count" > '${compareCount}'; if [ "$count" = 16 ]; then rm -f '${join(installRoot, 'current')}'; ln -s releases/foreign '${join(installRoot, 'current')}'; fi; fi\n`,
  );
  chmodSync(compare, 0o755);
  const remove = join(fake, 'rm');
  writeFileSync(
    remove,
    '#!/bin/sh\nif [ "${FAIL_SNAPSHOT_REMOVE:-}" = 1 ] && case "$*" in *.m17-upgrade-archive.*) true;; *) false;; esac; then exit 1; fi\nexec /usr/bin/rm "$@"\n',
  );
  chmodSync(remove, 0o755);
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
    .replaceAll('/tmp/chalkwright-m17-canary-runtime.tar.gz', archive)
    .replaceAll('/opt/chalkwright-canary', installRoot)
    .replaceAll('/etc/systemd/system', systemdRoot)
    .replaceAll('/usr/bin/systemctl', systemctl)
    .replaceAll('/usr/bin/chown', chown)
    .replaceAll('/usr/bin/cmp', compare)
    .replaceAll('/usr/bin/mv', move)
    .replaceAll('/usr/bin/rm', remove);
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

test('a predecessor change before the switch is refused and the incomplete release is removed', () => {
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
      false,
    );
    assert.equal(
      existsSync(join(paths.installRoot, 'releases', previous)),
      true,
    );
  } finally {
    rmSync(paths.root, { recursive: true, force: true });
  }
});

test('a post-switch failure with the selected target atomically restores the predecessor', () => {
  const paths = fixture();
  try {
    const result = run(paths, { FAIL_SNAPSHOT_REMOVE: '1' });
    assert.notEqual(result.status, 0);
    assert.equal(
      readlinkSync(join(paths.installRoot, 'current')),
      `releases/${previous}`,
    );
    assert.equal(
      existsSync(join(paths.installRoot, 'releases', paths.digest)),
      false,
    );
    assert.equal(
      existsSync(join(paths.installRoot, 'releases', previous)),
      true,
    );
  } finally {
    rmSync(paths.root, { recursive: true, force: true });
  }
});
