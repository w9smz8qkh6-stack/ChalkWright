import { isAbsolute, relative, resolve } from 'node:path';

import type { CourseMapping } from '../domain/coursework.js';
import type { ClassId, RoomId, ScreenId } from '../domain/identities.js';
import type { CoursePlanMapping } from '../domain/plan-derivation.js';
import { isIanaTimeZone, isIsoDate } from '../domain/runtime-validation.js';

export interface ShadowCourseMapping extends CoursePlanMapping, CourseMapping {
  /** Optional legacy attendance check-in code; unrelated to provider credentials. */
  readonly attendanceClassCode?: string;
  /** Optional external check-in form/link; Chalkwright redirects but never proxies submissions. */
  readonly attendanceCheckInUrl?: string;
}

export interface ShadowConfig {
  readonly instanceId: string;
  readonly roomId: RoomId;
  readonly screenId: ScreenId;
  readonly screenLabel: string;
  readonly host: '127.0.0.1' | '::1';
  readonly port: number;
  readonly productionPort: number;
  readonly timeZone: string;
  readonly academicYearEnd: string;
  readonly managedRoot: string;
  readonly databasePath: string;
  readonly backupDirectory: string;
  readonly courseMappings: readonly ShadowCourseMapping[];
  readonly checkInOpenMinutesBefore: number;
  readonly dismissalWarningMinutesBefore: number;
}

export function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name];
  if (value === undefined || value.length === 0)
    throw new Error(`${name} is required for the shadow instance`);
  return value;
}

export function boundedId(name: string, value: string, maximum = 128): string {
  if (value.length > maximum || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(value))
    throw new Error(`${name} must be a bounded opaque identifier`);
  return value;
}

export function boundedText(
  name: string,
  value: string,
  maximum = 128,
): string {
  if (value.length < 1 || value.length > maximum || /[\r\n\0]/u.test(value))
    throw new Error(`${name} must be bounded single-line text`);
  return value;
}

export function boundedInteger(
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

export function protectedPath(
  name: string,
  value: string,
  root?: string,
): string {
  if (
    !isAbsolute(value) ||
    resolve(value) !== value ||
    value === '/' ||
    value.includes('\0')
  )
    throw new Error(`${name} must be a normalized absolute non-root path`);
  if (root !== undefined) {
    const relation = relative(root, value);
    if (
      relation.length === 0 ||
      relation === '..' ||
      relation.startsWith('../')
    )
      throw new Error(`${name} must be a child of the shadow managed root`);
  }
  return value;
}

export function parseMappings(
  value: string,
  roomId: RoomId,
): readonly ShadowCourseMapping[] {
  if (Buffer.byteLength(value, 'utf8') > 16_384)
    throw new Error('CLASSROOM_HUB_SHADOW_COURSE_MAPPINGS is too large');
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('CLASSROOM_HUB_SHADOW_COURSE_MAPPINGS must be valid JSON');
  }
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 12)
    throw new Error(
      'CLASSROOM_HUB_SHADOW_COURSE_MAPPINGS must contain 1 through 12 mappings',
    );
  const mappings = parsed.map((entry, index): ShadowCourseMapping => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry))
      throw new Error(`Shadow mapping ${index + 1} has an invalid shape`);
    const record = entry as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    const requiredKeys = ['classId', 'providerCourseKey', 'sectionCode'];
    const allowedKeys = new Set([
      ...requiredKeys,
      'attendanceClassCode',
      'attendanceCheckInUrl',
    ]);
    if (
      requiredKeys.some((key) => !keys.includes(key)) ||
      keys.some((key) => !allowedKeys.has(key))
    )
      throw new Error(`Shadow mapping ${index + 1} has an invalid shape`);
    const {
      classId,
      sectionCode,
      providerCourseKey,
      attendanceClassCode,
      attendanceCheckInUrl,
    } = record;
    if (
      typeof classId !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(classId)
    )
      throw new Error(`Shadow mapping ${index + 1} has an invalid class ID`);
    if (
      typeof sectionCode !== 'string' ||
      sectionCode.length < 1 ||
      sectionCode.length > 256 ||
      /[\r\n\0]/u.test(sectionCode)
    )
      throw new Error(`Shadow mapping ${index + 1} has an invalid section`);
    if (
      typeof providerCourseKey !== 'string' ||
      !/^\d{1,32}$/u.test(providerCourseKey)
    )
      throw new Error(
        `Shadow mapping ${index + 1} has an invalid provider course ID`,
      );
    if (
      attendanceClassCode !== undefined &&
      (typeof attendanceClassCode !== 'string' ||
        attendanceClassCode.length < 1 ||
        attendanceClassCode.length > 64 ||
        /[\r\n\0]/u.test(attendanceClassCode))
    )
      throw new Error(
        `Shadow mapping ${index + 1} has an invalid attendance class code`,
      );
    if (attendanceCheckInUrl !== undefined) {
      if (
        typeof attendanceCheckInUrl !== 'string' ||
        attendanceCheckInUrl.length > 2_048
      )
        throw new Error(
          `Shadow mapping ${index + 1} has an invalid attendance URL`,
        );
      try {
        const url = new URL(attendanceCheckInUrl);
        if (
          url.protocol !== 'https:' ||
          url.username.length > 0 ||
          url.password.length > 0
        )
          throw new Error('invalid');
      } catch {
        throw new Error(
          `Shadow mapping ${index + 1} has an invalid attendance URL`,
        );
      }
    }
    return {
      classId: classId as ClassId,
      sectionCode,
      providerCourseKey,
      roomId,
      ...(attendanceClassCode === undefined ? {} : { attendanceClassCode }),
      ...(attendanceCheckInUrl === undefined ? {} : { attendanceCheckInUrl }),
    };
  });
  if (
    new Set(mappings.map((entry) => entry.classId)).size !== mappings.length ||
    new Set(mappings.map((entry) => entry.providerCourseKey)).size !==
      mappings.length
  )
    throw new Error('Shadow course mappings must be one-to-one');
  return mappings;
}

/** Load the mutation-disabled M-11 instance contract without reading credentials. */
export function loadShadowConfig(
  environment: NodeJS.ProcessEnv = process.env,
): ShadowConfig {
  for (const [name, value] of Object.entries(environment)) {
    if (
      (name.startsWith('CLASSROOM_HUB_CALENDAR_') ||
        name === 'CLASSROOM_HUB_OPERATOR_TOKEN') &&
      value !== undefined &&
      value.length > 0
    )
      throw new Error(
        'The shadow instance rejects Calendar and operator-mutation capability',
      );
  }
  const instanceId = boundedId(
    'CLASSROOM_HUB_SHADOW_INSTANCE_ID',
    required(environment, 'CLASSROOM_HUB_SHADOW_INSTANCE_ID'),
  );
  if (!instanceId.endsWith('-shadow'))
    throw new Error('CLASSROOM_HUB_SHADOW_INSTANCE_ID must end in -shadow');
  const roomId = boundedId(
    'CLASSROOM_HUB_SHADOW_ROOM_ID',
    required(environment, 'CLASSROOM_HUB_SHADOW_ROOM_ID'),
    96,
  ) as RoomId;
  const screenId = boundedId(
    'CLASSROOM_HUB_SHADOW_SCREEN_ID',
    required(environment, 'CLASSROOM_HUB_SHADOW_SCREEN_ID'),
    96,
  ) as ScreenId;
  const host = required(environment, 'CLASSROOM_HUB_SHADOW_HOST');
  if (host !== '127.0.0.1' && host !== '::1')
    throw new Error('CLASSROOM_HUB_SHADOW_HOST must be loopback');
  const port = boundedInteger(
    'CLASSROOM_HUB_SHADOW_PORT',
    required(environment, 'CLASSROOM_HUB_SHADOW_PORT'),
    1_024,
    65_535,
  );
  const productionPort = boundedInteger(
    'CLASSROOM_HUB_SHADOW_PRODUCTION_PORT',
    required(environment, 'CLASSROOM_HUB_SHADOW_PRODUCTION_PORT'),
    1_024,
    65_535,
  );
  if (port === productionPort)
    throw new Error('The shadow port must differ from production');
  const timeZone = required(environment, 'CLASSROOM_HUB_TIME_ZONE');
  if (!isIanaTimeZone(timeZone))
    throw new Error('CLASSROOM_HUB_TIME_ZONE must be an IANA timezone');
  const academicYearEnd = required(
    environment,
    'CLASSROOM_HUB_ACADEMIC_YEAR_END',
  );
  if (!isIsoDate(academicYearEnd))
    throw new Error('CLASSROOM_HUB_ACADEMIC_YEAR_END must be a real ISO date');
  const managedRoot = protectedPath(
    'CLASSROOM_HUB_MANAGED_ROOT',
    required(environment, 'CLASSROOM_HUB_MANAGED_ROOT'),
  );
  if (!/(?:^|[-_/])shadow(?:[-_/]|$)/iu.test(managedRoot))
    throw new Error('CLASSROOM_HUB_MANAGED_ROOT must identify a shadow path');
  const databasePath = protectedPath(
    'CLASSROOM_HUB_DATABASE_PATH',
    required(environment, 'CLASSROOM_HUB_DATABASE_PATH'),
    managedRoot,
  );
  const backupDirectory = protectedPath(
    'CLASSROOM_HUB_BACKUP_DIRECTORY',
    required(environment, 'CLASSROOM_HUB_BACKUP_DIRECTORY'),
    managedRoot,
  );
  const databaseFromBackup = relative(backupDirectory, databasePath);
  if (
    databasePath === backupDirectory ||
    (databaseFromBackup.length > 0 &&
      databaseFromBackup !== '..' &&
      !databaseFromBackup.startsWith('../'))
  )
    throw new Error('Shadow database and backup paths must be separate');
  return {
    instanceId,
    roomId,
    screenId,
    screenLabel: boundedText(
      'CLASSROOM_HUB_SHADOW_SCREEN_LABEL',
      required(environment, 'CLASSROOM_HUB_SHADOW_SCREEN_LABEL'),
    ),
    host,
    port,
    productionPort,
    timeZone,
    academicYearEnd,
    managedRoot,
    databasePath,
    backupDirectory,
    courseMappings: parseMappings(
      required(environment, 'CLASSROOM_HUB_SHADOW_COURSE_MAPPINGS'),
      roomId,
    ),
    checkInOpenMinutesBefore: boundedInteger(
      'CLASSROOM_HUB_SHADOW_CHECKIN_MINUTES',
      environment.CLASSROOM_HUB_SHADOW_CHECKIN_MINUTES ?? '5',
      0,
      120,
    ),
    dismissalWarningMinutesBefore: boundedInteger(
      'CLASSROOM_HUB_SHADOW_DISMISSAL_WARNING_MINUTES',
      environment.CLASSROOM_HUB_SHADOW_DISMISSAL_WARNING_MINUTES ?? '5',
      0,
      120,
    ),
  };
}
