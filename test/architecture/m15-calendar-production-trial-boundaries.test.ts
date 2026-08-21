import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

function files(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}

test('M-15 live authority is absent from services, jobs, and routine application paths', () => {
  const prohibited = [
    'src/app',
    'src/application/operations',
    'src/application/shadow',
    'systemd',
  ];
  for (const root of prohibited)
    for (const path of files(root)) {
      const content = readFileSync(path, 'utf8');
      assert.doesNotMatch(
        content,
        /production-trial|M15ProductionTrial|m15-calendar/u,
        path,
      );
    }
});

test('only the current M-17 Calendar entrypoint and writer client import the official production transport pair', () => {
  const matches = files('src')
    .filter((path) => path.endsWith('.ts'))
    .filter((path) =>
      readFileSync(path, 'utf8').includes(
        'loadOfficialCalendarProductionTrialTransports',
      ),
    );
  assert.deepEqual(
    matches.sort(),
    [
      'src/entrypoints/m17-canary-calendar-sync.ts',
      'src/infrastructure/google-calendar/official-writer-client.ts',
    ].sort(),
  );
});

test('synthetic policy injection is unreachable from production entrypoints', () => {
  for (const path of files('src/entrypoints')) {
    const content = readFileSync(path, 'utf8');
    assert.doesNotMatch(
      content,
      /createSyntheticM15ProductionTrialEngine/u,
      path,
    );
  }
});

test('obsolete M-15 entrypoints and OpenClaw writer adapter are absent', () => {
  for (const path of [
    'src/config/m15-calendar-production-trial.ts',
    'src/entrypoints/m15-calendar-production-trial.ts',
    'src/entrypoints/m15-provision.ts',
    'src/infrastructure/openclaw/legacy-writer-exclusion.ts',
  ]) {
    assert.equal(existsSync(path), false, path);
  }
});
