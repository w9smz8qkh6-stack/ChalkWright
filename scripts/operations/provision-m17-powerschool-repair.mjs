import {
  chmodSync,
  chownSync,
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = Object.freeze({
  references: '/etc/chalkwright/migration/powerschool-repair-references.json',
  serviceAccount:
    '/etc/chalkwright/migration/powerschool-onepassword-service-account.env',
});
const target = Object.freeze({
  providerDirectory: '/etc/chalkwright/canary/providers/powerschool',
  references:
    '/etc/chalkwright/canary/providers/powerschool/repair-references.json',
  serviceAccount:
    '/etc/chalkwright/canary/providers/powerschool/onepassword-service-account.env',
  environment: '/etc/chalkwright/canary/jobs/powerschool-repair.env',
  profile: '/var/lib/chalkwright/canary-powerschool-compatibility-profile',
});

export function renderRepairEnvironment() {
  return [
    `CLASSROOM_HUB_POWERSCHOOL_COMPATIBILITY_PROFILE_DIRECTORY=${JSON.stringify(target.profile)}`,
    `CLASSROOM_HUB_POWERSCHOOL_ONEPASSWORD_SERVICE_ACCOUNT_ENV=${JSON.stringify(target.serviceAccount)}`,
    `CLASSROOM_HUB_POWERSCHOOL_REPAIR_REFERENCE=${JSON.stringify(target.references)}`,
    '',
  ].join('\n');
}

export function validateRepairReferences(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !==
      'passwordReference,totpReference,usernameReference,version' ||
    value.version !== 1
  )
    throw new Error('m17-repair-provision-references-invalid');
  const entries = [
    [value.usernameReference, false],
    [value.passwordReference, false],
    [value.totpReference, true],
  ];
  if (
    new Set(entries.map(([reference]) => reference)).size !== 3 ||
    entries.some(([reference, otp]) => !validReference(reference, otp))
  )
    throw new Error('m17-repair-provision-references-invalid');
  return value;
}

function validReference(value, otp) {
  if (
    typeof value !== 'string' ||
    value.length < 10 ||
    value.length > 1024 ||
    /[\u0000-\u001f\u007f]/u.test(value) ||
    !value.startsWith('op://')
  )
    return false;
  const suffix = '?attribute=otp';
  const withoutQuery = otp ? value.slice(0, -suffix.length) : value;
  if (otp !== value.endsWith(suffix) || withoutQuery.includes('?'))
    return false;
  const segments = withoutQuery.slice(5).split('/');
  return (
    segments.length === 3 &&
    segments.every(
      (segment) =>
        segment.length > 0 &&
        segment.length <= 256 &&
        segment !== '.' &&
        segment !== '..' &&
        !segment.includes('#'),
    )
  );
}

function main() {
  if (process.argv.slice(2).join(' ') !== '--apply')
    throw new Error('m17-repair-provision-usage-invalid');
  if (process.geteuid?.() !== 0)
    throw new Error('m17-repair-provision-root-required');
  const identity = exactDirectory('/var/lib/chalkwright/canary-production');
  if (identity.uid === 0 || identity.gid === 0)
    throw new Error('m17-repair-provision-identity-invalid');
  exactDirectory(
    '/etc/chalkwright/canary/providers',
    identity.uid,
    identity.gid,
  );
  exactDirectory('/etc/chalkwright/canary/jobs', identity.uid, identity.gid);
  for (const path of Object.values(target))
    if (existsSync(path) || lstatSafe(path))
      throw new Error('m17-repair-provision-target-exists');

  let referenceBytes;
  let serviceAccountBytes;
  try {
    referenceBytes = readProtectedRootFile(source.references, 32 * 1024);
    serviceAccountBytes = readProtectedRootFile(
      source.serviceAccount,
      4 * 1024,
    );
    validateRepairReferences(JSON.parse(referenceBytes.toString('utf8')));
    validateServiceAccount(serviceAccountBytes);
    try {
      makeNewDirectory(target.providerDirectory, identity.uid, identity.gid);
      makeNewDirectory(target.profile, identity.uid, identity.gid);
      writeNew(target.references, referenceBytes, identity.uid, identity.gid);
      writeNew(
        target.serviceAccount,
        serviceAccountBytes,
        identity.uid,
        identity.gid,
      );
      writeNew(target.environment, renderRepairEnvironment(), 0, 0);
    } catch (error) {
      for (const path of [
        target.environment,
        target.profile,
        target.providerDirectory,
      ])
        rmSync(path, { recursive: true, force: true });
      throw error;
    }
  } finally {
    referenceBytes?.fill(0);
    serviceAccountBytes?.fill(0);
  }
  process.stdout.write(
    `${JSON.stringify({ status: 'm17-native-powerschool-repair-provisioned-inert', files: 3, directories: 2, valuesPrinted: 0, providerRequests: 0, unitsInstalled: 0, unitsStarted: 0, routeChanges: 0 })}\n`,
  );
}

export function validateServiceAccount(bytes) {
  const text = bytes.toString('utf8');
  if (Buffer.from(text, 'utf8').compare(bytes) !== 0 || /\0/u.test(text))
    throw new Error('m17-repair-provision-service-account-invalid');
  let token;
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u.exec(line);
    if (match === null)
      throw new Error('m17-repair-provision-service-account-invalid');
    if (match[1] !== 'OP_SERVICE_ACCOUNT_TOKEN')
      throw new Error('m17-repair-provision-service-account-invalid');
    if (token !== undefined)
      throw new Error('m17-repair-provision-service-account-invalid');
    const value = match[2].trim();
    token =
      value.length >= 2 &&
      (value[0] === '"' || value[0] === "'") &&
      value.at(-1) === value[0]
        ? value.slice(1, -1)
        : value;
  }
  if (
    typeof token !== 'string' ||
    token.length < 32 ||
    token.length > 2048 ||
    !/^ops_[A-Za-z0-9._-]+$/u.test(token)
  )
    throw new Error('m17-repair-provision-service-account-invalid');
}

function readProtectedRootFile(path, maximum) {
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
      before.size > maximum ||
      realpathSync(path) !== path
    )
      throw new Error('m17-repair-provision-source-unsafe');
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = fstatSync(descriptor);
    if (
      !opened.isFile() ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      opened.nlink !== 1 ||
      opened.uid !== 0 ||
      opened.gid !== 0 ||
      (opened.mode & 0o777) !== 0o600 ||
      opened.size !== before.size
    )
      throw new Error('m17-repair-provision-source-unsafe');
    return readFileSync(descriptor);
  } catch {
    throw new Error('m17-repair-provision-source-unavailable');
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function exactDirectory(path, uid, gid) {
  const state = lstatSync(path);
  if (
    !state.isDirectory() ||
    state.isSymbolicLink() ||
    (state.mode & 0o777) !== 0o700 ||
    (uid !== undefined && state.uid !== uid) ||
    (gid !== undefined && state.gid !== gid) ||
    realpathSync(path) !== path
  )
    throw new Error('m17-repair-provision-directory-invalid');
  return state;
}

function makeNewDirectory(path, uid, gid) {
  mkdirSync(path, { mode: 0o700 });
  chmodSync(path, 0o700);
  chownSync(path, uid, gid);
}

function writeNew(path, value, uid, gid) {
  const descriptor = openSync(
    path,
    constants.O_CREAT |
      constants.O_EXCL |
      constants.O_WRONLY |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    writeFileSync(descriptor, value);
  } finally {
    closeSync(descriptor);
  }
  chmodSync(path, 0o600);
  chownSync(path, uid, gid);
}

function lstatSafe(path) {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({ status: 'rejected', code: error instanceof Error && /^m17-repair-provision-[a-z0-9-]{3,80}$/u.test(error.message) ? error.message : 'm17-repair-provision-failed' })}\n`,
    );
    process.exitCode = 1;
  }
}
