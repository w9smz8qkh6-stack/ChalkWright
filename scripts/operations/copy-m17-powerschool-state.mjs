import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readlinkSync,
  realpathSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';

const planEnvironmentPath = '/etc/chalkwright/canary/jobs/plan-refresh.env';
const sourceDirectory = '/var/lib/classroom-hub/powerschool-session';
const destinationDirectory = '/var/lib/chalkwright/canary-powerschool-session';
const releaseRoot = '/opt/chalkwright-canary';
const installedCopyModule =
  '/opt/chalkwright-canary/current/dist/entrypoints/m17-copy-powerschool-state.js';
const routineEnvironmentNames = Object.freeze([
  'CLASSROOM_HUB_POWERSCHOOL_ROOM_ID',
  'CLASSROOM_HUB_POWERSCHOOL_ORIGIN',
  'CLASSROOM_HUB_POWERSCHOOL_STATUS_PATH',
  'CLASSROOM_HUB_POWERSCHOOL_STATUS_READY_SELECTOR',
  'CLASSROOM_HUB_POWERSCHOOL_BELL_PATH_TEMPLATE',
  'CLASSROOM_HUB_POWERSCHOOL_BELL_READY_SELECTOR',
  'CLASSROOM_HUB_POWERSCHOOL_EXPECTED_SCHOOL_TEXT',
  'CLASSROOM_HUB_POWERSCHOOL_SESSION_DIRECTORY',
  'CLASSROOM_HUB_POWERSCHOOL_CHROME_EXECUTABLE',
  'CLASSROOM_HUB_POWERSCHOOL_NAVIGATION_TIMEOUT_SECONDS',
  'CLASSROOM_HUB_POWERSCHOOL_ROUTINE_TIMEOUT_SECONDS',
  'CLASSROOM_HUB_POWERSCHOOL_MAX_RESPONSE_BYTES',
  'CLASSROOM_HUB_POWERSCHOOL_UTC_OFFSET',
]);

export function parseProtectedEnvironment(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 128 * 1024)
    throw new Error('m17-session-copy-environment-invalid');
  const result = Object.create(null);
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/u.exec(line);
    if (match === null || Object.hasOwn(result, match[1]))
      throw new Error('m17-session-copy-environment-invalid');
    let value;
    try {
      value = JSON.parse(match[2]);
    } catch {
      throw new Error('m17-session-copy-environment-invalid');
    }
    if (typeof value !== 'string' || /[\r\n\0]/u.test(value))
      throw new Error('m17-session-copy-environment-invalid');
    result[match[1]] = value;
  }
  return result;
}

export function selectCopyEnvironment(environment) {
  const selected = Object.create(null);
  for (const name of routineEnvironmentNames) {
    const value = environment[name];
    if (value !== undefined) selected[name] = value;
  }
  if (
    selected.CLASSROOM_HUB_POWERSCHOOL_SESSION_DIRECTORY !==
    destinationDirectory
  )
    throw new Error('m17-session-copy-environment-invalid');
  selected.CHALKWRIGHT_M17_POWERSCHOOL_SOURCE_DIRECTORY = sourceDirectory;
  return selected;
}

async function main() {
  if (
    process.argv.length !== 3 ||
    !/^[a-f0-9]{64}$/u.test(process.argv[2] ?? '')
  )
    throw new Error('m17-session-copy-launcher-usage-invalid');
  if (process.geteuid?.() !== 0)
    throw new Error('m17-session-copy-launcher-root-required');
  const source = protectedDirectory(sourceDirectory);
  const destination = protectedDirectory(destinationDirectory);
  const releaseSha256 = process.argv[2];
  assertInstalledCopyModule(releaseSha256);
  if (
    source.uid === 0 ||
    source.uid !== destination.uid ||
    source.gid !== destination.gid
  )
    throw new Error('m17-session-copy-owner-invalid');
  const environment = selectCopyEnvironment(
    parseProtectedEnvironment(readRootFile(planEnvironmentPath)),
  );
  if (
    typeof process.setgroups !== 'function' ||
    typeof process.setgid !== 'function' ||
    typeof process.setuid !== 'function' ||
    typeof process.getgroups !== 'function'
  )
    throw new Error('m17-session-copy-owner-invalid');
  process.setgroups([]);
  process.setgid(destination.gid);
  process.setuid(destination.uid);
  const supplementaryGroups = process.getgroups();
  if (
    process.geteuid?.() !== destination.uid ||
    process.getegid?.() !== destination.gid ||
    supplementaryGroups.some((gid) => gid !== destination.gid) ||
    supplementaryGroups.length > 1
  )
    throw new Error('m17-session-copy-owner-invalid');
  const { copyM17PowerSchoolState } =
    await import('file:///opt/chalkwright-canary/current/dist/entrypoints/m17-copy-powerschool-state.js');
  process.stdout.write(
    `${JSON.stringify(copyM17PowerSchoolState(environment))}\n`,
  );
}

function assertInstalledCopyModule(releaseSha256) {
  const current = `${releaseRoot}/current`;
  const currentStat = lstatSync(current);
  if (
    !currentStat.isSymbolicLink() ||
    readlinkSync(current) !== `releases/${releaseSha256}`
  )
    throw new Error('m17-session-copy-release-invalid');
  const expected = `${releaseRoot}/releases/${releaseSha256}/dist/entrypoints/m17-copy-powerschool-state.js`;
  const stat = lstatSync(installedCopyModule);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== 1 ||
    stat.uid !== 0 ||
    stat.gid !== 0 ||
    (stat.mode & 0o777) !== 0o644 ||
    realpathSync(installedCopyModule) !== expected
  )
    throw new Error('m17-session-copy-release-invalid');
}

function protectedDirectory(path) {
  const stat = lstatSync(path);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    realpathSync(path) !== path ||
    (stat.mode & 0o777) !== 0o700
  )
    throw new Error('m17-session-copy-directory-unsafe');
  return stat;
}

function readRootFile(path) {
  let descriptor;
  try {
    const before = lstatSync(path);
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      before.nlink !== 1 ||
      before.uid !== 0 ||
      before.gid !== 0 ||
      (before.mode & 0o777) !== 0o600 ||
      before.size < 2 ||
      before.size > 128 * 1024 ||
      realpathSync(path) !== path
    )
      throw new Error('m17-session-copy-environment-unsafe');
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = fstatSync(descriptor);
    if (
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      !opened.isFile() ||
      opened.nlink !== 1 ||
      opened.uid !== 0 ||
      opened.gid !== 0 ||
      (opened.mode & 0o777) !== 0o600 ||
      opened.size !== before.size
    )
      throw new Error('m17-session-copy-environment-unsafe');
    return readFileSync(descriptor, 'utf8');
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main().catch((error) => {
    const code =
      error instanceof Error && /^[a-z0-9-]{3,96}$/u.test(error.message)
        ? error.message
        : 'm17-session-copy-launcher-failed';
    process.stderr.write(`${JSON.stringify({ status: 'rejected', code })}\n`);
    process.exitCode = 1;
  });
}
