import assert from 'node:assert/strict';
import test from 'node:test';

import { run } from '../../src/app/run.js';

test('reports readiness without performing external work', () => {
  const result = run({
    nodeEnv: 'test',
    logLevel: 'info',
    host: '127.0.0.1',
    port: 0,
  });

  assert.deepEqual(result, {
    message: 'Chalkwright ready (test, info)',
  });
});
