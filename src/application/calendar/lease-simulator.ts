import type { IsoInstant, OpaqueId } from '../../contracts/v1/common.js';
import { epoch } from '../../domain/pure-values.js';
import { isIsoInstant } from '../../domain/runtime-validation.js';

export interface SimulatedCalendarLease {
  readonly scopeId: OpaqueId;
  readonly leaseId: OpaqueId;
  readonly ownerId: OpaqueId;
  readonly acquiredAt: IsoInstant;
  readonly expiresAt: IsoInstant;
}

export type CalendarLeaseSimulation =
  | {
      readonly status: 'acquired';
      readonly lease: SimulatedCalendarLease;
      readonly attemptedExternalMutations: 0;
      readonly completedExternalMutations: 0;
    }
  | {
      readonly status: 'refused';
      readonly code: 'calendar-lease-conflict' | 'calendar-lease-input-invalid';
      readonly attemptedExternalMutations: 0;
      readonly completedExternalMutations: 0;
    };

/** Pure lease rehearsal; it never reads or writes a provider or durable lock. */
export function simulateCalendarLease(options: {
  readonly scopeId: OpaqueId;
  readonly requestedLeaseId: OpaqueId;
  readonly ownerId: OpaqueId;
  readonly now: IsoInstant;
  readonly durationSeconds: number;
  readonly existing?: SimulatedCalendarLease;
}): CalendarLeaseSimulation {
  const now = epoch(options.now);
  if (
    !boundedId(options.scopeId) ||
    !boundedId(options.requestedLeaseId) ||
    !boundedId(options.ownerId) ||
    !isIsoInstant(options.now) ||
    now === undefined ||
    !Number.isSafeInteger(options.durationSeconds) ||
    options.durationSeconds < 5 ||
    options.durationSeconds > 900 ||
    (options.existing !== undefined && !validLease(options.existing))
  )
    return refused('calendar-lease-input-invalid');
  const existingExpiry =
    options.existing === undefined
      ? undefined
      : epoch(options.existing.expiresAt);
  if (
    options.existing !== undefined &&
    options.existing.scopeId === options.scopeId &&
    existingExpiry !== undefined &&
    existingExpiry > now &&
    options.existing.leaseId !== options.requestedLeaseId
  )
    return refused('calendar-lease-conflict');
  return {
    status: 'acquired',
    lease: {
      scopeId: options.scopeId,
      leaseId: options.requestedLeaseId,
      ownerId: options.ownerId,
      acquiredAt: options.now,
      expiresAt: new Date(now + options.durationSeconds * 1_000).toISOString(),
    },
    attemptedExternalMutations: 0,
    completedExternalMutations: 0,
  };
}

function validLease(value: SimulatedCalendarLease): boolean {
  const acquired = epoch(value.acquiredAt);
  const expires = epoch(value.expiresAt);
  return (
    boundedId(value.scopeId) &&
    boundedId(value.leaseId) &&
    boundedId(value.ownerId) &&
    isIsoInstant(value.acquiredAt) &&
    isIsoInstant(value.expiresAt) &&
    acquired !== undefined &&
    expires !== undefined &&
    acquired < expires
  );
}

function boundedId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value);
}

function refused(
  code: Extract<CalendarLeaseSimulation, { status: 'refused' }>['code'],
): CalendarLeaseSimulation {
  return {
    status: 'refused',
    code,
    attemptedExternalMutations: 0,
    completedExternalMutations: 0,
  };
}
