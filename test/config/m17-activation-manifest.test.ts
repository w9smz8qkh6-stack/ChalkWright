import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { loadM17ActivationManifest } from '../../src/config/m17-activation-manifest.js';

const valid = {
  version: 1,
  kind: 'chalkwright-m17-activation-manifest',
  releaseSha256: 'a'.repeat(64),
  calendarReferenceHash: `sha256:${'b'.repeat(64)}`,
  deniedCalendarReferenceHashes: [
    `sha256:${'c'.repeat(64)}`,
    `sha256:${'d'.repeat(64)}`,
  ],
  tailnetTarget: 'https://chalkwright.example-tailnet.ts.net/classroom-screen',
  legacyRouteFingerprint: `sha256:${'e'.repeat(64)}`,
  stopCommand:
    '/opt/chalkwright-canary/current/scripts/operations/stop-m17-canary.sh',
  observationStartsAt: '2035-04-13T00:00:00.000Z',
  observationEndsAt: '2035-04-14T00:00:00.000Z',
  comparisonEvidenceFingerprint: `sha256:${'f'.repeat(64)}`,
  comparisonRecordKey: `m17-preactivation-${'a'.repeat(24)}`,
  comparisonDate: '2035-04-13',
  screenId: 'screen-c509-canary-production',
} as const;

function protectedManifest(value: unknown): { root: string; path: string } {
  const root = mkdtempSync(join(tmpdir(), 'chalkwright-m17-manifest-'));
  chmodSync(root, 0o700);
  const path = join(root, 'manifest.json');
  writeFileSync(path, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  return { root, path };
}

test('loads only a complete bounded M-17 activation binding', () => {
  const { root, path } = protectedManifest(valid);
  try {
    assert.deepEqual(loadM17ActivationManifest(path), valid);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects non-Tailnet, missing, broad-window, and stop-command drift', () => {
  for (const changed of [
    { tailnetTarget: 'https://example.com/classroom-screen' },
    { stopCommand: '/bin/true' },
    { observationEndsAt: '2035-05-14T00:00:00.000Z' },
    { comparisonEvidenceFingerprint: undefined },
  ]) {
    const { root, path } = protectedManifest({ ...valid, ...changed });
    try {
      assert.throws(() => loadM17ActivationManifest(path));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});
