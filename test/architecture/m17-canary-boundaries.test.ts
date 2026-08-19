import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('M-17 Calendar routine has no PowerSchool, Classroom, alert, route, or credential-repair capability', () => {
  const source = readFileSync(
    'src/entrypoints/m17-canary-calendar-sync.ts',
    'utf8',
  );
  for (const forbidden of [
    'powerschool',
    'google-classroom',
    'telegram',
    'tailscale',
    'one-password',
    'jit-repair',
  ])
    assert.doesNotMatch(
      source,
      new RegExp(`from ['\"][^'\"]*${forbidden}`, 'iu'),
    );
  assert.match(source, /loadM17CanaryCalendarConfig/u);
  assert.match(source, /loadOfficialCalendarProductionTrialTransports/u);
});

test('M-17 artifacts use only distinct canary roots and secondary Calendar name', () => {
  const manifest = readFileSync('systemd/m17/canary-manifest.json', 'utf8');
  assert.match(manifest, /Auto Lesson 2/u);
  assert.match(manifest, /\/var\/lib\/chalkwright\/canary-production/u);
  assert.doesNotMatch(manifest, /\/var\/lib\/classroom-hub\/production/u);
});

test('M-17 comparison and manifest verification remain provider-neutral', () => {
  const sources = [
    'src/application/comparison/m17-canary.ts',
    'src/entrypoints/m17-canary-comparison.ts',
    'src/entrypoints/m17-canary-activation-manifest.ts',
  ].map((path) => readFileSync(path, 'utf8'));
  for (const source of sources)
    for (const forbidden of [
      'google-calendar/official',
      'google-classroom',
      'powerschool-session',
      'telegram',
      'tailscale',
      'child_process',
    ])
      assert.doesNotMatch(
        source,
        new RegExp(`from ['"][^'"]*${forbidden}`, 'iu'),
      );
  assert.match(sources[0]!, /provider-generated IDs are unrepresentable/u);
  assert.match(sources[2]!, /comparisonEvidenceFingerprint/u);
});
