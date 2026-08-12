import type { IanaTimeZone, IsoInstant } from '../../contracts/v1/common.js';
import type { ObservedCalendarEvent } from '../../domain/calendar-audit.js';
import { epoch } from '../../domain/pure-values.js';
import {
  isIanaTimeZone,
  isIsoInstant,
} from '../../domain/runtime-validation.js';
import {
  GoogleCalendarTransportError,
  type CalendarEventListTransport,
} from './contracts.js';

export interface CalendarAuditReadOptions {
  readonly calendarId: string;
  readonly requestTimeoutMs: number;
  readonly maximumPages: number;
  readonly maximumEvents: number;
  readonly maximumWindowDays: number;
  readonly transport: CalendarEventListTransport;
  readonly now?: () => string;
}

export interface CalendarAuditReadRequest {
  readonly timeMin: IsoInstant;
  readonly timeMax: IsoInstant;
  readonly timeZone: IanaTimeZone;
  readonly signal?: AbortSignal;
}

export type CalendarAuditReadResult =
  | {
      readonly status: 'observed';
      readonly events: readonly ObservedCalendarEvent[];
      readonly invalidItemCount: number;
      readonly unsupportedItemCount: number;
      readonly observedAt: IsoInstant;
    }
  | {
      readonly status: 'failed' | 'repair-required';
      readonly code: string;
      readonly retryable: boolean;
    };

/** Reads one explicit finite window; malformed provider entries block audit. */
export async function readCalendarAuditWindow(
  options: CalendarAuditReadOptions,
  request: CalendarAuditReadRequest,
): Promise<CalendarAuditReadResult> {
  const start = epoch(request.timeMin);
  const end = epoch(request.timeMax);
  if (
    !isIsoInstant(request.timeMin) ||
    !isIsoInstant(request.timeMax) ||
    !isIanaTimeZone(request.timeZone) ||
    start === undefined ||
    end === undefined ||
    start >= end ||
    end - start > options.maximumWindowDays * 86_400_000 ||
    !validOptions(options)
  )
    return failure('calendar-audit-request-invalid', false);

  const signal = AbortSignal.any(
    [AbortSignal.timeout(options.requestTimeoutMs), request.signal].filter(
      (value): value is AbortSignal => value !== undefined,
    ),
  );
  const events: ObservedCalendarEvent[] = [];
  const seenTokens = new Set<string>();
  let invalidItemCount = 0;
  let unsupportedItemCount = 0;
  let providerItemCount = 0;
  let pageToken: string | undefined;
  try {
    for (let page = 0; page < options.maximumPages; page += 1) {
      const response = await options.transport.listEvents({
        calendarId: options.calendarId,
        timeMin: request.timeMin,
        timeMax: request.timeMax,
        maximumResults: Math.min(250, options.maximumEvents),
        timeoutMs: options.requestTimeoutMs,
        signal,
        ...(pageToken === undefined ? {} : { pageToken }),
      });
      for (const value of response.items) {
        providerItemCount += 1;
        if (providerItemCount > options.maximumEvents)
          return failure('calendar-event-budget-exceeded', false);
        const event = normalizeEvent(value, request.timeZone);
        if (event.status === 'valid') events.push(event.event);
        else if (event.status === 'unsupported') unsupportedItemCount += 1;
        else invalidItemCount += 1;
      }
      const nextPageToken: unknown = response.nextPageToken;
      if (
        nextPageToken !== undefined &&
        (typeof nextPageToken !== 'string' ||
          nextPageToken.length < 1 ||
          nextPageToken.length > 2_048)
      )
        return failure('calendar-pagination-invalid', false);
      pageToken = nextPageToken as string | undefined;
      if (pageToken === undefined) break;
      if (seenTokens.has(pageToken))
        return failure('calendar-pagination-invalid', false);
      seenTokens.add(pageToken);
      if (page + 1 === options.maximumPages)
        return failure('calendar-page-budget-exceeded', false);
    }
  } catch (error: unknown) {
    if (error instanceof GoogleCalendarTransportError) {
      if (error.code === 'calendar-authentication-required')
        return {
          status: 'repair-required',
          code: error.code,
          retryable: false,
        };
      return failure(
        error.code,
        error.code === 'calendar-rate-limited' ||
          error.code === 'calendar-read-unavailable' ||
          error.code === 'calendar-request-timeout',
      );
    }
    return failure(
      signal.aborted ? 'calendar-request-timeout' : 'calendar-read-unavailable',
      true,
    );
  }

  const observedAt = options.now?.() ?? new Date().toISOString();
  if (!isIsoInstant(observedAt))
    return failure('calendar-audit-clock-invalid', false);
  return {
    status: 'observed',
    events,
    invalidItemCount,
    unsupportedItemCount,
    observedAt,
  };
}

function validOptions(options: CalendarAuditReadOptions): boolean {
  return (
    (options.calendarId === 'primary' ||
      /^[A-Za-z0-9][A-Za-z0-9._@-]{0,511}$/u.test(options.calendarId)) &&
    Number.isSafeInteger(options.requestTimeoutMs) &&
    options.requestTimeoutMs >= 1 &&
    options.requestTimeoutMs <= 60_000 &&
    Number.isSafeInteger(options.maximumPages) &&
    options.maximumPages >= 1 &&
    options.maximumPages <= 10 &&
    Number.isSafeInteger(options.maximumEvents) &&
    options.maximumEvents >= 1 &&
    options.maximumEvents <= 1_000 &&
    Number.isSafeInteger(options.maximumWindowDays) &&
    options.maximumWindowDays >= 1 &&
    options.maximumWindowDays <= 31
  );
}

function normalizeEvent(
  value: unknown,
  fallbackTimeZone: IanaTimeZone,
):
  | { readonly status: 'valid'; readonly event: ObservedCalendarEvent }
  | { readonly status: 'invalid' | 'unsupported' } {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return { status: 'invalid' };
  const record = value as Record<string, unknown>;
  const eventReference = boundedText(record.id, 1_024);
  const summary = boundedText(record.summary, 3_000);
  const description = boundedText(record.description, 30_000, true);
  if (
    eventReference === undefined ||
    summary === undefined ||
    record.status === 'cancelled' ||
    (record.eventType !== undefined && record.eventType !== 'default')
  )
    return { status: 'invalid' };
  const start = eventDateTime(record.start, fallbackTimeZone);
  const end = eventDateTime(record.end, fallbackTimeZone);
  if (start === 'all-day' || end === 'all-day')
    return { status: 'unsupported' };
  if (
    start === undefined ||
    end === undefined ||
    start.timeZone !== end.timeZone ||
    epoch(start.instant) === undefined ||
    epoch(end.instant) === undefined ||
    epoch(start.instant)! >= epoch(end.instant)!
  )
    return { status: 'invalid' };
  const privateProperties = privateOwnership(record.extendedProperties);
  if (privateProperties === undefined) return { status: 'invalid' };
  return {
    status: 'valid',
    event: {
      eventReference,
      summary,
      description: description ?? '',
      startsAt: start.instant,
      endsAt: end.instant,
      timeZone: start.timeZone,
      eventType: 'default',
      recurringInstance:
        typeof record.recurringEventId === 'string' &&
        record.recurringEventId.length > 0,
      privateOwnership: privateProperties,
    },
  };
}

function eventDateTime(
  value: unknown,
  fallbackTimeZone: IanaTimeZone,
):
  | { readonly instant: IsoInstant; readonly timeZone: IanaTimeZone }
  | 'all-day'
  | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.date === 'string') return 'all-day';
  if (typeof record.dateTime !== 'string') return undefined;
  const instant = normalizeProviderInstant(record.dateTime);
  if (instant === undefined) return undefined;
  const zone =
    typeof record.timeZone === 'string' && isIanaTimeZone(record.timeZone)
      ? record.timeZone
      : fallbackTimeZone;
  return { instant, timeZone: zone };
}

function normalizeProviderInstant(value: string): IsoInstant | undefined {
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

function privateOwnership(
  value: unknown,
): ObservedCalendarEvent['privateOwnership'] | undefined {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) return undefined;
  const properties = (value as Record<string, unknown>).private;
  if (properties === undefined || properties === null) return {};
  if (typeof properties !== 'object' || Array.isArray(properties))
    return undefined;
  const record = properties as Record<string, unknown>;
  const owner = optionalBoundedText(record.classroomHubOwner, 64);
  const scopeId = optionalBoundedText(record.classroomHubScope, 128);
  const ownershipMarker = optionalBoundedText(
    record.classroomHubOwnershipMarker,
    128,
  );
  if (owner === false || scopeId === false || ownershipMarker === false)
    return undefined;
  return {
    ...(owner === undefined ? {} : { owner }),
    ...(scopeId === undefined ? {} : { scopeId }),
    ...(ownershipMarker === undefined ? {} : { ownershipMarker }),
  };
}

function boundedText(
  value: unknown,
  maximum: number,
  allowEmpty = false,
): string | undefined {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > maximum)
    return undefined;
  const normalized = value.replace(/\s+/gu, ' ').trim();
  return normalized.length > 0 || allowEmpty ? normalized : undefined;
}

function optionalBoundedText(
  value: unknown,
  maximum: number,
): string | undefined | false {
  if (value === undefined) return undefined;
  return boundedText(value, maximum) ?? false;
}

function failure(code: string, retryable: boolean): CalendarAuditReadResult {
  return { status: 'failed', code, retryable };
}
