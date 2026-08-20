import assert from 'node:assert/strict';
import test from 'node:test';

import { sanitizedChromeEnvironment } from '../../../src/infrastructure/powerschool-session/browser-runtime.js';

test('headless Chrome receives no graphical-session environment', () => {
  assert.deepEqual(
    sanitizedChromeEnvironment(
      {
        DISPLAY: ':1',
        HOME: '/tmp/profile',
        LANG: 'C.UTF-8',
        PATH: '/usr/bin',
        WAYLAND_DISPLAY: 'wayland-1',
        XAUTHORITY: '/tmp/authority',
      },
      { headless: true },
    ),
    {
      HOME: '/tmp/profile',
      LANG: 'C.UTF-8',
      PATH: '/usr/bin',
    },
  );
});

test('headful Chrome retains its explicitly allowed graphical environment', () => {
  assert.deepEqual(
    sanitizedChromeEnvironment(
      {
        DISPLAY: ':1',
        HOME: '/tmp/profile',
        WAYLAND_DISPLAY: 'wayland-1',
        XAUTHORITY: '/tmp/authority',
      },
      { headless: false },
    ),
    {
      DISPLAY: ':1',
      HOME: '/tmp/profile',
      WAYLAND_DISPLAY: 'wayland-1',
      XAUTHORITY: '/tmp/authority',
    },
  );
});
