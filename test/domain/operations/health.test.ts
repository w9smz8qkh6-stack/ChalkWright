import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildOperationalReport,
  isOperationalObservation,
  isOperationalReport,
  issueFingerprint,
  type OperationalObservation,
} from '../../../src/domain/operations/health.js';

const observedAt = '2035-04-13T07:00:00Z';
const screenA = {
  kind: 'screen' as const,
  screenId: 'screen-a',
  roomId: 'room-a',
  targetDate: '2035-04-13',
};

function healthyObservations(): OperationalObservation[] {
  return [
    {
      check: 'catalog-coverage',
      observedAt,
      scope: { kind: 'global' },
      requiredCount: 6,
      availableCount: 6,
    },
    {
      check: 'source-sync',
      observedAt,
      scope: { kind: 'global' },
      state: 'current',
      lastSuccessfulAt: '2035-04-13T06:55:00Z',
    },
    {
      check: 'assignment-freshness',
      observedAt,
      scope: screenA,
      assignmentDate: '2035-04-13',
      freshness: 'fresh',
    },
    {
      check: 'standalone-readiness',
      observedAt,
      scope: { kind: 'global' },
      ready: true,
    },
    {
      check: 'compatibility-route',
      observedAt,
      scope: screenA,
      available: true,
    },
    {
      check: 'display-discovery',
      observedAt,
      scope: screenA,
      expectedCount: 1,
      discoveredCount: 1,
    },
    {
      check: 'preview-diagnostics',
      observedAt,
      scope: screenA,
      warningCount: 0,
      errorCount: 0,
    },
  ];
}

test('HEALTH-003 builder requires every check and produces a strict healthy report', () => {
  const report = buildOperationalReport({
    generatedAt: '2035-04-13T07:01:00Z',
    observations: healthyObservations().reverse(),
  });
  assert.ok(report);
  assert.equal(report.status, 'healthy');
  assert.deepEqual(report.issues, []);
  assert.equal(isOperationalReport(report), true);
  const source = healthyObservations();
  const detached = buildOperationalReport({
    generatedAt: '2035-04-13T07:01:00Z',
    observations: source,
  });
  assert.ok(detached);
  const originalScreen = source.find(
    (entry) => entry.check === 'compatibility-route',
  );
  assert.ok(originalScreen);
  if (originalScreen.scope.kind === 'screen')
    (originalScreen.scope as { screenId: string }).screenId = 'changed';
  const detachedCompatibility = detached.observations.find(
    (entry) => entry.check === 'compatibility-route',
  );
  assert.ok(detachedCompatibility);
  assert.equal(detachedCompatibility.scope.kind, 'screen');
  if (detachedCompatibility.scope.kind === 'screen')
    assert.equal(detachedCompatibility.scope.screenId, 'screen-a');
  assert.equal(
    buildOperationalReport({
      generatedAt: '2035-04-13T07:01:00Z',
      observations: healthyObservations().slice(1),
    }),
    undefined,
  );
});

test('degraded checks emit stable redacted issues in deterministic order', () => {
  const observations = healthyObservations().map((entry) => {
    if (entry.check === 'catalog-coverage')
      return { ...entry, availableCount: 5 };
    if (entry.check === 'source-sync')
      return { ...entry, state: 'stale' as const };
    if (entry.check === 'preview-diagnostics')
      return { ...entry, warningCount: 2 };
    return entry;
  });
  const first = buildOperationalReport({
    generatedAt: '2035-04-13T07:01:00Z',
    observations,
  });
  const reorderedAndLater = buildOperationalReport({
    generatedAt: '2035-04-13T08:30:00Z',
    observations: [...observations].reverse().map((entry) => ({
      ...entry,
      observedAt: '2035-04-13T08:29:00Z',
    })),
  });
  assert.ok(first);
  assert.ok(reorderedAndLater);
  assert.equal(first.status, 'unhealthy');
  assert.deepEqual(
    first.issues.map(({ code, fingerprint }) => ({ code, fingerprint })),
    reorderedAndLater.issues.map(({ code, fingerprint }) => ({
      code,
      fingerprint,
    })),
  );
  assert.deepEqual(
    first.issues.map((entry) => entry.fingerprint),
    [...first.issues.map((entry) => entry.fingerprint)].sort(),
  );
  assert.doesNotMatch(JSON.stringify(first), /message|https?:|recipient/iu);
});

test('issue fingerprints bind code and complete multi-screen scope only', () => {
  const scopeB = {
    kind: 'screen' as const,
    screenId: 'screen-b',
    roomId: 'room-b',
    targetDate: '2035-04-13',
  };
  const a = issueFingerprint('preview-diagnostics-error', screenA);
  const b = issueFingerprint('preview-diagnostics-error', scopeB);
  assert.ok(a);
  assert.ok(b);
  assert.notEqual(a, b);
  assert.equal(
    a,
    issueFingerprint('preview-diagnostics-error', { ...screenA }),
  );
  assert.notEqual(a, issueFingerprint('preview-diagnostics-warning', screenA));
});

test('observation validation rejects wrong relationships and unsafe fields', () => {
  const assignment = healthyObservations().find(
    (entry) => entry.check === 'assignment-freshness',
  );
  assert.ok(assignment);
  assert.equal(
    isOperationalObservation({
      ...assignment,
      scope: { kind: 'screen', screenId: 'screen-a' },
    }),
    false,
  );
  const sync = healthyObservations().find(
    (entry) => entry.check === 'source-sync',
  );
  assert.ok(sync);
  assert.equal(
    isOperationalObservation({
      ...sync,
      lastSuccessfulAt: '2035-04-13T07:00:00.001Z',
    }),
    false,
  );
  assert.equal(
    isOperationalObservation({ ...assignment, assignmentDate: '2035-02-30' }),
    false,
  );
  assert.equal(
    isOperationalObservation({
      ...assignment,
      message: 'unsafe diagnostic prose',
    }),
    false,
  );
  assert.equal(
    isOperationalObservation({
      check: 'catalog-coverage',
      observedAt,
      scope: screenA,
      requiredCount: 1,
      availableCount: 1,
    }),
    false,
  );
  assert.equal(
    isOperationalObservation({
      check: 'display-discovery',
      observedAt,
      scope: screenA,
      expectedCount: Number.POSITIVE_INFINITY,
      discoveredCount: 1,
    }),
    false,
  );
});

test('validators fail closed for sparse, cyclic, accessor, and hostile inputs', () => {
  const sparse = Array<OperationalObservation>(7);
  assert.equal(
    buildOperationalReport({ generatedAt: observedAt, observations: sparse }),
    undefined,
  );

  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  assert.equal(isOperationalObservation(cyclic), false);

  const accessor = { ...healthyObservations()[0] };
  Object.defineProperty(accessor, 'requiredCount', {
    enumerable: true,
    get() {
      throw new Error('must not execute');
    },
  });
  assert.doesNotThrow(() => isOperationalObservation(accessor));
  assert.equal(isOperationalObservation(accessor), false);

  const hostile = new Proxy(healthyObservations()[0]!, {
    ownKeys() {
      throw new Error('hostile');
    },
  });
  assert.doesNotThrow(() => isOperationalObservation(hostile));
  assert.equal(isOperationalObservation(hostile), false);
});
