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

import { epoch } from '../domain/pure-values.js';
import { isIanaTimeZone, isIsoInstant } from '../domain/runtime-validation.js';

const maximumConfigBytes = 16 * 1024;
const sha256Pattern = /^sha256:[a-f0-9]{64}$/u;

export interface GoogleCalendarWriterConfig {
  readonly version: 1;
  readonly environment: 'non-production';
  readonly calendarSummary: 'Auto Lesson 2';
  readonly calendarId: string;
  readonly calendarReferenceHash: string;
  readonly productionCalendarReferenceHash: string;
  readonly qualificationRunId: string;
  readonly approvalIssuedAt: string;
  readonly approvalExpiresAt: string;
  readonly scopeId: string;
  readonly timeZone: string;
  readonly credentialReferencePath: string;
  readonly databasePath: string;
  readonly requestTimeoutMs: number;
  readonly overallTimeoutMs: number;
  readonly leaseDurationSeconds: number;
}

/** Reads one owner-only, exact-shape M-14 live configuration. */
export function loadGoogleCalendarWriterConfig(
  referencePath: string,
  repositoryRoot = process.cwd(),
): GoogleCalendarWriterConfig {
  let descriptor: number | undefined;
  try {
    const effectiveUid = process.geteuid?.();
    if (effectiveUid === undefined)
      throw new Error('calendar-writer-config-unsafe');
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
      throw new Error('calendar-writer-config-unsafe');
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
      throw new Error('calendar-writer-config-unsafe');
    const value: unknown = JSON.parse(readFileSync(descriptor, 'utf8'));
    if (!isWriterConfig(value, repositoryRoot))
      throw new Error('calendar-writer-config-invalid');
    return value;
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      error.message.startsWith('calendar-writer-config-')
    )
      throw error;
    throw new Error('calendar-writer-config-unsafe');
  } finally {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        // A close failure cannot reveal protected configuration.
      }
    }
  }
}

function isWriterConfig(
  value: unknown,
  repositoryRoot: string,
): value is GoogleCalendarWriterConfig {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return false;
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(',') !==
      'approvalExpiresAt,approvalIssuedAt,calendarId,calendarReferenceHash,calendarSummary,credentialReferencePath,databasePath,environment,leaseDurationSeconds,overallTimeoutMs,productionCalendarReferenceHash,qualificationRunId,requestTimeoutMs,scopeId,timeZone,version' ||
    record.version !== 1 ||
    record.environment !== 'non-production' ||
    record.calendarSummary !== 'Auto Lesson 2' ||
    typeof record.calendarId !== 'string' ||
    record.calendarId === 'primary' ||
    !/^[A-Za-z0-9][A-Za-z0-9._@-]{0,511}$/u.test(record.calendarId) ||
    typeof record.calendarReferenceHash !== 'string' ||
    record.calendarReferenceHash !== digest(record.calendarId) ||
    typeof record.productionCalendarReferenceHash !== 'string' ||
    !sha256Pattern.test(record.productionCalendarReferenceHash) ||
    record.productionCalendarReferenceHash === record.calendarReferenceHash ||
    typeof record.qualificationRunId !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._:@-]{0,63}$/u.test(record.qualificationRunId) ||
    !validApprovalWindow(record.approvalIssuedAt, record.approvalExpiresAt) ||
    typeof record.scopeId !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$/u.test(record.scopeId) ||
    typeof record.timeZone !== 'string' ||
    !isIanaTimeZone(record.timeZone) ||
    !externalAbsolutePath(record.credentialReferencePath, repositoryRoot) ||
    !externalAbsolutePath(record.databasePath, repositoryRoot) ||
    !boundedInteger(record.requestTimeoutMs, 1_000, 60_000) ||
    !boundedInteger(record.overallTimeoutMs, 30_000, 15 * 60_000) ||
    !boundedInteger(record.leaseDurationSeconds, 5, 900) ||
    Number(record.overallTimeoutMs) <= Number(record.requestTimeoutMs) * 4 ||
    Number(record.leaseDurationSeconds) * 1_000 <
      Number(record.requestTimeoutMs) * 8 + 5_000
  )
    return false;
  return true;
}

function validApprovalWindow(issuedAt: unknown, expiresAt: unknown): boolean {
  if (
    typeof issuedAt !== 'string' ||
    typeof expiresAt !== 'string' ||
    !isIsoInstant(issuedAt) ||
    !isIsoInstant(expiresAt)
  )
    return false;
  const issued = epoch(issuedAt);
  const expires = epoch(expiresAt);
  return (
    issued !== undefined &&
    expires !== undefined &&
    issued < expires &&
    expires - issued <= 15 * 60_000
  );
}

function externalAbsolutePath(value: unknown, repositoryRoot: string): boolean {
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

function digest(value: string): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}
