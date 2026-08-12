import { isAbsolute, relative, resolve } from 'node:path';

import type { ClassId, RoomId, ScreenId } from '../domain/identities.js';
import { isIanaTimeZone, isIsoDate } from '../domain/runtime-validation.js';
import { readProtectedJson } from '../infrastructure/filesystem/protected-json.js';
import type { DismissalMediaReference } from '../presentation/assets.js';
import {
  boundedId,
  boundedInteger,
  boundedText,
  parseMappings,
  protectedPath,
  type ShadowCourseMapping,
} from './shadow.js';

export interface ProductionServerConfig {
  readonly version: 1;
  readonly instanceId: string;
  readonly roomId: RoomId;
  readonly screenId: ScreenId;
  readonly screenLabel: string;
  readonly host: '127.0.0.1' | '::1';
  readonly port: number;
  readonly timeZone: string;
  readonly academicYearEnd: string;
  readonly managedRoot: string;
  readonly databasePath: string;
  readonly backupDirectory: string;
  readonly operatorTokenReference: string;
  readonly courseMappings: readonly ShadowCourseMapping[];
  readonly checkInOpenMinutesBefore: number;
  readonly dismissalWarningMinutesBefore: number;
  readonly dismissalMedia?: DismissalMediaReference;
}

interface ProductionServerPayload {
  readonly version: 1;
  readonly instanceId: string;
  readonly roomId: string;
  readonly screenId: string;
  readonly screenLabel: string;
  readonly host: string;
  readonly port: number;
  readonly timeZone: string;
  readonly academicYearEnd: string;
  readonly managedRoot: string;
  readonly databasePath: string;
  readonly backupDirectory: string;
  readonly operatorTokenReference: string;
  readonly courseMappings: readonly unknown[];
  readonly checkInOpenMinutesBefore: number;
  readonly dismissalWarningMinutesBefore: number;
  readonly dismissalMedia?: unknown;
}

/** Load the inert M-16 production-server contract from one owner-only JSON reference. */
export function loadProductionServerConfig(
  referencePath: string,
  repositoryRoot = process.cwd(),
): ProductionServerConfig {
  if (!isExternalPath(referencePath, repositoryRoot))
    throw new Error('production-config-invalid');
  const payload = readProtectedJson(referencePath, isProductionPayload);
  const instanceId = boundedId('instanceId', payload.instanceId);
  if (!instanceId.endsWith('-production'))
    throw new Error('production-config-invalid');
  const roomId = boundedId('roomId', payload.roomId, 96) as RoomId;
  const screenId = boundedId('screenId', payload.screenId, 96) as ScreenId;
  if (payload.host !== '127.0.0.1' && payload.host !== '::1')
    throw new Error('production-config-invalid');
  const port = boundedInteger('port', String(payload.port), 1_024, 65_535);
  if (!isIanaTimeZone(payload.timeZone) || !isIsoDate(payload.academicYearEnd))
    throw new Error('production-config-invalid');
  const managedRoot = protectedPath('managedRoot', payload.managedRoot);
  if (
    !/(?:^|[-_/])production(?:[-_/]|$)/iu.test(managedRoot) ||
    !isExternalPath(managedRoot, repositoryRoot)
  )
    throw new Error('production-config-invalid');
  const databasePath = protectedPath(
    'databasePath',
    payload.databasePath,
    managedRoot,
  );
  const backupDirectory = protectedPath(
    'backupDirectory',
    payload.backupDirectory,
    managedRoot,
  );
  if (
    isSameOrChild(databasePath, backupDirectory) ||
    isSameOrChild(backupDirectory, databasePath)
  )
    throw new Error('production-config-invalid');
  const operatorTokenReference = protectedPath(
    'operatorTokenReference',
    payload.operatorTokenReference,
  );
  if (
    operatorTokenReference === referencePath ||
    !isExternalPath(operatorTokenReference, repositoryRoot) ||
    isSameOrChild(operatorTokenReference, managedRoot) ||
    isSameOrChild(referencePath, managedRoot)
  )
    throw new Error('production-config-invalid');
  let courseMappings: readonly ShadowCourseMapping[];
  try {
    courseMappings = parseMappings(
      JSON.stringify(payload.courseMappings),
      roomId,
    );
  } catch {
    throw new Error('production-config-invalid');
  }
  return {
    version: 1,
    instanceId,
    roomId,
    screenId,
    screenLabel: boundedText('screenLabel', payload.screenLabel),
    host: payload.host,
    port,
    timeZone: payload.timeZone,
    academicYearEnd: payload.academicYearEnd,
    managedRoot,
    databasePath,
    backupDirectory,
    operatorTokenReference,
    courseMappings,
    checkInOpenMinutesBefore: boundedInteger(
      'checkInOpenMinutesBefore',
      String(payload.checkInOpenMinutesBefore),
      0,
      120,
    ),
    dismissalWarningMinutesBefore: boundedInteger(
      'dismissalWarningMinutesBefore',
      String(payload.dismissalWarningMinutesBefore),
      0,
      120,
    ),
    ...(payload.dismissalMedia === undefined
      ? {}
      : {
          dismissalMedia: parseDismissalMediaReference(
            payload.dismissalMedia,
            repositoryRoot,
          ),
        }),
  };
}

function parseDismissalMediaReference(
  value: unknown,
  repositoryRoot: string,
): DismissalMediaReference {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error('production-config-invalid');
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(',') !== 'byteLength,path,sha256' ||
    typeof record.path !== 'string' ||
    !isExternalPath(record.path, repositoryRoot) ||
    typeof record.byteLength !== 'number' ||
    !Number.isSafeInteger(record.byteLength) ||
    record.byteLength < 12 ||
    record.byteLength > 100_000_000 ||
    typeof record.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(record.sha256)
  )
    throw new Error('production-config-invalid');
  return {
    path: record.path,
    byteLength: record.byteLength,
    sha256: record.sha256,
  };
}

function isExternalPath(candidate: string, repositoryRoot: string): boolean {
  try {
    protectedPath('path', candidate);
    const relation = relative(resolve(repositoryRoot), candidate);
    return (
      relation.length > 0 && (relation.startsWith('..') || isAbsolute(relation))
    );
  } catch {
    return false;
  }
}

function isProductionPayload(value: unknown): value is ProductionServerPayload {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const required = [
    'academicYearEnd',
    'backupDirectory',
    'checkInOpenMinutesBefore',
    'courseMappings',
    'databasePath',
    'dismissalWarningMinutesBefore',
    'host',
    'instanceId',
    'managedRoot',
    'operatorTokenReference',
    'port',
    'roomId',
    'screenId',
    'screenLabel',
    'timeZone',
    'version',
  ].sort();
  const keysWithoutOptional = keys.filter((key) => key !== 'dismissalMedia');
  return (
    keysWithoutOptional.length === required.length &&
    keysWithoutOptional.every((key, index) => key === required[index]) &&
    (record.dismissalMedia === undefined || keys.includes('dismissalMedia')) &&
    record.version === 1 &&
    typeof record.instanceId === 'string' &&
    typeof record.roomId === 'string' &&
    typeof record.screenId === 'string' &&
    typeof record.screenLabel === 'string' &&
    typeof record.host === 'string' &&
    typeof record.port === 'number' &&
    typeof record.timeZone === 'string' &&
    typeof record.academicYearEnd === 'string' &&
    typeof record.managedRoot === 'string' &&
    typeof record.databasePath === 'string' &&
    typeof record.backupDirectory === 'string' &&
    typeof record.operatorTokenReference === 'string' &&
    Array.isArray(record.courseMappings) &&
    typeof record.checkInOpenMinutesBefore === 'number' &&
    typeof record.dismissalWarningMinutesBefore === 'number'
  );
}

function isSameOrChild(candidate: string, root: string): boolean {
  const relation = relative(root, candidate);
  return (
    relation.length === 0 || (relation !== '..' && !relation.startsWith('../'))
  );
}
