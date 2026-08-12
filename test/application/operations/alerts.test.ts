import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateOperationalAlerts } from '../../../src/application/operations/alerts.js';
import { buildOperationalReport } from '../../../src/domain/operations/health.js';
import { FakeAlertTransport } from '../../../src/infrastructure/operations/fake-alert-transport.js';
import type {
  AlertCheckpoint,
  OperationsJobRunRecord,
  OperationsRunLedgerQuery,
} from '../../../src/ports/operations.js';

const observedAt = '2035-04-13T07:00:00Z';

function report(ready: boolean) {
  const value = buildOperationalReport({
    generatedAt: observedAt,
    observations: [
      {
        check: 'catalog-coverage',
        observedAt,
        scope: { kind: 'global' },
        requiredCount: 1,
        availableCount: 1,
      },
      {
        check: 'source-sync',
        observedAt,
        scope: { kind: 'global' },
        state: 'current',
        lastSuccessfulAt: observedAt,
      },
      {
        check: 'assignment-freshness',
        observedAt,
        scope: {
          kind: 'screen',
          screenId: 'screen-b407',
          targetDate: '2035-04-13',
        },
        assignmentDate: '2035-04-13',
        freshness: 'fresh',
      },
      {
        check: 'standalone-readiness',
        observedAt,
        scope: { kind: 'global' },
        ready,
      },
      {
        check: 'compatibility-route',
        observedAt,
        scope: { kind: 'screen', screenId: 'screen-b407' },
        available: true,
      },
      {
        check: 'display-discovery',
        observedAt,
        scope: { kind: 'screen', screenId: 'screen-b407' },
        expectedCount: 1,
        discoveredCount: 1,
      },
      {
        check: 'preview-diagnostics',
        observedAt,
        scope: { kind: 'screen', screenId: 'screen-b407' },
        warningCount: 0,
        errorCount: 0,
      },
    ],
  });
  assert.ok(value);
  return value;
}

function state() {
  let checkpoint: AlertCheckpoint | undefined;
  return {
    get checkpoint() {
      return checkpoint;
    },
    port: {
      loadAlertCheckpoint: async () => checkpoint,
      listJobRuns: async (_query: OperationsRunLedgerQuery) =>
        [] as readonly OperationsJobRunRecord[],
      storeAlertCheckpoint: async (value: AlertCheckpoint) => {
        checkpoint = structuredClone(value);
        return {
          status: 'stored' as const,
          revision: 'synthetic-alert-revision',
        };
      },
      storeJobRun: async (_record: OperationsJobRunRecord) => ({
        status: 'stored' as const,
        revision: 'synthetic-run-revision',
      }),
    },
  };
}

test('report-only evaluation never invokes a transport or marks delivery', async () => {
  const storage = state();
  const result = await evaluateOperationalAlerts({
    report: report(false),
    evaluatedAt: observedAt,
    repeatAfterSeconds: 900,
    deliveryMode: 'report-only',
    state: storage.port,
  });

  assert.equal(result?.decision.kind, 'no-send');
  assert.equal(result?.decision.shouldSend, false);
  assert.equal(result?.checkpoint.deliveryState, 'not-attempted');
  assert.deepEqual(result?.checkpoint.lastSuccessfulIssueFingerprints, []);
});

test('fake delivery persists new, unchanged, and recovery checkpoints', async () => {
  const storage = state();
  const transport = new FakeAlertTransport();
  const first = await evaluateOperationalAlerts({
    report: report(false),
    evaluatedAt: observedAt,
    repeatAfterSeconds: 900,
    deliveryMode: 'fake',
    state: storage.port,
    transport,
  });
  assert.equal(first?.decision.kind, 'new');
  assert.equal(first?.checkpoint.deliveryState, 'delivered');
  assert.equal(transport.deliveries.length, 1);

  const unchanged = await evaluateOperationalAlerts({
    report: report(false),
    evaluatedAt: '2035-04-13T07:01:00Z',
    repeatAfterSeconds: 900,
    deliveryMode: 'fake',
    state: storage.port,
    transport,
  });
  assert.equal(unchanged?.decision.kind, 'unchanged');
  assert.equal(transport.deliveries.length, 1);

  const recovery = await evaluateOperationalAlerts({
    report: report(true),
    evaluatedAt: '2035-04-13T07:02:00Z',
    repeatAfterSeconds: 900,
    deliveryMode: 'fake',
    state: storage.port,
    transport,
  });
  assert.equal(recovery?.decision.kind, 'recovery');
  assert.deepEqual(recovery?.checkpoint.lastSuccessfulIssueFingerprints, []);
  assert.equal(transport.deliveries.length, 2);
});

test('failed delivery preserves prior success and retries a never-delivered set', async () => {
  const storage = state();
  const failing = new FakeAlertTransport('fail');
  const failed = await evaluateOperationalAlerts({
    report: report(false),
    evaluatedAt: observedAt,
    repeatAfterSeconds: 900,
    deliveryMode: 'fake',
    state: storage.port,
    transport: failing,
  });
  assert.equal(failed?.decision.kind, 'new');
  assert.equal(failed?.checkpoint.deliveryState, 'failed');
  assert.deepEqual(failed?.checkpoint.lastSuccessfulIssueFingerprints, []);

  const retry = await evaluateOperationalAlerts({
    report: report(false),
    evaluatedAt: '2035-04-13T07:01:00Z',
    repeatAfterSeconds: 900,
    deliveryMode: 'fake',
    state: storage.port,
    transport: new FakeAlertTransport(),
  });
  assert.equal(retry?.decision.kind, 'new');
  assert.equal(retry?.checkpoint.deliveryState, 'delivered');
});

test('concurrent evaluations sharing one state capability deliver only once', async () => {
  const storage = state();
  const transport = new FakeAlertTransport();
  const options = {
    report: report(false),
    evaluatedAt: observedAt,
    repeatAfterSeconds: 900,
    deliveryMode: 'fake' as const,
    state: storage.port,
    transport,
  };
  const results = await Promise.all([
    evaluateOperationalAlerts(options),
    evaluateOperationalAlerts(options),
  ]);
  assert.deepEqual(
    results.map((result) => result?.decision.kind),
    ['new', 'unchanged'],
  );
  assert.equal(transport.deliveries.length, 1);
});

test('caller abort reaches an in-flight delivery and retains retryable checkpoint state', async () => {
  const storage = state();
  const controller = new AbortController();
  let observedSignal: AbortSignal | undefined;
  let markDeliveryStarted = (): void => undefined;
  const deliveryStarted = new Promise<void>((resolve) => {
    markDeliveryStarted = resolve;
  });
  const evaluation = evaluateOperationalAlerts({
    report: report(false),
    evaluatedAt: observedAt,
    repeatAfterSeconds: 900,
    deliveryMode: 'fake',
    state: storage.port,
    signal: controller.signal,
    transport: {
      deliver: async (_decision, signal) => {
        observedSignal = signal;
        markDeliveryStarted();
        return await new Promise((resolve) => {
          signal?.addEventListener(
            'abort',
            () =>
              resolve({
                status: 'failed' as const,
                code: 'alert-delivery-aborted',
              }),
            { once: true },
          );
        });
      },
    },
  });
  await deliveryStarted;
  controller.abort('synthetic-abort');
  const result = await evaluation;
  assert.equal(observedSignal, controller.signal);
  assert.equal(result?.deliveryErrorCode, 'alert-delivery-aborted');
  assert.equal(result?.checkpoint.deliveryState, 'failed');
  assert.deepEqual(result?.checkpoint.lastSuccessfulIssueFingerprints, []);
});
