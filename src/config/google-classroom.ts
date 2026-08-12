import { isAbsolute, relative, resolve } from 'node:path';

import type { CourseMapping } from '../domain/coursework.js';
import type { ClassId } from '../domain/identities.js';

export const googleClassroomCourseworkReadScope =
  'https://www.googleapis.com/auth/classroom.student-submissions.students.readonly' as const;

export interface GoogleClassroomReadConfig {
  readonly credentialReferencePath: string;
  readonly mappings: readonly CourseMapping[];
  readonly requestTimeoutMs: number;
  readonly maximumPagesPerCourse: number;
  readonly maximumItemsPerCourse: number;
  readonly maximumParallelCourses: number;
  readonly cacheFreshSeconds: number;
  readonly backoffBaseSeconds: number;
  readonly backoffMaximumSeconds: number;
}

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name];
  if (value === undefined || value.length === 0)
    throw new Error(`${name} is required for Classroom refresh`);
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

function credentialReferencePath(
  value: string,
  repositoryRoot: string,
): string {
  if (
    !isAbsolute(value) ||
    resolve(value) !== value ||
    value === '/' ||
    value.includes('\0')
  )
    throw new Error(
      'CLASSROOM_HUB_CLASSROOM_CREDENTIAL_REFERENCE must be a normalized absolute file path',
    );
  const relation = relative(resolve(repositoryRoot), value);
  if (relation === '' || (!relation.startsWith('..') && !isAbsolute(relation)))
    throw new Error(
      'CLASSROOM_HUB_CLASSROOM_CREDENTIAL_REFERENCE must be outside the repository',
    );
  return value;
}

function mappings(value: string): readonly CourseMapping[] {
  if (Buffer.byteLength(value, 'utf8') > 8_192)
    throw new Error('CLASSROOM_HUB_CLASSROOM_COURSE_MAPPINGS is too large');
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(
      'CLASSROOM_HUB_CLASSROOM_COURSE_MAPPINGS must be valid JSON',
    );
  }
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 12)
    throw new Error(
      'CLASSROOM_HUB_CLASSROOM_COURSE_MAPPINGS must contain 1 through 12 mappings',
    );
  const result = parsed.map((entry, index): CourseMapping => {
    if (
      typeof entry !== 'object' ||
      entry === null ||
      Array.isArray(entry) ||
      Object.keys(entry).sort().join(',') !== 'classId,providerCourseKey'
    )
      throw new Error(`Classroom mapping ${index + 1} has an invalid shape`);
    const classId = (entry as Record<string, unknown>).classId;
    const providerCourseKey = (entry as Record<string, unknown>)
      .providerCourseKey;
    if (
      typeof classId !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(classId)
    )
      throw new Error(`Classroom mapping ${index + 1} has an invalid class ID`);
    if (
      typeof providerCourseKey !== 'string' ||
      !/^\d{1,32}$/u.test(providerCourseKey)
    )
      throw new Error(
        `Classroom mapping ${index + 1} requires a numeric course ID`,
      );
    return {
      classId: classId as ClassId,
      providerCourseKey,
    };
  });
  const classIds = new Set(result.map((mapping) => mapping.classId));
  const courseIds = new Set(result.map((mapping) => mapping.providerCourseKey));
  if (classIds.size !== result.length || courseIds.size !== result.length)
    throw new Error('Classroom mappings must be one-to-one');
  return result;
}

/** Loads only safe policy and a path reference; it never reads OAuth material. */
export function loadGoogleClassroomReadConfig(
  environment: NodeJS.ProcessEnv = process.env,
  repositoryRoot = process.cwd(),
): GoogleClassroomReadConfig {
  const backoffBaseSeconds = boundedInteger(
    'CLASSROOM_HUB_CLASSROOM_BACKOFF_BASE_SECONDS',
    environment.CLASSROOM_HUB_CLASSROOM_BACKOFF_BASE_SECONDS ?? '60',
    10,
    3_600,
  );
  const backoffMaximumSeconds = boundedInteger(
    'CLASSROOM_HUB_CLASSROOM_BACKOFF_MAX_SECONDS',
    environment.CLASSROOM_HUB_CLASSROOM_BACKOFF_MAX_SECONDS ?? '3600',
    60,
    86_400,
  );
  if (backoffMaximumSeconds < backoffBaseSeconds)
    throw new Error(
      'Classroom maximum backoff must not be shorter than its base',
    );
  return {
    credentialReferencePath: credentialReferencePath(
      required(environment, 'CLASSROOM_HUB_CLASSROOM_CREDENTIAL_REFERENCE'),
      repositoryRoot,
    ),
    mappings: mappings(
      required(environment, 'CLASSROOM_HUB_CLASSROOM_COURSE_MAPPINGS'),
    ),
    requestTimeoutMs:
      boundedInteger(
        'CLASSROOM_HUB_CLASSROOM_REQUEST_TIMEOUT_SECONDS',
        environment.CLASSROOM_HUB_CLASSROOM_REQUEST_TIMEOUT_SECONDS ?? '15',
        1,
        60,
      ) * 1_000,
    maximumPagesPerCourse: boundedInteger(
      'CLASSROOM_HUB_CLASSROOM_MAX_PAGES_PER_COURSE',
      environment.CLASSROOM_HUB_CLASSROOM_MAX_PAGES_PER_COURSE ?? '5',
      1,
      10,
    ),
    maximumItemsPerCourse: boundedInteger(
      'CLASSROOM_HUB_CLASSROOM_MAX_ITEMS_PER_COURSE',
      environment.CLASSROOM_HUB_CLASSROOM_MAX_ITEMS_PER_COURSE ?? '500',
      1,
      500,
    ),
    maximumParallelCourses: boundedInteger(
      'CLASSROOM_HUB_CLASSROOM_MAX_PARALLEL_COURSES',
      environment.CLASSROOM_HUB_CLASSROOM_MAX_PARALLEL_COURSES ?? '3',
      1,
      4,
    ),
    cacheFreshSeconds: boundedInteger(
      'CLASSROOM_HUB_CLASSROOM_CACHE_FRESH_SECONDS',
      environment.CLASSROOM_HUB_CLASSROOM_CACHE_FRESH_SECONDS ?? '900',
      60,
      86_400,
    ),
    backoffBaseSeconds,
    backoffMaximumSeconds,
  };
}
