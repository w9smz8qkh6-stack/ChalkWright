import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readlinkSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';

const releaseRoot = '/opt/chalkwright-canary';
const configReference = '/etc/chalkwright/canary/server.json';
const managedRoot = '/var/lib/chalkwright/canary-production';
const stateDirectory = `${managedRoot}/state`;
const databasePath = `${managedRoot}/state/chalkwright.sqlite`;
const backupDirectory = `${managedRoot}/backups`;

export function assertInitializationConfig(config) {
  if (
    config?.instanceId !== 'chalkwright-c509-canary-production' ||
    config.roomId !== 'room-c509' ||
    config.screenId !== 'screen-c509-canary-production' ||
    config.host !== '127.0.0.1' ||
    config.port !== 4319 ||
    config.timeZone !== 'Asia/Ho_Chi_Minh' ||
    config.managedRoot !== managedRoot ||
    config.databasePath !== databasePath ||
    config.backupDirectory !== backupDirectory
  )
    throw new Error('m17-initialize-policy-invalid');
}

async function main() {
  if (
    process.argv.length !== 3 ||
    !/^[a-f0-9]{64}$/u.test(process.argv[2] ?? '')
  )
    throw new Error('m17-initialize-usage-invalid');
  if (process.geteuid?.() !== 0)
    throw new Error('m17-initialize-root-required');
  const target = protectedDirectory(managedRoot);
  const stateTarget = protectedDirectory(stateDirectory);
  const backupTarget = protectedDirectory(backupDirectory);
  const releaseDirectory = assertInstalledRuntime(process.argv[2]);
  assertProtectedDirectoryOwners(target, stateTarget, backupTarget);
  if (
    typeof process.setgroups !== 'function' ||
    typeof process.setgid !== 'function' ||
    typeof process.setuid !== 'function' ||
    typeof process.getgroups !== 'function'
  )
    throw new Error('m17-initialize-owner-invalid');
  process.setgroups([]);
  process.setgid(target.gid);
  process.setuid(target.uid);
  const groups = process.getgroups();
  if (
    process.geteuid?.() !== target.uid ||
    process.getegid?.() !== target.gid ||
    groups.some((gid) => gid !== target.gid) ||
    groups.length > 1
  )
    throw new Error('m17-initialize-owner-invalid');
  process.umask(0o077);
  const reservation = reserveDatabasePath(databasePath, target.uid, target.gid);
  let completed = false;
  try {
    const [{ loadProductionServerConfig }, { SqliteDatabase }] =
      await Promise.all([
        import(`file://${releaseDirectory}/dist/config/production.js`),
        import(
          `file://${releaseDirectory}/dist/infrastructure/sqlite/database.js`
        ),
      ]);
    const config = loadProductionServerConfig(configReference, releaseRoot);
    assertInitializationConfig(config);
    const database = new SqliteDatabase(databasePath, {
      migration: { appliedAt: new Date().toISOString() },
    });
    try {
      const integrity = database.integrityCheck();
      if (!integrity.ok || integrity.foreignKeyViolations !== 0)
        throw new Error('m17-initialize-integrity-failed');
    } finally {
      database.close();
    }
    const state = lstatSync(databasePath);
    if (
      !sameReservedFile(state, reservation) ||
      realpathSync(databasePath) !== databasePath
    )
      throw new Error('m17-initialize-state-unsafe');
    completed = true;
  } finally {
    if (!completed) removeReservation(databasePath, reservation);
  }
  process.stdout.write(
    `${JSON.stringify({ status: 'initialized-inert', schemaIntegrity: 'ok', providerRequests: 0, servicesStarted: 0, routeChanges: 0 })}\n`,
  );
}

function assertInstalledRuntime(releaseSha256) {
  const current = `${releaseRoot}/current`;
  const releaseDirectory = `${releaseRoot}/releases/${releaseSha256}`;
  for (const path of [
    releaseRoot,
    `${releaseRoot}/releases`,
    releaseDirectory,
    `${releaseDirectory}/dist`,
    `${releaseDirectory}/dist/config`,
    `${releaseDirectory}/dist/infrastructure`,
    `${releaseDirectory}/dist/infrastructure/sqlite`,
  ]) {
    const state = lstatSync(path);
    assertRootReleaseDirectoryPolicy(state, realpathSync(path), path);
  }
  const currentState = lstatSync(current);
  if (
    !currentState.isSymbolicLink() ||
    readlinkSync(current) !== `releases/${releaseSha256}`
  )
    throw new Error('m17-initialize-release-invalid');
  for (const suffix of [
    'dist/config/production.js',
    'dist/infrastructure/sqlite/database.js',
  ]) {
    const path = `${releaseDirectory}/${suffix}`;
    const state = lstatSync(path);
    if (
      !state.isFile() ||
      state.isSymbolicLink() ||
      state.nlink !== 1 ||
      state.uid !== 0 ||
      state.gid !== 0 ||
      (state.mode & 0o777) !== 0o644 ||
      realpathSync(path) !== path
    )
      throw new Error('m17-initialize-release-invalid');
  }
  return releaseDirectory;
}

export function assertRootReleaseDirectoryPolicy(state, realPath, path) {
  if (
    !state.isDirectory() ||
    state.isSymbolicLink() ||
    state.uid !== 0 ||
    state.gid !== 0 ||
    (state.mode & 0o022) !== 0 ||
    realPath !== path
  )
    throw new Error('m17-initialize-release-invalid');
}

export function assertProtectedDirectoryPolicy(state, realPath, path) {
  if (
    !state.isDirectory() ||
    state.isSymbolicLink() ||
    realPath !== path ||
    (state.mode & 0o777) !== 0o700
  )
    throw new Error('m17-initialize-directory-unsafe');
}

export function assertProtectedDirectoryOwners(root, state, backup) {
  if (
    root.uid === 0 ||
    state.uid !== root.uid ||
    state.gid !== root.gid ||
    backup.uid !== root.uid ||
    backup.gid !== root.gid
  )
    throw new Error('m17-initialize-owner-invalid');
}

export function reserveDatabasePath(path, uid, gid) {
  let descriptor;
  try {
    descriptor = openSync(
      path,
      constants.O_CREAT |
        constants.O_EXCL |
        constants.O_RDWR |
        constants.O_NOFOLLOW,
      0o600,
    );
    const state = fstatSync(descriptor);
    const reservation = { dev: state.dev, ino: state.ino, uid, gid };
    if (!sameReservedFile(state, reservation))
      throw new Error('m17-initialize-state-unsafe');
    return reservation;
  } catch (error) {
    if (error?.code === 'EEXIST')
      throw new Error('m17-initialize-state-exists');
    throw error;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function sameReservedFile(state, reservation) {
  return (
    state.isFile() &&
    !state.isSymbolicLink() &&
    state.nlink === 1 &&
    state.uid === reservation.uid &&
    state.gid === reservation.gid &&
    (state.mode & 0o777) === 0o600 &&
    state.dev === reservation.dev &&
    state.ino === reservation.ino
  );
}

function removeReservation(path, reservation) {
  try {
    const state = lstatSync(path);
    if (sameReservedFile(state, reservation)) rmSync(path);
  } catch {
    // Never remove an unverified or already replaced target.
  }
}

function protectedDirectory(path) {
  const state = lstatSync(path);
  assertProtectedDirectoryPolicy(state, realpathSync(path), path);
  return state;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main().catch((error) => {
    const code =
      error instanceof Error && /^[a-z0-9-]{3,96}$/u.test(error.message)
        ? error.message
        : 'm17-initialize-failed';
    process.stderr.write(`${JSON.stringify({ status: 'rejected', code })}\n`);
    process.exitCode = 1;
  });
}
