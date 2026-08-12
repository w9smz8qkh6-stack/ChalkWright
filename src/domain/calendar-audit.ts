import type { CalendarEventFields, OpaqueId } from '../contracts/v1/index.js';

export interface CalendarPrivateOwnershipProperties {
  readonly owner?: string;
  readonly scopeId?: string;
  readonly ownershipMarker?: string;
}

/** Minimal event material retained in memory for M-13 comparison only. */
export interface ObservedCalendarEvent extends CalendarEventFields {
  readonly eventReference: OpaqueId;
  readonly eventType: 'default';
  readonly recurringInstance: boolean;
  readonly privateOwnership: CalendarPrivateOwnershipProperties;
}

export interface CalendarAdoptionApproval {
  readonly eventReference: OpaqueId;
  readonly eventFingerprint: string;
  readonly scopeId: OpaqueId;
  readonly ownershipMarker: OpaqueId;
  readonly disposition: 'approved-adoption';
}
