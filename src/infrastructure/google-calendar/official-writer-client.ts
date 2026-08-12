import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
} from 'node:fs';

import { auth, calendar } from '@googleapis/calendar';

import { googleCalendarOwnedEventsWriteScope } from '../../config/google-calendar.js';
import type {
  CalendarMutationTransport,
  CalendarProductionTrialTransport,
} from '../../ports/calendar-mutation-transport.js';
import type { CalendarEventListTransport } from './contracts.js';
import { createCalendarEventListTransport } from './official-client.js';
import {
  createOfflineQualifiedCalendarMutationTransport,
  createOfflineQualifiedCalendarProductionTrialTransport,
} from './offline-writer-adapter.js';

const maximumCredentialBytes = 16 * 1024;

interface CalendarWriterAuthorizedUserReference {
  readonly version: 1;
  readonly type: 'authorized-user';
  readonly clientId: string;
  readonly clientSecret: string;
  readonly refreshToken: string;
  readonly scopes: readonly [typeof googleCalendarOwnedEventsWriteScope];
}

/**
 * Constructs the exact M-14 mutation adapter from a distinct owner-only grant.
 * This factory is not imported by routine jobs or services.
 */
export function loadOfficialCalendarMutationTransport(
  referencePath: string,
): CalendarMutationTransport {
  const reference = loadWriterReference(referencePath);
  const oauth = new auth.OAuth2(reference.clientId, reference.clientSecret);
  oauth.setCredentials({ refresh_token: reference.refreshToken });
  return createOfflineQualifiedCalendarMutationTransport(
    calendar({ version: 'v3', auth: oauth }),
  );
}

/** Constructs the exact M-15 read-preflight and mutation pair from one grant. */
export function loadOfficialCalendarProductionTrialTransports(
  referencePath: string,
): {
  readonly listTransport: CalendarEventListTransport;
  readonly mutationTransport: CalendarProductionTrialTransport;
} {
  const reference = loadWriterReference(referencePath);
  const oauth = new auth.OAuth2(reference.clientId, reference.clientSecret);
  oauth.setCredentials({ refresh_token: reference.refreshToken });
  const client = calendar({ version: 'v3', auth: oauth });
  return {
    listTransport: createCalendarEventListTransport(client),
    mutationTransport:
      createOfflineQualifiedCalendarProductionTrialTransport(client),
  };
}

function loadWriterReference(
  path: string,
): CalendarWriterAuthorizedUserReference {
  let descriptor: number | undefined;
  try {
    const effectiveUid = process.geteuid?.();
    if (effectiveUid === undefined)
      throw new Error('calendar-writer-credential-reference-unsafe');
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
      throw new Error('calendar-writer-credential-reference-unsafe');
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
      throw new Error('calendar-writer-credential-reference-unsafe');
    const value: unknown = JSON.parse(readFileSync(descriptor, 'utf8'));
    if (!isWriterReference(value))
      throw new Error('calendar-writer-credential-reference-invalid');
    return value;
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      error.message.startsWith('calendar-writer-credential-reference-')
    )
      throw error;
    throw new Error('calendar-writer-credential-reference-unsafe');
  } finally {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        // A close failure cannot expose the path or widen provider authority.
      }
    }
  }
}

function isWriterReference(
  value: unknown,
): value is CalendarWriterAuthorizedUserReference {
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
    record.scopes[0] === googleCalendarOwnedEventsWriteScope
  );
}
