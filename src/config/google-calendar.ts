import { isAbsolute, relative, resolve } from 'node:path';

export const googleCalendarOwnedEventsReadScope =
  'https://www.googleapis.com/auth/calendar.events.owned.readonly' as const;

export const googleCalendarOwnedEventsWriteScope =
  'https://www.googleapis.com/auth/calendar.events.owned' as const;

export const calendarOwnershipMarker = 'classroom-hub-v1' as const;

export interface GoogleCalendarAuditConfig {
  readonly credentialReferencePath: string;
  readonly calendarId: string;
  readonly scopeId: string;
  readonly requestTimeoutMs: number;
  readonly maximumPages: number;
  readonly maximumEvents: number;
  readonly maximumWindowDays: number;
}

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name];
  if (value === undefined || value.length === 0)
    throw new Error(`${name} is required for Calendar audit`);
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

function externalReference(value: string, repositoryRoot: string): string {
  if (
    !isAbsolute(value) ||
    resolve(value) !== value ||
    value === '/' ||
    value.includes('\0')
  )
    throw new Error(
      'CLASSROOM_HUB_CALENDAR_AUDIT_CREDENTIAL_REFERENCE must be a normalized absolute file path',
    );
  const relation = relative(resolve(repositoryRoot), value);
  if (relation === '' || (!relation.startsWith('..') && !isAbsolute(relation)))
    throw new Error(
      'CLASSROOM_HUB_CALENDAR_AUDIT_CREDENTIAL_REFERENCE must be outside the repository',
    );
  return value;
}

function calendarId(value: string): string {
  if (
    value !== 'primary' &&
    !/^[A-Za-z0-9][A-Za-z0-9._@-]{0,511}$/u.test(value)
  )
    throw new Error(
      'CLASSROOM_HUB_CALENDAR_AUDIT_CALENDAR_ID must be primary or one exact bounded identifier',
    );
  return value;
}

function scopeId(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value))
    throw new Error(
      'CLASSROOM_HUB_CALENDAR_AUDIT_SCOPE_ID must be one exact bounded identifier',
    );
  return value;
}

/** Loads policy and protected path references without reading OAuth material. */
export function loadGoogleCalendarAuditConfig(
  environment: NodeJS.ProcessEnv = process.env,
  repositoryRoot = process.cwd(),
): GoogleCalendarAuditConfig {
  return {
    credentialReferencePath: externalReference(
      required(
        environment,
        'CLASSROOM_HUB_CALENDAR_AUDIT_CREDENTIAL_REFERENCE',
      ),
      repositoryRoot,
    ),
    calendarId: calendarId(
      required(environment, 'CLASSROOM_HUB_CALENDAR_AUDIT_CALENDAR_ID'),
    ),
    scopeId: scopeId(
      required(environment, 'CLASSROOM_HUB_CALENDAR_AUDIT_SCOPE_ID'),
    ),
    requestTimeoutMs:
      boundedInteger(
        'CLASSROOM_HUB_CALENDAR_AUDIT_REQUEST_TIMEOUT_SECONDS',
        environment.CLASSROOM_HUB_CALENDAR_AUDIT_REQUEST_TIMEOUT_SECONDS ??
          '15',
        1,
        60,
      ) * 1_000,
    maximumPages: boundedInteger(
      'CLASSROOM_HUB_CALENDAR_AUDIT_MAX_PAGES',
      environment.CLASSROOM_HUB_CALENDAR_AUDIT_MAX_PAGES ?? '5',
      1,
      10,
    ),
    maximumEvents: boundedInteger(
      'CLASSROOM_HUB_CALENDAR_AUDIT_MAX_EVENTS',
      environment.CLASSROOM_HUB_CALENDAR_AUDIT_MAX_EVENTS ?? '500',
      1,
      1_000,
    ),
    maximumWindowDays: boundedInteger(
      'CLASSROOM_HUB_CALENDAR_AUDIT_MAX_WINDOW_DAYS',
      environment.CLASSROOM_HUB_CALENDAR_AUDIT_MAX_WINDOW_DAYS ?? '14',
      1,
      31,
    ),
  };
}
