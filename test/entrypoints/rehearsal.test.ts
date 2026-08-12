import assert from 'node:assert/strict';
import test from 'node:test';

import { runOfflineOperationsRehearsal } from '../../src/entrypoints/rehearsal.js';

test('offline operations rehearsal completes only against temporary synthetic state', async () => {
  assert.deepEqual(await runOfflineOperationsRehearsal(), {
    jobs: 6,
    successful: 6,
  });
});
