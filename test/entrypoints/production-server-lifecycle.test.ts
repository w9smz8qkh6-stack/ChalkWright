import assert from 'node:assert/strict';
import test from 'node:test';

import { waitForProductionServerShutdown } from '../../src/entrypoints/production-server.js';

test('production server remains alive until abort and closes exactly once', async () => {
  const controller = new AbortController();
  let closes = 0;
  let settled = false;
  const lifetime = waitForProductionServerShutdown(
    {
      close: async () => {
        closes += 1;
      },
    },
    controller.signal,
  ).then(() => {
    settled = true;
  });

  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  assert.equal(closes, 0);
  controller.abort('test-shutdown');
  controller.abort('duplicate-shutdown');
  await lifetime;
  assert.equal(settled, true);
  assert.equal(closes, 1);
});

test('production server closes immediately when startup signal is already aborted', async () => {
  const controller = new AbortController();
  controller.abort('pre-start-shutdown');
  let closes = 0;
  await waitForProductionServerShutdown(
    {
      close: async () => {
        closes += 1;
      },
    },
    controller.signal,
  );
  assert.equal(closes, 1);
});
