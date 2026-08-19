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
import { chromium, type BrowserContext } from 'playwright-core';

import {
  acquirePowerSchoolSessionLock,
  applyFilteredPowerSchoolState,
  filterPowerSchoolStorageState,
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

test('retains only an exact PowerSchool cookie partition without broadening it', () => {
  const [baseCookie] = state().cookies;
  assert.ok(baseCookie);
  const partitioned = {
    ...baseCookie,
    partitionKey: origin,
    _crHasCrossSiteAncestor: false,
  };
  const foreignPartition = {
    ...baseCookie,
    name: 'foreign_partition',
    partitionKey: 'https://accounts.google.com',
  };
  const incompletePartition = {
    ...baseCookie,
    name: 'incomplete_partition',
    partitionKey: origin,
  };
  assert.throws(
    () =>
      filterPowerSchoolStorageState({ cookies: [], origins: [] }, origin, [
        partitioned,
        foreignPartition,
      ]),
    /state-unsafe/u,
  );
  assert.throws(
    () =>
      filterPowerSchoolStorageState({ cookies: [], origins: [] }, origin, [
        partitioned,
        incompletePartition,
      ]),
    /state-unsafe/u,
  );
  const filtered = filterPowerSchoolStorageState(
    {
      cookies: [],
      origins: [],
    },
    origin,
    [partitioned],
  );
  assert.deepEqual(filtered, { cookies: [partitioned], origins: [] });

  const parent = mkdtempSync(join(tmpdir(), 'm07c-partitioned-state-'));
  const directory = join(parent, 'session');
  try {
    writeFilteredPowerSchoolState(directory, origin, filtered);
    assert.deepEqual(loadFilteredPowerSchoolState(directory, origin), filtered);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test('retains PSL-derived Chrome schemeful sites without accepting public suffixes', () => {
  const powerSchoolOrigin = 'https://powerschool.mytas.edu.vn';
  const [baseCookie] = state().cookies;
  assert.ok(baseCookie);
  const parentPartition = {
    ...baseCookie,
    domain: 'powerschool.mytas.edu.vn',
    partitionKey: 'https://mytas.edu.vn',
    _crHasCrossSiteAncestor: false,
  };
  assert.deepEqual(
    filterPowerSchoolStorageState(
      { cookies: [], origins: [] },
      powerSchoolOrigin,
      [parentPartition],
    ).cookies,
    [parentPartition],
  );
  assert.throws(
    () =>
      filterPowerSchoolStorageState(
        { cookies: [], origins: [] },
        powerSchoolOrigin,
        [{ ...parentPartition, partitionKey: 'https://edu.vn' }],
      ),
    /state-unsafe/u,
  );
  assert.equal(
    filterPowerSchoolStorageState(
      { cookies: [], origins: [] },
      'https://tenant.region.example.co.uk',
      [
        {
          ...parentPartition,
          domain: 'tenant.region.example.co.uk',
          partitionKey: 'https://example.co.uk',
        },
      ],
    ).cookies[0]?.partitionKey,
    'https://example.co.uk',
  );
});

test('restores local state before applying exact filtered cookies', async () => {
  const [baseCookie] = state().cookies;
  assert.ok(baseCookie);
  const partitioned = {
    ...baseCookie,
    partitionKey: origin,
    _crHasCrossSiteAncestor: true,
  };
  const calls: unknown[] = [];
  const context = {
    setStorageState: async (value: unknown) => {
      calls.push({ method: 'setStorageState', value });
    },
    addCookies: async (value: unknown) => {
      calls.push({ method: 'addCookies', value });
    },
  } as unknown as BrowserContext;

  await applyFilteredPowerSchoolState(context, {
    cookies: [partitioned],
    origins: [{ origin, localStorage: [{ name: 'safe', value: 'state' }] }],
  });

  assert.deepEqual(calls, [
    {
      method: 'setStorageState',
      value: {
        cookies: [],
        origins: [{ origin, localStorage: [{ name: 'safe', value: 'state' }] }],
      },
    },
    { method: 'addCookies', value: [partitioned] },
  ]);
});

test('round-trips both Chromium partition ancestor states in installed Chrome', async () => {
  const browser = await chromium.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: true,
  });
  try {
    const capture = await browser.newContext();
    const chromiumCookies = [
      {
        ...state().cookies[0],
        name: 'partitioned_same_site',
        sameSite: 'None',
        partitionKey: origin,
        _crHasCrossSiteAncestor: false,
      },
      {
        ...state().cookies[0],
        name: 'partitioned_cross_site',
        sameSite: 'None',
        partitionKey: origin,
        _crHasCrossSiteAncestor: true,
      },
    ];
    await capture.addCookies(
      chromiumCookies as unknown as Parameters<BrowserContext['addCookies']>[0],
    );
    const filtered = filterPowerSchoolStorageState(
      await capture.storageState(),
      origin,
      await capture.cookies(),
    );
    await capture.close();

    const restored = await browser.newContext();
    await applyFilteredPowerSchoolState(restored, filtered);
    const cookies = await restored.cookies();
    await restored.close();

    assert.deepEqual(
      cookies.map((cookie) => ({
        name: cookie.name,
        partitionKey: cookie.partitionKey,
        _crHasCrossSiteAncestor: (
          cookie as typeof cookie & {
            _crHasCrossSiteAncestor?: boolean;
          }
        )._crHasCrossSiteAncestor,
      })),
      [
        {
          name: 'partitioned_same_site',
          partitionKey: origin,
          _crHasCrossSiteAncestor: false,
        },
        {
          name: 'partitioned_cross_site',
          partitionKey: origin,
          _crHasCrossSiteAncestor: true,
        },
      ],
    );
  } finally {
    await browser.close();
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
      JSON.stringify({
        cookies: [
          {
            ...state().cookies[0],
            partitionKey: origin,
          },
        ],
        origins: [],
      }),
      { mode: 0o600 },
    );
    assert.throws(
      () => loadFilteredPowerSchoolState(foreignDirectory, origin),
      /state-unsafe/u,
    );

    writeFileSync(
      path,
      JSON.stringify({
        cookies: [
          {
            ...state().cookies[0],
            partitionKey: 'https://accounts.google.com',
          },
        ],
        origins: [],
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
