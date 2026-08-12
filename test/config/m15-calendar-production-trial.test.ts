import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { loadM15CalendarProductionTrialConfig } from '../../src/config/m15-calendar-production-trial.js';

function digest(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

function value(root: string) {
  const calendarId = 'production-calendar@example.test';
  return {
    version: 1,
    environment: 'production-trial',
    date: '2026-08-11',
    calendarId,
    calendarReferenceHash: digest(calendarId),
    scopeId: 'classroom-hub-c509-2026-27',
    timeMin: '2026-08-10T17:00:00.000Z',
    timeMax: '2026-08-11T17:00:00.000Z',
    timeZone: 'Asia/Ho_Chi_Minh',
    roomId: 'C509',
    screenId: 'c509-display',
    credentialReferencePath: join(root, 'writer.json'),
    sourceManagedRoot: join(root, 'shadow'),
    sourceDatabasePath: join(root, 'shadow/state.sqlite'),
    sourceBackupDirectory: join(root, 'shadow/backups'),
    trialManagedRoot: join(root, 'trial'),
    trialDatabasePath: join(root, 'trial/execution.sqlite'),
    preparedStatePath: join(root, 'trial/prepared.json'),
    approvalStatePath: join(root, 'trial/approval.json'),
    requestTimeoutMs: 15_000,
    overallTimeoutMs: 180_000,
    leaseDurationSeconds: 300,
    maximumPages: 5,
    maximumEvents: 100,
    maximumWindowDays: 1,
    legacyOpenClawPath: '/opt/openclaw/bin/openclaw',
    legacyProfile: 'workonly',
    legacyCronJobId: 'c174a3b2-1e75-49c5-94da-1b45f2c2f649',
  };
}

test('loads only the exact fixed M-15 production trial boundary', () => {
  const root = mkdtempSync(join(tmpdir(), 'm15-config-'));
  const path = join(root, 'config.json');
  try {
    chmodSync(root, 0o700);
    writeFileSync(path, JSON.stringify(value(root)), { mode: 0o600 });
    assert.equal(
      loadM15CalendarProductionTrialConfig(path, '/repository').date,
      '2026-08-11',
    );
    for (const changed of [
      { calendarId: 'primary', calendarReferenceHash: digest('primary') },
      { date: '2026-08-12' },
      { scopeId: 'another-scope' },
      { timeMax: '2026-08-12T17:00:00.000Z' },
      { legacyProfile: 'default' },
      { trialDatabasePath: join(root, 'shadow/trial.sqlite') },
      { unexpected: true },
    ]) {
      writeFileSync(path, JSON.stringify({ ...value(root), ...changed }), {
        mode: 0o600,
      });
      assert.throws(
        () => loadM15CalendarProductionTrialConfig(path, '/repository'),
        /m15-production-config-invalid/u,
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects permissive, linked, and repository-contained config references', () => {
  const root = mkdtempSync(join(tmpdir(), 'm15-config-'));
  const path = join(root, 'config.json');
  try {
    mkdirSync(join(root, 'repo'), { mode: 0o700 });
    writeFileSync(path, JSON.stringify(value(root)), { mode: 0o644 });
    chmodSync(path, 0o644);
    assert.throws(() => loadM15CalendarProductionTrialConfig(path, '/repo'));
    chmodSync(path, 0o600);
    const inside = value(root);
    inside.credentialReferencePath = join(root, 'repo/writer.json');
    writeFileSync(path, JSON.stringify(inside), { mode: 0o600 });
    assert.throws(() =>
      loadM15CalendarProductionTrialConfig(path, join(root, 'repo')),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
