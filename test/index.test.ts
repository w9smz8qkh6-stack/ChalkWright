import assert from 'node:assert/strict';
import test from 'node:test';

import { main } from '../src/index.js';

test('validates configuration before invoking startup orchestration', () => {
  assert.deepEqual(main({ NODE_ENV: 'test', LOG_LEVEL: 'warn' }), {
    message: 'Chalkwright ready (test, warn)',
  });

  assert.throws(() => main({ NODE_ENV: 'unsupported' }), /NODE_ENV must be/);
});
