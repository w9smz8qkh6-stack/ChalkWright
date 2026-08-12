import { isAbsolute, relative, resolve, sep } from 'node:path';

import { readProtectedJson } from '../infrastructure/filesystem/protected-json.js';

export const powerSchoolRepairReferenceEnvironmentName =
  'CLASSROOM_HUB_POWERSCHOOL_REPAIR_REFERENCE';
export const powerSchoolJitHeadlessEnvironmentName =
  'CLASSROOM_HUB_POWERSCHOOL_JIT_HEADLESS';
export const lockedOnePasswordExecutable = '/usr/bin/op';

export interface PowerSchoolRepairReferences {
  readonly version: 1;
  readonly usernameReference: string;
  readonly passwordReference: string;
  readonly totpReference: string;
}

/** Loads only protected 1Password references; it never resolves their values. */
export function loadPowerSchoolRepairReferences(
  environment: NodeJS.ProcessEnv = process.env,
  repositoryRoot = process.cwd(),
): PowerSchoolRepairReferences {
  const referencePath = environment[powerSchoolRepairReferenceEnvironmentName];
  if (
    referencePath === undefined ||
    !isAbsolute(referencePath) ||
    resolve(referencePath) !== referencePath ||
    !outsideRepository(referencePath, repositoryRoot)
  ) {
    throw new Error('powerschool-repair-config-invalid');
  }
  let payload: PowerSchoolRepairReferences;
  try {
    payload = readProtectedJson(referencePath, isRepairReferences);
  } catch {
    throw new Error('powerschool-repair-config-invalid');
  }
  if (
    payload.usernameReference === payload.passwordReference ||
    payload.usernameReference === payload.totpReference ||
    payload.passwordReference === payload.totpReference
  ) {
    throw new Error('powerschool-repair-config-invalid');
  }
  return payload;
}

function isRepairReferences(
  value: unknown,
): value is PowerSchoolRepairReferences {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return false;
  const record = value as Record<string, unknown>;
  if (
    !hasExactKeys(record, [
      'passwordReference',
      'totpReference',
      'usernameReference',
      'version',
    ]) ||
    record.version !== 1 ||
    typeof record.usernameReference !== 'string' ||
    typeof record.passwordReference !== 'string' ||
    typeof record.totpReference !== 'string'
  ) {
    return false;
  }
  return (
    validSecretReference(record.usernameReference, false) &&
    validSecretReference(record.passwordReference, false) &&
    validSecretReference(record.totpReference, true)
  );
}

function validSecretReference(value: string, otp: boolean): boolean {
  if (
    value.length < 10 ||
    value.length > 1_024 ||
    /[\u0000-\u001f\u007f]/u.test(value) ||
    !value.startsWith('op://')
  ) {
    return false;
  }
  const suffix = '?attribute=otp';
  const withoutQuery = otp ? value.slice(0, -suffix.length) : value;
  if (otp !== value.endsWith(suffix) || withoutQuery.includes('?'))
    return false;
  const segments = withoutQuery.slice('op://'.length).split('/');
  return (
    segments.length === 3 &&
    segments.every(
      (segment) =>
        segment.length > 0 &&
        segment.length <= 256 &&
        segment !== '.' &&
        segment !== '..' &&
        !segment.includes('#'),
    )
  );
}

function outsideRepository(candidate: string, repositoryRoot: string): boolean {
  const relation = relative(resolve(repositoryRoot), candidate);
  return (
    relation.length > 0 &&
    (relation === '..' ||
      relation.startsWith(`..${sep}`) ||
      isAbsolute(relation))
  );
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}
