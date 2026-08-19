import { createHash, randomBytes } from 'node:crypto';
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

const source = {
  server: '/etc/classroom-hub/server/production-server.json',
  plan: '/etc/classroom-hub/jobs/production-plan-refresh.env',
  classroom: '/etc/classroom-hub/jobs/production-classroom-refresh.env',
  calendar: '/etc/chalkwright/migration/google-calendar-writer-config.json',
};
const target = {
  root: '/etc/chalkwright/canary',
  server: '/etc/chalkwright/canary/server.json',
  plan: '/etc/chalkwright/canary/jobs/plan-refresh.env',
  classroom: '/etc/chalkwright/canary/jobs/classroom-refresh.env',
  maintenance: '/etc/chalkwright/canary/jobs/maintenance.env',
  calendar: '/etc/chalkwright/canary/calendar.json',
  operator: '/etc/chalkwright/canary/operator/token',
  classroomCredential:
    '/etc/chalkwright/canary/providers/google-classroom/authorized-user.json',
  calendarCredential:
    '/etc/chalkwright/canary/providers/google-calendar/writer.json',
  state: '/var/lib/chalkwright/canary-production',
  session: '/var/lib/chalkwright/canary-powerschool-session',
};
const databasePath = `${target.state}/state/chalkwright.sqlite`;
const backupDirectory = `${target.state}/backups`;

export function parseEnvironment(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 64 * 1024)
    throw new Error('m17-provision-source-invalid');
  const result = Object.create(null);
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/u.exec(line);
    if (!match || Object.hasOwn(result, match[1]))
      throw new Error('m17-provision-source-invalid');
    let value;
    try {
      value = JSON.parse(match[2]);
    } catch {
      throw new Error('m17-provision-source-invalid');
    }
    if (typeof value !== 'string' || /[\r\n\0]/u.test(value))
      throw new Error('m17-provision-source-invalid');
    result[match[1]] = value;
  }
  return result;
}

export function buildM17Payloads(
  server,
  planSource,
  classroomSource,
  calendarSource,
) {
  if (
    server.timeZone !== 'Asia/Ho_Chi_Minh' ||
    server.host !== '127.0.0.1' ||
    !Array.isArray(server.courseMappings)
  )
    throw new Error('m17-provision-server-policy-invalid');
  if (
    calendarSource.calendarSummary !== 'Auto Lesson 2' ||
    calendarSource.environment !== 'non-production' ||
    calendarSource.calendarId === 'primary' ||
    !/^[A-Za-z0-9][A-Za-z0-9._@-]{0,511}$/u.test(calendarSource.calendarId) ||
    digest(calendarSource.calendarId) !==
      calendarSource.calendarReferenceHash ||
    !/^sha256:[a-f0-9]{64}$/u.test(
      calendarSource.productionCalendarReferenceHash,
    ) ||
    calendarSource.productionCalendarReferenceHash ===
      calendarSource.calendarReferenceHash
  )
    throw new Error('m17-provision-calendar-policy-invalid');
  const production = {
    ...server,
    instanceId: 'chalkwright-c509-canary-production',
    screenId: 'screen-c509-canary-production',
    port: 4319,
    managedRoot: target.state,
    databasePath,
    backupDirectory,
    operatorTokenReference: target.operator,
  };
  const common = {
    CLASSROOM_HUB_PRODUCTION_CONFIG_REFERENCE: target.server,
    CLASSROOM_HUB_INSTANCE_ID: production.instanceId,
    CLASSROOM_HUB_OPERATIONS_SCOPE_ID: 'c509-canary-production',
    CLASSROOM_HUB_MANAGED_ROOT: target.state,
    CLASSROOM_HUB_DATABASE_PATH: databasePath,
    CLASSROOM_HUB_BACKUP_DIRECTORY: backupDirectory,
    CLASSROOM_HUB_ALERT_DELIVERY_MODE: 'report-only',
  };
  const plan = {
    ...planSource,
    ...common,
    CLASSROOM_HUB_POWERSCHOOL_SESSION_DIRECTORY: target.session,
  };
  const classroom = {
    ...classroomSource,
    ...common,
    CLASSROOM_HUB_CLASSROOM_CREDENTIAL_REFERENCE: target.classroomCredential,
  };
  const maintenance = {
    ...common,
    CLASSROOM_HUB_TIME_ZONE: production.timeZone,
    CLASSROOM_HUB_ACADEMIC_YEAR_END: production.academicYearEnd,
    CLASSROOM_HUB_JOB_DEADLINE_SECONDS: '120',
  };
  const calendar = {
    version: 1,
    kind: 'chalkwright-m17-parallel-canary',
    calendarSummary: 'Auto Lesson 2',
    calendarId: calendarSource.calendarId,
    calendarReferenceHash: calendarSource.calendarReferenceHash,
    deniedCalendarReferenceHashes: [
      digest('primary'),
      calendarSource.productionCalendarReferenceHash,
    ],
    scopeId: 'chalkwright-c509-2026-27-canary',
    timeZone: 'Asia/Ho_Chi_Minh',
    productionConfigReference: target.server,
    credentialReferencePath: target.calendarCredential,
    databasePath,
    requestTimeoutMs: 15_000,
    overallTimeoutMs: 180_000,
    leaseDurationSeconds: 300,
    maximumPages: 5,
    maximumEvents: 100,
  };
  return { production, plan, classroom, maintenance, calendar };
}

export function renderEnvironment(environment) {
  return `${Object.keys(environment)
    .sort()
    .map((key) => `${key}=${JSON.stringify(environment[key])}`)
    .join('\n')}\n`;
}

function main() {
  if (process.argv.slice(2).join(' ') !== '--apply')
    throw new Error('m17-provision-usage-invalid');
  if (process.geteuid?.() !== 0) throw new Error('m17-provision-root-required');
  const identityPath = '/var/lib/classroom-hub/production';
  const identity = lstatSync(identityPath);
  if (
    !identity.isDirectory() ||
    identity.isSymbolicLink() ||
    realpathSync(identityPath) !== identityPath ||
    (identity.mode & 0o777) !== 0o700 ||
    identity.uid === 0 ||
    identity.gid === 0
  )
    throw new Error('m17-provision-identity-invalid');
  const uid = identity.uid,
    gid = identity.gid;
  const server = readProtectedJson(source.server, 128 * 1024, 'server');
  const planSource = readProtectedEnvironment(source.plan, 128 * 1024, 'plan');
  const classroomSource = readProtectedEnvironment(
    source.classroom,
    128 * 1024,
    'classroom',
  );
  const calendarSource = readProtectedJson(
    source.calendar,
    32 * 1024,
    'calendar',
  );
  const classroomCredentialSource = required(
    classroomSource,
    'CLASSROOM_HUB_CLASSROOM_CREDENTIAL_REFERENCE',
  );
  const classroomCredential = readProtectedSource(
    classroomCredentialSource,
    32 * 1024,
    'classroom-credential',
  );
  const calendarCredential = readProtectedSource(
    calendarSource.credentialReferencePath,
    32 * 1024,
    'calendar-credential',
  );
  const payloads = buildM17Payloads(
    server,
    planSource,
    classroomSource,
    calendarSource,
  );
  for (const path of [target.root, target.state, target.session])
    if (existsSync(path) || lstatSafe(path))
      throw new Error('m17-provision-target-exists');
  ensureBaseDirectory('/etc/chalkwright');
  ensureBaseDirectory('/var/lib/chalkwright');
  try {
    for (const path of [
      target.root,
      `${target.root}/jobs`,
      `${target.root}/operator`,
      `${target.root}/providers`,
      `${target.root}/providers/google-classroom`,
      `${target.root}/providers/google-calendar`,
      target.state,
      `${target.state}/state`,
      `${target.state}/evidence`,
      backupDirectory,
      target.session,
    ])
      makeNewDirectory(path, uid, gid);
    writeNew(
      target.server,
      `${JSON.stringify(payloads.production, null, 2)}\n`,
      uid,
      gid,
    );
    writeNew(
      target.operator,
      `${randomBytes(48).toString('base64url')}\n`,
      uid,
      gid,
    );
    writeNew(target.classroomCredential, classroomCredential, uid, gid);
    writeNew(target.calendarCredential, calendarCredential, uid, gid);
    writeNew(
      target.calendar,
      `${JSON.stringify(payloads.calendar, null, 2)}\n`,
      uid,
      gid,
    );
    writeNew(target.plan, renderEnvironment(payloads.plan), 0, 0);
    writeNew(target.classroom, renderEnvironment(payloads.classroom), 0, 0);
    writeNew(target.maintenance, renderEnvironment(payloads.maintenance), 0, 0);
  } catch (error) {
    for (const path of [target.session, target.state, target.root])
      rmSync(path, { recursive: true, force: true });
    throw error;
  }
  process.stdout.write(
    `${JSON.stringify({ status: 'provisioned-inert', files: 8, valuesPrinted: 0, providerRequests: 0, unitsInstalled: 0, unitsStarted: 0, routeChanges: 0, digest: digest({ targets: Object.values(target).sort(), payloads: { production: payloads.production, calendar: payloads.calendar, planKeys: Object.keys(payloads.plan).sort(), classroomKeys: Object.keys(payloads.classroom).sort(), maintenanceKeys: Object.keys(payloads.maintenance).sort() } }) })}\n`,
  );
}

function readProtectedSource(path, maximum, label) {
  try {
    return readProtected(path, maximum);
  } catch {
    throw new Error(`m17-provision-${label}-source-unavailable`);
  }
}

function readProtectedJson(path, maximum, label) {
  const text = readProtectedSource(path, maximum, label);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`m17-provision-${label}-source-invalid`);
  }
}

function readProtectedEnvironment(path, maximum, label) {
  const text = readProtectedSource(path, maximum, label);
  try {
    return parseEnvironment(text);
  } catch {
    throw new Error(`m17-provision-${label}-source-invalid`);
  }
}

function readProtected(path, maximum) {
  let fd;
  try {
    const before = lstatSync(path);
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      before.nlink !== 1 ||
      (before.mode & 0o077) !== 0 ||
      before.size < 2 ||
      before.size > maximum ||
      realpathSync(path) !== path
    )
      throw new Error('m17-provision-source-unsafe');
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = fstatSync(fd);
    if (
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      opened.nlink !== 1 ||
      opened.size !== before.size
    )
      throw new Error('m17-provision-source-unsafe');
    return readFileSync(fd, 'utf8');
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
function makeNewDirectory(path, uid, gid, mode = 0o700) {
  mkdirSync(path, { mode });
  chmodSync(path, mode);
  chownSync(path, uid, gid);
}
function ensureBaseDirectory(path) {
  if (!existsSync(path)) makeNewDirectory(path, 0, 0, 0o755);
  const stat = lstatSync(path);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    stat.uid !== 0 ||
    stat.gid !== 0 ||
    (stat.mode & 0o777) !== 0o755 ||
    realpathSync(path) !== path
  )
    throw new Error('m17-provision-base-unsafe');
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
function writeNew(path, value, uid, gid) {
  const fd = openSync(
    path,
    constants.O_CREAT |
      constants.O_EXCL |
      constants.O_WRONLY |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    writeFileSync(fd, value);
  } finally {
    closeSync(fd);
  }
  chmodSync(path, 0o600);
  chownSync(path, uid, gid);
}
function required(environment, key) {
  const value = environment[key];
  if (typeof value !== 'string' || !value)
    throw new Error('m17-provision-source-invalid');
  return value;
}
function digest(value) {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({ status: 'rejected', code: error instanceof Error && /^[a-z0-9-]{3,96}$/u.test(error.message) ? error.message : 'm17-provision-failed' })}\n`,
    );
    process.exitCode = 1;
  }
}
