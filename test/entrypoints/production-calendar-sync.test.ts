import assert from 'node:assert/strict';
import test from 'node:test';

import { runProductionCalendarSync } from '../../src/entrypoints/production-calendar-sync.js';

test('production Calendar sync requires its protected boundary before doing work', async () => {
  const output = await runProductionCalendarSync({
    arguments: ['--preflight'],
    environment: {},
  });

  assert.deepEqual(output, {
    exitCode: 1,
    status: 'failed',
    code: 'production-calendar-config-required',
    observedEventCount: 0,
    intentCount: 0,
    attemptedExternalMutations: 0,
    completedExternalMutations: 0,
  });
});
