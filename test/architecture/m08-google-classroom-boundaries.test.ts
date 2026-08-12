import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve('.');

test('M-08 grants exactly one canonical Classroom teacher read scope', () => {
  const config = source('src/config/google-classroom.ts');
  const official = source(
    'src/infrastructure/google-classroom/official-client.ts',
  );
  const combined = `${config}\n${official}`;
  assert.deepEqual(
    combined.match(/https:\/\/www\.googleapis\.com\/auth\/[A-Za-z0-9._/-]+/gu),
    [
      'https://www.googleapis.com/auth/classroom.student-submissions.students.readonly',
    ],
  );
  assert.doesNotMatch(combined, /classroom\.courses\.readonly/u);
  assert.doesNotMatch(combined, /classroom\.rosters/u);
});

test('official-client capability exposes only the fixed courseWork.list read', () => {
  const official = source(
    'src/infrastructure/google-classroom/official-client.ts',
  );
  assert.match(official, /client\.courses\.courseWork\.list\(/u);
  assert.match(official, /courseWorkStates: \['PUBLISHED'\]/u);
  assert.match(official, /retry: false/u);
  assert.doesNotMatch(
    official,
    /\.courses\.(?:list|get|create|patch|update|delete)\(/u,
  );
  assert.doesNotMatch(
    official,
    /\.courseWork\.(?:create|patch|update|delete|modifyAssignees)\(/u,
  );
  assert.doesNotMatch(official, /requestBody/u);
});

test('Classroom refresh stays out of display request paths and unrelated Google products', () => {
  const implementation = [
    'src/application/classroom/refresh.ts',
    'src/infrastructure/google-classroom/adapter.ts',
    'src/infrastructure/google-classroom/contracts.ts',
    'src/infrastructure/google-classroom/official-client.ts',
  ]
    .map(source)
    .join('\n');
  assert.doesNotMatch(
    implementation,
    /@googleapis\/(?:gmail|calendar|drive|people|admin)|\.students\.|\.studentSubmissions\./iu,
  );
  for (const path of [
    'src/index.ts',
    'src/application/display/controller.ts',
    'src/infrastructure/http/server.ts',
    'src/app/mvp-server.ts',
  ]) {
    const file = source(path);
    assert.doesNotMatch(file, /google-classroom|classroom\/refresh/u);
  }
});

test('the official Classroom dependency is exact-version pinned', () => {
  const manifest = JSON.parse(source('package.json')) as {
    dependencies?: Record<string, string>;
  };
  assert.equal(manifest.dependencies?.['@googleapis/classroom'], '14.0.0');
});

test('the Classroom handler is enabled only through an explicitly composed isolated entrypoint', () => {
  const registry = source('src/application/operations/registry.ts');
  const entrypoint = source('src/entrypoints/job.ts');
  assert.match(
    registry,
    /name: 'classroom-refresh',\s*availability: 'implemented',\s*effect: 'read-only'/u,
  );
  assert.doesNotMatch(
    entrypoint,
    /classroom\/job-handler|google-classroom|loadGoogleClassroomReadConfig/u,
  );
  const shadow = source('src/entrypoints/shadow-job.ts');
  assert.match(shadow, /createClassroomRefreshJobHandler/u);
  assert.match(shadow, /jobName === 'classroom-refresh'/u);
});

function source(path: string): string {
  return readFileSync(resolve(root, path), 'utf8');
}
