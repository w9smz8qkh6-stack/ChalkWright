import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('M-16 candidate installer is fixed, hash-bound, inert, and atomically switched', () => {
  const source = readFileSync(
    'scripts/operations/install-m16-candidate-v2.sh',
    'utf8',
  );
  assert.match(
    source,
    /source_sha256=5bec5c560768707f49c42cf7de3558f8f51b0723e4ee6730d705be79b7e01e6d/u,
  );
  assert.match(
    source,
    /previous_release=24234ad4c8263bba81d390eb3a8839e02585aa33204277b51f952a6a9a677b60/u,
  );
  assert.match(source, /sha256sum/u);
  assert.match(source, /mv -T/u);
  assert.match(source, /"servicesStarted":0/u);
  assert.match(source, /"routeChanges":0/u);
  assert.doesNotMatch(
    source,
    /systemctl|systemd-run|tailscale|curl|@google|powerschool|credential/u,
  );
});

test('M-16 canonical-invocation release advances only from the reviewed predecessor', () => {
  const source = readFileSync(
    'scripts/operations/install-m16-candidate-v3.sh',
    'utf8',
  );
  assert.match(
    source,
    /source_sha256=002264cb6de9d04f18a0da4737b71510981b3027d1cb9f18429a8bfab4d0c823/u,
  );
  assert.match(
    source,
    /previous_release=5bec5c560768707f49c42cf7de3558f8f51b0723e4ee6730d705be79b7e01e6d/u,
  );
  assert.match(source, /sha256sum/u);
  assert.match(source, /mv -T/u);
  assert.doesNotMatch(
    source,
    /systemctl|systemd-run|tailscale|curl|@google|powerschool|credential/u,
  );
});

test('M-16 alert qualification release advances inertly from the physical candidate', () => {
  const source = readFileSync(
    'scripts/operations/install-m16-alert-qualification.sh',
    'utf8',
  );
  assert.match(
    source,
    /source_sha256=a45b90c3414088871262a2f2954d2a89344d8b8c663e2fa7482448dccc763396/u,
  );
  assert.match(
    source,
    /previous_release=002264cb6de9d04f18a0da4737b71510981b3027d1cb9f18429a8bfab4d0c823/u,
  );
  assert.match(source, /sha256sum/u);
  assert.match(source, /mv -T/u);
  assert.match(source, /"servicesStarted":0/u);
  assert.match(source, /"messagesSent":0/u);
  assert.doesNotMatch(
    source,
    /systemctl|systemd-run|tailscale|curl|@google|powerschool|credential|telegram/u,
  );
});
