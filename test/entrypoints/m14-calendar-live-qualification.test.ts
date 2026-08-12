import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  m14LiveApprovalFingerprint,
  m14RuntimeImplementationFingerprint,
  runM14LiveQualificationEntrypoint,
} from '../../src/entrypoints/m14-calendar-live-qualification.js';

const digest = (value: string): string =>
  `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
const implementationFingerprint = `sha256:${'a'.repeat(64)}`;

function config(root: string) {
  const calendarId = 'm14-calendar@example.test';
  return {
    version: 1 as const,
    environment: 'non-production' as const,
    calendarSummary: 'Auto Lesson 2' as const,
    calendarId,
    calendarReferenceHash: digest(calendarId),
    productionCalendarReferenceHash: digest('production@example.test'),
    qualificationRunId: 'm14-entrypoint-test-01',
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
}

test('approval binds every material configuration field, mode, and implementation', () => {
  const value = config('/external');
  const baseline = m14LiveApprovalFingerprint(value, implementationFingerprint);
  const variants = [
    { ...value, qualificationRunId: 'm14-entrypoint-test-02' },
    { ...value, approvalIssuedAt: '2035-04-13T06:56:00.000Z' },
    { ...value, approvalExpiresAt: '2035-04-13T07:09:00.000Z' },
    { ...value, scopeId: 'different-scope' },
    { ...value, timeZone: 'Etc/UTC' },
    { ...value, requestTimeoutMs: 14_000 },
    { ...value, overallTimeoutMs: 179_000 },
    { ...value, leaseDurationSeconds: 299 },
    { ...value, credentialReferencePath: '/other/writer.json' },
    { ...value, databasePath: '/other/writer.sqlite' },
  ];
  for (const variant of variants)
    assert.notEqual(
      m14LiveApprovalFingerprint(variant, implementationFingerprint),
      baseline,
    );
  assert.notEqual(
    m14LiveApprovalFingerprint(value, `sha256:${'b'.repeat(64)}`),
    baseline,
  );
  assert.notEqual(
    m14LiveApprovalFingerprint(value, implementationFingerprint, 'recover'),
    baseline,
  );
});

test('runtime approval identity covers the complete source and compiled trees', () => {
  assert.match(m14RuntimeImplementationFingerprint(), /^sha256:[a-f0-9]{64}$/u);
  const fingerprintSource = readFileSync(
    'src/infrastructure/filesystem/runtime-fingerprint.ts',
    'utf8',
  );
  assert.match(
    fingerprintSource,
    /collectRegularFiles\(\s*join\(repositoryRoot, 'src'\),\s*'\.ts'/u,
  );
  assert.match(
    fingerprintSource,
    /collectRegularFiles\(\s*compiledRoot,\s*'\.js'/u,
  );
  assert.match(fingerprintSource, /package-lock\.json/u);
});

test('entrypoint prints mode-specific approval only inside the protected window', async () => {
  const root = mkdtempSync(join(tmpdir(), 'm14-entrypoint-'));
  const path = join(root, 'writer.json');
  try {
    writeFileSync(path, JSON.stringify(config(root)), { mode: 0o600 });
    const environment = {
      CLASSROOM_HUB_M14_WRITER_CONFIG_REFERENCE: path,
    };
    const execute = await runM14LiveQualificationEntrypoint({
      arguments: ['--print-approval-fingerprint'],
      environment,
      clock: () => '2035-04-13T07:00:00.000Z',
    });
    const recover = await runM14LiveQualificationEntrypoint({
      arguments: ['--print-recovery-approval-fingerprint'],
      environment,
      clock: () => '2035-04-13T07:00:00.000Z',
    });
    assert.equal(execute.mode, 'approval');
    assert.equal(recover.mode, 'approval');
    assert.notEqual(execute.approvalFingerprint, recover.approvalFingerprint);
    await assert.rejects(
      runM14LiveQualificationEntrypoint({
        arguments: ['--print-approval-fingerprint'],
        environment,
        clock: () => '2035-04-13T07:08:00.001Z',
      }),
      /m14-live-approval-expired/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
