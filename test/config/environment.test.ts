import assert from 'node:assert/strict';
import test from 'node:test';

import { loadConfig } from '../../src/config/environment.js';

test('loads safe defaults from an empty environment', () => {
  assert.deepEqual(loadConfig({}), {
    nodeEnv: 'development',
    logLevel: 'info',
    host: '127.0.0.1',
    port: 4317,
  });
});

test('rejects unsupported configuration values', () => {
  assert.throws(
    () => loadConfig({ NODE_ENV: 'invalid' }),
    /NODE_ENV must be one of/,
  );
  assert.throws(
    () => loadConfig({ CLASSROOM_HUB_HOST: '0.0.0.0' }),
    /CLASSROOM_HUB_HOST must be one of/,
  );
  assert.throws(
    () => loadConfig({ CLASSROOM_HUB_PORT: '65536' }),
    /CLASSROOM_HUB_PORT must be an integer/,
  );
  assert.throws(
    () => loadConfig({ CLASSROOM_HUB_OPERATOR_TOKEN: 'too-short' }),
    /CLASSROOM_HUB_OPERATOR_TOKEN must be empty or/,
  );
});

test('accepts only bounded loopback server configuration', () => {
  assert.deepEqual(
    loadConfig({
      NODE_ENV: 'test',
      CLASSROOM_HUB_HOST: '::1',
      CLASSROOM_HUB_PORT: '0',
      CLASSROOM_HUB_OPERATOR_TOKEN: 'synthetic-local-authority',
    }),
    {
      nodeEnv: 'test',
      logLevel: 'info',
      host: '::1',
      port: 0,
      operatorToken: 'synthetic-local-authority',
    },
  );
});
