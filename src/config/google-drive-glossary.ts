import { isAbsolute, relative, resolve } from 'node:path';

import type { ClassId } from '../domain/identities.js';
import { isIsoDate } from '../domain/runtime-validation.js';
import { readProtectedJson } from '../infrastructure/filesystem/protected-json.js';

export const googleDriveGlossaryReadScope =
  'https://www.googleapis.com/auth/drive.readonly' as const;

export interface GoogleDriveGlossaryCourseConfig {
  readonly classId: ClassId;
  readonly subject: string;
  readonly defaultLanguage: string;
  readonly courseName: string;
  readonly className?: string;
}

export interface GoogleDriveGlossaryConfig {
  readonly version: 1;
  readonly academicYear: string;
  readonly academicYearFolderId: string;
  readonly credentialReferencePath: string;
  readonly requestTimeoutMs: number;
  readonly maximumPagesPerSource: number;
  readonly maximumFilesPerCourse: number;
  readonly courses: readonly GoogleDriveGlossaryCourseConfig[];
}

interface Payload {
  readonly version: 1;
  readonly academicYear: string;
  readonly academicYearFolderId: string;
  readonly credentialReferencePath: string;
  readonly requestTimeoutSeconds: number;
  readonly maximumPagesPerSource: number;
  readonly maximumFilesPerCourse: number;
  readonly courses: readonly unknown[];
}

/** Loads provider references and exact direct-child bindings from owner-only JSON. */
export function loadGoogleDriveGlossaryConfig(
  referencePath: string,
  repositoryRoot = process.cwd(),
): GoogleDriveGlossaryConfig {
  if (!externalPath(referencePath, repositoryRoot))
    throw new Error('glossary-config-invalid');
  const payload = readProtectedJson(referencePath, isPayload);
  if (!externalPath(payload.credentialReferencePath, repositoryRoot))
    throw new Error('glossary-config-invalid');
  const courses = payload.courses.map(courseConfig);
  if (new Set(courses.map((course) => course.classId)).size !== courses.length)
    throw new Error('glossary-config-invalid');
  return {
    version: 1,
    academicYear: payload.academicYear,
    academicYearFolderId: payload.academicYearFolderId,
    credentialReferencePath: payload.credentialReferencePath,
    requestTimeoutMs: payload.requestTimeoutSeconds * 1_000,
    maximumPagesPerSource: payload.maximumPagesPerSource,
    maximumFilesPerCourse: payload.maximumFilesPerCourse,
    courses,
  };
}

function courseConfig(value: unknown): GoogleDriveGlossaryCourseConfig {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('glossary-config-invalid');
  const record = value as Record<string, unknown>;
  const required = ['classId', 'defaultLanguage', 'courseName', 'subject'];
  const optional = ['className'];
  const keys = Object.keys(record);
  if (
    required.some((key) => !keys.includes(key)) ||
    keys.some((key) => !required.includes(key) && !optional.includes(key)) ||
    !boundedId(record.classId) ||
    !languageCode(record.defaultLanguage) ||
    !boundedText(record.subject, 256) ||
    !boundedText(record.courseName, 256) ||
    optional.some(
      (key) => record[key] !== undefined && !boundedText(record[key], 512),
    )
  )
    throw new Error('glossary-config-invalid');
  return {
    classId: record.classId as ClassId,
    subject: record.subject as string,
    defaultLanguage: record.defaultLanguage as string,
    courseName: record.courseName as string,
    ...(record.className === undefined
      ? {}
      : { className: record.className as string }),
  };
}

function isPayload(value: unknown): value is Payload {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).sort().join(',') ===
      'academicYear,academicYearFolderId,courses,credentialReferencePath,maximumFilesPerCourse,maximumPagesPerSource,requestTimeoutSeconds,version' &&
    record.version === 1 &&
    typeof record.academicYear === 'string' &&
    /^\d{4}-\d{2}$/u.test(record.academicYear) &&
    isIsoDate(`${record.academicYear.slice(0, 4)}-01-01`) &&
    driveId(record.academicYearFolderId) &&
    typeof record.credentialReferencePath === 'string' &&
    integer(record.requestTimeoutSeconds, 1, 60) &&
    integer(record.maximumPagesPerSource, 1, 10) &&
    integer(record.maximumFilesPerCourse, 1, 50) &&
    Array.isArray(record.courses) &&
    record.courses.length >= 1 &&
    record.courses.length <= 24
  );
}

function externalPath(value: string, repositoryRoot: string): boolean {
  if (!isAbsolute(value) || resolve(value) !== value || value === '/')
    return false;
  const relation = relative(resolve(repositoryRoot), value);
  return (
    relation.length > 0 && (relation.startsWith('..') || isAbsolute(relation))
  );
}

function integer(value: unknown, minimum: number, maximum: number): boolean {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function boundedId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)
  );
}

function driveId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{8,256}$/u.test(value);
}

function boundedText(value: unknown, maximum: number): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= maximum &&
    !/[\r\n\0]/u.test(value)
  );
}

function languageCode(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u.test(value)
  );
}
