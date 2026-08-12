import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync,
  chownSync,
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const legacySource =
  '/opt/openclaw/plugins/classroom-screen/ops/classroom_screen_ops.js';
const legacySourceSha256 =
  '0823354a44945838815571cb1dbd3910f35370aa06ee274f4e65f111e6b5f54a';
const legacyBotToken = '/etc/openclaw/secrets/telegram-work-bot-token';
const targetDirectory = '/etc/classroom-hub/providers/alert-delivery';
const botTokenPath = `${targetDirectory}/bot-token`;
const destinationPath = `${targetDirectory}/destination`;
const referencePath = `${targetDirectory}/alert-delivery.json`;
const destinationPrefix = Buffer.from('const TELEGRAM_CHAT_ID = "', 'ascii');

export function alertProvisioningPolicy() {
  return {
    version: 1,
    legacySource,
    legacySourceSha256: `sha256:${legacySourceSha256}`,
    legacyBotToken,
    targetDirectory,
    botTokenPath,
    destinationPath,
    referencePath,
  };
}

/** Extracts one bounded legacy destination without evaluating source code. */
export function parseLegacyDestination(source) {
  if (!Buffer.isBuffer(source) || source.length < destinationPrefix.length)
    throw new Error('m16-alert-source-invalid');
  const start = source.indexOf(destinationPrefix);
  if (
    start < 0 ||
    source.indexOf(destinationPrefix, start + destinationPrefix.length) >= 0
  )
    throw new Error('m16-alert-source-invalid');
  const valueStart = start + destinationPrefix.length;
  const valueEnd = source.indexOf(0x22, valueStart);
  if (valueEnd < 0 || valueEnd - valueStart < 5 || valueEnd - valueStart > 32)
    throw new Error('m16-alert-destination-invalid');
  const value = source.subarray(valueStart, valueEnd);
  if (!isDestinationBytes(value))
    throw new Error('m16-alert-destination-invalid');
  return Buffer.from(value);
}

/** Returns a newline-free copy only when bytes match a Telegram bot token. */
export function normalizeBotToken(source) {
  if (!Buffer.isBuffer(source) || source.length < 20 || source.length > 256)
    throw new Error('m16-alert-token-invalid');
  let start = 0;
  let end = source.length;
  while (start < end && isAsciiWhitespace(source[start])) start += 1;
  while (end > start && isAsciiWhitespace(source[end - 1])) end -= 1;
  const value = source.subarray(start, end);
  const colon = value.indexOf(0x3a);
  if (
    colon < 5 ||
    colon > 20 ||
    value.indexOf(0x3a, colon + 1) >= 0 ||
    value.length - colon - 1 < 20 ||
    value.length - colon - 1 > 128
  )
    throw new Error('m16-alert-token-invalid');
  for (let index = 0; index < value.length; index += 1) {
    const byte = value[index];
    if (index < colon) {
      if (byte < 0x30 || byte > 0x39)
        throw new Error('m16-alert-token-invalid');
    } else if (index > colon && !isTokenByte(byte)) {
      throw new Error('m16-alert-token-invalid');
    }
  }
  return Buffer.from(value);
}

function main() {
  if (process.argv.slice(2).join(' ') !== '--apply')
    throw new Error('m16-alert-provision-usage-invalid');
  if (process.geteuid?.() !== 0)
    throw new Error('m16-alert-provision-root-required');

  const identity = statSync('/etc/classroom-hub/server');
  if (identity.uid === 0 || identity.gid === 0)
    throw new Error('m16-alert-provision-identity-unavailable');
  const uid = identity.uid;
  const gid = identity.gid;
  assertDirectory('/etc/classroom-hub/providers', 0, 0, 0o711);

  let createdDirectory = false;
  if (!pathExists(targetDirectory)) {
    mkdirSync(targetDirectory, { mode: 0o700 });
    chownSync(targetDirectory, uid, gid);
    chmodSync(targetDirectory, 0o700);
    createdDirectory = true;
  }
  assertDirectory(targetDirectory, uid, gid, 0o700);

  let source;
  let tokenSource;
  let token;
  let destination;
  const created = [];
  try {
    source = readFixedFile(legacySource, 1000, 0o755, 128 * 1024, false);
    if (
      createHash('sha256').update(source).digest('hex') !== legacySourceSha256
    )
      throw new Error('m16-alert-source-drift');
    destination = parseLegacyDestination(source);
    tokenSource = readFixedFile(legacyBotToken, 1000, 0o600, 256, true);
    token = normalizeBotToken(tokenSource);

    for (const target of [botTokenPath, destinationPath, referencePath])
      assertAbsent(target);
    writeNewProtected(botTokenPath, token, uid, gid);
    created.push(botTokenPath);
    writeNewProtected(destinationPath, destination, uid, gid);
    created.push(destinationPath);
    const references = Buffer.from(
      `${JSON.stringify(
        { version: 1, botTokenPath, destinationPath },
        null,
        2,
      )}\n`,
      'utf8',
    );
    try {
      writeNewProtected(referencePath, references, uid, gid);
      created.push(referencePath);
    } finally {
      references.fill(0);
    }
  } catch (error) {
    for (const target of created.reverse()) rmSync(target, { force: true });
    if (createdDirectory) {
      try {
        rmdirSync(targetDirectory);
      } catch {
        // A nonempty or externally changed directory is never removed.
      }
    }
    throw error;
  } finally {
    source?.fill(0);
    tokenSource?.fill(0);
    token?.fill(0);
    destination?.fill(0);
  }

  const policy = alertProvisioningPolicy();
  process.stdout.write(
    `${JSON.stringify({
      status: 'provisioned-inert',
      files: 3,
      valuesPrinted: 0,
      providerRequests: 0,
      unitsInstalled: 0,
      unitsStarted: 0,
      digest: `sha256:${createHash('sha256')
        .update(JSON.stringify(policy))
        .digest('hex')}`,
    })}\n`,
  );
}

function readFixedFile(path, uid, mode, maximumBytes, protectedParent) {
  const before = lstatSync(path);
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.nlink !== 1 ||
    before.uid !== uid ||
    (before.mode & 0o777) !== mode ||
    before.size < 2 ||
    before.size > maximumBytes ||
    realpathSync(path) !== path
  )
    throw new Error('m16-alert-source-unsafe');
  if (protectedParent) {
    const parent = lstatSync(dirname(path));
    if (
      !parent.isDirectory() ||
      parent.isSymbolicLink() ||
      parent.uid !== uid ||
      (parent.mode & 0o077) !== 0 ||
      realpathSync(dirname(path)) !== dirname(path)
    )
      throw new Error('m16-alert-source-unsafe');
  }
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = fstatSync(descriptor);
    if (
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      opened.size !== before.size ||
      opened.uid !== uid ||
      opened.nlink !== 1
    )
      throw new Error('m16-alert-source-unsafe');
    return readFileSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function writeNewProtected(path, value, uid, gid) {
  if (!Buffer.isBuffer(value) || value.length < 1 || value.length > 16 * 1024)
    throw new Error('m16-alert-target-invalid');
  assertAbsent(path);
  const temporary = `${path}.tmp-${randomUUID()}`;
  let descriptor;
  try {
    descriptor = openSync(
      temporary,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    writeFileSync(descriptor, value);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    chownSync(temporary, uid, gid);
    chmodSync(temporary, 0o600);
    renameSync(temporary, path);
    const directory = openSync(
      dirname(path),
      constants.O_RDONLY | constants.O_DIRECTORY,
    );
    try {
      fsyncSync(directory);
    } finally {
      closeSync(directory);
    }
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(temporary, { force: true });
    throw error;
  }
}

function assertDirectory(path, uid, gid, mode) {
  const value = lstatSync(path);
  if (
    !value.isDirectory() ||
    value.isSymbolicLink() ||
    value.uid !== uid ||
    value.gid !== gid ||
    (value.mode & 0o777) !== mode ||
    realpathSync(path) !== path
  )
    throw new Error('m16-alert-target-unsafe');
}

function assertAbsent(path) {
  try {
    lstatSync(path);
    throw new Error('m16-alert-target-exists');
  } catch (error) {
    if (error instanceof Error && error.message === 'm16-alert-target-exists')
      throw error;
    if (error?.code !== 'ENOENT') throw error;
  }
}

function pathExists(path) {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function isDestinationBytes(value) {
  if (value[0] === 0x40) {
    if (value.length < 5 || !isAsciiLetter(value[1])) return false;
    for (let index = 2; index < value.length; index += 1) {
      const byte = value[index];
      if (!isAsciiLetter(byte) && !isDigit(byte) && byte !== 0x5f) return false;
    }
    return true;
  }
  let index = value[0] === 0x2d ? 1 : 0;
  if (index >= value.length || value[index] < 0x31 || value[index] > 0x39)
    return false;
  for (; index < value.length; index += 1) {
    if (!isDigit(value[index])) return false;
  }
  return true;
}

function isAsciiWhitespace(byte) {
  return byte === 0x09 || byte === 0x0a || byte === 0x0d || byte === 0x20;
}

function isDigit(byte) {
  return byte >= 0x30 && byte <= 0x39;
}

function isAsciiLetter(byte) {
  return (byte >= 0x41 && byte <= 0x5a) || (byte >= 0x61 && byte <= 0x7a);
}

function isTokenByte(byte) {
  return isDigit(byte) || isAsciiLetter(byte) || byte === 0x2d || byte === 0x5f;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({
        status: 'rejected',
        code:
          error instanceof Error ? error.message : 'm16-alert-provision-failed',
      })}\n`,
    );
    process.exitCode = 1;
  }
}
