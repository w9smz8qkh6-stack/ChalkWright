import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  chmodSync,
  chownSync,
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
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const serverSource = '/etc/classroom-hub/shadow/server.env';
const refreshSource = '/etc/classroom-hub/shadow/refresh.env';
const productionReference = '/etc/classroom-hub/server/production-server.json';
const operatorReference = '/etc/classroom-hub/operator/operator-token';
const classroomReference =
  '/etc/classroom-hub/providers/google-classroom/authorized-user.json';
const planEnvironment = '/etc/classroom-hub/jobs/production-plan-refresh.env';
const classroomEnvironment =
  '/etc/classroom-hub/jobs/production-classroom-refresh.env';
const managedRoot = '/var/lib/classroom-hub/production';
const databasePath = `${managedRoot}/state/classroom-hub.sqlite`;
const backupDirectory = `${managedRoot}/backups`;
const sessionDirectory = '/var/lib/classroom-hub/powerschool-session';
const courseworkScope =
  'https://www.googleapis.com/auth/classroom.student-submissions.students.readonly';

const powerSchoolKeys = [
  'CLASSROOM_HUB_POWERSCHOOL_ROOM_ID',
  'CLASSROOM_HUB_POWERSCHOOL_ORIGIN',
  'CLASSROOM_HUB_POWERSCHOOL_STATUS_PATH',
  'CLASSROOM_HUB_POWERSCHOOL_STATUS_READY_SELECTOR',
  'CLASSROOM_HUB_POWERSCHOOL_BELL_PATH_TEMPLATE',
  'CLASSROOM_HUB_POWERSCHOOL_BELL_READY_SELECTOR',
  'CLASSROOM_HUB_POWERSCHOOL_CHROME_EXECUTABLE',
  'CLASSROOM_HUB_POWERSCHOOL_NAVIGATION_TIMEOUT_SECONDS',
  'CLASSROOM_HUB_POWERSCHOOL_ROUTINE_TIMEOUT_SECONDS',
  'CLASSROOM_HUB_POWERSCHOOL_MAX_RESPONSE_BYTES',
  'CLASSROOM_HUB_POWERSCHOOL_UTC_OFFSET',
];

const classroomKeys = [
  'CLASSROOM_HUB_CLASSROOM_REQUEST_TIMEOUT_SECONDS',
  'CLASSROOM_HUB_CLASSROOM_MAX_PAGES_PER_COURSE',
  'CLASSROOM_HUB_CLASSROOM_MAX_ITEMS_PER_COURSE',
  'CLASSROOM_HUB_CLASSROOM_MAX_PARALLEL_COURSES',
  'CLASSROOM_HUB_CLASSROOM_CACHE_FRESH_SECONDS',
  'CLASSROOM_HUB_CLASSROOM_BACKOFF_BASE_SECONDS',
  'CLASSROOM_HUB_CLASSROOM_BACKOFF_MAX_SECONDS',
];

export function parseSystemdEnvironmentText(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > 64 * 1024)
    throw new Error('m16-provision-source-invalid');
  const result = Object.create(null);
  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/u.exec(line);
    if (match === null || Object.hasOwn(result, match[1]))
      throw new Error('m16-provision-source-invalid');
    let value;
    try {
      value = JSON.parse(match[2]);
    } catch {
      throw new Error('m16-provision-source-invalid');
    }
    if (
      typeof value !== 'string' ||
      value.includes('\0') ||
      /[\r\n]/u.test(value)
    )
      throw new Error('m16-provision-source-invalid');
    result[match[1]] = value;
  }
  return result;
}

export function buildProductionPayload(server, refresh) {
  const roomId = required(server, 'CLASSROOM_HUB_SHADOW_ROOM_ID');
  const timeZone = required(server, 'CLASSROOM_HUB_TIME_ZONE');
  if (timeZone !== 'Asia/Ho_Chi_Minh')
    throw new Error('m16-provision-policy-invalid');
  const courseMappings = parseMappings(
    required(server, 'CLASSROOM_HUB_SHADOW_COURSE_MAPPINGS'),
  );
  const classroomMappings = parseClassroomMappings(
    required(refresh, 'CLASSROOM_HUB_CLASSROOM_COURSE_MAPPINGS'),
  );
  if (
    JSON.stringify(
      courseMappings.map(({ classId, providerCourseKey }) => ({
        classId,
        providerCourseKey,
      })),
    ) !== JSON.stringify(classroomMappings)
  )
    throw new Error('m16-provision-mapping-mismatch');
  if (required(refresh, 'CLASSROOM_HUB_POWERSCHOOL_ROOM_ID') !== roomId)
    throw new Error('m16-provision-room-mismatch');
  return {
    version: 1,
    instanceId: 'classroom-hub-c509-production',
    roomId,
    screenId: 'screen-c509-production',
    screenLabel: required(server, 'CLASSROOM_HUB_SHADOW_SCREEN_LABEL'),
    host: '127.0.0.1',
    port: 4317,
    timeZone,
    academicYearEnd: required(server, 'CLASSROOM_HUB_ACADEMIC_YEAR_END'),
    managedRoot,
    databasePath,
    backupDirectory,
    operatorTokenReference: operatorReference,
    courseMappings,
    checkInOpenMinutesBefore: boundedInteger(
      required(server, 'CLASSROOM_HUB_SHADOW_CHECKIN_MINUTES'),
      0,
      120,
    ),
    dismissalWarningMinutesBefore: boundedInteger(
      required(server, 'CLASSROOM_HUB_SHADOW_DISMISSAL_WARNING_MINUTES'),
      0,
      120,
    ),
  };
}

export function buildJobEnvironments(server, refresh) {
  const payload = buildProductionPayload(server, refresh);
  const common = {
    CLASSROOM_HUB_PRODUCTION_CONFIG_REFERENCE: productionReference,
    CLASSROOM_HUB_INSTANCE_ID: payload.instanceId,
    CLASSROOM_HUB_OPERATIONS_SCOPE_ID: 'c509-production',
    CLASSROOM_HUB_TIME_ZONE: payload.timeZone,
    CLASSROOM_HUB_MANAGED_ROOT: managedRoot,
    CLASSROOM_HUB_DATABASE_PATH: databasePath,
    CLASSROOM_HUB_BACKUP_DIRECTORY: backupDirectory,
    CLASSROOM_HUB_ACADEMIC_YEAR_END: payload.academicYearEnd,
    CLASSROOM_HUB_JOB_DEADLINE_SECONDS: required(
      refresh,
      'CLASSROOM_HUB_JOB_DEADLINE_SECONDS',
    ),
    CLASSROOM_HUB_ALERT_DELIVERY_MODE: 'report-only',
  };
  const plan = { ...common };
  for (const key of powerSchoolKeys) plan[key] = required(refresh, key);
  plan.CLASSROOM_HUB_POWERSCHOOL_SESSION_DIRECTORY = sessionDirectory;
  const classroom = {
    ...common,
    CLASSROOM_HUB_CLASSROOM_CREDENTIAL_REFERENCE: classroomReference,
    CLASSROOM_HUB_CLASSROOM_COURSE_MAPPINGS: required(
      refresh,
      'CLASSROOM_HUB_CLASSROOM_COURSE_MAPPINGS',
    ),
  };
  for (const key of classroomKeys) classroom[key] = required(refresh, key);
  if (
    classroom.CLASSROOM_HUB_CLASSROOM_BACKOFF_BASE_SECONDS !== '60' ||
    classroom.CLASSROOM_HUB_CLASSROOM_BACKOFF_MAX_SECONDS !== '3600'
  )
    throw new Error('m16-provision-classroom-policy-invalid');
  classroom.CLASSROOM_HUB_CLASSROOM_BACKOFF_MAX_SECONDS = '900';
  return { payload, plan, classroom };
}

export function renderEnvironment(environment) {
  return `${Object.keys(environment)
    .sort()
    .map((key) => `${key}=${JSON.stringify(environment[key])}`)
    .join('\n')}\n`;
}

function main() {
  if (process.argv.slice(2).join(' ') !== '--apply')
    throw new Error('m16-provision-usage-invalid');
  if (process.geteuid?.() !== 0) throw new Error('m16-provision-root-required');
  const identity = statSync('/etc/classroom-hub/server');
  if (identity.uid === 0 || identity.gid === 0)
    throw new Error('m16-provision-identity-unavailable');
  const uid = identity.uid;
  const gid = identity.gid;
  assertTargetDirectory('/etc/classroom-hub/server', uid, gid, 0o700);
  assertTargetDirectory('/etc/classroom-hub/operator', uid, gid, 0o700);
  assertTargetDirectory(
    '/etc/classroom-hub/providers/google-classroom',
    uid,
    gid,
    0o700,
  );
  assertTargetDirectory('/etc/classroom-hub/jobs', 0, 0, 0o700);
  assertTargetDirectory(managedRoot, uid, gid, 0o700);
  assertTargetDirectory(`${managedRoot}/state`, uid, gid, 0o700);
  assertTargetDirectory(backupDirectory, uid, gid, 0o700);
  assertTargetDirectory(sessionDirectory, uid, gid, 0o700);

  const server = parseSystemdEnvironmentText(
    readProtectedSource(serverSource, 1000, 0o600, 64 * 1024),
  );
  const refresh = parseSystemdEnvironmentText(
    readProtectedSource(refreshSource, 1000, 0o600, 64 * 1024),
  );
  const { payload, plan, classroom } = buildJobEnvironments(server, refresh);
  const credentialSource = required(
    refresh,
    'CLASSROOM_HUB_CLASSROOM_CREDENTIAL_REFERENCE',
  );
  const credentialBytes = readProtectedSource(
    credentialSource,
    1000,
    0o600,
    16 * 1024,
  );
  validateCredential(credentialBytes);

  const targets = [
    productionReference,
    operatorReference,
    classroomReference,
    planEnvironment,
    classroomEnvironment,
  ];
  for (const target of targets) assertAbsent(target);
  const created = [];
  try {
    writeNewProtected(
      productionReference,
      `${JSON.stringify(payload, null, 2)}\n`,
      uid,
      gid,
    );
    created.push(productionReference);
    writeNewProtected(
      operatorReference,
      `${randomBytes(48).toString('base64url')}\n`,
      uid,
      gid,
    );
    created.push(operatorReference);
    writeNewProtected(classroomReference, credentialBytes, uid, gid);
    created.push(classroomReference);
    writeNewProtected(planEnvironment, renderEnvironment(plan), 0, 0);
    created.push(planEnvironment);
    writeNewProtected(classroomEnvironment, renderEnvironment(classroom), 0, 0);
    created.push(classroomEnvironment);
  } catch (error) {
    for (const target of created.reverse()) rmSync(target, { force: true });
    throw error;
  }
  const evidence = {
    status: 'provisioned-inert',
    files: targets.length,
    valuesPrinted: 0,
    serviceUnitsInstalled: 0,
    serviceUnitsStarted: 0,
    providerRequests: 0,
    digest: `sha256:${createHash('sha256')
      .update(
        JSON.stringify({
          payload,
          planKeys: Object.keys(plan).sort(),
          classroomKeys: Object.keys(classroom).sort(),
          targets,
        }),
      )
      .digest('hex')}`,
  };
  process.stdout.write(`${JSON.stringify(evidence)}\n`);
}

function readProtectedSource(path, uid, mode, maximumBytes) {
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
    throw new Error('m16-provision-source-unsafe');
  const parent = lstatSync(dirname(path));
  if (
    !parent.isDirectory() ||
    parent.isSymbolicLink() ||
    parent.uid !== uid ||
    (parent.mode & 0o077) !== 0 ||
    realpathSync(dirname(path)) !== dirname(path)
  )
    throw new Error('m16-provision-source-unsafe');
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
      throw new Error('m16-provision-source-unsafe');
    return readFileSync(descriptor, 'utf8');
  } finally {
    closeSync(descriptor);
  }
}

function writeNewProtected(path, value, uid, gid) {
  if (
    typeof value !== 'string' ||
    Buffer.byteLength(value, 'utf8') > 128 * 1024
  )
    throw new Error('m16-provision-target-invalid');
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
    writeFileSync(descriptor, value, 'utf8');
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

function assertTargetDirectory(path, uid, gid, mode) {
  const stat = lstatSync(path);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    stat.uid !== uid ||
    stat.gid !== gid ||
    (stat.mode & 0o777) !== mode ||
    realpathSync(path) !== path
  )
    throw new Error('m16-provision-target-unsafe');
}

function assertAbsent(path) {
  try {
    lstatSync(path);
    throw new Error('m16-provision-target-exists');
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === 'm16-provision-target-exists'
    )
      throw error;
    if (error?.code !== 'ENOENT') throw error;
  }
}

function required(environment, name) {
  const value = environment[name];
  if (typeof value !== 'string' || value.length === 0)
    throw new Error('m16-provision-source-incomplete');
  return value;
}

function boundedInteger(value, minimum, maximum) {
  if (!/^\d{1,10}$/u.test(value))
    throw new Error('m16-provision-policy-invalid');
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum)
    throw new Error('m16-provision-policy-invalid');
  return number;
}

function parseMappings(value) {
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('m16-provision-mapping-invalid');
  }
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 12)
    throw new Error('m16-provision-mapping-invalid');
  for (const entry of parsed) {
    const keys =
      entry !== null && typeof entry === 'object' && !Array.isArray(entry)
        ? Object.keys(entry).sort().join(',')
        : '';
    if (
      ![
        'classId,providerCourseKey,sectionCode',
        'attendanceClassCode,classId,providerCourseKey,sectionCode',
      ].includes(keys) ||
      typeof entry.classId !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(entry.classId) ||
      typeof entry.providerCourseKey !== 'string' ||
      !/^\d{1,32}$/u.test(entry.providerCourseKey) ||
      typeof entry.sectionCode !== 'string' ||
      entry.sectionCode.length < 1 ||
      entry.sectionCode.length > 256 ||
      /[\r\n\0]/u.test(entry.sectionCode) ||
      (entry.attendanceClassCode !== undefined &&
        (typeof entry.attendanceClassCode !== 'string' ||
          entry.attendanceClassCode.length < 1 ||
          entry.attendanceClassCode.length > 64 ||
          /[\r\n\0]/u.test(entry.attendanceClassCode)))
    )
      throw new Error('m16-provision-mapping-invalid');
  }
  if (
    new Set(parsed.map((entry) => entry.classId)).size !== parsed.length ||
    new Set(parsed.map((entry) => entry.providerCourseKey)).size !==
      parsed.length
  )
    throw new Error('m16-provision-mapping-invalid');
  return parsed;
}

function parseClassroomMappings(value) {
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('m16-provision-mapping-invalid');
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length < 1 ||
    parsed.length > 12 ||
    parsed.some(
      (entry) =>
        entry === null ||
        typeof entry !== 'object' ||
        Array.isArray(entry) ||
        Object.keys(entry).sort().join(',') !== 'classId,providerCourseKey' ||
        typeof entry.classId !== 'string' ||
        typeof entry.providerCourseKey !== 'string',
    )
  )
    throw new Error('m16-provision-mapping-invalid');
  return parsed;
}

function validateCredential(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('m16-provision-classroom-reference-invalid');
  }
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !==
      'clientId,clientSecret,refreshToken,scopes,type,version' ||
    value.version !== 1 ||
    value.type !== 'authorized-user' ||
    typeof value.clientId !== 'string' ||
    !/^[A-Za-z0-9._-]{8,256}\.apps\.googleusercontent\.com$/u.test(
      value.clientId,
    ) ||
    typeof value.clientSecret !== 'string' ||
    !/^[A-Za-z0-9._-]{8,256}$/u.test(value.clientSecret) ||
    typeof value.refreshToken !== 'string' ||
    value.refreshToken.length < 8 ||
    value.refreshToken.length > 4096 ||
    !Array.isArray(value.scopes) ||
    value.scopes.length !== 1 ||
    value.scopes[0] !== courseworkScope
  )
    throw new Error('m16-provision-classroom-reference-invalid');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({ status: 'rejected', code: error instanceof Error ? error.message : 'm16-provision-failed' })}\n`,
    );
    process.exitCode = 1;
  }
}
