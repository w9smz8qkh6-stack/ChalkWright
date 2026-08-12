import assert from 'node:assert/strict';
import test from 'node:test';

import {
  decideAlert,
  emptyAlertState,
  isAlertDecision,
} from '../../../src/domain/operations/alerts.js';
import {
  issueFingerprint,
  type OperationalIssue,
  type OperationalIssueCode,
} from '../../../src/domain/operations/health.js';

const scope = {
  kind: 'screen' as const,
  screenId: 'screen-a',
  roomId: 'room-a',
  targetDate: '2035-04-13',
};

function issue(code: OperationalIssueCode): OperationalIssue {
  return {
    code,
    severity: code.includes('stale') ? 'warning' : 'error',
    scope,
    fingerprint: issueFingerprint(code, scope)!,
  };
}

const firstIssue = issue('standalone-not-ready');
const secondIssue = issue('preview-diagnostics-error');

function decide(
  issues: readonly OperationalIssue[],
  previousState: unknown,
  evaluatedAt: string,
  deliveryMode: 'send' | 'no-send' = 'send',
) {
  return decideAlert({
    issues,
    previousState,
    evaluatedAt,
    repeatAfterSeconds: 3_600,
    deliveryMode,
  });
}

test('alert decisions cover new, unchanged, and exact repeat boundary', () => {
  const created = decide([firstIssue], emptyAlertState, '2035-04-13T08:00:00Z');
  assert.ok(created);
  assert.equal(created.kind, 'new');
  assert.equal(created.shouldSend, true);
  assert.equal(isAlertDecision(created), true);

  const unchanged = decide(
    [firstIssue],
    created.nextState,
    '2035-04-13T08:59:59.999Z',
  );
  assert.ok(unchanged);
  assert.equal(unchanged.kind, 'unchanged');
  assert.equal(unchanged.shouldSend, false);

  const repeat = decide(
    [firstIssue],
    created.nextState,
    '2035-04-13T09:00:00Z',
  );
  assert.ok(repeat);
  assert.equal(repeat.kind, 'repeat');
  assert.equal(repeat.shouldSend, true);
});

test('alert decisions cover recovery and mixed deltas', () => {
  const created = decide([firstIssue], emptyAlertState, '2035-04-13T08:00:00Z');
  assert.ok(created);
  const recovery = decide([], created.nextState, '2035-04-13T08:10:00Z');
  assert.ok(recovery);
  assert.equal(recovery.kind, 'recovery');
  assert.deepEqual(recovery.recoveredFingerprints, [firstIssue.fingerprint]);

  const mixed = decide(
    [secondIssue],
    created.nextState,
    '2035-04-13T08:10:00Z',
  );
  assert.ok(mixed);
  assert.equal(mixed.kind, 'mixed');
  assert.deepEqual(mixed.addedFingerprints, [secondIssue.fingerprint]);
  assert.deepEqual(mixed.recoveredFingerprints, [firstIssue.fingerprint]);
});

test('no-send records active observation without fabricating delivery state', () => {
  const decision = decide(
    [firstIssue],
    emptyAlertState,
    '2035-04-13T08:00:00Z',
    'no-send',
  );
  assert.ok(decision);
  assert.equal(decision.kind, 'no-send');
  assert.equal(decision.shouldSend, false);
  assert.deepEqual(decision.nextState.activeFingerprints, [
    firstIssue.fingerprint,
  ]);
  assert.deepEqual(decision.nextState.notifiedFingerprints, []);
  assert.equal(decision.nextState.lastNotifiedAt, undefined);

  const laterSend = decide(
    [firstIssue],
    decision.nextState,
    '2035-04-13T08:05:00Z',
  );
  assert.ok(laterSend);
  assert.equal(laterSend.kind, 'new');
});

test('alert input ordering is immaterial and output is canonical', () => {
  const first = decide(
    [firstIssue, secondIssue],
    emptyAlertState,
    '2035-04-13T08:00:00Z',
  );
  const second = decide(
    [secondIssue, firstIssue, secondIssue],
    emptyAlertState,
    '2035-04-13T08:00:00Z',
  );
  assert.ok(first);
  assert.ok(second);
  assert.deepEqual(first, second);
});

test('alert decisions reject invalid state, times, durations, and hostile inputs', () => {
  assert.equal(
    decideAlert({
      issues: [firstIssue],
      previousState: emptyAlertState,
      evaluatedAt: '2035-02-30T08:00:00Z',
      repeatAfterSeconds: 3_600,
      deliveryMode: 'send',
    }),
    undefined,
  );
  assert.equal(
    decideAlert({
      issues: [firstIssue],
      previousState: {
        activeFingerprints: [firstIssue.fingerprint],
        notifiedFingerprints: [firstIssue.fingerprint],
        lastNotifiedAt: '2035-04-13T09:00:00Z',
      },
      evaluatedAt: '2035-04-13T08:59:59.999Z',
      repeatAfterSeconds: 3_600,
      deliveryMode: 'send',
    }),
    undefined,
  );
  assert.equal(
    decideAlert({
      issues: [firstIssue],
      previousState: emptyAlertState,
      evaluatedAt: '2035-04-13T08:00:00Z',
      repeatAfterSeconds: Number.NaN,
      deliveryMode: 'send',
    }),
    undefined,
  );
  const sparse = Array<OperationalIssue>(1);
  assert.equal(
    decideAlert({
      issues: sparse,
      previousState: emptyAlertState,
      evaluatedAt: '2035-04-13T08:00:00Z',
      repeatAfterSeconds: 3_600,
      deliveryMode: 'send',
    }),
    undefined,
  );
  const hostile = new Proxy(firstIssue, {
    getPrototypeOf() {
      throw new Error('hostile');
    },
  });
  assert.doesNotThrow(() =>
    decideAlert({
      issues: [hostile],
      previousState: emptyAlertState,
      evaluatedAt: '2035-04-13T08:00:00Z',
      repeatAfterSeconds: 3_600,
      deliveryMode: 'send',
    }),
  );
});
