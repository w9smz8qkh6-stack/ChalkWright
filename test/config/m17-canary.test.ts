import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { loadM17CanaryCalendarConfig } from '../../src/config/m17-canary.js';

const digest = (value: string): string =>
  `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;

function payload(root: string) {
  const calendarId = 'auto-lesson-2@example.test';
  return {
    version: 1,
    kind: 'chalkwright-m17-parallel-canary',
    calendarSummary: 'Auto Lesson 2',
    calendarId,
    calendarReferenceHash: digest(calendarId),
    deniedCalendarReferenceHashes: [
      digest('primary'),
      digest('legacy@example.test'),
    ],
    scopeId: 'chalkwright-c509-2026-27-canary',
    timeZone: 'Asia/Ho_Chi_Minh',
    productionConfigReference: join(root, 'server.json'),
    credentialReferencePath: join(root, 'writer.json'),
    databasePath: join(root, 'state.sqlite'),
    requestTimeoutMs: 15_000,
    overallTimeoutMs: 180_000,
    leaseDurationSeconds: 300,
    maximumPages: 5,
    maximumEvents: 100,
  };
}

test('loads only the exact protected Auto Lesson 2 canary boundary', () => {
  const root = mkdtempSync(join(tmpdir(), 'chalkwright-m17-config-'));
  const path = join(root, 'calendar.json');
  try {
    chmodSync(root, 0o700);
    writeFileSync(path, JSON.stringify(payload(root)), { mode: 0o600 });
    assert.equal(
      loadM17CanaryCalendarConfig(path, '/repository').calendarSummary,
      'Auto Lesson 2',
    );
    for (const change of [
      { calendarId: 'primary', calendarReferenceHash: digest('primary') },
      { calendarSummary: 'Auto Lesson' },
      { scopeId: 'chalkwright-c509-2026-27' },
      {
        deniedCalendarReferenceHashes: [
          digest('primary'),
          digest(payload(root).calendarId),
        ],
      },
      { unexpected: true },
    ]) {
      writeFileSync(path, JSON.stringify({ ...payload(root), ...change }), {
        mode: 0o600,
      });
      assert.throws(
        () => loadM17CanaryCalendarConfig(path, '/repository'),
        /invalid/u,
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects permissive and repository-contained canary references', () => {
  const root = mkdtempSync(join(tmpdir(), 'chalkwright-m17-config-'));
  const path = join(root, 'calendar.json');
  try {
    writeFileSync(path, JSON.stringify(payload(root)), { mode: 0o644 });
    chmodSync(path, 0o644);
    assert.throws(() => loadM17CanaryCalendarConfig(path, '/repository'));
    chmodSync(path, 0o600);
    writeFileSync(
      path,
      JSON.stringify({
        ...payload(root),
        databasePath: '/repository/state.sqlite',
      }),
      { mode: 0o600 },
    );
    assert.throws(() => loadM17CanaryCalendarConfig(path, '/repository'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
