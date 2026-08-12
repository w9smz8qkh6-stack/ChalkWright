import { isAbsolute, relative, resolve } from 'node:path';

import { isIanaTimeZone, isIsoDate } from '../domain/runtime-validation.js';

export const alertDeliveryModes = ['report-only', 'fake'] as const;
export type AlertDeliveryMode = (typeof alertDeliveryModes)[number];

export interface OperationsConfig {
  readonly instanceId: string;
  readonly scopeId: string;
  readonly timeZone: string;
  readonly managedRoot: string;
  readonly databasePath: string;
  readonly backupDirectory: string;
  readonly academicYearEnd: string;
  readonly jobDeadlineSeconds: number;
  readonly alertDeliveryMode: AlertDeliveryMode;
  readonly alertRepeatSeconds?: number;
}

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name];
  if (value === undefined || value.length === 0)
    throw new Error(`${name} is required for an operational job`);
  return value;
}

function boundedId(name: string, value: string): string {
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,127})$/u.test(value))
    throw new Error(`${name} must be a bounded opaque identifier`);
  return value;
}

function boundedScopeId(name: string, value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/u.test(value))
    throw new Error(`${name} must be a bounded operational scope identifier`);
  return value;
}

function boundedInteger(
  name: string,
  value: string,
  minimum: number,
  maximum: number,
): number {
  if (!/^\d{1,10}$/u.test(value))
    throw new Error(
      `${name} must be an integer from ${minimum} through ${maximum}`,
    );
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum)
    throw new Error(
      `${name} must be an integer from ${minimum} through ${maximum}`,
    );
  return parsed;
}

function normalizedAbsolutePath(name: string, value: string): string {
  if (
    !isAbsolute(value) ||
    resolve(value) !== value ||
    value === '/' ||
    value.includes('\0')
  )
    throw new Error(`${name} must be a normalized absolute non-root path`);
  return value;
}

function isWithin(parent: string, child: string): boolean {
  const relation = relative(parent, child);
  return (
    relation.length > 0 && relation !== '..' && !relation.startsWith('../')
  );
}

/**
 * Loads only references and bounded policy required by a named operational job.
 * Display startup deliberately does not call this function.
 */
export function loadOperationsConfig(
  environment: NodeJS.ProcessEnv = process.env,
): OperationsConfig {
  const managedRoot = normalizedAbsolutePath(
    'CLASSROOM_HUB_MANAGED_ROOT',
    required(environment, 'CLASSROOM_HUB_MANAGED_ROOT'),
  );
  const databasePath = normalizedAbsolutePath(
    'CLASSROOM_HUB_DATABASE_PATH',
    required(environment, 'CLASSROOM_HUB_DATABASE_PATH'),
  );
  const backupDirectory = normalizedAbsolutePath(
    'CLASSROOM_HUB_BACKUP_DIRECTORY',
    required(environment, 'CLASSROOM_HUB_BACKUP_DIRECTORY'),
  );
  if (
    !isWithin(managedRoot, databasePath) ||
    !isWithin(managedRoot, backupDirectory) ||
    databasePath === backupDirectory ||
    isWithin(backupDirectory, databasePath)
  )
    throw new Error(
      'Operational database and backup paths must be separate children of CLASSROOM_HUB_MANAGED_ROOT',
    );

  const timeZone = required(environment, 'CLASSROOM_HUB_TIME_ZONE');
  if (!isIanaTimeZone(timeZone))
    throw new Error('CLASSROOM_HUB_TIME_ZONE must be an IANA timezone name');
  const academicYearEnd = required(
    environment,
    'CLASSROOM_HUB_ACADEMIC_YEAR_END',
  );
  if (!isIsoDate(academicYearEnd))
    throw new Error(
      'CLASSROOM_HUB_ACADEMIC_YEAR_END must be a real ISO calendar date',
    );

  const alertDeliveryMode =
    environment.CLASSROOM_HUB_ALERT_DELIVERY_MODE ?? 'report-only';
  if (!alertDeliveryModes.includes(alertDeliveryMode as AlertDeliveryMode))
    throw new Error(
      'CLASSROOM_HUB_ALERT_DELIVERY_MODE must be report-only or fake',
    );
  const repeatText = environment.CLASSROOM_HUB_ALERT_REPEAT_SECONDS;
  if (alertDeliveryMode === 'fake' && repeatText === undefined)
    throw new Error(
      'CLASSROOM_HUB_ALERT_REPEAT_SECONDS is required for fake alert rehearsal',
    );
  if (alertDeliveryMode === 'report-only' && repeatText !== undefined)
    throw new Error(
      'CLASSROOM_HUB_ALERT_REPEAT_SECONDS is not accepted in report-only mode',
    );

  return {
    instanceId: boundedId(
      'CLASSROOM_HUB_INSTANCE_ID',
      required(environment, 'CLASSROOM_HUB_INSTANCE_ID'),
    ),
    scopeId: boundedScopeId(
      'CLASSROOM_HUB_OPERATIONS_SCOPE_ID',
      required(environment, 'CLASSROOM_HUB_OPERATIONS_SCOPE_ID'),
    ),
    timeZone,
    managedRoot,
    databasePath,
    backupDirectory,
    academicYearEnd,
    jobDeadlineSeconds: boundedInteger(
      'CLASSROOM_HUB_JOB_DEADLINE_SECONDS',
      environment.CLASSROOM_HUB_JOB_DEADLINE_SECONDS ?? '300',
      1,
      3600,
    ),
    alertDeliveryMode: alertDeliveryMode as AlertDeliveryMode,
    ...(repeatText === undefined
      ? {}
      : {
          alertRepeatSeconds: boundedInteger(
            'CLASSROOM_HUB_ALERT_REPEAT_SECONDS',
            repeatText,
            60,
            604_800,
          ),
        }),
  };
}
