import type { calendar_v3 } from '@googleapis/calendar';

import type {
  CalendarEventFields,
  CalendarOwnership,
} from '../../contracts/v1/calendar.js';
import { calendarOwnershipMarker } from '../../config/google-calendar.js';
import { epoch } from '../../domain/pure-values.js';
import {
  hasExactKeys,
  isIanaTimeZone,
  isIsoInstant,
  isPlainObject,
} from '../../domain/runtime-validation.js';
import {
  CalendarMutationTransportError,
  type CalendarMutationTransport,
  type CalendarProductionTrialTransport,
  type CalendarWriterObservedEvent,
} from '../../ports/calendar-mutation-transport.js';

const responseFields =
  'id,etag,status,eventType,summary,description,start(dateTime,timeZone),end(dateTime,timeZone),extendedProperties(private,shared),recurringEventId,attendees(email),recurrence,conferenceData,attachments(fileUrl),location,reminders(useDefault,overrides(method,minutes))';
const exactProjectionDescription = 'Imported from PowerSchool Bell Schedule.';

interface WriterMethodOptions {
  readonly fields?: string;
  readonly retry: false;
  readonly signal: AbortSignal;
  readonly timeout: number;
  readonly headers?: Readonly<Record<string, string>>;
}

/** Exact generated-client subset used by the offline-qualified adapter. */
export interface NarrowCalendarMutationClient {
  readonly events: {
    get(
      params: calendar_v3.Params$Resource$Events$Get,
      options: WriterMethodOptions,
    ): Promise<{ readonly data: calendar_v3.Schema$Event }>;
    insert(
      params: calendar_v3.Params$Resource$Events$Insert,
      options: WriterMethodOptions,
    ): Promise<{ readonly data: calendar_v3.Schema$Event }>;
    update(
      params: calendar_v3.Params$Resource$Events$Update,
      options: WriterMethodOptions,
    ): Promise<{ readonly data: calendar_v3.Schema$Event }>;
    patch?(
      params: calendar_v3.Params$Resource$Events$Patch,
      options: WriterMethodOptions,
    ): Promise<{ readonly data: calendar_v3.Schema$Event }>;
    delete(
      params: calendar_v3.Params$Resource$Events$Delete,
      options: WriterMethodOptions,
    ): Promise<unknown>;
  };
}

/**
 * Creates the exact mutation adapter around an injected client. This module
 * has no OAuth factory, credential loader, environment access, or entrypoint.
 */
export function createOfflineQualifiedCalendarMutationTransport(
  client: NarrowCalendarMutationClient,
): CalendarMutationTransport {
  return {
    async getEvent(request) {
      assertReadRequest(request);
      try {
        const response = await client.events.get(
          {
            calendarId: request.calendarId,
            eventId: request.eventReference,
            maxAttendees: 1,
          },
          requestOptions(request, true),
        );
        if (
          response.data.id === request.eventReference &&
          response.data.status === 'cancelled'
        )
          return { status: 'not-found' };
        return {
          status: 'found',
          event: normalizeResponse(response.data, request.eventReference),
        };
      } catch (error: unknown) {
        if (statusFromError(error) === 404) return { status: 'not-found' };
        throw classifyError(error, request.signal);
      }
    },

    async insertEvent(request) {
      assertInsertRequest(request);
      try {
        const response = await client.events.insert(
          {
            calendarId: request.calendarId,
            conferenceDataVersion: 0,
            maxAttendees: 1,
            sendUpdates: request.sendUpdates,
            supportsAttachments: false,
            requestBody: eventBody(
              request.desired,
              request.ownership,
              request.eventReference,
            ),
          },
          requestOptions(request, true),
        );
        return normalizeResponse(response.data, request.eventReference);
      } catch (error: unknown) {
        throw classifyError(error, request.signal);
      }
    },

    async updateEvent(request) {
      assertUpdateRequest(request);
      try {
        const response = await client.events.update(
          {
            calendarId: request.calendarId,
            eventId: request.eventReference,
            conferenceDataVersion: 0,
            maxAttendees: 1,
            sendUpdates: request.sendUpdates,
            supportsAttachments: false,
            requestBody: eventBody(request.desired, request.ownership),
          },
          {
            ...requestOptions(request, true),
            headers: { 'If-Match': request.expectedEtag },
          },
        );
        return normalizeResponse(response.data, request.eventReference);
      } catch (error: unknown) {
        throw classifyError(error, request.signal);
      }
    },

    async deleteEvent(request) {
      assertDeleteRequest(request);
      try {
        await client.events.delete(
          {
            calendarId: request.calendarId,
            eventId: request.eventReference,
            sendUpdates: request.sendUpdates,
          },
          {
            ...requestOptions(request, false),
            headers: { 'If-Match': request.expectedEtag },
          },
        );
      } catch (error: unknown) {
        throw classifyError(error, request.signal);
      }
    },
  };
}

/** Adds only exact M-15 legacy-snapshot restoration to the qualified surface. */
export function createOfflineQualifiedCalendarProductionTrialTransport(
  client: NarrowCalendarMutationClient,
): CalendarProductionTrialTransport {
  const mutation = createOfflineQualifiedCalendarMutationTransport(client);
  return {
    ...mutation,
    async getAdoptionCandidateEvent(request) {
      assertReadRequest(request);
      try {
        const response = await client.events.get(
          {
            calendarId: request.calendarId,
            eventId: request.eventReference,
            maxAttendees: 1,
          },
          requestOptions(request, true),
        );
        if (
          response.data.id === request.eventReference &&
          response.data.status === 'cancelled'
        )
          return { status: 'not-found' };
        const event = normalizeResponse(
          response.data,
          request.eventReference,
          true,
          true,
        );
        if (response.data.reminders?.useDefault !== true)
          throw new CalendarMutationTransportError(
            'calendar-write-unavailable',
            false,
            'response-default-reminders-unsupported',
          );
        return {
          status: 'found',
          event: { ...event, reminderPolicy: 'provider-default' },
        };
      } catch (error: unknown) {
        if (statusFromError(error) === 404) return { status: 'not-found' };
        throw classifyError(error, request.signal);
      }
    },
    async updateAdoptedEvent(request) {
      assertAdoptedUpdateRequest(request);
      try {
        if (client.events.patch === undefined) throw boundaryError();
        const response = await client.events.patch(
          {
            calendarId: request.calendarId,
            eventId: request.eventReference,
            conferenceDataVersion: 0,
            maxAttendees: 1,
            sendUpdates: request.sendUpdates,
            supportsAttachments: false,
            requestBody: adoptionPatchBody(
              request.desired.description,
              request.ownership,
            ),
          },
          {
            ...requestOptions(request, true),
            headers: { 'If-Match': request.expectedEtag },
          },
        );
        const updated = normalizeResponse(
          response.data,
          request.eventReference,
          true,
          true,
        );
        if (response.data.reminders?.useDefault !== true) throw boundaryError();
        return {
          ...updated,
          reminderPolicy: 'provider-default' as const,
        };
      } catch (error: unknown) {
        throw classifyError(error, request.signal);
      }
    },
    async restoreAdoptedEvent(request) {
      assertRestoreRequest(request);
      try {
        if (client.events.patch === undefined) throw boundaryError();
        const response = await client.events.patch(
          {
            calendarId: request.calendarId,
            eventId: request.eventReference,
            conferenceDataVersion: 0,
            maxAttendees: 1,
            sendUpdates: request.sendUpdates,
            supportsAttachments: false,
            requestBody: adoptionPatchBody(
              request.desiredLegacySnapshot.description,
              request.ownership,
            ),
          },
          {
            ...requestOptions(request, true),
            headers: { 'If-Match': request.expectedEtag },
          },
        );
        const restored = normalizeResponse(
          response.data,
          request.eventReference,
          true,
          true,
        );
        if (
          !sameFields(restored, request.desiredLegacySnapshot) ||
          restored.ownership.owner !== 'classroom-hub' ||
          restored.ownership.scopeId !== request.ownership.scopeId ||
          restored.ownership.ownershipMarker !==
            request.ownership.ownershipMarker ||
          response.data.reminders?.useDefault !== true
        )
          throw boundaryError();
        return { ...restored, reminderPolicy: 'provider-default' as const };
      } catch (error: unknown) {
        throw classifyError(error, request.signal);
      }
    },
  };
}

function assertAdoptedUpdateRequest(request: unknown): asserts request is {
  readonly calendarId: string;
  readonly eventReference: string;
  readonly expectedEtag: string;
  readonly desired: CalendarEventFields;
  readonly ownership: CalendarOwnership;
  readonly reminderPolicy: 'provider-default';
  readonly sendUpdates: 'none';
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
} {
  if (
    !isPlainObject(request) ||
    !hasExactKeys(request, [
      'calendarId',
      'eventReference',
      'expectedEtag',
      'desired',
      'ownership',
      'reminderPolicy',
      'sendUpdates',
      'timeoutMs',
      'signal',
    ]) ||
    !validBoundary(request) ||
    !boundedReference(request.eventReference) ||
    !bounded(request.expectedEtag, 512) ||
    !validDesired(request.desired) ||
    !validOwnership(request.ownership) ||
    request.reminderPolicy !== 'provider-default' ||
    request.sendUpdates !== 'none'
  )
    throw boundaryError();
}

function assertReadRequest(request: unknown): asserts request is {
  readonly calendarId: string;
  readonly eventReference: string;
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
} {
  if (
    !isPlainObject(request) ||
    !hasExactKeys(request, [
      'calendarId',
      'eventReference',
      'timeoutMs',
      'signal',
    ]) ||
    !validBoundary(request) ||
    !boundedReference(request.eventReference)
  )
    throw boundaryError();
}

function assertInsertRequest(request: unknown): asserts request is {
  readonly calendarId: string;
  readonly eventReference: string;
  readonly desired: CalendarEventFields;
  readonly ownership: CalendarOwnership;
  readonly sendUpdates: 'none';
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
} {
  if (
    !isPlainObject(request) ||
    !hasExactKeys(request, [
      'calendarId',
      'eventReference',
      'desired',
      'ownership',
      'sendUpdates',
      'timeoutMs',
      'signal',
    ]) ||
    !validBoundary(request) ||
    !/^[0-9a-v]{5,1024}$/u.test(String(request.eventReference)) ||
    !validDesired(request.desired) ||
    !validOwnership(request.ownership) ||
    request.sendUpdates !== 'none'
  )
    throw boundaryError();
}

function assertUpdateRequest(request: unknown): asserts request is {
  readonly calendarId: string;
  readonly eventReference: string;
  readonly expectedEtag: string;
  readonly desired: CalendarEventFields;
  readonly ownership: CalendarOwnership;
  readonly sendUpdates: 'none';
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
} {
  if (
    !isPlainObject(request) ||
    !hasExactKeys(request, [
      'calendarId',
      'eventReference',
      'expectedEtag',
      'desired',
      'ownership',
      'sendUpdates',
      'timeoutMs',
      'signal',
    ]) ||
    !validBoundary(request) ||
    !boundedReference(request.eventReference) ||
    !bounded(request.expectedEtag, 512) ||
    !validDesired(request.desired) ||
    !validOwnership(request.ownership) ||
    request.sendUpdates !== 'none'
  )
    throw boundaryError();
}

function assertRestoreRequest(request: unknown): asserts request is {
  readonly calendarId: string;
  readonly eventReference: string;
  readonly expectedEtag: string;
  readonly desiredLegacySnapshot: CalendarEventFields;
  readonly ownership: CalendarOwnership;
  readonly reminderPolicy: 'provider-default';
  readonly sendUpdates: 'none';
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
} {
  if (
    !isPlainObject(request) ||
    !hasExactKeys(request, [
      'calendarId',
      'eventReference',
      'expectedEtag',
      'desiredLegacySnapshot',
      'ownership',
      'reminderPolicy',
      'sendUpdates',
      'timeoutMs',
      'signal',
    ]) ||
    !validBoundary(request) ||
    !boundedReference(request.eventReference) ||
    !bounded(request.expectedEtag, 512) ||
    !validLegacySnapshot(request.desiredLegacySnapshot) ||
    !validOwnership(request.ownership) ||
    request.reminderPolicy !== 'provider-default' ||
    request.sendUpdates !== 'none'
  )
    throw boundaryError();
}

function assertDeleteRequest(request: unknown): asserts request is {
  readonly calendarId: string;
  readonly eventReference: string;
  readonly expectedEtag: string;
  readonly ownership: CalendarOwnership;
  readonly sendUpdates: 'none';
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
} {
  if (
    !isPlainObject(request) ||
    !hasExactKeys(request, [
      'calendarId',
      'eventReference',
      'expectedEtag',
      'ownership',
      'sendUpdates',
      'timeoutMs',
      'signal',
    ]) ||
    !validBoundary(request) ||
    !boundedReference(request.eventReference) ||
    !bounded(request.expectedEtag, 512) ||
    !validOwnership(request.ownership) ||
    request.sendUpdates !== 'none'
  )
    throw boundaryError();
}

function validBoundary(value: Record<string, unknown>): boolean {
  return (
    typeof value.calendarId === 'string' &&
    value.calendarId !== 'primary' &&
    /^[A-Za-z0-9][A-Za-z0-9._@-]{0,511}$/u.test(value.calendarId) &&
    Number.isSafeInteger(value.timeoutMs) &&
    Number(value.timeoutMs) >= 1_000 &&
    Number(value.timeoutMs) <= 60_000 &&
    value.signal instanceof AbortSignal
  );
}

function validDesired(value: unknown): value is CalendarEventFields {
  if (
    !isPlainObject(value) ||
    !hasExactKeys(value, [
      'summary',
      'description',
      'startsAt',
      'endsAt',
      'timeZone',
    ]) ||
    !validSummary(value.summary) ||
    value.description !== exactProjectionDescription ||
    !isIsoInstant(value.startsAt) ||
    !isIsoInstant(value.endsAt) ||
    !isIanaTimeZone(value.timeZone)
  )
    return false;
  const start = epoch(value.startsAt);
  const end = epoch(value.endsAt);
  return start !== undefined && end !== undefined && start < end;
}

function validLegacySnapshot(value: unknown): value is CalendarEventFields {
  if (
    !isPlainObject(value) ||
    !hasExactKeys(value, [
      'summary',
      'description',
      'startsAt',
      'endsAt',
      'timeZone',
    ]) ||
    !validSummary(value.summary) ||
    typeof value.description !== 'string' ||
    !/^Imported from PowerSchool Bell Schedule \(.{1,256}\)\.$/u.test(
      value.description,
    ) ||
    value.description.normalize('NFC') !== value.description ||
    /[\p{Cc}\p{Cs}\p{Zl}\p{Zp}]/u.test(value.description) ||
    !isIsoInstant(value.startsAt) ||
    !isIsoInstant(value.endsAt) ||
    !isIanaTimeZone(value.timeZone)
  )
    return false;
  const start = epoch(value.startsAt);
  const end = epoch(value.endsAt);
  return start !== undefined && end !== undefined && start < end;
}

function sameFields(
  observed: CalendarEventFields,
  desired: CalendarEventFields,
): boolean {
  return (
    observed.summary === desired.summary &&
    observed.description === desired.description &&
    observed.startsAt === desired.startsAt &&
    observed.endsAt === desired.endsAt &&
    observed.timeZone === desired.timeZone
  );
}

function validSummary(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= 256 &&
    value.trim() === value &&
    value.normalize('NFC') === value &&
    !/[\p{Cc}\p{Cs}\p{Zl}\p{Zp}]/u.test(value)
  );
}

function validOwnership(value: unknown): value is CalendarOwnership {
  return (
    isPlainObject(value) &&
    hasExactKeys(value, ['classification', 'scopeId', 'ownershipMarker']) &&
    value.classification === 'verified-application-owned' &&
    bounded(value.scopeId, 128) &&
    value.ownershipMarker === calendarOwnershipMarker
  );
}

function boundedReference(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= 1_024 &&
    !/[\0\r\n]/u.test(value)
  );
}

function boundaryError(): CalendarMutationTransportError {
  return new CalendarMutationTransportError('calendar-write-conflict', false);
}

function requestOptions(
  request: { readonly timeoutMs: number; readonly signal: AbortSignal },
  includeFields: boolean,
): WriterMethodOptions {
  return {
    ...(includeFields ? { fields: responseFields } : {}),
    retry: false,
    signal: request.signal,
    timeout: request.timeoutMs,
  };
}

function eventBody(
  desired: CalendarEventFields,
  ownership: CalendarOwnership,
  id?: string,
): calendar_v3.Schema$Event {
  return {
    ...(id === undefined ? {} : { id }),
    summary: desired.summary,
    description: desired.description,
    start: { dateTime: desired.startsAt, timeZone: desired.timeZone },
    end: { dateTime: desired.endsAt, timeZone: desired.timeZone },
    extendedProperties: {
      private: {
        classroomHubOwner: 'classroom-hub',
        classroomHubScope: ownership.scopeId,
        classroomHubOwnershipMarker: ownership.ownershipMarker,
      },
    },
    reminders: { useDefault: false, overrides: [] },
  };
}

function adoptionPatchBody(
  description: string,
  ownership: CalendarOwnership,
): calendar_v3.Schema$Event {
  return {
    description,
    extendedProperties: {
      private: {
        classroomHubOwner: 'classroom-hub',
        classroomHubScope: ownership.scopeId,
        classroomHubOwnershipMarker: ownership.ownershipMarker,
      },
    },
  };
}

function normalizeResponse(
  value: calendar_v3.Schema$Event,
  expectedReference: string,
  allowProviderDefaultReminders = false,
  allowUnknownExtendedProperties = false,
): CalendarWriterObservedEvent {
  const startsAt = normalizeProviderInstant(value.start?.dateTime);
  const endsAt = normalizeProviderInstant(value.end?.dateTime);
  const timeZone = value.start?.timeZone;
  const privateProperties = normalizedPrivateProperties(
    value.extendedProperties?.private,
    allowUnknownExtendedProperties,
  );
  const rejection = responseRejection(
    value,
    expectedReference,
    startsAt,
    endsAt,
    timeZone,
    privateProperties,
    allowProviderDefaultReminders,
    allowUnknownExtendedProperties,
  );
  if (rejection !== undefined)
    throw new CalendarMutationTransportError(
      'calendar-write-unavailable',
      false,
      rejection,
    );
  const normalizedPrivate = privateProperties as Readonly<
    Record<string, string>
  >;
  return {
    eventReference: value.id as string,
    etag: value.etag as string,
    summary: value.summary as string,
    description: value.description as string,
    startsAt: startsAt as string,
    endsAt: endsAt as string,
    timeZone: timeZone as string,
    ownership: {
      ...(bounded(normalizedPrivate.classroomHubOwner, 64)
        ? { owner: normalizedPrivate.classroomHubOwner }
        : {}),
      ...(bounded(normalizedPrivate.classroomHubScope, 128)
        ? { scopeId: normalizedPrivate.classroomHubScope }
        : {}),
      ...(bounded(normalizedPrivate.classroomHubOwnershipMarker, 128)
        ? {
            ownershipMarker: normalizedPrivate.classroomHubOwnershipMarker,
          }
        : {}),
    },
  };
}

function normalizedPrivateProperties(
  value: Readonly<Record<string, string>> | null | undefined,
  allowUnknown: boolean,
): Readonly<Record<string, string>> | undefined {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) return undefined;
  const allowed = new Set([
    'classroomHubOwner',
    'classroomHubScope',
    'classroomHubOwnershipMarker',
  ]);
  if (!allowUnknown && Object.keys(value).some((key) => !allowed.has(key)))
    return undefined;
  if (Object.values(value).some((entry) => typeof entry !== 'string'))
    return undefined;
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => allowed.has(key)),
  );
}

type ResponseDiagnostic = NonNullable<
  ConstructorParameters<typeof CalendarMutationTransportError>[2]
>;

function responseRejection(
  value: calendar_v3.Schema$Event,
  expectedReference: string,
  startsAt: string | undefined,
  endsAt: string | undefined,
  timeZone: string | null | undefined,
  privateProperties: Readonly<Record<string, string>> | undefined,
  allowProviderDefaultReminders: boolean,
  allowUnknownExtendedProperties: boolean,
): ResponseDiagnostic | undefined {
  if (value.id !== expectedReference) return 'response-identity-invalid';
  if (!bounded(value.etag, 512)) return 'response-etag-invalid';
  if (value.status === 'cancelled') return 'response-cancelled';
  if (value.eventType !== undefined && value.eventType !== 'default')
    return 'response-event-type-unsupported';
  if (
    !bounded(value.summary, 256) ||
    typeof value.description !== 'string' ||
    Buffer.byteLength(value.description, 'utf8') > 1_024
  )
    return 'response-fields-invalid';
  if (
    startsAt === undefined ||
    endsAt === undefined ||
    epoch(startsAt)! >= epoch(endsAt)!
  )
    return 'response-interval-invalid';
  if (!isIanaTimeZone(timeZone) || value.end?.timeZone !== timeZone)
    return 'response-timezone-invalid';
  if (
    (typeof value.recurringEventId === 'string' &&
      value.recurringEventId.length > 0) ||
    (value.recurrence !== undefined &&
      value.recurrence !== null &&
      (!Array.isArray(value.recurrence) || value.recurrence.length > 0))
  )
    return 'response-recurring-unsupported';
  if (
    value.attendees !== undefined &&
    value.attendees !== null &&
    (!Array.isArray(value.attendees) || value.attendees.length > 0)
  )
    return 'response-attendees-unsupported';
  if (
    value.attachments !== undefined &&
    value.attachments !== null &&
    (!Array.isArray(value.attachments) || value.attachments.length > 0)
  )
    return 'response-attachments-unsupported';
  if (typeof value.location === 'string' && value.location.length > 0)
    return 'response-location-unsupported';
  if (
    value.conferenceData !== undefined &&
    value.conferenceData !== null &&
    typeof value.conferenceData === 'object' &&
    Object.keys(value.conferenceData).length > 0
  )
    return 'response-conference-unsupported';
  if (value.reminders?.useDefault === true && !allowProviderDefaultReminders)
    return 'response-default-reminders-unsupported';
  if (
    value.reminders?.overrides !== undefined &&
    value.reminders.overrides !== null &&
    (!Array.isArray(value.reminders.overrides) ||
      value.reminders.overrides.length > 0)
  )
    return 'response-reminder-overrides-unsupported';
  if (privateProperties === undefined)
    return 'response-private-properties-unsupported';
  const shared = value.extendedProperties?.shared;
  if (
    !allowUnknownExtendedProperties &&
    shared !== undefined &&
    shared !== null &&
    (typeof shared !== 'object' ||
      Array.isArray(shared) ||
      Object.keys(shared).length > 0)
  )
    return 'response-shared-properties-unsupported';
  return undefined;
}

function normalizeProviderInstant(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-](\d{2}):(\d{2}))$/u.exec(
      value,
    );
  if (match === null) return undefined;
  const [year, month, day, hour, minute, second] = match
    .slice(1, 7)
    .map(Number);
  if (match[7] !== 'Z' && (Number(match[8]) > 23 || Number(match[9]) > 59))
    return undefined;
  const local = new Date(
    Date.UTC(year!, month! - 1, day!, hour!, minute!, second!),
  );
  if (
    local.getUTCFullYear() !== year ||
    local.getUTCMonth() + 1 !== month ||
    local.getUTCDate() !== day ||
    local.getUTCHours() !== hour ||
    local.getUTCMinutes() !== minute ||
    local.getUTCSeconds() !== second
  )
    return undefined;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return undefined;
  const normalized = new Date(parsed).toISOString();
  return isIsoInstant(normalized) ? normalized : undefined;
}

function classifyError(
  error: unknown,
  signal: AbortSignal,
): CalendarMutationTransportError {
  if (error instanceof CalendarMutationTransportError) return error;
  if (signal.aborted)
    return new CalendarMutationTransportError('calendar-write-timeout', true);
  const status = statusFromError(error);
  if (status === 401)
    return new CalendarMutationTransportError(
      'calendar-write-authentication-required',
      false,
    );
  if (status === 403)
    return new CalendarMutationTransportError(
      'calendar-write-authorization-denied',
      false,
    );
  if (status === 404)
    return new CalendarMutationTransportError(
      'calendar-write-not-found',
      false,
    );
  if (status === 409 || status === 412)
    return new CalendarMutationTransportError('calendar-write-conflict', true);
  if (status === 429)
    return new CalendarMutationTransportError(
      'calendar-write-rate-limited',
      true,
    );
  return new CalendarMutationTransportError('calendar-write-unavailable', true);
}

function statusFromError(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const response = (error as { readonly response?: unknown }).response;
  if (typeof response !== 'object' || response === null) return undefined;
  const status = (response as { readonly status?: unknown }).status;
  return typeof status === 'number' ? status : undefined;
}

function bounded(value: unknown, maximum: number): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    Buffer.byteLength(value, 'utf8') <= maximum &&
    !/[\0\r\n]/u.test(value)
  );
}
