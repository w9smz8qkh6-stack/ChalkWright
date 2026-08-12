import type {
  ContractEnvelope,
  IanaTimeZone,
  IsoInstant,
  OpaqueId,
} from './common.js';

export interface CalendarOwnership {
  readonly classification: 'verified-application-owned';
  readonly scopeId: OpaqueId;
  readonly ownershipMarker: OpaqueId;
}

export interface CalendarEventFields {
  readonly summary: string;
  readonly description: string;
  readonly startsAt: IsoInstant;
  readonly endsAt: IsoInstant;
  readonly timeZone: IanaTimeZone;
}

interface CalendarIntentBase extends ContractEnvelope {
  readonly intentId: OpaqueId;
  readonly planId: OpaqueId;
  readonly notifyAttendees: false;
}

export interface CalendarNoopIntent extends CalendarIntentBase {
  readonly kind: 'no-op';
  readonly existingEventReference: OpaqueId;
  readonly reason: 'semantic-match';
}

export interface CalendarCreateIntent extends CalendarIntentBase {
  readonly kind: 'create';
  readonly ownership: CalendarOwnership;
  readonly desired: CalendarEventFields;
}

export interface CalendarReplaceIntent extends CalendarIntentBase {
  readonly kind: 'replace';
  readonly ownership: CalendarOwnership;
  readonly existingEventReference: OpaqueId;
  readonly desired: CalendarEventFields;
}

export interface CalendarDeleteIntent extends CalendarIntentBase {
  readonly kind: 'delete';
  readonly ownership: CalendarOwnership;
  readonly existingEventReference: OpaqueId;
  readonly reason: 'obsolete-owned-event' | 'replace-owned-event';
}

/** Intent is inert data. No execution interface is part of M-01. */
export type CalendarMutationIntent =
  | CalendarNoopIntent
  | CalendarCreateIntent
  | CalendarReplaceIntent
  | CalendarDeleteIntent;
