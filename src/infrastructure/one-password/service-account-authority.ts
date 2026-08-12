import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import { dirname, isAbsolute, parse, relative, resolve, sep } from 'node:path';

export const powerSchoolOnePasswordServiceAccountEnvironmentName =
  'CLASSROOM_HUB_POWERSCHOOL_ONEPASSWORD_SERVICE_ACCOUNT_ENV';

const maximumEnvironmentBytes = 4_096;
const tokenName = 'OP_SERVICE_ACCOUNT_TOKEN';

/**
 * Loads only the service-account token from a protected legacy environment
 * file. The file is parsed as data; no shell or environment-file evaluation is
 * performed and no other assignment is returned.
 */
export function loadPowerSchoolOnePasswordServiceAccountToken(
  environment: NodeJS.ProcessEnv = process.env,
  repositoryRoot = process.cwd(),
): Buffer | undefined {
  const path = environment[powerSchoolOnePasswordServiceAccountEnvironmentName];
  if (path === undefined) return undefined;
  let descriptor: number | undefined;
  let raw: Buffer | undefined;
  try {
    if (
      !isAbsolute(path) ||
      resolve(path) !== path ||
      !outsideRepository(path, repositoryRoot)
    )
      throw unavailable();
    assertSafePath(path);
    const before = lstatSync(path);
    const effectiveUid = process.geteuid?.();
    if (
      effectiveUid === undefined ||
      !before.isFile() ||
      before.isSymbolicLink() ||
      before.nlink !== 1 ||
      before.uid !== effectiveUid ||
      (before.mode & 0o777) !== 0o600 ||
      before.size < 16 ||
      before.size > maximumEnvironmentBytes ||
      realpathSync(path) !== path
    )
      throw unavailable();
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = fstatSync(descriptor);
    if (
      !opened.isFile() ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      opened.nlink !== 1 ||
      opened.uid !== effectiveUid ||
      (opened.mode & 0o777) !== 0o600 ||
      opened.size !== before.size
    )
      throw unavailable();
    raw = readFileSync(descriptor);
    return extractServiceAccountToken(raw);
  } catch {
    throw unavailable();
  } finally {
    raw?.fill(0);
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        // Close failure cannot expose protected content.
      }
    }
  }
}

function extractServiceAccountToken(raw: Buffer): Buffer {
  const text = raw.toString('utf8');
  if (Buffer.from(text, 'utf8').compare(raw) !== 0 || /\0/u.test(text))
    throw unavailable();
  let token: string | undefined;
  for (const sourceLine of text.split(/\r?\n/u)) {
    const line = sourceLine.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u.exec(line);
    if (match === null) throw unavailable();
    if (match[1] !== tokenName) continue;
    if (token !== undefined) throw unavailable();
    token = unquote(match[2]!.trim());
  }
  if (
    token === undefined ||
    token.length < 32 ||
    token.length > 2_048 ||
    !/^ops_[A-Za-z0-9._-]+$/u.test(token)
  )
    throw unavailable();
  return Buffer.from(token, 'ascii');
}

function unquote(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value.at(-1);
    if ((first === '"' || first === "'") && last === first)
      return value.slice(1, -1);
  }
  return value;
}

function assertSafePath(path: string): void {
  const effectiveUid = process.geteuid?.();
  const effectiveGid = process.getegid?.();
  if (effectiveUid === undefined || effectiveGid === undefined)
    throw unavailable();
  const root = parse(path).root;
  const parts = dirname(path).slice(root.length).split(sep).filter(Boolean);
  let current = root;
  for (const part of parts) {
    current = resolve(current, part);
    const state = lstatSync(current);
    const protectedStickyRoot =
      state.uid === 0 &&
      (state.mode & 0o1000) !== 0 &&
      (state.mode & 0o022) !== 0;
    const ownerPrimaryGroupOnly =
      state.uid === effectiveUid &&
      state.gid === effectiveGid &&
      (state.mode & 0o002) === 0;
    if (
      !state.isDirectory() ||
      state.isSymbolicLink() ||
      (state.uid !== 0 && state.uid !== effectiveUid) ||
      ((state.mode & 0o022) !== 0 &&
        !protectedStickyRoot &&
        !ownerPrimaryGroupOnly) ||
      realpathSync(current) !== current
    )
      throw unavailable();
  }
}

function outsideRepository(candidate: string, repositoryRoot: string): boolean {
  const relation = relative(resolve(repositoryRoot), candidate);
  return (
    relation.length > 0 &&
    (relation === '..' ||
      relation.startsWith(`..${sep}`) ||
      isAbsolute(relation))
  );
}

function unavailable(): Error {
  return new Error('powerschool-repair-service-account-unavailable');
}
