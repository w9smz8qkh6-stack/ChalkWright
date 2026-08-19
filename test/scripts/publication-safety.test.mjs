import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  auditPublicationTree,
  publicationSummary,
} from '../../scripts/lib/publication-safety.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'classroom-hub-publication-'));
  for (const path of [
    'LICENSE',
    'README.md',
    'CONTRIBUTING.md',
    'SECURITY.md',
    'CODE_OF_CONDUCT.md',
    'THIRD_PARTY_NOTICES.md',
  ])
    writeFileSync(join(root, path), 'safe\n', { mode: 0o600 });
  mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
  writeFileSync(
    join(root, '.github', 'workflows', 'ci.yml'),
    `permissions:\n  contents: read\nsteps:\n  - uses: actions/checkout@${'a'.repeat(40)} # v6\n`,
    { mode: 0o600 },
  );
  writeFileSync(
    join(root, '.github', 'dependabot.yml'),
    'version: 2\nupdates: []\n',
    { mode: 0o600 },
  );
  mkdirSync(join(root, 'docs', 'assets'), { recursive: true });
  const preview = Buffer.alloc(12_000);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(preview);
  writeFileSync(
    join(root, 'docs', 'assets', 'classroom-hub-preview.png'),
    preview,
  );
  writeFileSync(
    join(root, 'docs', 'assets', 'classroom-hub-preview.json'),
    `${JSON.stringify({
      version: 1,
      source: 'repository-owned synthetic B407 fixture',
      state: 'pre_checkin',
      instant: '2035-04-13T07:55:00Z',
      browser: 'Google Chrome 150.0.7871.114',
      viewport: { width: 1_920, height: 1_080 },
      reducedMotion: true,
      foreignRequests: 0,
      consoleErrors: 0,
      pageErrors: 0,
      httpFailures: 0,
      image: 'classroom-hub-preview.png',
      sha256: createHash('sha256').update(preview).digest('hex'),
    })}\n`,
    { mode: 0o600 },
  );
  return root;
}

test('accepts a minimal licensed privacy-safe publication tree', () => {
  const root = fixture();
  assert.deepEqual(auditPublicationTree(root), []);
  assert.equal(publicationSummary(root).status, 'passed');
});

test('rejects personal and protected paths without returning their values', () => {
  const root = fixture();
  const personalPath = ['/home', '/bren/private'].join('');
  const protectedPath = ['.openclaw-workonly', '/secrets/value'].join('');
  writeFileSync(
    join(root, 'README.md'),
    `path=${personalPath}\nsecret=${protectedPath}\n`,
    { mode: 0o600 },
  );
  const summary = publicationSummary(root);
  assert.equal(summary.status, 'rejected');
  assert.deepEqual(
    summary.issues.map(({ code }) => code),
    ['publication-personal-home-path', 'publication-protected-path'],
  );
  assert.equal(JSON.stringify(summary).includes(personalPath), false);
});

test('rejects a personal home root without a trailing slash', () => {
  const root = fixture();
  const personalRoot = ['/home', '/bren'].join('');
  writeFileSync(join(root, 'README.md'), `path=${personalRoot}\n`, {
    mode: 0o600,
  });
  assert.deepEqual(auditPublicationTree(root), [
    {
      code: 'publication-personal-home-path',
      path: 'README.md',
      count: 1,
    },
  ]);
});

test('rejects private Tailnet URLs while accepting the documentation placeholder', () => {
  const root = fixture();
  writeFileSync(
    join(root, 'README.md'),
    [
      'safe=https://chalkwright.example-tailnet.ts.net:14443/classroom-screen',
      `private=https://classroom-device.${'tail12345.ts.net'}:14443/classroom-screen`,
      '',
    ].join('\n'),
    { mode: 0o600 },
  );
  assert.deepEqual(auditPublicationTree(root), [
    {
      code: 'publication-private-tailnet-url',
      path: 'README.md',
      count: 1,
    },
  ]);
});

test('requires exact media provenance for the bundled horse video', () => {
  const root = fixture();
  mkdirSync(join(root, 'public'));
  writeFileSync(
    join(root, 'public', 'galloping-horse.mp4'),
    'synthetic-media',
    {
      mode: 0o600,
    },
  );
  assert.deepEqual(auditPublicationTree(root), [
    {
      code: 'publication-media-provenance-missing',
      path: 'public/galloping-horse.mp4',
      count: 1,
    },
  ]);
});

test('requires provenance for every bundled video even when unused', () => {
  const root = fixture();
  mkdirSync(join(root, 'public'));
  writeFileSync(join(root, 'public', 'unused.webm'), 'synthetic-media', {
    mode: 0o600,
  });
  assert.deepEqual(auditPublicationTree(root), [
    {
      code: 'publication-media-provenance-missing',
      path: 'public/unused.webm',
      count: 1,
    },
  ]);
});

test('accepts only a complete digest-bound media provenance manifest', () => {
  const root = fixture();
  mkdirSync(join(root, 'public'));
  const assets = [
    ['public/a.mp4', Buffer.from('synthetic-mp4')],
    ['public/b.webm', Buffer.from('synthetic-webm')],
  ];
  for (const [path, bytes] of assets) writeFileSync(join(root, path), bytes);
  mkdirSync(join(root, 'docs'), { recursive: true });
  writeFileSync(
    join(root, 'docs', 'media-provenance.json'),
    `${JSON.stringify({
      version: 1,
      assets: assets.map(([asset, bytes]) => ({
        asset,
        license: 'test-only',
        rightsBasis: 'original',
        sha256: createHash('sha256').update(bytes).digest('hex'),
        source: 'synthetic test fixture',
      })),
    })}\n`,
    { mode: 0o600 },
  );
  assert.deepEqual(auditPublicationTree(root), []);

  writeFileSync(join(root, 'public', 'b.webm'), 'drifted');
  assert.deepEqual(auditPublicationTree(root), [
    {
      code: 'publication-media-provenance-invalid',
      path: 'docs/media-provenance.json',
      count: 1,
    },
  ]);
});

test('rejects a preview screenshot whose evidence digest drifts', () => {
  const root = fixture();
  writeFileSync(
    join(root, 'docs', 'assets', 'classroom-hub-preview.png'),
    Buffer.alloc(12_000),
  );
  assert.ok(
    auditPublicationTree(root).some(
      ({ code }) => code === 'publication-preview-evidence-invalid',
    ),
  );
});

test('rejects mutable action tags and missing license', () => {
  const root = fixture();
  writeFileSync(join(root, 'LICENSE'), '', { mode: 0o600 });
  writeFileSync(
    join(root, '.github', 'workflows', 'ci.yml'),
    'permissions:\n  contents: read\nsteps:\n  - uses: actions/checkout@v6\n',
    { mode: 0o600 },
  );
  assert.deepEqual(
    auditPublicationTree(root).map(({ code }) => code),
    ['publication-ci-action-unpinned', 'publication-required-file-missing'],
  );
});
