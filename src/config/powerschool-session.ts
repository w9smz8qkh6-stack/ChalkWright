import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDomain } from 'tldts';

import { isIsoDate } from '../domain/runtime-validation.js';

const defaultChromeExecutable = '/usr/bin/google-chrome';
const approvedStatusPath = '/teachers/home.html';
const approvedBellPathTemplate =
  '/teachers/aet_schedulebell.html?target_date={date-us}';
const defaultGoogleBootstrapResourceOrigins = [
  'https://ssl.gstatic.com',
  'https://www.gstatic.com',
  'https://fonts.gstatic.com',
] as const;
const approvedPowerSchoolSiblingLabels = [
  'assets-sis',
  'assets',
  'services',
] as const;
export const powerSchoolCleanupReserveMs = 5_000;

interface PowerSchoolSessionBaseConfig {
  readonly powerSchoolOrigin: string;
  readonly bellPathTemplate: string;
  readonly bellReadySelector: string;
  readonly expectedSchoolText?: string;
  readonly sessionDirectory: string;
  readonly chromeExecutablePath: string;
  readonly navigationTimeoutMs: number;
  readonly maxResponseBytes: number;
}

export interface PowerSchoolRoutineConfig extends PowerSchoolSessionBaseConfig {
  readonly roomId: string;
  readonly statusPath: string;
  readonly statusReadySelector: string;
  readonly overallTimeoutMs: number;
  readonly utcOffset: 'Z' | `${'+' | '-'}${string}`;
}

export interface PowerSchoolBootstrapConfig extends PowerSchoolSessionBaseConfig {
  readonly identityOrigin: string;
  readonly allowedBootstrapResourceOrigins: readonly string[];
  readonly overallTimeoutMs: number;
  readonly maxTopLevelRequests: number;
}

export interface PowerSchoolCompatibilityConfig extends PowerSchoolRoutineConfig {
  readonly identityOrigin: string;
  readonly allowedBootstrapResourceOrigins: readonly string[];
  readonly maxTopLevelRequests: number;
  readonly persistentProfileDirectory: string;
}

const environmentNames = {
  roomId: 'CLASSROOM_HUB_POWERSCHOOL_ROOM_ID',
  origin: 'CLASSROOM_HUB_POWERSCHOOL_ORIGIN',
  statusPath: 'CLASSROOM_HUB_POWERSCHOOL_STATUS_PATH',
  statusReadySelector: 'CLASSROOM_HUB_POWERSCHOOL_STATUS_READY_SELECTOR',
  bellPathTemplate: 'CLASSROOM_HUB_POWERSCHOOL_BELL_PATH_TEMPLATE',
  bellReadySelector: 'CLASSROOM_HUB_POWERSCHOOL_BELL_READY_SELECTOR',
  expectedSchoolText: 'CLASSROOM_HUB_POWERSCHOOL_EXPECTED_SCHOOL_TEXT',
  sessionDirectory: 'CLASSROOM_HUB_POWERSCHOOL_SESSION_DIRECTORY',
  chromeExecutable: 'CLASSROOM_HUB_POWERSCHOOL_CHROME_EXECUTABLE',
  navigationTimeout: 'CLASSROOM_HUB_POWERSCHOOL_NAVIGATION_TIMEOUT_SECONDS',
  routineTimeout: 'CLASSROOM_HUB_POWERSCHOOL_ROUTINE_TIMEOUT_SECONDS',
  bootstrapTimeout: 'CLASSROOM_HUB_POWERSCHOOL_BOOTSTRAP_TIMEOUT_SECONDS',
  maxBootstrapRequests: 'CLASSROOM_HUB_POWERSCHOOL_BOOTSTRAP_MAX_REQUESTS',
  maxResponseBytes: 'CLASSROOM_HUB_POWERSCHOOL_MAX_RESPONSE_BYTES',
  utcOffset: 'CLASSROOM_HUB_POWERSCHOOL_UTC_OFFSET',
  identityOrigin: 'CLASSROOM_HUB_POWERSCHOOL_IDENTITY_ORIGIN',
  bootstrapResourceOrigins:
    'CLASSROOM_HUB_POWERSCHOOL_BOOTSTRAP_RESOURCE_ORIGINS',
  compatibilityProfileDirectory:
    'CLASSROOM_HUB_POWERSCHOOL_COMPATIBILITY_PROFILE_DIRECTORY',
} as const;

export const powerSchoolCompatibilityProfileEnvironmentName =
  environmentNames.compatibilityProfileDirectory;

export const powerSchoolRoutineEnvironmentNames = [
  environmentNames.roomId,
  environmentNames.origin,
  environmentNames.statusPath,
  environmentNames.statusReadySelector,
  environmentNames.bellPathTemplate,
  environmentNames.bellReadySelector,
  environmentNames.expectedSchoolText,
  environmentNames.sessionDirectory,
  environmentNames.chromeExecutable,
  environmentNames.navigationTimeout,
  environmentNames.routineTimeout,
  environmentNames.maxResponseBytes,
  environmentNames.utcOffset,
] as const;

export const powerSchoolBootstrapEnvironmentNames = [
  environmentNames.origin,
  environmentNames.bellPathTemplate,
  environmentNames.bellReadySelector,
  environmentNames.expectedSchoolText,
  environmentNames.sessionDirectory,
  environmentNames.chromeExecutable,
  environmentNames.navigationTimeout,
  environmentNames.bootstrapTimeout,
  environmentNames.maxBootstrapRequests,
  environmentNames.maxResponseBytes,
  environmentNames.identityOrigin,
  environmentNames.bootstrapResourceOrigins,
] as const;

export const powerSchoolCompatibilityEnvironmentNames = [
  ...powerSchoolRoutineEnvironmentNames,
  environmentNames.identityOrigin,
  environmentNames.bootstrapResourceOrigins,
  environmentNames.maxBootstrapRequests,
  environmentNames.compatibilityProfileDirectory,
] as const;

export function loadPowerSchoolRoutineConfig(
  environment: NodeJS.ProcessEnv = process.env,
): PowerSchoolRoutineConfig {
  const base = loadBaseConfig(environment);
  const utcOffset = environment[environmentNames.utcOffset] ?? 'Z';
  if (
    utcOffset !== 'Z' &&
    !/^[+-](?:0\d|1\d|2[0-3]):[0-5]\d$/u.test(utcOffset)
  ) {
    throw new Error(
      `${environmentNames.utcOffset} must be Z or an exact ±HH:MM offset`,
    );
  }
  return {
    ...base,
    roomId: boundedText(
      environmentNames.roomId,
      required(environment, environmentNames.roomId),
      128,
    ),
    statusPath: approvedProviderPath(
      environmentNames.statusPath,
      required(environment, environmentNames.statusPath),
      approvedStatusPath,
    ),
    statusReadySelector: boundedText(
      environmentNames.statusReadySelector,
      required(environment, environmentNames.statusReadySelector),
    ),
    overallTimeoutMs:
      boundedInteger(
        environmentNames.routineTimeout,
        environment[environmentNames.routineTimeout] ?? '120',
        10,
        120,
      ) * 1_000,
    utcOffset: utcOffset as PowerSchoolRoutineConfig['utcOffset'],
  };
}

export function powerSchoolOperationTimeoutMs(
  supervisorTimeoutMs: number,
): number {
  if (
    !Number.isSafeInteger(supervisorTimeoutMs) ||
    supervisorTimeoutMs <= powerSchoolCleanupReserveMs
  ) {
    throw new Error('powerschool-cleanup-reserve-invalid');
  }
  return supervisorTimeoutMs - powerSchoolCleanupReserveMs;
}

export function loadPowerSchoolBootstrapConfig(
  environment: NodeJS.ProcessEnv = process.env,
): PowerSchoolBootstrapConfig {
  const base = loadBaseConfig(environment);
  const identityOrigin = exactHttpOrigin(
    environmentNames.identityOrigin,
    required(environment, environmentNames.identityOrigin),
  );
  const resourceOrigins = originList(
    environment,
    environmentNames.bootstrapResourceOrigins,
    [base.powerSchoolOrigin, identityOrigin],
    [
      base.powerSchoolOrigin,
      identityOrigin,
      ...defaultGoogleBootstrapResourceOrigins,
      ...approvedPowerSchoolSiblingOrigins(base.powerSchoolOrigin),
    ],
  );
  return {
    ...base,
    identityOrigin,
    allowedBootstrapResourceOrigins: resourceOrigins,
    overallTimeoutMs:
      boundedInteger(
        environmentNames.bootstrapTimeout,
        environment[environmentNames.bootstrapTimeout] ?? '300',
        30,
        300,
      ) * 1_000,
    maxTopLevelRequests: boundedInteger(
      environmentNames.maxBootstrapRequests,
      environment[environmentNames.maxBootstrapRequests] ?? '16',
      2,
      32,
    ),
  };
}

export function loadPowerSchoolCompatibilityConfig(
  environment: NodeJS.ProcessEnv = process.env,
): PowerSchoolCompatibilityConfig {
  const routine = loadPowerSchoolRoutineConfig(environment);
  const identityOrigin = exactHttpOrigin(
    environmentNames.identityOrigin,
    required(environment, environmentNames.identityOrigin),
  );
  const persistentProfileDirectory =
    loadPowerSchoolPersistentProfileDirectory(environment);
  if (pathsOverlap(routine.sessionDirectory, persistentProfileDirectory)) {
    throw new Error(
      `${environmentNames.compatibilityProfileDirectory} must be separate from the filtered session directory`,
    );
  }
  return {
    ...routine,
    identityOrigin,
    allowedBootstrapResourceOrigins: originList(
      environment,
      environmentNames.bootstrapResourceOrigins,
      [routine.powerSchoolOrigin, identityOrigin],
      [
        routine.powerSchoolOrigin,
        identityOrigin,
        ...defaultGoogleBootstrapResourceOrigins,
        ...approvedPowerSchoolSiblingOrigins(routine.powerSchoolOrigin),
      ],
    ),
    maxTopLevelRequests: boundedInteger(
      environmentNames.maxBootstrapRequests,
      environment[environmentNames.maxBootstrapRequests] ?? '16',
      2,
      32,
    ),
    persistentProfileDirectory,
  };
}

export function loadPowerSchoolPersistentProfileDirectory(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const persistentProfileDirectory = protectedSessionDirectoryPath(
    environmentNames.compatibilityProfileDirectory,
    required(environment, environmentNames.compatibilityProfileDirectory),
  );
  const sessionDirectory = protectedSessionDirectoryPath(
    environmentNames.sessionDirectory,
    required(environment, environmentNames.sessionDirectory),
  );
  if (pathsOverlap(sessionDirectory, persistentProfileDirectory)) {
    throw new Error(
      `${environmentNames.compatibilityProfileDirectory} must be separate from the filtered session directory`,
    );
  }
  return persistentProfileDirectory;
}

function loadBaseConfig(
  environment: NodeJS.ProcessEnv,
): PowerSchoolSessionBaseConfig {
  const expectedSchoolText = environment[environmentNames.expectedSchoolText];
  return {
    powerSchoolOrigin: exactHttpOrigin(
      environmentNames.origin,
      required(environment, environmentNames.origin),
    ),
    bellPathTemplate: approvedProviderPath(
      environmentNames.bellPathTemplate,
      bellPathTemplate(
        environmentNames.bellPathTemplate,
        required(environment, environmentNames.bellPathTemplate),
      ),
      approvedBellPathTemplate,
    ),
    bellReadySelector: boundedText(
      environmentNames.bellReadySelector,
      required(environment, environmentNames.bellReadySelector),
    ),
    ...(expectedSchoolText === undefined || expectedSchoolText.length === 0
      ? {}
      : {
          expectedSchoolText: boundedText(
            environmentNames.expectedSchoolText,
            expectedSchoolText,
          ),
        }),
    sessionDirectory: protectedSessionDirectoryPath(
      environmentNames.sessionDirectory,
      required(environment, environmentNames.sessionDirectory),
    ),
    chromeExecutablePath: normalizedAbsolutePath(
      environmentNames.chromeExecutable,
      environment[environmentNames.chromeExecutable] ?? defaultChromeExecutable,
    ),
    navigationTimeoutMs:
      boundedInteger(
        environmentNames.navigationTimeout,
        environment[environmentNames.navigationTimeout] ?? '10',
        1,
        30,
      ) * 1_000,
    maxResponseBytes: boundedInteger(
      environmentNames.maxResponseBytes,
      environment[environmentNames.maxResponseBytes] ?? '2097152',
      1_024,
      8 * 1024 * 1024,
    ),
  };
}

export function renderPowerSchoolBellPath(
  template: string,
  requestedDate: string,
): string {
  if (!isIsoDate(requestedDate)) throw new Error('powerschool-date-invalid');
  if (template.includes('{date-us}')) {
    const [year, month, day] = requestedDate.split('-');
    return template.replace('{date-us}', `${month}/${day}/${year}`);
  }
  return template.replace('{date}', encodeURIComponent(requestedDate));
}

export function parsePowerSchoolDate(value: string | undefined): string {
  if (value === undefined || !isIsoDate(value)) {
    throw new Error('PowerSchool session operation requires one real ISO date');
  }
  return value;
}

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name];
  if (value === undefined || value.length === 0)
    throw new Error(`${name} is required`);
  return value;
}

function boundedText(name: string, value: string, maximum = 512): string {
  if (
    value.length === 0 ||
    value.length > maximum ||
    value.includes('\0') ||
    /[\r\n]/u.test(value)
  ) {
    throw new Error(`${name} must be bounded single-line text`);
  }
  return value;
}

function exactHttpOrigin(name: string, value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an exact HTTP(S) origin`);
  }
  if (
    (url.protocol !== 'https:' && url.protocol !== 'http:') ||
    url.origin !== value ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.pathname !== '/' ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    throw new Error(`${name} must be an exact HTTP(S) origin`);
  }
  if (url.protocol === 'http:' && !isLoopbackHost(url.hostname)) {
    throw new Error(`${name} must use HTTPS except for loopback-only tests`);
  }
  return url.origin;
}

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '[::1]' ||
    /^127(?:\.\d{1,3}){3}$/u.test(hostname)
  );
}

function exactRelativePath(name: string, value: string): string {
  if (
    value.length === 0 ||
    value.length > 512 ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('#') ||
    /[\\\u0000-\u001f]/u.test(value)
  ) {
    throw new Error(`${name} must be an exact bounded same-origin path`);
  }
  const parsed = new URL(value, 'https://powerschool.invalid');
  return `${parsed.pathname}${parsed.search}`;
}

function bellPathTemplate(name: string, value: string): string {
  const placeholders = value.match(/\{date(?:-us)?\}/gu) ?? [];
  if (placeholders.length !== 1) {
    throw new Error(`${name} must contain exactly one date placeholder`);
  }
  const placeholder = placeholders[0]!;
  const sentinel = placeholder === '{date-us}' ? '04/13/2035' : '2035-04-13';
  const path = exactRelativePath(name, value.replace(placeholder, sentinel));
  return path.replace(sentinel, placeholder);
}

function approvedProviderPath(
  name: string,
  value: string,
  approved: string,
): string {
  const path = exactRelativePath(name, value);
  if (path !== approved) {
    throw new Error(
      `${name} must equal the approved PowerSchool path contract`,
    );
  }
  return path;
}

function normalizedAbsolutePath(name: string, value: string): string {
  if (
    !isAbsolute(value) ||
    resolve(value) !== value ||
    value === '/' ||
    value.includes('\0')
  ) {
    throw new Error(`${name} must be a normalized absolute non-root path`);
  }
  return value;
}

function protectedSessionDirectoryPath(name: string, value: string): string {
  const path = normalizedAbsolutePath(name, value);
  const repositoryRoot = findRepositoryRoot();
  const fromRepository = relative(repositoryRoot, path);
  if (
    fromRepository.length === 0 ||
    (fromRepository !== '..' && !fromRepository.startsWith(`..${sep}`))
  ) {
    throw new Error(`${name} must be outside the repository`);
  }
  return path;
}

function pathsOverlap(left: string, right: string): boolean {
  const fromLeft = relative(left, right);
  const fromRight = relative(right, left);
  const within = (relation: string): boolean =>
    relation.length === 0 ||
    (relation !== '..' && !relation.startsWith(`..${sep}`));
  return within(fromLeft) || within(fromRight);
}

function findRepositoryRoot(): string {
  let candidate = dirname(fileURLToPath(import.meta.url));
  while (true) {
    if (existsSync(join(candidate, 'package.json'))) return candidate;
    const parent = dirname(candidate);
    if (parent === candidate) {
      throw new Error(
        'PowerSchool configuration cannot locate the repository root',
      );
    }
    candidate = parent;
  }
}

function boundedInteger(
  name: string,
  value: string,
  minimum: number,
  maximum: number,
): number {
  if (!/^\d{1,10}$/u.test(value)) {
    throw new Error(
      `${name} must be an integer from ${minimum} through ${maximum}`,
    );
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(
      `${name} must be an integer from ${minimum} through ${maximum}`,
    );
  }
  return parsed;
}

function originList(
  environment: NodeJS.ProcessEnv,
  name: string,
  requiredOrigins: readonly string[],
  defaultOrigins: readonly string[] = requiredOrigins,
): readonly string[] {
  const configured = environment[name];
  const configuredOrigins = (configured ?? defaultOrigins.join(','))
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => exactHttpOrigin(name, value));
  if (
    configuredOrigins.length === 0 ||
    requiredOrigins.some((origin) => !configuredOrigins.includes(origin))
  ) {
    throw new Error(
      `${name} must include the PowerSchool and identity origins`,
    );
  }
  return [...new Set([...defaultOrigins, ...configuredOrigins])];
}

function approvedPowerSchoolSiblingOrigins(
  powerSchoolOrigin: string,
): readonly string[] {
  const url = new URL(powerSchoolOrigin);
  if (url.protocol !== 'https:') return [];
  const registrableSite = getDomain(url.hostname, {
    allowPrivateDomains: true,
    extractHostname: false,
  });
  return registrableSite === null
    ? []
    : approvedPowerSchoolSiblingLabels.map(
        (label) => `https://${label}.${registrableSite}`,
      );
}
