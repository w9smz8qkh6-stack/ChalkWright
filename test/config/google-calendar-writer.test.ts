import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  linkSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { loadGoogleCalendarWriterConfig } from '../../src/config/google-calendar-writer.js';

const digest = (value: string): string =>
  `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;

test('loads only an exact protected nonproduction writer configuration', () => {
  const root = mkdtempSync(join(tmpdir(), 'm14-writer-config-'));
  const path = join(root, 'writer.json');
  const calendarId = 'm14-calendar@example.test';
  const value = {
    version: 1,
    environment: 'non-production',
    calendarSummary: 'Auto Lesson 2',
    calendarId,
    calendarReferenceHash: digest(calendarId),
    productionCalendarReferenceHash: digest('production@example.test'),
    qualificationRunId: 'm14-test-run-01',
    approvalIssuedAt: '2035-04-13T06:55:00.000Z',
    approvalExpiresAt: '2035-04-13T07:10:00.000Z',
    scopeId: 'classroom-hub-m14-auto-lesson-2',
    timeZone: 'Asia/Ho_Chi_Minh',
    credentialReferencePath: join(root, 'writer-oauth.json'),
    databasePath: join(root, 'writer.sqlite'),
    requestTimeoutMs: 15_000,
    overallTimeoutMs: 180_000,
    leaseDurationSeconds: 300,
  };
  try {
    writeFileSync(path, JSON.stringify(value), { mode: 0o600 });
    assert.deepEqual(
      loadGoogleCalendarWriterConfig(path, '/repository'),
      value,
    );

    for (const invalid of [
      { ...value, calendarId: 'primary' },
      { ...value, calendarReferenceHash: digest('other') },
      {
        ...value,
        productionCalendarReferenceHash: value.calendarReferenceHash,
      },
      { ...value, calendarSummary: 'Production' },
      { ...value, approvalExpiresAt: '2035-04-13T07:10:00.001Z' },
      { ...value, approvalIssuedAt: '2035-04-13T07:10:00.000Z' },
      { ...value, credentialReferencePath: '/repository/secret.json' },
      { ...value, unexpected: true },
    ]) {
      writeFileSync(path, JSON.stringify(invalid), { mode: 0o600 });
      assert.throws(
        () => loadGoogleCalendarWriterConfig(path, '/repository'),
        /calendar-writer-config-invalid/u,
      );
    }

    writeFileSync(path, JSON.stringify(value), { mode: 0o600 });
    chmodSync(path, 0o640);
    assert.throws(
      () => loadGoogleCalendarWriterConfig(path, '/repository'),
      /calendar-writer-config-unsafe/u,
    );
    chmodSync(path, 0o600);

    const hardLink = join(root, 'hard-link.json');
    linkSync(path, hardLink);
    assert.throws(
      () => loadGoogleCalendarWriterConfig(path, '/repository'),
      /calendar-writer-config-unsafe/u,
    );
    unlinkSync(hardLink);

    const symlink = join(root, 'link.json');
    symlinkSync(path, symlink);
    assert.throws(
      () => loadGoogleCalendarWriterConfig(symlink, '/repository'),
      /calendar-writer-config-unsafe/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
