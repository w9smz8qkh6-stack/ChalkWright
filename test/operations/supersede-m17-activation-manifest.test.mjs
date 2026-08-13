import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { supersedeM17ActivationManifest } from '../../scripts/operations/supersede-m17-activation-manifest.mjs';

const rejectedFingerprint =
  'sha256:2fda6668afbd28b2b3ee843e5ed42438cab30dacfdb496eb4c37e8ab74e925b2';
const failedActivationFingerprint =
  'sha256:e84fdcc9a9ba7155d5b6382a3f191eae4f3f94f490228af418db52280e332a65';
const activeVisualDefectFingerprint =
  'sha256:3ef42b8d902a61b9add8afd6f15812f2076810050f9d275371d165922b2230bb';
const activeFuturePreviewDefectFingerprint =
  'sha256:69ccff3c358f0edd3cbd7a09f9e4d3ec8ccfac20eb2fe12a56f052903da99f7f';
const activeFuturePreviewFingerprint =
  'sha256:41cc8a7ea7e73ba514862bdf72faaaa287ec19f28e6f603a4ae7dfbc475435d9';
const manifest = {
  calendarReferenceHash:
    'sha256:25184522bd2f65a8a38badb6d2fc07e9f1b96fb45134d4b5f8dc5816c976d804',
  comparisonDate: '2026-08-13',
  comparisonEvidenceFingerprint:
    'sha256:77071f2349eaf2a95ba25bdf1ee7236caa1251210cfdb666de01a49a70ba69af',
  comparisonRecordKey: 'm17-preactivation-c21e2f5973ec51afdf572017',
  deniedCalendarReferenceHashes: [
    'sha256:5e1f7df2ce31a3a091283f9485120f8355c1ab187d42cddbdfc9550a52f65f1c',
    'sha256:eb806488452229d2f9a03d1f0a68f5f81de08eb5fafc2d569f00d2332706124c',
  ],
  kind: 'chalkwright-m17-activation-manifest',
  legacyRouteFingerprint:
    'sha256:8cc66148ef842730b4c766962b6e796a351c4251db2ad7649882196921ad3090',
  observationEndsAt: '2026-08-20T02:36:26.000Z',
  observationStartsAt: '2026-08-13T02:36:26.000Z',
  releaseSha256:
    '8dd31c682f71af124ca20ef5836d47328fb1baddc7d17089a9bebc2fba0cff3a',
  screenId: 'classroom-screen',
  stopCommand:
    '/opt/chalkwright-canary/current/scripts/operations/stop-m17-canary.sh',
  tailnetTarget:
    'https://chalkwright.example-tailnet.ts.net:14443/classroom-screen',
  version: 1,
};
const fingerprint = digest(manifest);

function digest(value) {
  return `sha256:${createHash('sha256').update(stable(value)).digest('hex')}`;
}

function stable(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
    .join(',')}}`;
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'm17-supersede-'));
  const live = join(root, 'activation-manifest.json');
  const archive = join(root, 'rejected.json');
  writeFileSync(live, `${JSON.stringify(manifest, null, 2)}\n`, {
    mode: 0o600,
  });
  return { root, live, archive };
}

function run(paths, overrides = {}) {
  return supersedeM17ActivationManifest({
    manifestPath: paths.live,
    archivePath: paths.archive,
    expectedFingerprint: fingerprint,
    expectedTailnetTargetHash: digestText(manifest.tailnetTarget),
    verifyInactive: () => {},
    verifyRouteAbsent: () => {},
    ...overrides,
  });
}

function digestText(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

test('production default is fixed to the recorded rejected fingerprint', () => {
  const paths = fixture();
  try {
    assert.notEqual(fingerprint, rejectedFingerprint);
    assert.throws(
      () =>
        supersedeM17ActivationManifest({
          manifestPath: paths.live,
          archivePath: paths.archive,
          verifyInactive: () => {},
          verifyRouteAbsent: () => {},
        }),
      /m17-supersede-manifest-mismatch/u,
    );
    const source = readFileSync(
      'scripts/operations/supersede-m17-activation-manifest.mjs',
      'utf8',
    );
    assert.ok(source.includes(rejectedFingerprint));
    assert.ok(source.includes(failedActivationFingerprint));
    assert.ok(source.includes(activeVisualDefectFingerprint));
    assert.ok(source.includes(activeFuturePreviewDefectFingerprint));
    assert.ok(source.includes(activeFuturePreviewFingerprint));
  } finally {
    rmSync(paths.root, { recursive: true, force: true });
  }
});

test('atomically archives the exact rejected manifest without deleting it', () => {
  const paths = fixture();
  try {
    const before = lstatSync(paths.live);
    const result = run(paths);
    assert.equal(result.status, 'm17-rejected-activation-manifest-archived');
    assert.throws(() => lstatSync(paths.live), { code: 'ENOENT' });
    const after = lstatSync(paths.archive);
    assert.equal(after.ino, before.ino);
    assert.equal(after.mode & 0o777, 0o600);
    assert.deepEqual(JSON.parse(readFileSync(paths.archive, 'utf8')), manifest);
  } finally {
    rmSync(paths.root, { recursive: true, force: true });
  }
});

test('rejects a mismatched fingerprint, unsafe mode, symlink, and existing archive', () => {
  for (const mutate of [
    (paths) => writeFileSync(paths.live, '{}\n'),
    (paths) => chmodSync(paths.live, 0o644),
    (paths) => {
      const target = join(paths.root, 'target.json');
      writeFileSync(target, `${JSON.stringify(manifest)}\n`, { mode: 0o600 });
      rmSync(paths.live);
      symlinkSync(target, paths.live);
    },
    (paths) => writeFileSync(paths.archive, '{}\n', { mode: 0o600 }),
  ]) {
    const paths = fixture();
    try {
      mutate(paths);
      assert.throws(() => run(paths), /m17-supersede-/u);
    } finally {
      rmSync(paths.root, { recursive: true, force: true });
    }
  }
});

test('refuses active candidate units or a present candidate route before moving', () => {
  for (const overrides of [
    {
      verifyInactive: () => {
        throw new Error('m17-supersede-candidate-active');
      },
    },
    {
      verifyRouteAbsent: () => {
        throw new Error('m17-supersede-candidate-route-present');
      },
    },
  ]) {
    const paths = fixture();
    try {
      assert.throws(() => run(paths, overrides), /m17-supersede-/u);
      assert.equal(lstatSync(paths.live).isFile(), true);
      assert.throws(() => lstatSync(paths.archive), { code: 'ENOENT' });
    } finally {
      rmSync(paths.root, { recursive: true, force: true });
    }
  }
});

test('restores the exact original inode when a post-rename operation fails', () => {
  const paths = fixture();
  try {
    const before = lstatSync(paths.live);
    assert.throws(
      () =>
        run(paths, {
          afterArchiveValidated: () => {
            throw new Error('synthetic-post-rename-failure');
          },
        }),
      /synthetic-post-rename-failure/u,
    );
    assert.equal(lstatSync(paths.live).ino, before.ino);
    assert.throws(() => lstatSync(paths.archive), { code: 'ENOENT' });
  } finally {
    rmSync(paths.root, { recursive: true, force: true });
  }
});

test('detects an in-place content race before rename and restores the inode', () => {
  const paths = fixture();
  try {
    const before = lstatSync(paths.live);
    assert.throws(
      () =>
        run(paths, {
          beforeRename: () => {
            writeFileSync(paths.live, '{}\n', { mode: 0o600 });
          },
        }),
      /m17-supersede-archive-invalid/u,
    );
    assert.equal(lstatSync(paths.live).ino, before.ino);
    assert.equal(readFileSync(paths.live, 'utf8'), '{}\n');
    assert.throws(() => lstatSync(paths.archive), { code: 'ENOENT' });
  } finally {
    rmSync(paths.root, { recursive: true, force: true });
  }
});

test('fails closed rather than overwriting a new live path during restore', () => {
  const paths = fixture();
  try {
    assert.throws(
      () =>
        run(paths, {
          afterArchiveValidated: () => {
            writeFileSync(paths.live, '{}\n', { mode: 0o600 });
            throw new Error('synthetic-post-rename-failure');
          },
        }),
      /m17-supersede-restore-failed/u,
    );
    assert.deepEqual(JSON.parse(readFileSync(paths.archive, 'utf8')), manifest);
    assert.equal(readFileSync(paths.live, 'utf8'), '{}\n');
  } finally {
    rmSync(paths.root, { recursive: true, force: true });
  }
});

test('production helper is fixed to read-only status commands and contains no deletion or mutation command', () => {
  const source = readFileSync(
    'scripts/operations/supersede-m17-activation-manifest.mjs',
    'utf8',
  );
  assert.match(
    source,
    /'\/usr\/bin\/systemctl',[\s\S]*\['show', '--property=ActiveState'/u,
  );
  assert.match(
    source,
    /'\/usr\/bin\/tailscale',[\s\S]*\['serve', 'status', '--json'\]/u,
  );
  assert.match(source, /timeout: 5_000/u);
  assert.match(source, /timeout: 10_000/u);
  assert.match(source, /digest\(archivedManifest\) !== expectedFingerprint/u);
  assert.equal((source.match(/killSignal: 'SIGKILL'/gu) ?? []).length, 2);
  assert.doesNotMatch(
    source,
    /rmSync|unlink|systemctl', \['(?:start|stop|enable|disable)|tailscale', \['serve', (?:'set'|'reset')/u,
  );
});
