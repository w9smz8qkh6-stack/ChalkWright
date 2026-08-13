import { spawnSync } from 'node:child_process';
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

const approvedOpenClawVersion = 'OpenClaw 2026.6.11 (e085fa1)';
const setprivExecutable = '/usr/bin/setpriv';
const nodeExecutable = '/usr/local/bin/node';
const openClawEntrypoint = '/usr/local/lib/node_modules/openclaw/openclaw.mjs';
const operatorHomeReference = '/etc/chalkwright/migration/legacy-operator-home';
const planEnvironmentPath = '/etc/chalkwright/canary/jobs/plan-refresh.env';
const destinationDirectory = '/var/lib/chalkwright/canary-powerschool-session';
const releaseRoot = '/opt/chalkwright-canary';
const localStorageEvaluation =
  '() => ({ origin: window.location.origin, values: Object.fromEntries(Object.keys(window.localStorage).map((key) => [key, window.localStorage.getItem(key)])) })';
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
    throw new Error('m17-legacy-bridge-environment-invalid');
  const result = Object.create(null);
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/u.exec(line);
    if (match === null || Object.hasOwn(result, match[1]))
      throw new Error('m17-legacy-bridge-environment-invalid');
    let value;
    try {
      value = JSON.parse(match[2]);
    } catch {
      throw new Error('m17-legacy-bridge-environment-invalid');
    }
    if (typeof value !== 'string' || /[\r\n\0]/u.test(value))
      throw new Error('m17-legacy-bridge-environment-invalid');
    result[match[1]] = value;
  }
  return result;
}

export function selectRoutineEnvironment(environment) {
  const selected = Object.create(null);
  for (const name of routineEnvironmentNames) {
    const value = environment[name];
    if (value !== undefined) selected[name] = value;
  }
  if (
    selected.CLASSROOM_HUB_POWERSCHOOL_SESSION_DIRECTORY !==
    destinationDirectory
  )
    throw new Error('m17-legacy-bridge-environment-invalid');
  return selected;
}

export function parseOpenClawCookieEnvelope(text) {
  const envelope = JSON.parse(text);
  if (
    envelope === null ||
    typeof envelope !== 'object' ||
    Array.isArray(envelope) ||
    envelope.ok !== true ||
    typeof envelope.targetId !== 'string' ||
    !Array.isArray(envelope.cookies) ||
    Object.keys(envelope).sort().join(',') !== 'cookies,ok,targetId'
  )
    throw new Error('m17-legacy-bridge-envelope-invalid');
  return { cookies: envelope.cookies, targetId: envelope.targetId };
}

export function parseOpenClawLocalStorageEvaluation(
  text,
  targetId,
  powerSchoolOrigin,
) {
  const envelope = JSON.parse(text);
  if (
    envelope === null ||
    typeof envelope !== 'object' ||
    Array.isArray(envelope) ||
    envelope.ok !== true ||
    envelope.targetId !== targetId ||
    typeof envelope.url !== 'string' ||
    envelope.result === null ||
    typeof envelope.result !== 'object' ||
    Array.isArray(envelope.result) ||
    Object.keys(envelope).sort().join(',') !== 'ok,result,targetId,url' ||
    Object.keys(envelope.result).sort().join(',') !== 'origin,values' ||
    typeof envelope.result.origin !== 'string' ||
    envelope.result.values === null ||
    typeof envelope.result.values !== 'object' ||
    Array.isArray(envelope.result.values)
  )
    throw new Error('m17-legacy-bridge-envelope-invalid');
  let resultOrigin;
  let responseOrigin;
  try {
    const resultUrl = new URL(envelope.result.origin);
    const responseUrl = new URL(envelope.url);
    if (
      resultUrl.username ||
      resultUrl.password ||
      responseUrl.username ||
      responseUrl.password
    )
      throw new Error('unsafe');
    resultOrigin = resultUrl.origin;
    responseOrigin = responseUrl.origin;
  } catch {
    throw new Error('m17-legacy-bridge-envelope-invalid');
  }
  if (
    resultOrigin !== powerSchoolOrigin ||
    responseOrigin !== powerSchoolOrigin
  )
    throw new Error('m17-legacy-bridge-origin-invalid');
  const entries = Object.entries(envelope.result.values);
  if (
    entries.length > 128 ||
    entries.some(
      ([name, value]) =>
        name.length > 1_024 ||
        name.includes('\0') ||
        typeof value !== 'string' ||
        value.length > 64 * 1_024,
    )
  )
    throw new Error('m17-legacy-bridge-envelope-invalid');
  return entries.map(([name, value]) => ({ name, value }));
}

async function main() {
  if (
    process.argv.length !== 3 ||
    !/^[a-f0-9]{64}$/u.test(process.argv[2] ?? '')
  )
    throw new Error('m17-legacy-bridge-usage-invalid');
  if (process.geteuid?.() !== 0)
    throw new Error('m17-legacy-bridge-root-required');

  let phase = 'm17-legacy-bridge-directory-check-failed';
  try {
    const operatorHome = readOperatorHome();
    const operator = protectedDirectory(operatorHome, 0o750);
    const destination = protectedDirectory(destinationDirectory, 0o700);
    if (
      operator.uid === 0 ||
      operator.gid === 0 ||
      destination.uid === 0 ||
      destination.gid === 0 ||
      operator.uid === destination.uid
    )
      throw new Error('m17-legacy-bridge-owner-invalid');
    phase = 'm17-legacy-bridge-release-check-failed';
    const releaseDirectory = assertInstalledRelease(process.argv[2]);
    phase = 'm17-legacy-bridge-environment-read-failed';
    const selected = selectRoutineEnvironment(
      parseProtectedEnvironment(readRootFile(planEnvironmentPath)),
    );
    phase = 'm17-legacy-bridge-openclaw-version-check-failed';
    assertOpenClawVersion(operator.uid, operator.gid, operatorHome);
    phase = 'm17-legacy-bridge-browser-state-read-failed';
    const rawState = readLegacyState(
      operator.uid,
      operator.gid,
      selected.CLASSROOM_HUB_POWERSCHOOL_ORIGIN,
      operatorHome,
    );
    phase = 'm17-legacy-bridge-privilege-drop-failed';
    dropPrivileges(destination.uid, destination.gid);
    for (const name of Object.keys(process.env)) delete process.env[name];
    Object.assign(process.env, selected, { NODE_ENV: 'production' });
    phase = 'm17-legacy-bridge-runtime-import-failed';
    const [{ loadPowerSchoolRoutineConfig }, protectedState] =
      await Promise.all([
        import(`file://${releaseDirectory}/dist/config/powerschool-session.js`),
        import(
          `file://${releaseDirectory}/dist/infrastructure/powerschool-session/protected-state.js`
        ),
      ]);
    phase = 'm17-legacy-bridge-config-load-failed';
    const config = loadPowerSchoolRoutineConfig(process.env);
    phase = 'm17-legacy-bridge-filter-failed';
    const filtered = protectedState.filterPowerSchoolStorageState(
      rawState,
      config.powerSchoolOrigin,
    );
    phase = 'm17-legacy-bridge-state-write-failed';
    const lock = protectedState.acquirePowerSchoolSessionLock(
      config.sessionDirectory,
    );
    try {
      protectedState.writeFilteredPowerSchoolState(
        config.sessionDirectory,
        config.powerSchoolOrigin,
        filtered,
      );
    } finally {
      lock.release();
    }
    process.stdout.write(
      `${JSON.stringify({ status: 'refreshed-filtered-state', cookies: filtered.cookies.length, origins: filtered.origins.length, profilesCopied: 0, googleOriginsCopied: 0, providerRequests: 0, passwordCredentialsRead: 0 })}\n`,
    );
  } catch (error) {
    if (
      error instanceof Error &&
      /^m17-legacy-bridge-[a-z0-9-]{1,72}$/u.test(error.message)
    )
      throw error;
    throw new Error(phase);
  }
}

function readLegacyState(uid, gid, powerSchoolOrigin, operatorHome) {
  if (typeof powerSchoolOrigin !== 'string')
    throw new Error('m17-legacy-bridge-environment-invalid');
  const captured = [];
  try {
    const cookieCapture = readLegacyJson(uid, gid, operatorHome, 'cookies');
    captured.push(cookieCapture);
    const cookieEnvelope = parseOpenClawCookieEnvelope(
      cookieCapture.toString('utf8'),
    );
    const localStorageCapture = readLegacyJson(
      uid,
      gid,
      operatorHome,
      'local-storage-evaluation',
      cookieEnvelope.targetId,
    );
    captured.push(localStorageCapture);
    return {
      cookies: cookieEnvelope.cookies,
      origins: [
        {
          origin: powerSchoolOrigin,
          localStorage: parseOpenClawLocalStorageEvaluation(
            localStorageCapture.toString('utf8'),
            cookieEnvelope.targetId,
            powerSchoolOrigin,
          ),
        },
      ],
    };
  } finally {
    for (const buffer of captured) buffer.fill(0);
  }
}

function readLegacyJson(uid, gid, operatorHome, action, targetId) {
  let actionArguments;
  if (action === 'cookies') actionArguments = ['cookies'];
  else if (
    action === 'local-storage-evaluation' &&
    typeof targetId === 'string' &&
    targetId.length >= 1 &&
    targetId.length <= 128 &&
    !/[\r\n\0]/u.test(targetId)
  )
    actionArguments = [
      'evaluate',
      '--fn',
      localStorageEvaluation,
      '--timeout-ms',
      '5000',
      '--target-id',
      targetId,
    ];
  else throw new Error('m17-legacy-bridge-envelope-invalid');
  const result = spawnSync(
    setprivExecutable,
    [
      `--reuid=${uid}`,
      `--regid=${gid}`,
      '--clear-groups',
      '--inh-caps=-all',
      '--bounding-set=-all',
      '--no-new-privs',
      '--pdeathsig=SIGKILL',
      nodeExecutable,
      openClawEntrypoint,
      '--profile',
      'workonly',
      'browser',
      '--json',
      '--browser-profile',
      'powerschool',
      ...actionArguments,
    ],
    {
      cwd: operatorHome,
      env: {
        HOME: operatorHome,
        PATH: '/usr/local/bin:/usr/bin:/bin',
        XDG_CONFIG_HOME: `${operatorHome}/.config`,
        XDG_DATA_HOME: `${operatorHome}/.local/share`,
      },
      encoding: 'buffer',
      timeout: 30_000,
      maxBuffer: 512 * 1024,
      windowsHide: true,
    },
  );
  if (
    result.status !== 0 ||
    result.signal !== null ||
    !Buffer.isBuffer(result.stdout) ||
    result.stdout.length < 2 ||
    result.stdout.length > 512 * 1024
  ) {
    result.stdout?.fill(0);
    result.stderr?.fill(0);
    throw new Error('m17-legacy-bridge-browser-state-read-failed');
  }
  result.stderr?.fill(0);
  return result.stdout;
}

function assertOpenClawVersion(uid, gid, operatorHome) {
  const result = spawnSync(
    setprivExecutable,
    [
      `--reuid=${uid}`,
      `--regid=${gid}`,
      '--clear-groups',
      '--inh-caps=-all',
      '--bounding-set=-all',
      '--no-new-privs',
      nodeExecutable,
      openClawEntrypoint,
      '--version',
    ],
    {
      cwd: operatorHome,
      env: { HOME: operatorHome, PATH: '/usr/local/bin:/usr/bin:/bin' },
      encoding: 'utf8',
      timeout: 5_000,
      maxBuffer: 4_096,
      windowsHide: true,
    },
  );
  if (result.status !== 0 || result.stdout.trim() !== approvedOpenClawVersion)
    throw new Error('m17-legacy-bridge-openclaw-version-invalid');
}

function dropPrivileges(uid, gid) {
  if (
    typeof process.setgroups !== 'function' ||
    typeof process.setgid !== 'function' ||
    typeof process.setuid !== 'function' ||
    typeof process.getgroups !== 'function'
  )
    throw new Error('m17-legacy-bridge-owner-invalid');
  process.setgroups([]);
  process.setgid(gid);
  process.setuid(uid);
  const groups = process.getgroups();
  if (
    process.geteuid?.() !== uid ||
    process.getegid?.() !== gid ||
    groups.some((value) => value !== gid) ||
    groups.length > 1
  )
    throw new Error('m17-legacy-bridge-owner-invalid');
}

function assertInstalledRelease(digest) {
  const current = `${releaseRoot}/current`;
  const releaseDirectory = `${releaseRoot}/releases/${digest}`;
  const currentState = lstatSync(current);
  if (
    !currentState.isSymbolicLink() ||
    readlinkSync(current) !== `releases/${digest}`
  )
    throw new Error('m17-legacy-bridge-release-invalid');
  for (const path of [
    releaseRoot,
    `${releaseRoot}/releases`,
    releaseDirectory,
    `${releaseDirectory}/dist`,
    `${releaseDirectory}/dist/config`,
    `${releaseDirectory}/dist/infrastructure`,
    `${releaseDirectory}/dist/infrastructure/powerschool-session`,
  ]) {
    const state = lstatSync(path);
    if (
      !state.isDirectory() ||
      state.isSymbolicLink() ||
      state.uid !== 0 ||
      state.gid !== 0 ||
      (state.mode & 0o022) !== 0 ||
      realpathSync(path) !== path
    )
      throw new Error('m17-legacy-bridge-release-invalid');
  }
  for (const path of [
    `${releaseDirectory}/dist/config/powerschool-session.js`,
    `${releaseDirectory}/dist/infrastructure/powerschool-session/protected-state.js`,
  ]) {
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
      throw new Error('m17-legacy-bridge-release-invalid');
  }
  return releaseDirectory;
}

function protectedDirectory(path, mode) {
  const state = lstatSync(path);
  if (
    !state.isDirectory() ||
    state.isSymbolicLink() ||
    realpathSync(path) !== path ||
    (state.mode & 0o777) !== mode
  )
    throw new Error('m17-legacy-bridge-directory-unsafe');
  return state;
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
      throw new Error('m17-legacy-bridge-environment-unsafe');
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
      throw new Error('m17-legacy-bridge-environment-unsafe');
    return readFileSync(descriptor, 'utf8');
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function readOperatorHome() {
  const value = readRootFile(operatorHomeReference).trim();
  if (!/^\/home\/[a-z_][a-z0-9_-]{0,31}$/u.test(value))
    throw new Error('m17-legacy-bridge-operator-home-invalid');
  return value;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main().catch((error) => {
    const code =
      error instanceof Error && /^[a-z0-9-]{3,96}$/u.test(error.message)
        ? error.message
        : 'm17-legacy-bridge-failed';
    process.stderr.write(`${JSON.stringify({ status: 'rejected', code })}\n`);
    process.exitCode = 1;
  });
}
