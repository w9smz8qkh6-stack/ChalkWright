import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync('src/application/comparison/m12-parity.ts', 'utf8');

test('M-12 comparison has no provider, Calendar, credential, browser, or command capability', () => {
  assert.doesNotMatch(
    source,
    /google-classroom|powerschool-session|calendar-writer|credential|1password|manual-bootstrap|playwright|chrom(?:e|ium)|child_process|local-command|fetch\s*\(|https?:\/\//iu,
  );
  assert.doesNotMatch(
    source,
    /writeCalendar|createEvent|updateEvent|deleteEvent|submit|acknowledge/iu,
  );
});

test('M-12 comparison depends only on finite contracts and existing safe-state evidence', () => {
  const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/gu)].map(
    ([, imported]) => imported,
  );
  assert.deepEqual(imports, [
    '../../contracts/v1/common.js',
    '../../contracts/v1/display.js',
    '../../domain/identities.js',
    '../../domain/runtime-validation.js',
    '../../ports/application-state.js',
  ]);
  assert.match(source, /kind: 'comparison-evidence'/u);
  assert.doesNotMatch(
    source,
    /title|url|classCode|courseKey|providerCourseKey|student|responseBody|html|cookie|token/iu,
  );
});
