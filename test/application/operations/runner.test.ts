import assert from 'node:assert/strict';
import test from 'node:test';

import { contractVersion } from '../../../src/contracts/v1/common.js';
import type { OperationsJobRunRecord } from '../../../src/ports/operations.js';
import type { PersistenceWriteResult } from '../../../src/ports/persistence-write.js';
import {
  OperationsJobRegistry,
  type OperationsJobRequest,
} from '../../../src/application/operations/registry.js';
import { runOperationsJob } from '../../../src/application/operations/runner.js';

const request: OperationsJobRequest = {
  jobName: 'operations-report',
  runId: 'synthetic-run',
  scopeId: 'synthetic-scope',
  requestedAt: '2035-04-13T07:00:00Z',
  deadlineAt: '2035-04-13T07:00:01Z',
};

const succeeded = {
  contractVersion,
  runId: request.runId,
  jobName: request.jobName,
  startedAt: request.requestedAt,
  finishedAt: request.requestedAt,
  diagnostics: [],
  category: 'succeeded',
  attemptedExternalMutations: 0,
  completedExternalMutations: 0,
  errors: [],
} as const;

function dependencies(options: {
  readonly handler?: () => Promise<typeof succeeded>;
  readonly store?: (
    record: OperationsJobRunRecord,
  ) => Promise<PersistenceWriteResult>;
}) {
  const records: OperationsJobRunRecord[] = [];
  return {
    records,
    value: {
      clock: { now: () => request.requestedAt },
      registry: new OperationsJobRegistry({
        'operations-report': options.handler ?? (async () => succeeded),
      }),
      state: {
        loadAlertCheckpoint: async () => undefined,
        listJobRuns: async () => [],
        storeAlertCheckpoint: async () => ({
          status: 'stored' as const,
          revision: 'alert-revision',
        }),
        storeJobRun: async (record: OperationsJobRunRecord) => {
          records.push(record);
          return options.store === undefined
            ? { status: 'stored' as const, revision: 'run-revision' }
            : options.store(record);
        },
      },
      hardStop: () => {
        throw new Error('unexpected-hard-stop');
      },
    },
  };
}

test('records every recognized successful job as a finite job-run record', async () => {
  const item = dependencies({});
  const result = await runOperationsJob(item.value, request);

  assert.equal(result.category, 'succeeded');
  assert.equal(item.records.length, 1);
  assert.deepEqual(item.records[0], {
    kind: 'job-run',
    recordKey: request.runId,
    scope: {},
    data: {
      outcome: {
        contractVersion,
        runId: request.runId,
        jobName: request.jobName,
        startedAt: request.requestedAt,
        finishedAt: request.requestedAt,
        diagnostics: [],
        category: 'succeeded',
        attemptedExternalMutations: 0,
        completedExternalMutations: 0,
      },
      errorCodes: [],
      incidentCodes: [],
      requestedDates: [],
      provenanceReferences: [request.scopeId],
    },
  });
});

test('sanitizes thrown handlers and records the failed outcome', async () => {
  const item = dependencies({
    handler: async () => {
      throw new Error('sensitive synthetic detail');
    },
  });
  const result = await runOperationsJob(item.value, request);

  assert.equal(result.category, 'failed');
  if (result.category === 'failed') {
    assert.equal(result.error.code, 'job-execution-failed');
    assert.doesNotMatch(result.error.message, /sensitive/u);
  }
  assert.deepEqual(item.records[0]?.data.errorCodes, ['job-execution-failed']);
});

test('bounds deadlines before dispatch and reports ledger rejection', async () => {
  let calls = 0;
  const expired = dependencies({
    handler: async () => {
      calls += 1;
      return succeeded;
    },
  });
  const expiredResult = await runOperationsJob(expired.value, {
    ...request,
    deadlineAt: '2035-04-13T07:00:00Z',
  });
  assert.equal(expiredResult.category, 'failed');
  assert.equal(calls, 0);

  const rejected = dependencies({
    store: async () => ({
      status: 'rejected',
      error: {
        category: 'unavailable',
        code: 'synthetic-ledger-rejected',
        message: 'Synthetic ledger rejected the write.',
        retryable: true,
        diagnostics: [],
      },
    }),
  });
  const rejectedResult = await runOperationsJob(rejected.value, request);
  assert.equal(rejectedResult.category, 'failed');
  if (rejectedResult.category === 'failed')
    assert.equal(rejectedResult.error.code, 'job-ledger-store-failed');
});

test('cooperative interruption aborts the handler and records a redacted failure', async () => {
  const controller = new AbortController();
  let received: AbortSignal | undefined;
  const item = dependencies({
    handler: async () =>
      new Promise<typeof succeeded>(() => {
        // The registry wrapper receives the same controller signal.
      }),
  });
  const registry = new OperationsJobRegistry({
    'operations-report': async (_request, signal) => {
      received = signal;
      return new Promise<typeof succeeded>((resolve) => {
        signal.addEventListener('abort', () => resolve(succeeded), {
          once: true,
        });
      });
    },
  });
  const running = runOperationsJob(
    { ...item.value, registry, signal: controller.signal },
    request,
  );
  controller.abort();
  const result = await running;
  assert.equal(received?.aborted, true);
  assert.equal(result.category, 'failed');
  if (result.category === 'failed')
    assert.equal(result.error.code, 'job-interrupted');
  assert.deepEqual(item.records[0]?.data.errorCodes, ['job-interrupted']);
});

test('deadline result waits for handler quiescence so no effect occurs afterward', async () => {
  let lateEffect = false;
  const item = dependencies({});
  const registry = new OperationsJobRegistry({
    'operations-report': async () => {
      await new Promise<void>((resolve) =>
        setTimeout(() => {
          lateEffect = true;
          resolve();
        }, 30),
      );
      return succeeded;
    },
  });
  const result = await runOperationsJob(
    { ...item.value, registry },
    {
      ...request,
      requestedAt: '2035-04-13T07:00:00.000Z',
      deadlineAt: '2035-04-13T07:00:00.010Z',
    },
  );
  assert.equal(result.category, 'failed');
  if (result.category === 'failed')
    assert.equal(result.error.code, 'job-deadline-exceeded');
  assert.equal(lateEffect, true);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(lateEffect, true);
});

test('hard stop remains bounded when best-effort ledger persistence never settles', async () => {
  const records: OperationsJobRunRecord[] = [];
  let stores = 0;
  let hardStops = 0;
  const registry = new OperationsJobRegistry({
    'operations-report': async () =>
      new Promise<typeof succeeded>(() => undefined),
  });
  const result = await runOperationsJob(
    {
      clock: { now: () => request.requestedAt },
      registry,
      state: {
        storeAlertCheckpoint: async () => ({
          status: 'stored' as const,
          revision: 'unused',
        }),
        storeJobRun: async (record) => {
          stores += 1;
          records.push(record);
          return stores === 1
            ? new Promise<PersistenceWriteResult>(() => undefined)
            : { status: 'stored' as const, revision: 'final-revision' };
        },
      },
      hardStop: () => {
        hardStops += 1;
        throw new Error('synthetic-hard-stop');
      },
    },
    {
      ...request,
      requestedAt: '2035-04-13T07:00:00.000Z',
      deadlineAt: '2035-04-13T07:00:00.010Z',
    },
  );
  assert.equal(hardStops, 1);
  assert.equal(stores, 2);
  assert.deepEqual(records[0]?.data.errorCodes, ['job-hard-stop-required']);
  assert.equal(result.category, 'failed');
});
