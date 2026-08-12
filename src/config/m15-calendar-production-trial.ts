import { createHash } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

import { isIanaTimeZone, isIsoInstant } from '../domain/runtime-validation.js';

const maximumConfigBytes = 32 * 1024;
const sha256Pattern = /^sha256:[a-f0-9]{64}$/u;

export interface M15CalendarProductionTrialConfig {
  readonly version: 1;
  readonly environment: 'production-trial';
  readonly date: '2026-08-11';
  readonly calendarId: string;
  readonly calendarReferenceHash: string;
  readonly scopeId: 'classroom-hub-c509-2026-27';
  readonly timeMin: string;
  readonly timeMax: string;
  readonly timeZone: 'Asia/Ho_Chi_Minh';
  readonly roomId: string;
  readonly screenId: string;
  readonly credentialReferencePath: string;
  readonly sourceManagedRoot: string;
  readonly sourceDatabasePath: string;
  readonly sourceBackupDirectory: string;
  readonly trialManagedRoot: string;
  readonly trialDatabasePath: string;
  readonly preparedStatePath: string;
  readonly approvalStatePath: string;
  readonly requestTimeoutMs: number;
  readonly overallTimeoutMs: number;
  readonly leaseDurationSeconds: number;
  readonly maximumPages: number;
  readonly maximumEvents: number;
  readonly maximumWindowDays: number;
  readonly legacyOpenClawPath: string;
  readonly legacyProfile: 'workonly';
  readonly legacyCronJobId: 'c174a3b2-1e75-49c5-94da-1b45f2c2f649';
}

export function loadM15CalendarProductionTrialConfig(
  referencePath: string,
  repositoryRoot = process.cwd(),
): M15CalendarProductionTrialConfig {
  let descriptor: number | undefined;
  try {
    const effectiveUid = process.geteuid?.();
    if (effectiveUid === undefined)
      throw new Error('m15-production-config-unsafe');
    const before = lstatSync(referencePath);
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      before.nlink !== 1 ||
      before.uid !== effectiveUid ||
      (before.mode & 0o077) !== 0 ||
      before.size < 2 ||
      before.size > maximumConfigBytes ||
      realpathSync(referencePath) !== referencePath
    )
      throw new Error('m15-production-config-unsafe');
    descriptor = openSync(
      referencePath,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    const opened = fstatSync(descriptor);
    if (
      !opened.isFile() ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      opened.nlink !== 1 ||
      opened.uid !== effectiveUid ||
      (opened.mode & 0o077) !== 0 ||
      opened.size !== before.size
    )
      throw new Error('m15-production-config-unsafe');
    const value: unknown = JSON.parse(readFileSync(descriptor, 'utf8'));
    if (!isM15Config(value, repositoryRoot))
      throw new Error('m15-production-config-invalid');
    return value;
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      error.message.startsWith('m15-production-config-')
    )
      throw error;
    throw new Error('m15-production-config-unsafe');
  } finally {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        // Closing cannot widen authority or disclose protected configuration.
      }
    }
  }
}

function isM15Config(
  value: unknown,
  repositoryRoot: string,
): value is M15CalendarProductionTrialConfig {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return false;
  const record = value as Record<string, unknown>;
  const exactKeys = [
    'approvalStatePath',
    'calendarId',
    'calendarReferenceHash',
    'credentialReferencePath',
    'date',
    'environment',
    'leaseDurationSeconds',
    'legacyCronJobId',
    'legacyOpenClawPath',
    'legacyProfile',
    'maximumEvents',
    'maximumPages',
    'maximumWindowDays',
    'overallTimeoutMs',
    'preparedStatePath',
    'requestTimeoutMs',
    'roomId',
    'scopeId',
    'screenId',
    'sourceBackupDirectory',
    'sourceDatabasePath',
    'sourceManagedRoot',
    'timeMax',
    'timeMin',
    'timeZone',
    'trialDatabasePath',
    'trialManagedRoot',
    'version',
  ].sort();
  if (
    Object.keys(record).sort().join(',') !== exactKeys.join(',') ||
    record.version !== 1 ||
    record.environment !== 'production-trial' ||
    record.date !== '2026-08-11' ||
    record.scopeId !== 'classroom-hub-c509-2026-27' ||
    record.timeZone !== 'Asia/Ho_Chi_Minh' ||
    !isIanaTimeZone(record.timeZone) ||
    !validCalendarId(record.calendarId) ||
    record.calendarReferenceHash !== digest(record.calendarId) ||
    !boundedId(record.roomId, 96) ||
    !boundedId(record.screenId, 96) ||
    !isIsoInstant(record.timeMin) ||
    !isIsoInstant(record.timeMax) ||
    record.timeMin !== '2026-08-10T17:00:00.000Z' ||
    record.timeMax !== '2026-08-11T17:00:00.000Z' ||
    !externalPath(record.credentialReferencePath, repositoryRoot) ||
    !externalPath(record.sourceManagedRoot, repositoryRoot) ||
    !childPath(record.sourceManagedRoot, record.sourceDatabasePath) ||
    !childPath(record.sourceManagedRoot, record.sourceBackupDirectory) ||
    !externalPath(record.trialManagedRoot, repositoryRoot) ||
    !childPath(record.trialManagedRoot, record.trialDatabasePath) ||
    !childPath(record.trialManagedRoot, record.preparedStatePath) ||
    !childPath(record.trialManagedRoot, record.approvalStatePath) ||
    record.trialManagedRoot === record.sourceManagedRoot ||
    !boundedInteger(record.requestTimeoutMs, 1_000, 60_000) ||
    !boundedInteger(record.overallTimeoutMs, 30_000, 15 * 60_000) ||
    Number(record.overallTimeoutMs) <= Number(record.requestTimeoutMs) * 8 ||
    !boundedInteger(record.leaseDurationSeconds, 30, 900) ||
    Number(record.leaseDurationSeconds) * 1_000 <
      Number(record.overallTimeoutMs) ||
    !boundedInteger(record.maximumPages, 1, 10) ||
    !boundedInteger(record.maximumEvents, 3, 1_000) ||
    !boundedInteger(record.maximumWindowDays, 1, 14) ||
    record.legacyOpenClawPath !== '/opt/openclaw/bin/openclaw' ||
    record.legacyProfile !== 'workonly' ||
    record.legacyCronJobId !== 'c174a3b2-1e75-49c5-94da-1b45f2c2f649'
  )
    return false;
  return (
    new Set([
      record.sourceDatabasePath,
      record.sourceBackupDirectory,
      record.trialDatabasePath,
      record.preparedStatePath,
      record.approvalStatePath,
    ]).size === 5
  );
}

function validCalendarId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value !== 'primary' &&
    /^[A-Za-z0-9][A-Za-z0-9._@-]{0,511}$/u.test(value)
  );
}

function boundedId(value: unknown, maximum: number): value is string {
  return (
    typeof value === 'string' &&
    value.length <= maximum &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(value)
  );
}

function boundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): boolean {
  return (
    Number.isSafeInteger(value) &&
    Number(value) >= minimum &&
    Number(value) <= maximum
  );
}

function externalPath(value: unknown, repositoryRoot: string): value is string {
  if (
    typeof value !== 'string' ||
    !isAbsolute(value) ||
    resolve(value) !== value ||
    value === '/' ||
    value.includes('\0')
  )
    return false;
  const relation = relative(resolve(repositoryRoot), value);
  return relation !== '' && (relation.startsWith('..') || isAbsolute(relation));
}

function childPath(root: unknown, value: unknown): value is string {
  if (typeof root !== 'string' || typeof value !== 'string') return false;
  if (!isAbsolute(root) || !isAbsolute(value) || resolve(value) !== value)
    return false;
  const relation = relative(resolve(root), value);
  return (
    relation !== '' &&
    relation !== '..' &&
    !relation.startsWith('../') &&
    !isAbsolute(relation)
  );
}

function digest(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}
