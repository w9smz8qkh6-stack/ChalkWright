import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  parse,
  relative,
  resolve,
  sep,
} from 'node:path';

import type { BrowserContext } from 'playwright-core';

const stateFileName = '.classroom-hub-auth-state.json';
const lockFileName = '.classroom-hub-session.lock';
const maximumStateBytes = 256 * 1024;
export const temporaryProfilePrefix = 'classroom-hub-powerschool-session-';
export const jitRepairTemporaryProfilePrefix =
  'classroom-hub-powerschool-jit-repair-';

export type FilteredPowerSchoolStorageState = Exclude<
  Parameters<BrowserContext['setStorageState']>[0],
  string
>;

export interface PowerSchoolSessionLock {
  readonly path: string;
  release(): void;
}

export function ensureProtectedSessionDirectory(
  path: string,
  options: { readonly create: boolean },
): void {
  validateAbsoluteTarget(path);
  assertNoSymlinkComponents(path);
  if (!existsSync(path)) {
    if (!options.create) throw new Error('powerschool-session-state-missing');
    mkdirSync(path, { recursive: true, mode: 0o700 });
    chmodSync(path, 0o700);
  }
  const state = lstatSync(path);
  if (
    state.isSymbolicLink() ||
    !state.isDirectory() ||
    state.uid !== effectiveUid() ||
    (state.mode & 0o777) !== 0o700 ||
    realpathSync(path) !== path
  ) {
    throw new Error('powerschool-session-directory-unsafe');
  }
}

export function acquirePowerSchoolSessionLock(
  sessionDirectory: string,
): PowerSchoolSessionLock {
  ensureProtectedSessionDirectory(sessionDirectory, { create: true });
  const path = join(sessionDirectory, lockFileName);
  let descriptor: number;
  try {
    descriptor = openSync(
      path,
      constants.O_CREAT |
        constants.O_EXCL |
        constants.O_WRONLY |
        constants.O_NOFOLLOW,
      0o600,
    );
  } catch (error: unknown) {
    if (isErrno(error, 'EEXIST')) {
      throw new Error('powerschool-session-concurrent');
    }
    throw new Error('powerschool-session-lock-unsafe');
  }
  const identity = fstatSync(descriptor);
  writeFileSync(descriptor, `${process.pid}\n`, { encoding: 'utf8' });
  fsyncSync(descriptor);
  let released = false;
  return {
    path,
    release: () => {
      if (released) return;
      released = true;
      closeSync(descriptor);
      try {
        const current = lstatSync(path);
        if (
          current.isSymbolicLink() ||
          current.dev !== identity.dev ||
          current.ino !== identity.ino
        ) {
          throw new Error('powerschool-session-lock-changed');
        }
        unlinkSync(path);
      } catch (error: unknown) {
        if (!isErrno(error, 'ENOENT')) throw error;
      }
    },
  };
}

export function loadFilteredPowerSchoolState(
  sessionDirectory: string,
  powerSchoolOrigin: string,
): FilteredPowerSchoolStorageState {
  ensureProtectedSessionDirectory(sessionDirectory, { create: false });
  const path = join(sessionDirectory, stateFileName);
  let descriptor: number;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error: unknown) {
    if (isErrno(error, 'ENOENT')) {
      throw new Error('powerschool-session-state-missing');
    }
    throw new Error('powerschool-session-state-unsafe');
  }
  try {
    const state = fstatSync(descriptor);
    if (
      !state.isFile() ||
      state.nlink !== 1 ||
      state.uid !== effectiveUid() ||
      (state.mode & 0o777) !== 0o600 ||
      state.size < 2 ||
      state.size > maximumStateBytes
    ) {
      throw new Error('powerschool-session-state-unsafe');
    }
    const parsed: unknown = JSON.parse(readFileSync(descriptor, 'utf8'));
    assertFilteredState(parsed, powerSchoolOrigin);
    return parsed as FilteredPowerSchoolStorageState;
  } catch (error: unknown) {
    if (error instanceof Error && error.message.startsWith('powerschool-')) {
      throw error;
    }
    throw new Error('powerschool-session-state-unsafe');
  } finally {
    closeSync(descriptor);
  }
}

export function filterPowerSchoolStorageState(
  state: Awaited<ReturnType<BrowserContext['storageState']>>,
  powerSchoolOrigin: string,
): FilteredPowerSchoolStorageState {
  const host = new URL(powerSchoolOrigin).hostname;
  const filtered = {
    cookies: state.cookies
      .filter((cookie) => cookieBelongsToHost(cookie.domain, host))
      .map((cookie) => ({
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path,
        expires: cookie.expires,
        httpOnly: cookie.httpOnly,
        secure: cookie.secure,
        sameSite: cookie.sameSite,
      })),
    origins: state.origins
      .filter((origin) => origin.origin === powerSchoolOrigin)
      .map((origin) => {
        const indexedDB = (
          origin as typeof origin & { readonly indexedDB?: readonly unknown[] }
        ).indexedDB;
        return {
          origin: origin.origin,
          localStorage: origin.localStorage.map((item) => ({
            name: item.name,
            value: item.value,
          })),
          ...(indexedDB === undefined ? {} : { indexedDB }),
        };
      }),
  };
  assertFilteredState(filtered, powerSchoolOrigin);
  return filtered;
}

export function writeFilteredPowerSchoolState(
  sessionDirectory: string,
  powerSchoolOrigin: string,
  state: FilteredPowerSchoolStorageState,
): void {
  ensureProtectedSessionDirectory(sessionDirectory, { create: true });
  assertFilteredState(state, powerSchoolOrigin);
  const serialized = JSON.stringify(state);
  if (Buffer.byteLength(serialized, 'utf8') > maximumStateBytes) {
    throw new Error('powerschool-session-state-too-large');
  }
  const target = join(sessionDirectory, stateFileName);
  if (existsSync(target)) assertSafeStateFile(target);
  const temporary = join(
    sessionDirectory,
    `${stateFileName}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`,
  );
  let descriptor: number | undefined;
  try {
    descriptor = openSync(
      temporary,
      constants.O_CREAT |
        constants.O_EXCL |
        constants.O_WRONLY |
        constants.O_NOFOLLOW,
      0o600,
    );
    writeFileSync(descriptor, serialized, { encoding: 'utf8' });
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    chmodSync(temporary, 0o600);
    renameSync(temporary, target);
    chmodSync(target, 0o600);
    const directoryDescriptor = openSync(
      sessionDirectory,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    try {
      fsyncSync(directoryDescriptor);
    } finally {
      closeSync(directoryDescriptor);
    }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

export function createTemporaryBrowserProfile(
  prefix:
    | typeof temporaryProfilePrefix
    | typeof jitRepairTemporaryProfilePrefix = temporaryProfilePrefix,
): string {
  const root = realpathSync(tmpdir());
  const path = `${join(root, prefix)}${randomBytes(12).toString('hex')}`;
  mkdirSync(path, { mode: 0o700 });
  chmodSync(path, 0o700);
  const state = statSync(path);
  if (
    !state.isDirectory() ||
    state.uid !== effectiveUid() ||
    (state.mode & 0o777) !== 0o700
  ) {
    throw new Error('powerschool-temporary-profile-unsafe');
  }
  return path;
}

export function removeTemporaryBrowserProfile(path: string): void {
  const root = realpathSync(tmpdir());
  const canonicalParent = realpathSync(dirname(path));
  const fromRoot = relative(root, path);
  if (
    !isAbsolute(path) ||
    resolve(path) !== path ||
    canonicalParent !== root ||
    fromRoot.length === 0 ||
    fromRoot === '..' ||
    fromRoot.startsWith(`..${sep}`) ||
    ![temporaryProfilePrefix, jitRepairTemporaryProfilePrefix].some((prefix) =>
      basename(path).startsWith(prefix),
    )
  ) {
    throw new Error('powerschool-temporary-profile-unsafe');
  }
  rmSync(path, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 50,
  });
}

export function powerSchoolStatePath(sessionDirectory: string): string {
  return join(sessionDirectory, stateFileName);
}

function assertFilteredState(value: unknown, powerSchoolOrigin: string): void {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['cookies', 'origins']) ||
    !Array.isArray(value.cookies) ||
    !Array.isArray(value.origins)
  ) {
    throw new Error('powerschool-session-state-unsafe');
  }
  const host = new URL(powerSchoolOrigin).hostname;
  if (value.cookies.length > 128 || value.origins.length > 1) {
    throw new Error('powerschool-session-state-unsafe');
  }
  for (const cookie of value.cookies) {
    if (
      !isRecord(cookie) ||
      !hasExactKeys(cookie, [
        'name',
        'value',
        'domain',
        'path',
        'expires',
        'httpOnly',
        'secure',
        'sameSite',
      ]) ||
      typeof cookie.name !== 'string' ||
      typeof cookie.value !== 'string' ||
      typeof cookie.domain !== 'string' ||
      typeof cookie.path !== 'string' ||
      typeof cookie.expires !== 'number' ||
      !Number.isFinite(cookie.expires) ||
      typeof cookie.httpOnly !== 'boolean' ||
      typeof cookie.secure !== 'boolean' ||
      (cookie.sameSite !== 'Strict' &&
        cookie.sameSite !== 'Lax' &&
        cookie.sameSite !== 'None') ||
      !/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/u.test(cookie.name) ||
      cookie.value.length > 4_096 ||
      /[\r\n\u0000]/u.test(cookie.value) ||
      cookie.domain.length > 253 ||
      !cookie.path.startsWith('/') ||
      cookie.path.length > 1_024 ||
      !cookieBelongsToHost(cookie.domain, host)
    ) {
      throw new Error('powerschool-session-state-unsafe');
    }
  }
  for (const origin of value.origins) {
    if (
      !isRecord(origin) ||
      !hasOnlyKeys(origin, ['origin', 'localStorage', 'indexedDB']) ||
      !hasRequiredKeys(origin, ['origin', 'localStorage']) ||
      origin.origin !== powerSchoolOrigin ||
      !Array.isArray(origin.localStorage) ||
      origin.localStorage.length > 128 ||
      (origin.indexedDB !== undefined && !Array.isArray(origin.indexedDB))
    ) {
      throw new Error('powerschool-session-state-unsafe');
    }
    for (const item of origin.localStorage) {
      if (
        !isRecord(item) ||
        !hasExactKeys(item, ['name', 'value']) ||
        typeof item.name !== 'string' ||
        typeof item.value !== 'string' ||
        item.name.length > 1_024 ||
        item.value.length > 64 * 1_024 ||
        /[\u0000]/u.test(item.name)
      ) {
        throw new Error('powerschool-session-state-unsafe');
      }
    }
  }
  if (value.cookies.length === 0 && value.origins.length === 0) {
    throw new Error('powerschool-session-state-empty');
  }
}

function cookieBelongsToHost(domain: string, host: string): boolean {
  const normalized = domain.startsWith('.') ? domain.slice(1) : domain;
  return normalized === host || host.endsWith(`.${normalized}`);
}

function assertSafeStateFile(path: string): void {
  const state = lstatSync(path);
  if (
    state.isSymbolicLink() ||
    !state.isFile() ||
    state.nlink !== 1 ||
    state.uid !== effectiveUid() ||
    (state.mode & 0o777) !== 0o600
  ) {
    throw new Error('powerschool-session-state-unsafe');
  }
}

function assertNoSymlinkComponents(path: string): void {
  const resolved = resolve(path);
  const root = parse(resolved).root;
  const parts = resolved.slice(root.length).split(sep).filter(Boolean);
  let current = root;
  for (const part of parts) {
    current = join(current, part);
    if (!existsSync(current)) break;
    if (lstatSync(current).isSymbolicLink()) {
      throw new Error('powerschool-session-path-symlink-rejected');
    }
  }
}

function validateAbsoluteTarget(path: string): void {
  if (
    !isAbsolute(path) ||
    resolve(path) !== path ||
    path === '/' ||
    path.includes('\0')
  ) {
    throw new Error('powerschool-session-path-invalid');
  }
}

function effectiveUid(): number {
  const uid = process.geteuid?.();
  if (uid === undefined) {
    throw new Error('powerschool-session-owner-unavailable');
  }
  return uid;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  return (
    Object.keys(value).length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key))
  );
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function hasRequiredKeys(
  value: Record<string, unknown>,
  required: readonly string[],
): boolean {
  return required.every((key) => Object.hasOwn(value, key));
}

function isErrno(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}
