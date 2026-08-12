import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { assertInitializationConfig } from '../../scripts/operations/initialize-m16-production-state.mjs';

const exact = {
  instanceId: 'classroom-hub-c509-production',
  roomId: 'room-c509',
  screenId: 'screen-c509-production',
  host: '127.0.0.1',
  port: 4317,
  timeZone: 'Asia/Ho_Chi_Minh',
  managedRoot: '/var/lib/classroom-hub/production',
  databasePath: '/var/lib/classroom-hub/production/state/classroom-hub.sqlite',
  backupDirectory: '/var/lib/classroom-hub/production/backups',
};

test('M-16 state initializer accepts only the exact inert production target', () => {
  assert.doesNotThrow(() => assertInitializationConfig(exact));
  for (const [key, value] of [
    ['instanceId', 'classroom-hub-shadow'],
    ['roomId', 'B407'],
    ['host', '0.0.0.0'],
    ['port', 20790],
    ['timeZone', 'Etc/UTC'],
    ['databasePath', '/tmp/classroom-hub.sqlite'],
  ]) {
    assert.throws(
      () => assertInitializationConfig({ ...exact, [key]: value }),
      /m16-initialize-policy-invalid/u,
    );
  }
});

test('M-16 state initializer has no provider, unit, route, or root runtime authority', () => {
  const source = readFileSync(
    'scripts/operations/initialize-m16-production-state.mjs',
    'utf8',
  );
  for (const forbidden of [
    "from '@googleapis/",
    'powerschool',
    'playwright',
    'tailscale',
    'systemctl',
    'child_process',
    '/etc/systemd/system',
  ]) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
  assert.match(source, /m16-initialize-root-refused/u);
  assert.match(source, /providerRequests: 0/u);
  assert.match(source, /servicesStarted: 0/u);
});
