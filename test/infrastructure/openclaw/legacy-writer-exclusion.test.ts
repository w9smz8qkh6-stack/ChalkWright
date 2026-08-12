import assert from 'node:assert/strict';
import test from 'node:test';

import {
  legacyCalendarWriterJobId,
  verifyLegacyWriterExcluded,
  type OpenClawJsonRunner,
} from '../../../src/infrastructure/openclaw/legacy-writer-exclusion.js';

function runner(job: Record<string, unknown>): OpenClawJsonRunner {
  return {
    async run(_executable, arguments_) {
      assert.deepEqual(arguments_, [
        '--profile',
        'workonly',
        'cron',
        'list',
        '--all',
        '--json',
      ]);
      return { jobs: [job] };
    },
  };
}

const excluded = {
  id: legacyCalendarWriterJobId,
  name: 'PowerSchool Bell Calendar Sync',
  enabled: false,
  schedule: { kind: 'cron', expr: '0 6 * * *', tz: 'Asia/Ho_Chi_Minh' },
  state: { runningAtMs: null },
};

test('accepts only the exact disabled and quiescent legacy writer', async () => {
  const evidence = await verifyLegacyWriterExcluded({
    executablePath: '/opt/openclaw/bin/openclaw',
    profile: 'workonly',
    jobId: legacyCalendarWriterJobId,
    signal: new AbortController().signal,
    runner: runner(excluded),
  });
  assert.equal(evidence.enabled, false);
  assert.equal(evidence.running, false);
  assert.match(evidence.fingerprint, /^sha256:[a-f0-9]{64}$/u);
});

test('rejects enabled, running, renamed, rescheduled, duplicated, and missing jobs', async () => {
  const variants = [
    { ...excluded, enabled: true },
    { ...excluded, state: { runningAtMs: 123 } },
    { ...excluded, name: 'Different' },
    { ...excluded, schedule: { ...excluded.schedule, expr: '0 7 * * *' } },
  ];
  for (const job of variants)
    await assert.rejects(
      verifyLegacyWriterExcluded({
        executablePath: '/opt/openclaw/bin/openclaw',
        profile: 'workonly',
        jobId: legacyCalendarWriterJobId,
        signal: new AbortController().signal,
        runner: runner(job),
      }),
      /legacy-writer-exclusion-invalid/u,
    );
});
