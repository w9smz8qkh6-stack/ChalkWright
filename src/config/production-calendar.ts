import { createHash } from 'node:crypto';
import { isAbsolute, relative, resolve } from 'node:path';

import { isIanaTimeZone } from '../domain/runtime-validation.js';
import { readProtectedJson } from '../infrastructure/filesystem/protected-json.js';

const sha256Pattern = /^sha256:[a-f0-9]{64}$/u;

/** Protected, single-target Calendar authority for the permanent production lane. */
export interface ProductionCalendarConfig {
  readonly version: 1;
  readonly kind: 'chalkwright-production';
  readonly calendarId: string;
  readonly calendarReferenceHash: string;
  readonly deniedCalendarReferenceHashes: readonly [string, string];
  readonly scopeId: string;
  readonly timeZone: 'Asia/Ho_Chi_Minh';
  readonly productionConfigReference: string;
  readonly credentialReferencePath: string;
  readonly databasePath: string;
  readonly requestTimeoutMs: number;
  readonly overallTimeoutMs: number;
  readonly leaseDurationSeconds: number;
  readonly maximumPages: number;
  readonly maximumEvents: number;
}

export function loadProductionCalendarConfig(
  referencePath: string,
  repositoryRoot = process.cwd(),
): ProductionCalendarConfig {
  if (!externalPath(referencePath, repositoryRoot))
    throw new Error('production-calendar-config-invalid');
  const value = readProtectedJson(referencePath, isPayload);
  if (
    !externalPath(value.productionConfigReference, repositoryRoot) ||
    !externalPath(value.credentialReferencePath, repositoryRoot) ||
    !externalPath(value.databasePath, repositoryRoot) ||
    value.calendarId === 'primary' ||
    value.calendarReferenceHash !== calendarReferenceHash(value.calendarId) ||
    value.deniedCalendarReferenceHashes[0] !==
      calendarReferenceHash('primary') ||
    value.deniedCalendarReferenceHashes[1] === value.calendarReferenceHash ||
    value.deniedCalendarReferenceHashes[0] === value.calendarReferenceHash ||
    value.deniedCalendarReferenceHashes[0] ===
      value.deniedCalendarReferenceHashes[1]
  )
    throw new Error('production-calendar-config-invalid');
  return value;
}

export function calendarReferenceHash(calendarId: string): string {
  return `sha256:${createHash('sha256')
    .update(JSON.stringify(calendarId))
    .digest('hex')}`;
}

function isPayload(value: unknown): value is ProductionCalendarConfig {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).sort().join(',') ===
      'calendarId,calendarReferenceHash,credentialReferencePath,databasePath,deniedCalendarReferenceHashes,kind,leaseDurationSeconds,maximumEvents,maximumPages,overallTimeoutMs,productionConfigReference,requestTimeoutMs,scopeId,timeZone,version' &&
    record.version === 1 &&
    record.kind === 'chalkwright-production' &&
    typeof record.calendarId === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9._@-]{0,511}$/u.test(record.calendarId) &&
    typeof record.calendarReferenceHash === 'string' &&
    sha256Pattern.test(record.calendarReferenceHash) &&
    Array.isArray(record.deniedCalendarReferenceHashes) &&
    record.deniedCalendarReferenceHashes.length === 2 &&
    record.deniedCalendarReferenceHashes.every(
      (entry) => typeof entry === 'string' && sha256Pattern.test(entry),
    ) &&
    typeof record.scopeId === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}-production$/u.test(record.scopeId) &&
    record.timeZone === 'Asia/Ho_Chi_Minh' &&
    isIanaTimeZone(record.timeZone) &&
    typeof record.productionConfigReference === 'string' &&
    typeof record.credentialReferencePath === 'string' &&
    typeof record.databasePath === 'string' &&
    boundedInteger(record.requestTimeoutMs, 1_000, 30_000) &&
    boundedInteger(record.overallTimeoutMs, 30_000, 300_000) &&
    boundedInteger(record.leaseDurationSeconds, 60, 900) &&
    boundedInteger(record.maximumPages, 1, 5) &&
    boundedInteger(record.maximumEvents, 1, 100) &&
    Number(record.overallTimeoutMs) > Number(record.requestTimeoutMs) * 4
  );
}

function externalPath(value: string, repositoryRoot: string): boolean {
  if (
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
