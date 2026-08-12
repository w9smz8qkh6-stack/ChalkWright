import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const m05Files = [
  'src/app/mvp-controller.ts',
  'src/app/mvp-server.ts',
  'src/application/display/contracts.ts',
  'src/application/display/controller.ts',
  'src/infrastructure/fixture/b407.ts',
  'src/infrastructure/http/server.ts',
  'src/infrastructure/http/types.ts',
  'src/presentation/html.ts',
  'src/presentation/models.ts',
];

test('keeps the offline M-05 slice free of providers and external mutation capabilities', () => {
  for (const path of m05Files) {
    const source = readFileSync(path, 'utf8');
    assert.doesNotMatch(
      source,
      /calendar-writer|CalendarWriterPort|read-sources|PowerSchool|google-classroom|OpenClaw|provider SDK/iu,
      path,
    );
  }
});

test('keeps HTTP transport injected and presentation free of SQLite and HTTP authority', () => {
  const transport = readFileSync('src/infrastructure/http/server.ts', 'utf8');
  assert.match(transport, /ClassroomHttpController/iu);
  assert.doesNotMatch(transport, /sqlite|FixtureBackedDisplayController/iu);
  for (const path of [
    'src/presentation/html.ts',
    'src/presentation/models.ts',
    'src/presentation/display-client.ts',
  ]) {
    const source = readFileSync(path, 'utf8');
    assert.doesNotMatch(
      source,
      /node:sqlite|SqliteDatabase|SqliteApplicationStateRepository/iu,
      path,
    );
  }
});
