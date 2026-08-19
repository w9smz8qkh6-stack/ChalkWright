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
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildJobEnvironments,
  parseSystemdEnvironmentText,
  renderEnvironment,
} from './provision-m16-production.mjs';

const source = Object.freeze({
  server: '/home/bren/.config/classroom-hub/classroom-hub-shadow-server.env',
  refresh: '/home/bren/.config/classroom-hub/classroom-hub-shadow-refresh.env',
  calendar:
    '/home/bren/.config/classroom-hub/google-calendar-writer-config.json',
});
const target = Object.freeze({
  root: '/etc/chalkwright/production',
  server: '/etc/chalkwright/production/server.json',
  calendar: '/etc/chalkwright/production/calendar.json',
  plan: '/etc/chalkwright/production/jobs/plan-refresh.env',
  classroom: '/etc/chalkwright/production/jobs/classroom-refresh.env',
  maintenance: '/etc/chalkwright/production/jobs/maintenance.env',
  operator: '/etc/chalkwright/production/operator/token',
  classroomCredential:
    '/etc/chalkwright/production/providers/google-classroom/authorized-user.json',
  calendarCredential:
    '/etc/chalkwright/production/providers/google-calendar/writer.json',
  state: '/var/lib/chalkwright/production',
  session: '/var/lib/chalkwright/production-session',
  profile: '/var/lib/chalkwright/production-powerschool-profile',
});

const serviceAccount = Object.freeze({ uid: 972, gid: 972 });
const databasePath = `${target.state}/state/chalkwright.sqlite`;
const backupDirectory = `${target.state}/backups`;

/**
 * Creates the protected permanent production boundary from the currently-live
 * shadow configuration. It intentionally never starts a unit, changes a route,
 * reads provider data, or contacts a provider.
 */
export function buildPermanentPayloads(server, refresh, calendar) {
  const legacy = buildJobEnvironments(server, refresh);
  if (
    calendar === null ||
    typeof calendar !== 'object' ||
    Array.isArray(calendar) ||
    !['AutoLesson 2', 'Auto Lesson 2'].includes(calendar.calendarSummary) ||
    calendar.environment !== 'non-production' ||
    typeof calendar.calendarId !== 'string' ||
    calendar.calendarId === 'primary' ||
    !/^[A-Za-z0-9][A-Za-z0-9._@-]{0,511}$/u.test(calendar.calendarId) ||
    typeof calendar.calendarReferenceHash !== 'string' ||
    calendar.calendarReferenceHash !== calendarHash(calendar.calendarId) ||
    typeof calendar.productionCalendarReferenceHash !== 'string' ||
    !/^sha256:[a-f0-9]{64}$/u.test(calendar.productionCalendarReferenceHash) ||
    calendar.productionCalendarReferenceHash ===
      calendar.calendarReferenceHash ||
    typeof calendar.credentialReferencePath !== 'string'
  )
    throw new Error('permanent-bootstrap-calendar-policy-invalid');

  const production = {
    ...legacy.payload,
    instanceId: 'chalkwright-c509-production',
    screenId: 'screen-c509-production',
    managedRoot: target.state,
    databasePath,
    backupDirectory,
    operatorTokenReference: target.operator,
  };
  const common = {
    CLASSROOM_HUB_PRODUCTION_CONFIG_REFERENCE: target.server,
    CLASSROOM_HUB_INSTANCE_ID: production.instanceId,
    CLASSROOM_HUB_OPERATIONS_SCOPE_ID: 'chalkwright-c509-2026-27-production',
    CLASSROOM_HUB_TIME_ZONE: production.timeZone,
    CLASSROOM_HUB_MANAGED_ROOT: target.state,
    CLASSROOM_HUB_DATABASE_PATH: databasePath,
    CLASSROOM_HUB_BACKUP_DIRECTORY: backupDirectory,
    CLASSROOM_HUB_ACADEMIC_YEAR_END: production.academicYearEnd,
    CLASSROOM_HUB_JOB_DEADLINE_SECONDS:
      legacy.plan.CLASSROOM_HUB_JOB_DEADLINE_SECONDS,
    CLASSROOM_HUB_ALERT_DELIVERY_MODE: 'report-only',
  };
  const plan = {
    ...legacy.plan,
    ...common,
    CLASSROOM_HUB_POWERSCHOOL_SESSION_DIRECTORY: target.session,
    CLASSROOM_HUB_POWERSCHOOL_IDENTITY_ORIGIN: 'https://accounts.google.com',
    CLASSROOM_HUB_POWERSCHOOL_COMPATIBILITY_PROFILE_DIRECTORY: target.profile,
  };
  const classroom = {
    ...legacy.classroom,
    ...common,
    CLASSROOM_HUB_CLASSROOM_CREDENTIAL_REFERENCE: target.classroomCredential,
  };
  const maintenance = { ...common };
  const calendarConfig = {
    version: 1,
    kind: 'chalkwright-production',
    calendarId: calendar.calendarId,
    calendarReferenceHash: calendar.calendarReferenceHash,
    deniedCalendarReferenceHashes: [
      calendarHash('primary'),
      calendar.productionCalendarReferenceHash,
    ],
    scopeId: 'chalkwright-c509-2026-27-production',
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
  return { production, plan, classroom, maintenance, calendarConfig };
}

function main() {
  if (process.argv.slice(2).join(' ') !== '--apply')
    throw new Error('permanent-bootstrap-usage-invalid');
  if (process.geteuid?.() !== 0)
    throw new Error('permanent-bootstrap-root-required');
  for (const path of Object.values(target)) {
    if (existsSync(path)) throw new Error('permanent-bootstrap-target-exists');
  }
  const server = parseSystemdEnvironmentText(readSource(source.server));
  const refresh = parseSystemdEnvironmentText(readSource(source.refresh));
  const calendar = JSON.parse(readSource(source.calendar));
  const payloads = buildPermanentPayloads(server, refresh, calendar);
  const classroomCredential = readSource(
    requireValue(refresh, 'CLASSROOM_HUB_CLASSROOM_CREDENTIAL_REFERENCE'),
  );
  const calendarCredential = readSource(calendar.credentialReferencePath);
  const created = [];
  try {
    for (const path of [
      target.root,
      `${target.root}/jobs`,
      `${target.root}/operator`,
      `${target.root}/providers`,
      dirname(target.classroomCredential),
      dirname(target.calendarCredential),
      target.state,
      `${target.state}/state`,
      `${target.state}/evidence`,
      backupDirectory,
      target.session,
      target.profile,
    ]) {
      makeDirectory(path, serviceAccount.uid, serviceAccount.gid);
      created.push(path);
    }
    writeNew(
      target.server,
      `${JSON.stringify(payloads.production, null, 2)}\n`,
      serviceAccount.uid,
      serviceAccount.gid,
    );
    writeNew(
      target.calendar,
      `${JSON.stringify(payloads.calendarConfig, null, 2)}\n`,
      serviceAccount.uid,
      serviceAccount.gid,
    );
    writeNew(
      target.operator,
      `${randomBytes(48).toString('base64url')}\n`,
      serviceAccount.uid,
      serviceAccount.gid,
    );
    writeNew(
      target.classroomCredential,
      classroomCredential,
      serviceAccount.uid,
      serviceAccount.gid,
    );
    writeNew(
      target.calendarCredential,
      calendarCredential,
      serviceAccount.uid,
      serviceAccount.gid,
    );
    writeNew(target.plan, renderEnvironment(payloads.plan), 0, 0);
    writeNew(target.classroom, renderEnvironment(payloads.classroom), 0, 0);
    writeNew(target.maintenance, renderEnvironment(payloads.maintenance), 0, 0);
  } catch (error) {
    for (const path of created.reverse())
      rmSync(path, { recursive: true, force: true });
    throw error;
  }
  process.stdout.write(
    '{"status":"configured-inert","filesCreated":8,"providerRequests":0,"unitsStarted":0,"routeChanges":0,"valuesPrinted":0}\n',
  );
}

function readSource(path) {
  const before = lstatSync(path);
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.nlink !== 1 ||
    (before.mode & 0o077) !== 0 ||
    before.size < 2 ||
    before.size > 128 * 1024 ||
    realpathSync(path) !== path
  )
    throw new Error('permanent-bootstrap-source-unsafe');
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = fstatSync(descriptor);
    if (
      !opened.isFile() ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      opened.size !== before.size
    )
      throw new Error('permanent-bootstrap-source-unsafe');
    return readFileSync(descriptor, 'utf8');
  } finally {
    closeSync(descriptor);
  }
}

function makeDirectory(path, uid, gid) {
  mkdirSync(path, { mode: 0o700 });
  chmodSync(path, 0o700);
  chownSync(path, uid, gid);
}

function writeNew(path, bytes, uid, gid) {
  const descriptor = openSync(
    path,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    writeFileSync(descriptor, bytes, 'utf8');
  } finally {
    closeSync(descriptor);
  }
  chmodSync(path, 0o600);
  chownSync(path, uid, gid);
}

function calendarHash(value) {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

function requireValue(value, key) {
  if (typeof value[key] !== 'string' || value[key].length === 0)
    throw new Error('permanent-bootstrap-source-invalid');
  return value[key];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    const code =
      error instanceof Error && /^[a-z0-9-]{3,96}$/u.test(error.message)
        ? error.message
        : 'permanent-bootstrap-failed';
    process.stderr.write(`{"status":"rejected","code":"${code}"}\n`);
    process.exitCode = 1;
  }
}
