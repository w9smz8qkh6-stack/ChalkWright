import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

function files(directory: string): readonly string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory()
      ? files(path)
      : entry.isFile() && path.endsWith('.ts')
        ? [path]
        : [];
  });
}

test('operations reporting and decisions cannot reach providers, Calendar writers, HTTP, or local commands', () => {
  const paths = [
    ...files('src/domain/operations'),
    ...files('src/application/operations'),
    resolve('src/ports/operations.ts'),
  ];
  for (const path of paths) {
    const source = readFileSync(path, 'utf8');
    assert.doesNotMatch(
      source,
      /calendar-writer|CalendarWriterPort|LocalCommandPort|read-sources|PowerSchool|google-classroom|OpenClaw|infrastructure\/http/iu,
      path,
    );
  }
});

test('alert decisions remain transport-neutral and fake transport has no writer capability', () => {
  const decisions = readFileSync('src/domain/operations/alerts.ts', 'utf8');
  const fake = readFileSync(
    'src/infrastructure/operations/fake-alert-transport.ts',
    'utf8',
  );
  assert.doesNotMatch(decisions, /transport|node:|infrastructure/iu);
  assert.doesNotMatch(
    fake,
    /calendar-writer|persistence-write|local-command|node:http|node:https/iu,
  );
});

test('bounded job entrypoint contains no shell, subprocess, executable, or free-form path surface', () => {
  const source = readFileSync('src/entrypoints/job.ts', 'utf8');
  assert.doesNotMatch(
    source,
    /child_process|execFile|spawn\(|eval\(|shell|LocalCommandPort/iu,
  );
  assert.match(source, /parseJobArguments/);
  assert.match(source, /arguments_\.length !== 1/);
});
