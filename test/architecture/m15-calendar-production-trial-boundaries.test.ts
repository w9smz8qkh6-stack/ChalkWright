import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
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

test('only the separate M-15 and M-17 Calendar entrypoints import the official production transport pair', () => {
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
      'src/entrypoints/m15-calendar-production-trial.ts',
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

test('M-15 entrypoint has no PowerSchool, Classroom, routing, or service capability', () => {
  const content = readFileSync(
    'src/entrypoints/m15-calendar-production-trial.ts',
    'utf8',
  );
  assert.doesNotMatch(
    content,
    /powerschool|google-classroom|systemctl|systemd|listen\(|createServer|route/u,
  );
});
