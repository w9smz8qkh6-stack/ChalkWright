import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  calendarReferenceHash,
  loadProductionCalendarConfig,
} from '../../src/config/production-calendar.js';

function payload(root: string) {
  const calendarId = 'chalkwright-owned@example.test';
  return {
    version: 1,
    kind: 'chalkwright-production',
    calendarId,
    calendarReferenceHash: calendarReferenceHash(calendarId),
    deniedCalendarReferenceHashes: [
      calendarReferenceHash('primary'),
      calendarReferenceHash('retired@example.test'),
    ],
    scopeId: 'chalkwright-c509-2026-27-production',
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

test('loads only one exact owned production Calendar boundary', () => {
  const root = mkdtempSync(join(tmpdir(), 'chalkwright-production-calendar-'));
  const path = join(root, 'calendar.json');
  try {
    chmodSync(root, 0o700);
    writeFileSync(path, JSON.stringify(payload(root)), { mode: 0o600 });
    assert.equal(
      loadProductionCalendarConfig(path, '/repository').scopeId,
      'chalkwright-c509-2026-27-production',
    );
    for (const change of [
      {
        calendarId: 'primary',
        calendarReferenceHash: calendarReferenceHash('primary'),
      },
      { scopeId: 'chalkwright-c509-2026-27-canary' },
      {
        deniedCalendarReferenceHashes: [
          calendarReferenceHash('primary'),
          calendarReferenceHash(payload(root).calendarId),
        ],
      },
      { unexpected: true },
    ]) {
      writeFileSync(path, JSON.stringify({ ...payload(root), ...change }), {
        mode: 0o600,
      });
      assert.throws(
        () => loadProductionCalendarConfig(path, '/repository'),
        /invalid/u,
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
