import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

const maximumProtectedJsonBytes = 128 * 1024;

/** Reads one owner-only bounded single-line secret without logging its path. */
export function readProtectedText(
  path: string,
  bounds: { readonly minimumBytes: number; readonly maximumBytes: number },
): string {
  let descriptor: number | undefined;
  try {
    assertNormalizedAbsolute(path);
    if (
      !Number.isSafeInteger(bounds.minimumBytes) ||
      !Number.isSafeInteger(bounds.maximumBytes) ||
      bounds.minimumBytes < 1 ||
      bounds.maximumBytes < bounds.minimumBytes ||
      bounds.maximumBytes > 4_096
    )
      throw unsafe();
    const effectiveUid = process.geteuid?.();
    if (effectiveUid === undefined) throw unsafe();
    assertProtectedDirectory(dirname(path), effectiveUid);
    const before = lstatSync(path);
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      before.nlink !== 1 ||
      before.uid !== effectiveUid ||
      (before.mode & 0o077) !== 0 ||
      before.size < bounds.minimumBytes ||
      before.size > bounds.maximumBytes + 2 ||
      realpathSync(path) !== path
    )
      throw unsafe();
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = fstatSync(descriptor);
    if (
      !opened.isFile() ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      opened.nlink !== 1 ||
      opened.uid !== effectiveUid ||
      (opened.mode & 0o077) !== 0 ||
      opened.size !== before.size
    )
      throw unsafe();
    const raw = readFileSync(descriptor, 'utf8');
    const value = raw.endsWith('\r\n')
      ? raw.slice(0, -2)
      : raw.endsWith('\n')
        ? raw.slice(0, -1)
        : raw;
    if (
      Buffer.byteLength(value, 'utf8') < bounds.minimumBytes ||
      Buffer.byteLength(value, 'utf8') > bounds.maximumBytes ||
      /[\r\n\0]/u.test(value)
    )
      throw unsafe();
    return value;
  } catch (error: unknown) {
    if (error instanceof Error && error.message === 'protected-json-unsafe')
      throw error;
    throw unsafe();
  } finally {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        // Close failure does not expose protected content.
      }
    }
  }
}

export function readProtectedJson<Value>(
  path: string,
  validate: (value: unknown) => value is Value,
): Value {
  return readProtectedJsonOwnedBy(path, undefined, validate);
}

export function readProtectedJsonOwnedBy<Value>(
  path: string,
  ownerUid: number | undefined,
  validate: (value: unknown) => value is Value,
): Value {
  let descriptor: number | undefined;
  try {
    assertNormalizedAbsolute(path);
    const expectedUid = ownerUid ?? process.geteuid?.();
    if (
      expectedUid === undefined ||
      !Number.isSafeInteger(expectedUid) ||
      expectedUid < 0
    )
      throw unsafe();
    assertProtectedDirectory(dirname(path), expectedUid);
    const before = lstatSync(path);
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      before.nlink !== 1 ||
      before.uid !== expectedUid ||
      (before.mode & 0o077) !== 0 ||
      before.size < 2 ||
      before.size > maximumProtectedJsonBytes ||
      realpathSync(path) !== path
    )
      throw unsafe();
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = fstatSync(descriptor);
    if (
      !opened.isFile() ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      opened.nlink !== 1 ||
      opened.uid !== expectedUid ||
      (opened.mode & 0o077) !== 0 ||
      opened.size !== before.size
    )
      throw unsafe();
    const value: unknown = JSON.parse(readFileSync(descriptor, 'utf8'));
    if (!validate(value)) throw new Error('protected-json-invalid');
    return value;
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      (error.message === 'protected-json-invalid' ||
        error.message === 'protected-json-unsafe')
    )
      throw error;
    throw unsafe();
  } finally {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        // Close failure does not expose the protected content.
      }
    }
  }
}

/** Creates one owner-only file atomically and refuses every existing target. */
export function writeNewProtectedJson(path: string, value: unknown): void {
  assertNormalizedAbsolute(path);
  const effectiveUid = process.geteuid?.();
  if (effectiveUid === undefined) throw unsafe();
  const parent = dirname(path);
  assertProtectedDirectory(parent, effectiveUid);
  const bytes = `${JSON.stringify(value, null, 2)}\n`;
  if (
    Buffer.byteLength(bytes, 'utf8') < 2 ||
    Buffer.byteLength(bytes, 'utf8') > maximumProtectedJsonBytes
  )
    throw new Error('protected-json-invalid');
  const temporary = `${path}.tmp-${randomUUID()}`;
  let descriptor: number | undefined;
  try {
    try {
      lstatSync(path);
      throw unsafe();
    } catch (error: unknown) {
      if (error instanceof Error && error.message === 'protected-json-unsafe')
        throw error;
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw unsafe();
    }
    descriptor = openSync(
      temporary,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    writeFileSync(descriptor, bytes, 'utf8');
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    chmodSync(temporary, 0o600);
    const created = lstatSync(temporary);
    if (
      !created.isFile() ||
      created.isSymbolicLink() ||
      created.nlink !== 1 ||
      created.uid !== effectiveUid ||
      (created.mode & 0o077) !== 0
    )
      throw unsafe();
    renameSync(temporary, path);
    const directory = openSync(
      parent,
      constants.O_RDONLY | constants.O_DIRECTORY,
    );
    try {
      fsyncSync(directory);
    } finally {
      closeSync(directory);
    }
  } catch (error: unknown) {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        // Cleanup below remains best effort.
      }
    }
    try {
      rmSync(temporary, { force: true });
    } catch {
      // Never replace an unsafe target merely to clean a temporary artifact.
    }
    if (
      error instanceof Error &&
      (error.message === 'protected-json-invalid' ||
        error.message === 'protected-json-unsafe')
    )
      throw error;
    throw unsafe();
  }
}

function assertNormalizedAbsolute(path: string): void {
  if (!isAbsolute(path) || resolve(path) !== path || path === '/')
    throw unsafe();
}

function assertProtectedDirectory(path: string, effectiveUid: number): void {
  const stat = lstatSync(path);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    stat.uid !== effectiveUid ||
    (stat.mode & 0o077) !== 0 ||
    realpathSync(path) !== path
  )
    throw unsafe();
}

function unsafe(): Error {
  return new Error('protected-json-unsafe');
}
