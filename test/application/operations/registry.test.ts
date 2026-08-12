import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { contractVersion } from '../../../src/contracts/v1/common.js';
import {
  isOperationsJobRequest,
  isTypedJobResult,
  OperationsJobRegistry,
  OperationsJobRequestError,
  operationsJobDefinitions,
  operationsJobNames,
  type OperationsJobRequest,
} from '../../../src/application/operations/registry.js';

const request: OperationsJobRequest = {
  jobName: 'operations-report',
  runId: 'synthetic-run',
  scopeId: 'synthetic-operations',
  requestedAt: '2035-04-13T07:00:00Z',
  deadlineAt: '2035-04-13T07:01:00Z',
};

const succeeded = {
  contractVersion,
  runId: 'synthetic-run',
  jobName: 'operations-report',
  startedAt: request.requestedAt,
  finishedAt: request.requestedAt,
  diagnostics: [],
  category: 'succeeded',
  attemptedExternalMutations: 0,
  completedExternalMutations: 0,
  errors: [],
} as const;

test('registers every finite job exactly once and preserves deferred ordering', () => {
  assert.deepEqual(
    operationsJobDefinitions.map((entry) => entry.name),
    operationsJobNames,
  );
  assert.equal(new Set(operationsJobNames).size, operationsJobNames.length);
  assert.deepEqual(
    operationsJobDefinitions.find(
      (entry) => entry.name === 'calendar-reconcile',
    )?.prerequisites,
    ['source-auth-preflight'],
  );
  assert.equal(
    operationsJobDefinitions.find(
      (entry) => entry.name === 'calendar-reconcile',
    )?.availability,
    'deferred',
  );
});

test('registry names exactly match the inert cadence manifest', () => {
  const manifest = JSON.parse(
    readFileSync('systemd/cadence-manifest.json', 'utf8'),
  ) as { readonly jobs: readonly { readonly name: string }[] };
  assert.deepEqual(
    manifest.jobs.map((job) => job.name).sort(),
    [...operationsJobNames].sort(),
  );
});

test('dispatches only implemented handlers and validates their result', async () => {
  let calls = 0;
  const registry = new OperationsJobRegistry({
    'operations-report': async () => {
      calls += 1;
      return succeeded;
    },
  });

  assert.deepEqual(
    await registry.execute(request, new AbortController().signal),
    succeeded,
  );
  assert.equal(calls, 1);
  await assert.rejects(
    registry.execute(
      { ...request, jobName: 'sqlite-integrity' },
      new AbortController().signal,
    ),
    (error: unknown) =>
      error instanceof OperationsJobRequestError &&
      error.code === 'job-handler-invalid',
  );
});

test('deferred jobs are structurally skipped without invoking a handler', async () => {
  const registry = new OperationsJobRegistry({});
  const result = await registry.execute(
    { ...request, jobName: 'calendar-reconcile' },
    new AbortController().signal,
  );

  assert.equal(result.category, 'skipped');
  assert.equal(result.attemptedExternalMutations, 0);
  assert.equal(result.completedExternalMutations, 0);
  assert.equal(result.jobName, 'calendar-reconcile');
});

test('rejects unknown, malformed, expired, and augmented requests before dispatch', async () => {
  let calls = 0;
  const registry = new OperationsJobRegistry({
    'operations-report': async () => {
      calls += 1;
      return succeeded;
    },
  });
  const cases: unknown[] = [
    { ...request, jobName: 'Operations-Report' },
    { ...request, scopeId: '' },
    { ...request, deadlineAt: request.requestedAt },
    { ...request, executable: '/bin/sh' },
    { ...request, requestedAt: 'a' },
  ];
  for (const candidate of cases) {
    assert.equal(isOperationsJobRequest(candidate), false);
    await assert.rejects(
      registry.execute(
        candidate as OperationsJobRequest,
        new AbortController().signal,
      ),
      OperationsJobRequestError,
    );
  }
  assert.equal(calls, 0);
});

test('typed job results cover all categories and reject unsafe extra fields', () => {
  const error = {
    category: 'unavailable',
    code: 'synthetic-unavailable',
    message: 'Synthetic dependency is unavailable.',
    retryable: true,
    diagnostics: [],
  } as const;
  const { errors: _successfulErrors, ...common } = succeeded;
  const results = [
    succeeded,
    { ...common, category: 'degraded', errors: [error] },
    {
      ...common,
      category: 'skipped',
      reason: 'not-required',
      errors: [],
    },
    {
      ...common,
      category: 'repair-required',
      error: { ...error, category: 'authentication-repair-required' },
    },
    { ...common, category: 'failed', error },
  ];
  assert.deepEqual(results.map(isTypedJobResult), [
    true,
    true,
    true,
    true,
    true,
  ]);
  assert.equal(isTypedJobResult({ ...succeeded, token: 'synthetic' }), false);
});
