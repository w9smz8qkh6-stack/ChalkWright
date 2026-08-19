import assert from 'node:assert/strict';
import test from 'node:test';

import { m17ObservationRemainingMs } from '../../src/entrypoints/m17-canary-server.js';

test('canary server lifetime is bounded by the exact observation end', () => {
  assert.equal(
    m17ObservationRemainingMs(
      '2035-04-13T00:00:00.000Z',
      '2035-04-15T00:00:00.000Z',
    ),
    48 * 60 * 60_000,
  );
  assert.throws(
    () =>
      m17ObservationRemainingMs(
        '2035-04-15T00:00:00.000Z',
        '2035-04-15T00:00:00.000Z',
      ),
    /m17-server-window-expired/u,
  );
});
