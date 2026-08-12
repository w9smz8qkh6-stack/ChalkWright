import assert from 'node:assert/strict';
import test from 'node:test';

import {
  contractVersion,
  type JobOutcome,
} from '../../src/contracts/v1/index.js';
import {
  type ActionableError,
  type JobResultContractIsV1Compatible,
  type TypedJobResult,
} from '../../src/domain/index.js';

const unavailableError: ActionableError = {
  category: 'unavailable',
  code: 'synthetic-source-unavailable',
  message: 'Synthetic source is unavailable.',
  retryable: true,
  diagnostics: [],
};

const repairError: ActionableError & {
  readonly category: 'authentication-repair-required';
} = {
  category: 'authentication-repair-required',
  code: 'synthetic-auth-repair',
  message: 'Synthetic authentication repair is required.',
  retryable: false,
  diagnostics: [],
};

function base(category: TypedJobResult['category']) {
  return {
    contractVersion,
    runId: `run-${category}`,
    jobName: 'synthetic-job',
    startedAt: '2035-02-20T05:00:00Z',
    finishedAt: '2035-02-20T05:00:01Z',
    diagnostics: [],
  } as const;
}

const jobResults: readonly TypedJobResult[] = [
  {
    ...base('succeeded'),
    category: 'succeeded',
    attemptedExternalMutations: 0,
    completedExternalMutations: 0,
    errors: [],
  },
  {
    ...base('degraded'),
    category: 'degraded',
    attemptedExternalMutations: 0,
    completedExternalMutations: 0,
    errors: [unavailableError],
  },
  {
    ...base('skipped'),
    category: 'skipped',
    attemptedExternalMutations: 0,
    completedExternalMutations: 0,
    reason: 'prerequisite-unavailable',
    errors: [unavailableError],
  },
  {
    ...base('repair-required'),
    category: 'repair-required',
    attemptedExternalMutations: 0,
    completedExternalMutations: 0,
    error: repairError,
  },
  {
    ...base('failed'),
    category: 'failed',
    attemptedExternalMutations: 0,
    completedExternalMutations: 0,
    error: unavailableError,
  },
];
const jobResultContractIsV1Compatible: JobResultContractIsV1Compatible = true;

function summarize(result: TypedJobResult): string {
  switch (result.category) {
    case 'succeeded':
      return 'succeeded';
    case 'degraded':
      return `degraded:${result.errors.length}`;
    case 'skipped':
      return `skipped:${result.reason}`;
    case 'repair-required':
      return `repair-required:${result.error.category}`;
    case 'failed':
      return `failed:${result.error.category}`;
    default: {
      const exhaustive: never = result;
      return exhaustive;
    }
  }
}

test('provides an exhaustive typed example for every job result', () => {
  assert.equal(jobResultContractIsV1Compatible, true);
  assert.deepEqual(
    jobResults.map((result) => result.category),
    ['succeeded', 'degraded', 'skipped', 'repair-required', 'failed'],
  );
  assert.deepEqual(jobResults.map(summarize), [
    'succeeded',
    'degraded:1',
    'skipped:prerequisite-unavailable',
    'repair-required:authentication-repair-required',
    'failed:unavailable',
  ]);

  const frozenOutcomes: readonly JobOutcome[] = jobResults;
  assert.equal(frozenOutcomes.length, 5);
});

test('makes repair-required structurally mutation-free', () => {
  const repairRequired = jobResults.find(
    (result) => result.category === 'repair-required',
  );

  assert.equal(repairRequired?.attemptedExternalMutations, 0);
  assert.equal(repairRequired?.completedExternalMutations, 0);
});
