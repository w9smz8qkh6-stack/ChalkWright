import assert from 'node:assert/strict';
import test from 'node:test';

import { inspectFixtureText } from '../../scripts/lib/fixture-safety.mjs';

test('accepts clearly synthetic fixture text', () => {
  assert.deepEqual(
    inspectFixtureText(
      JSON.stringify({
        fixtureId: 'schedule-normal',
        roomId: 'room-alpha',
        courseKey: 'course-alpha',
      }),
    ),
    [],
  );
});

test('accepts the reserved synthetic fixture URL host', () => {
  assert.deepEqual(
    inspectFixtureText('https://fixture.example.invalid/material'),
    [],
  );
});

test('rejects routable lookalikes of the reserved synthetic URL host', () => {
  for (const value of [
    'https://fixture.example.invalid.evil.example/path',
    'https://fixture.example.invalid@evil.example/path',
    'https://fixture.example.invalid:443/path',
  ]) {
    assert.ok(
      inspectFixtureText(value).some(
        (finding) => finding.ruleId === 'absolute-url',
      ),
      value,
    );
  }
});

test('accepts the serialized compiled fixture catalog', async () => {
  const { scheduleFixtureCatalog } =
    await import('../../.test-dist/test/fixtures/schedule-cases.js');

  assert.deepEqual(
    inspectFixtureText(JSON.stringify(scheduleFixtureCatalog), 'catalog'),
    [],
  );
});

test('rejects representative sensitive and live-looking fixture content', () => {
  const unsafeSamples = [
    ['provider-token', 'token=sk-abcdefghijklmnopqrstuvwxyz012345'],
    ['email-or-calendar-address', 'calendar=user@example.invalid'],
    ['absolute-url', 'url=https://private.example.invalid/path'],
    ['private-host-or-address', 'host=display.internal'],
    ['live-uuid', 'id=123e4567-e89b-12d3-a456-426614174000'],
    ['long-numeric-identifier', 'id=123456789012345'],
    ['long-provider-identifier', 'courseId=syntheticlongidentifier'],
    ['student-record-field', 'studentName=Example'],
    ['credential-or-capture-field', 'rawHtml=<html>'],
    ['unsafe-absolute-path', 'path=/srv/example/state.json'],
  ];

  for (const [expectedRule, sample] of unsafeSamples) {
    assert.ok(
      inspectFixtureText(sample).some(
        (finding) => finding.ruleId === expectedRule,
      ),
      `expected ${expectedRule} to reject its sample`,
    );
  }
});
