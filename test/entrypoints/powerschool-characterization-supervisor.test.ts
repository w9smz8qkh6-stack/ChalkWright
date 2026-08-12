import assert from 'node:assert/strict';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { runSupervisedPowerSchoolCharacterization } from '../../src/entrypoints/powerschool-characterization-supervisor.js';

const designatedProfileReference = join(
  userInfo({ encoding: 'utf8' }).homedir,
  '.openclaw-workonly',
  'browser',
  'powerschool',
);

test('supervisor rejects an outside-window run before constructing its child', async () => {
  const result = await runSupervisedPowerSchoolCharacterization({
    profilePath: designatedProfileReference,
    clock: { now: () => '2026-08-09T05:24:00.000Z' },
  });
  assert.deepEqual(result, { status: 'failed', code: 'outside-window' });
});

test('supervisor rejects an alternate same-tail profile identity before access', async () => {
  const lookalike = join(
    tmpdir(),
    '.openclaw-workonly',
    'browser',
    'powerschool',
  );
  await assert.rejects(
    runSupervisedPowerSchoolCharacterization({
      profilePath: lookalike,
      clock: { now: () => '2026-08-09T04:30:00.000Z' },
    }),
    /profile-reference-invalid/u,
  );
});
