import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
} from 'node:fs';

import { auth, calendar, type calendar_v3 } from '@googleapis/calendar';

import { googleCalendarOwnedEventsReadScope } from '../../config/google-calendar.js';
import {
  GoogleCalendarTransportError,
  type CalendarEventListTransport,
} from './contracts.js';

const maximumCredentialBytes = 16 * 1024;
const calendarFields =
  'nextPageToken,items(id,status,eventType,summary,description,start(date,dateTime,timeZone),end(date,dateTime,timeZone),extendedProperties(private),recurringEventId,originalStartTime(date,dateTime,timeZone))';

interface CalendarAuthorizedUserReference {
  readonly version: 1;
  readonly type: 'authorized-user';
  readonly clientId: string;
  readonly clientSecret: string;
  readonly refreshToken: string;
  readonly scopes: readonly [typeof googleCalendarOwnedEventsReadScope];
}

interface NarrowOfficialCalendarClient {
  readonly events: {
    list(
      params: calendar_v3.Params$Resource$Events$List,
      options: {
        readonly fields: string;
        readonly retry: false;
        readonly signal: AbortSignal;
        readonly timeout: number;
      },
    ): Promise<{ readonly data: calendar_v3.Schema$Events }>;
  };
}

/** Exposes one fixed, bounded Events.list GET and no generated write surface. */
export function createCalendarEventListTransport(
  client: NarrowOfficialCalendarClient,
): CalendarEventListTransport {
  return {
    async listEvents(request) {
      try {
        const response = await client.events.list(
          {
            calendarId: request.calendarId,
            timeMin: request.timeMin,
            timeMax: request.timeMax,
            singleEvents: true,
            orderBy: 'startTime',
            showDeleted: false,
            maxResults: request.maximumResults,
            ...(request.pageToken === undefined
              ? {}
              : { pageToken: request.pageToken }),
          },
          {
            fields: calendarFields,
            retry: false,
            signal: request.signal,
            timeout: request.timeoutMs,
          },
        );
        const items = response.data.items;
        if (items !== undefined && !Array.isArray(items))
          throw new GoogleCalendarTransportError('calendar-read-unavailable');
        const nextPageToken = response.data.nextPageToken;
        if (
          nextPageToken !== undefined &&
          nextPageToken !== null &&
          (typeof nextPageToken !== 'string' || nextPageToken.length > 2_048)
        )
          throw new GoogleCalendarTransportError('calendar-read-unavailable');
        return {
          items: items ?? [],
          ...(typeof nextPageToken === 'string' && nextPageToken.length > 0
            ? { nextPageToken }
            : {}),
        };
      } catch (error: unknown) {
        if (error instanceof GoogleCalendarTransportError) throw error;
        throw classifyGoogleError(error, request.signal);
      }
    },
  };
}

/** Reads a distinct protected read-only grant only when an audit is invoked. */
export function loadOfficialCalendarEventListTransport(
  referencePath: string,
): CalendarEventListTransport {
  const reference = loadAuthorizedUserReference(referencePath);
  const oauth = new auth.OAuth2(reference.clientId, reference.clientSecret);
  oauth.setCredentials({ refresh_token: reference.refreshToken });
  const client = calendar({ version: 'v3', auth: oauth });
  return createCalendarEventListTransport(client);
}

function loadAuthorizedUserReference(
  path: string,
): CalendarAuthorizedUserReference {
  let descriptor: number | undefined;
  try {
    const effectiveUid = process.geteuid?.();
    if (effectiveUid === undefined)
      throw new Error('calendar-audit-credential-reference-unsafe');
    const before = lstatSync(path);
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      before.nlink !== 1 ||
      before.uid !== effectiveUid ||
      (before.mode & 0o077) !== 0 ||
      before.size < 2 ||
      before.size > maximumCredentialBytes ||
      realpathSync(path) !== path
    )
      throw new Error('calendar-audit-credential-reference-unsafe');
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
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
      throw new Error('calendar-audit-credential-reference-unsafe');
    const value: unknown = JSON.parse(readFileSync(descriptor, 'utf8'));
    if (!isAuthorizedUserReference(value))
      throw new Error('calendar-audit-credential-reference-invalid');
    return value;
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      error.message.startsWith('calendar-audit-credential-reference-')
    )
      throw error;
    throw new Error('calendar-audit-credential-reference-unsafe');
  } finally {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        // A close failure cannot expose the protected path or widen authority.
      }
    }
  }
}

function isAuthorizedUserReference(
  value: unknown,
): value is CalendarAuthorizedUserReference {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).sort().join(',') ===
      'clientId,clientSecret,refreshToken,scopes,type,version' &&
    record.version === 1 &&
    record.type === 'authorized-user' &&
    typeof record.clientId === 'string' &&
    /^[A-Za-z0-9._-]{8,256}\.apps\.googleusercontent\.com$/u.test(
      record.clientId,
    ) &&
    typeof record.clientSecret === 'string' &&
    /^[A-Za-z0-9._-]{8,256}$/u.test(record.clientSecret) &&
    typeof record.refreshToken === 'string' &&
    record.refreshToken.length >= 8 &&
    record.refreshToken.length <= 4_096 &&
    Array.isArray(record.scopes) &&
    record.scopes.length === 1 &&
    record.scopes[0] === googleCalendarOwnedEventsReadScope
  );
}

function classifyGoogleError(
  error: unknown,
  signal: AbortSignal,
): GoogleCalendarTransportError {
  if (signal.aborted)
    return new GoogleCalendarTransportError('calendar-request-timeout');
  const status = statusFromError(error);
  if (status === 401)
    return new GoogleCalendarTransportError('calendar-authentication-required');
  if (status === 403)
    return new GoogleCalendarTransportError('calendar-authorization-denied');
  if (status === 404)
    return new GoogleCalendarTransportError('calendar-not-found');
  if (status === 429)
    return new GoogleCalendarTransportError('calendar-rate-limited');
  return new GoogleCalendarTransportError('calendar-read-unavailable');
}

function statusFromError(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const response = (error as { readonly response?: unknown }).response;
  if (typeof response !== 'object' || response === null) return undefined;
  const status = (response as { readonly status?: unknown }).status;
  return typeof status === 'number' ? status : undefined;
}
