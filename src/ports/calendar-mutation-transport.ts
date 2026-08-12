import type {
  CalendarEventFields,
  CalendarOwnership,
} from '../contracts/v1/calendar.js';
import type { OpaqueId } from '../contracts/v1/common.js';
import type { CalendarPrivateOwnershipProperties } from '../domain/calendar-audit.js';

export interface CalendarWriterObservedEvent extends CalendarEventFields {
  readonly eventReference: OpaqueId;
  readonly etag: string;
  readonly ownership: CalendarPrivateOwnershipProperties;
}

export interface CalendarProductionTrialObservedEvent extends CalendarWriterObservedEvent {
  readonly reminderPolicy: 'provider-default';
}

export interface CalendarWriterRequestBoundary {
  readonly calendarId: string;
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
}

export interface CalendarWriterReadRequest extends CalendarWriterRequestBoundary {
  readonly eventReference: OpaqueId;
}

export type CalendarWriterReadResult =
  | { readonly status: 'found'; readonly event: CalendarWriterObservedEvent }
  | { readonly status: 'not-found' };

export interface CalendarWriterInsertRequest extends CalendarWriterRequestBoundary {
  readonly eventReference: OpaqueId;
  readonly desired: CalendarEventFields;
  readonly ownership: CalendarOwnership;
  readonly sendUpdates: 'none';
}

export interface CalendarWriterUpdateRequest extends CalendarWriterRequestBoundary {
  readonly eventReference: OpaqueId;
  readonly expectedEtag: string;
  readonly desired: CalendarEventFields;
  readonly ownership: CalendarOwnership;
  readonly sendUpdates: 'none';
}

export interface CalendarProductionTrialRestoreRequest extends CalendarWriterRequestBoundary {
  readonly eventReference: OpaqueId;
  readonly expectedEtag: string;
  readonly desiredLegacySnapshot: CalendarEventFields;
  readonly ownership: CalendarOwnership;
  readonly reminderPolicy: 'provider-default';
  readonly sendUpdates: 'none';
}

export interface CalendarProductionTrialUpdateRequest extends CalendarWriterUpdateRequest {
  readonly reminderPolicy: 'provider-default';
}

export interface CalendarWriterDeleteRequest extends CalendarWriterRequestBoundary {
  readonly eventReference: OpaqueId;
  readonly expectedEtag: string;
  readonly ownership: CalendarOwnership;
  readonly sendUpdates: 'none';
}

/**
 * Narrow provider mutation surface admitted only into the M-14 writer adapter.
 * It cannot accept attendees, recurrence, conference, reminder, or arbitrary
 * provider fields.
 */
export interface CalendarMutationTransport {
  getEvent(
    request: CalendarWriterReadRequest,
  ): Promise<CalendarWriterReadResult>;
  insertEvent(
    request: CalendarWriterInsertRequest,
  ): Promise<CalendarWriterObservedEvent>;
  updateEvent(
    request: CalendarWriterUpdateRequest,
  ): Promise<CalendarWriterObservedEvent>;
  deleteEvent(request: CalendarWriterDeleteRequest): Promise<void>;
}

/** M-15-only extension for exact compensation to a preflight legacy snapshot. */
export interface CalendarProductionTrialTransport extends CalendarMutationTransport {
  getAdoptionCandidateEvent(request: CalendarWriterReadRequest): Promise<
    | {
        readonly status: 'found';
        readonly event: CalendarProductionTrialObservedEvent;
      }
    | { readonly status: 'not-found' }
  >;
  updateAdoptedEvent(
    request: CalendarProductionTrialUpdateRequest,
  ): Promise<CalendarProductionTrialObservedEvent>;
  restoreAdoptedEvent(
    request: CalendarProductionTrialRestoreRequest,
  ): Promise<CalendarProductionTrialObservedEvent>;
}

export class CalendarMutationTransportError extends Error {
  constructor(
    readonly code:
      | 'calendar-write-authentication-required'
      | 'calendar-write-authorization-denied'
      | 'calendar-write-conflict'
      | 'calendar-write-not-found'
      | 'calendar-write-rate-limited'
      | 'calendar-write-timeout'
      | 'calendar-write-unavailable',
    readonly retryable: boolean,
    readonly diagnosticCode?:
      | 'response-identity-invalid'
      | 'response-etag-invalid'
      | 'response-cancelled'
      | 'response-event-type-unsupported'
      | 'response-fields-invalid'
      | 'response-interval-invalid'
      | 'response-timezone-invalid'
      | 'response-recurring-unsupported'
      | 'response-attendees-unsupported'
      | 'response-attachments-unsupported'
      | 'response-location-unsupported'
      | 'response-conference-unsupported'
      | 'response-default-reminders-unsupported'
      | 'response-reminder-overrides-unsupported'
      | 'response-private-properties-unsupported'
      | 'response-shared-properties-unsupported',
  ) {
    super(code);
    this.name = 'CalendarMutationTransportError';
  }
}
