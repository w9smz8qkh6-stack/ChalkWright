import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  assertInitializationConfig,
  assertProtectedDirectoryOwners,
  assertProtectedDirectoryPolicy,
  assertRootReleaseDirectoryPolicy,
  reserveDatabasePath,
} from '../../scripts/operations/initialize-m17-canary-state.mjs';

const exact = {
  instanceId: 'chalkwright-c509-canary-production',
  roomId: 'room-c509',
  screenId: 'screen-c509-canary-production',
  host: '127.0.0.1',
  port: 4319,
  timeZone: 'Asia/Ho_Chi_Minh',
  managedRoot: '/var/lib/chalkwright/canary-production',
  databasePath:
    '/var/lib/chalkwright/canary-production/state/chalkwright.sqlite',
  backupDirectory: '/var/lib/chalkwright/canary-production/backups',
};

test('M-17 initializer accepts only the exact isolated canary target', () => {
  assert.doesNotThrow(() => assertInitializationConfig(exact));
  for (const [key, value] of [
    ['instanceId', 'classroom-hub-c509-production'],
    ['roomId', 'room-b407'],
    ['screenId', 'screen-c509-production'],
    ['host', '0.0.0.0'],
    ['port', 4317],
    ['timeZone', 'Etc/UTC'],
    ['databasePath', '/tmp/chalkwright.sqlite'],
  ]) {
    assert.throws(
      () => assertInitializationConfig({ ...exact, [key]: value }),
      /m17-initialize-policy-invalid/u,
    );
  }
});

test('M-17 initializer drops root before imports and has no provider or service capability', () => {
  const source = readFileSync(
    'scripts/operations/initialize-m17-canary-state.mjs',
    'utf8',
  );
  assert.match(source, /process\.setgroups\(\[\]\)/u);
  assert.match(source, /process\.setgid\(target\.gid\)/u);
  assert.match(source, /process\.setuid\(target\.uid\)/u);
  assert.ok(
    source.indexOf('process.setuid(target.uid)') <
      source.indexOf('await Promise.all'),
  );
  assert.match(source, /readlinkSync\(current\)/u);
  assert.match(source, /releases\/\$\{releaseSha256\}/u);
  assert.match(source, /\$\{releaseDirectory\}\/dist\/infrastructure\/sqlite/u);
  assert.match(source, /constants\.O_EXCL/u);
  assert.match(source, /constants\.O_NOFOLLOW/u);
  assert.match(source, /protectedDirectory\(stateDirectory\)/u);
  assert.match(source, /protectedDirectory\(backupDirectory\)/u);
  assert.match(
    source,
    /import\(`file:\/\/\$\{releaseDirectory\}\/dist\/config\/production\.js`\)/u,
  );
  assert.doesNotMatch(
    source,
    /import\('file:\/\/\/opt\/chalkwright-canary\/current/u,
  );
  assert.match(source, /providerRequests: 0/u);
  assert.match(source, /servicesStarted: 0/u);
  assert.match(source, /routeChanges: 0/u);
  assert.doesNotMatch(
    source,
    /playwright|powerschool|googleapis|systemctl|systemd-run|child_process|execFile|execSync|spawn/u,
  );
});

test('M-17 initializer rejects unsafe fixed directory components', () => {
  const safe = {
    isDirectory: () => true,
    isSymbolicLink: () => false,
    mode: 0o40700,
  };
  assert.doesNotThrow(() =>
    assertProtectedDirectoryPolicy(safe, '/fixed/state', '/fixed/state'),
  );
  for (const unsafe of [
    { ...safe, isDirectory: () => false },
    { ...safe, isSymbolicLink: () => true },
    { ...safe, mode: 0o40750 },
  ]) {
    assert.throws(
      () =>
        assertProtectedDirectoryPolicy(unsafe, '/fixed/state', '/fixed/state'),
      /m17-initialize-directory-unsafe/u,
    );
  }
  assert.throws(
    () => assertProtectedDirectoryPolicy(safe, '/elsewhere', '/fixed/state'),
    /m17-initialize-directory-unsafe/u,
  );
});

test('M-17 initializer requires one exact non-root owner for all state directories', () => {
  const owner = { uid: 972, gid: 972 };
  assert.doesNotThrow(() =>
    assertProtectedDirectoryOwners(owner, owner, owner),
  );
  for (const values of [
    [{ uid: 0, gid: 0 }, owner, owner],
    [owner, { uid: 973, gid: 972 }, owner],
    [owner, owner, { uid: 972, gid: 973 }],
  ]) {
    assert.throws(
      () => assertProtectedDirectoryOwners(...values),
      /m17-initialize-owner-invalid/u,
    );
  }
});

test('M-17 initializer reserves the exact database path exclusively', () => {
  const directory = mkdtempSync(join(tmpdir(), 'chalkwright-m17-init-'));
  const path = join(directory, 'chalkwright.sqlite');
  try {
    const uid = process.geteuid();
    const gid = process.getegid();
    const reservation = reserveDatabasePath(path, uid, gid);
    assert.equal(typeof reservation.dev, 'number');
    assert.equal(typeof reservation.ino, 'number');
    assert.throws(
      () => reserveDatabasePath(path, uid, gid),
      /m17-initialize-state-exists/u,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('M-17 initializer rejects mutable or redirected release directories', () => {
  const safe = {
    isDirectory: () => true,
    isSymbolicLink: () => false,
    uid: 0,
    gid: 0,
    mode: 0o40755,
  };
  assert.doesNotThrow(() =>
    assertRootReleaseDirectoryPolicy(safe, '/fixed/release', '/fixed/release'),
  );
  for (const unsafe of [
    { ...safe, isDirectory: () => false },
    { ...safe, isSymbolicLink: () => true },
    { ...safe, uid: 972 },
    { ...safe, gid: 972 },
    { ...safe, mode: 0o40775 },
  ]) {
    assert.throws(
      () =>
        assertRootReleaseDirectoryPolicy(
          unsafe,
          '/fixed/release',
          '/fixed/release',
        ),
      /m17-initialize-release-invalid/u,
    );
  }
  assert.throws(
    () =>
      assertRootReleaseDirectoryPolicy(safe, '/redirected', '/fixed/release'),
    /m17-initialize-release-invalid/u,
  );
});
