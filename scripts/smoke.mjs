import assert from 'node:assert/strict';

const { main } = await import('../dist/index.js');
const result = main({
  NODE_ENV: 'production',
  LOG_LEVEL: 'warn',
});

assert.deepEqual(result, {
  message: 'Chalkwright ready (production, warn)',
});

process.stdout.write(
  'Compiled startup orchestration passed its smoke check.\n',
);
