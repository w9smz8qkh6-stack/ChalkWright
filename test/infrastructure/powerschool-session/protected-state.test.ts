import assert from 'node:assert/strict';
import {
  chmodSync,
  linkSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  acquirePowerSchoolSessionLock,
  loadFilteredPowerSchoolState,
  powerSchoolStatePath,
  writeFilteredPowerSchoolState,
  type FilteredPowerSchoolStorageState,
} from '../../../src/infrastructure/powerschool-session/protected-state.js';

const origin = 'https://powerschool.invalid';

function state(): FilteredPowerSchoolStorageState {
  return {
    cookies: [
      {
        name: 'synthetic_session',
        value: 'valid',
        domain: 'powerschool.invalid',
        path: '/',
        expires: -1,
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
      },
    ],
    origins: [],
  };
}

test('atomically stores only a strict owner-only filtered state file', () => {
  const parent = mkdtempSync(join(tmpdir(), 'm07c-state-'));
  const directory = join(parent, 'session');
  try {
    writeFilteredPowerSchoolState(directory, origin, state());
    const path = powerSchoolStatePath(directory);
    assert.equal(statSync(directory).mode & 0o777, 0o700);
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.deepEqual(loadFilteredPowerSchoolState(directory, origin), state());
    assert.deepEqual(
      readdirSync(directory).filter((name) => name.endsWith('.tmp')),
      [],
    );
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test('rejects foreign origins, unknown fields, hard links, symlinks, and unsafe permissions', () => {
  const parent = mkdtempSync(join(tmpdir(), 'm07c-hostile-state-'));
  try {
    const foreignDirectory = join(parent, 'foreign');
    writeFilteredPowerSchoolState(foreignDirectory, origin, state());
    const path = powerSchoolStatePath(foreignDirectory);
    writeFileSync(
      path,
      JSON.stringify({
        cookies: state().cookies,
        origins: [{ origin: 'https://accounts.google.com', localStorage: [] }],
      }),
      { mode: 0o600 },
    );
    assert.throws(
      () => loadFilteredPowerSchoolState(foreignDirectory, origin),
      /state-unsafe/u,
    );

    writeFileSync(
      path,
      JSON.stringify({ ...state(), unexpected: 'identity-material' }),
      { mode: 0o600 },
    );
    assert.throws(
      () => loadFilteredPowerSchoolState(foreignDirectory, origin),
      /state-unsafe/u,
    );

    writeFileSync(
      path,
      JSON.stringify({
        cookies: [{ ...state().cookies[0], unexpected: 'identity-material' }],
        origins: [],
      }),
      { mode: 0o600 },
    );
    assert.throws(
      () => loadFilteredPowerSchoolState(foreignDirectory, origin),
      /state-unsafe/u,
    );

    writeFileSync(path, JSON.stringify(state()), { mode: 0o600 });
    const hardLink = join(parent, 'state-hard-link.json');
    linkSync(path, hardLink);
    assert.throws(
      () => loadFilteredPowerSchoolState(foreignDirectory, origin),
      /state-unsafe/u,
    );
    rmSync(hardLink);

    writeFileSync(
      path,
      JSON.stringify({
        cookies: [{ ...state().cookies[0], secure: 'yes' }],
        origins: [],
      }),
      { mode: 0o600 },
    );
    assert.throws(
      () => loadFilteredPowerSchoolState(foreignDirectory, origin),
      /state-unsafe/u,
    );

    const unsafeDirectory = join(parent, 'unsafe');
    writeFilteredPowerSchoolState(unsafeDirectory, origin, state());
    chmodSync(unsafeDirectory, 0o755);
    assert.throws(
      () => loadFilteredPowerSchoolState(unsafeDirectory, origin),
      /directory-unsafe/u,
    );

    const realDirectory = join(parent, 'real');
    writeFilteredPowerSchoolState(realDirectory, origin, state());
    const linkedDirectory = join(parent, 'linked');
    symlinkSync(realDirectory, linkedDirectory);
    assert.throws(
      () => loadFilteredPowerSchoolState(linkedDirectory, origin),
      /symlink/u,
    );
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test('refuses a second concurrent owner deterministically', () => {
  const parent = mkdtempSync(join(tmpdir(), 'm07c-lock-'));
  const directory = join(parent, 'session');
  const first = acquirePowerSchoolSessionLock(directory);
  try {
    assert.throws(
      () => acquirePowerSchoolSessionLock(directory),
      /session-concurrent/u,
    );
    assert.match(readFileSync(first.path, 'utf8'), /^\d+\n$/u);
  } finally {
    first.release();
    rmSync(parent, { recursive: true, force: true });
  }
});
