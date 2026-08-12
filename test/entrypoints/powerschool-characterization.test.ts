import assert from 'node:assert/strict';
import test from 'node:test';

import {
  main,
  runM07bPowerSchoolProfilePreflight,
} from '../../src/entrypoints/powerschool-characterization.js';

test('managed-profile preflight records a validated zero-request failure without a source capability', () => {
  const result = runM07bPowerSchoolProfilePreflight({
    clock: { now: () => '2026-08-09T04:30:00.000Z' },
  });
  assert.equal(result.status, 'failed');
  assert.deepEqual(result.evidence, {
    evidenceVersion: '1.0.0',
    requestedDate: '2026-08-10',
    startedAt: '2026-08-09T04:30:00.000Z',
    completedAt: '2026-08-09T04:30:00.000Z',
    deleteAfter: '2026-08-16T04:30:00.000Z',
    outcome: 'failed',
    authenticationClassification: 'not-checked',
    topLevelRequests: 0,
    aggregateResponseBytes: 0,
    aggregateDurationMs: 0,
    selectedTransports: [],
    surfaces: [],
    normalizedSummary: {
      fieldNames: [],
      periodCount: 0,
      roomKeyCount: 0,
    },
    codes: ['profile-write-not-authorized'],
    lastKnownGoodPreserved: false,
    fingerprint: null,
    failureCode: 'profile-write-not-authorized',
  });

  const outside = runM07bPowerSchoolProfilePreflight({
    clock: { now: () => '2026-08-09T05:24:00.000Z' },
  });
  assert.equal(outside.evidence.failureCode, 'outside-window');
  assert.equal(outside.evidence.topLevelRequests, 0);
});

test('runtime renderer accepts no path, profile, source, or network capability', () => {
  assert.equal(main.length, 0);
  const evidence = JSON.parse(main()) as Record<string, unknown>;
  assert.equal(evidence.topLevelRequests, 0);
  assert.deepEqual(evidence.surfaces, []);
  assert.deepEqual(evidence.selectedTransports, []);
  const startedAt = String(evidence.startedAt);
  assert.equal(
    evidence.failureCode,
    startedAt >= '2026-08-09T04:24:00.000Z' &&
      startedAt < '2026-08-09T05:24:00.000Z'
      ? 'profile-write-not-authorized'
      : 'outside-window',
  );
  for (const forbidden of [
    'profilePath',
    'origin',
    'url',
    'cookie',
    'header',
    'body',
  ]) {
    assert.equal(forbidden in evidence, false, forbidden);
  }
});
