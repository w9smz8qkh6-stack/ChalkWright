import {
  chmodSync,
  chownSync,
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';

const root = '/etc/chalkwright/canary';
const bindingsPath = `${root}/activation-bindings.json`;
const manifestPath = `${root}/activation-manifest.json`;
const calendarPath = `${root}/calendar.json`;
const releaseLink = '/opt/chalkwright-canary/current';
const evidencePath =
  '/var/lib/chalkwright/canary-production/evidence/m17-preactivation.json';

function main() {
  if (
    process.argv.slice(2).join(' ') !== '--apply' ||
    process.geteuid?.() !== 0
  )
    throw new Error('m17-bind-usage-invalid');
  const identity = lstatSync('/var/lib/chalkwright/canary-production');
  if (!identity.isDirectory() || identity.uid === 0 || identity.gid === 0)
    throw new Error('m17-bind-identity-invalid');
  const bindings = JSON.parse(readProtected(bindingsPath, 16 * 1024));
  const calendar = JSON.parse(readProtected(calendarPath, 32 * 1024));
  const evidence = JSON.parse(readProtected(evidencePath, 128 * 1024));
  const release = readlinkSync(releaseLink);
  const match = /^releases\/([a-f0-9]{64})$/u.exec(release);
  if (
    !match ||
    !validBindings(bindings) ||
    !validCalendar(calendar) ||
    !validEvidence(evidence)
  )
    throw new Error('m17-bind-input-invalid');
  const manifest = {
    version: 1,
    kind: 'chalkwright-m17-activation-manifest',
    releaseSha256: match[1],
    calendarReferenceHash: calendar.calendarReferenceHash,
    deniedCalendarReferenceHashes: calendar.deniedCalendarReferenceHashes,
    tailnetTarget: bindings.tailnetTarget,
    legacyRouteFingerprint: bindings.legacyRouteFingerprint,
    stopCommand:
      '/opt/chalkwright-canary/current/scripts/operations/stop-m17-canary.sh',
    observationStartsAt: bindings.observationStartsAt,
    observationEndsAt: bindings.observationEndsAt,
    comparisonEvidenceFingerprint: digest(evidence),
    comparisonRecordKey: evidence.recordKey,
    comparisonDate: evidence.scope.date,
    screenId: evidence.scope.screenId,
  };
  writeNew(
    manifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
    identity.uid,
    identity.gid,
  );
  rmSync(bindingsPath);
  rmSync(evidencePath);
  process.stdout.write(
    `${JSON.stringify({ status: 'm17-activation-manifest-bound', manifestFingerprint: digest(manifest), valuesPrinted: 0, providerRequests: 0, servicesStarted: 0, routeChanges: 0 })}\n`,
  );
}

function validBindings(value) {
  return (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(',') ===
      'legacyRouteFingerprint,observationEndsAt,observationStartsAt,tailnetTarget' &&
    typeof value.tailnetTarget === 'string' &&
    /^https:\/\/[a-z0-9](?:[a-z0-9-]{0,62}\.)+ts\.net(?::\d{1,5})?\/classroom-screen$/u.test(
      value.tailnetTarget,
    ) &&
    typeof value.legacyRouteFingerprint === 'string' &&
    /^sha256:[a-f0-9]{64}$/u.test(value.legacyRouteFingerprint) &&
    typeof value.observationStartsAt === 'string' &&
    typeof value.observationEndsAt === 'string' &&
    Number.isFinite(Date.parse(value.observationStartsAt)) &&
    Number.isFinite(Date.parse(value.observationEndsAt)) &&
    Date.parse(value.observationEndsAt) -
      Date.parse(value.observationStartsAt) >=
      60 * 60_000 &&
    Date.parse(value.observationEndsAt) -
      Date.parse(value.observationStartsAt) <=
      14 * 24 * 60 * 60_000
  );
}
function validCalendar(value) {
  return (
    value &&
    typeof value === 'object' &&
    /^sha256:[a-f0-9]{64}$/u.test(value.calendarReferenceHash) &&
    Array.isArray(value.deniedCalendarReferenceHashes) &&
    value.deniedCalendarReferenceHashes.length === 2
  );
}
function validEvidence(value) {
  return (
    value &&
    value.kind === 'comparison-evidence' &&
    /^m17-preactivation-[a-f0-9]{24}$/u.test(value.recordKey) &&
    value.data?.equal === true &&
    Array.isArray(value.data.differenceCodes) &&
    value.data.differenceCodes.length === 0 &&
    /^\d{4}-\d{2}-\d{2}$/u.test(value.scope?.date) &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/u.test(value.scope?.screenId)
  );
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
      throw new Error('m17-bind-source-unsafe');
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = fstatSync(fd);
    if (
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      opened.size !== before.size
    )
      throw new Error('m17-bind-source-unsafe');
    return readFileSync(fd, 'utf8');
  } finally {
    if (fd !== undefined) closeSync(fd);
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
function digest(value) {
  return `sha256:${createHash('sha256').update(stable(value)).digest('hex')}`;
}
function stable(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
    .join(',')}}`;
}

try {
  main();
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({ status: 'rejected', code: error instanceof Error && /^m17-[a-z0-9-]+$/u.test(error.message) ? error.message : 'm17-bind-failed' })}\n`,
  );
  process.exitCode = 1;
}
