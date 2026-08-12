import type { CalendarAdoptionApproval } from '../../domain/calendar-audit.js';
import type { EffectiveDayPlan } from '../../domain/plans.js';
import type { GoogleCalendarAuditConfig } from '../../config/google-calendar.js';
import { calendarOwnershipMarker } from '../../config/google-calendar.js';
import {
  auditCalendarOwnership,
  type CalendarOwnershipAuditResult,
} from '../../application/calendar/ownership-audit.js';
import { projectCalendarDay } from '../../application/calendar/projection-policy.js';
import type { IsoInstant } from '../../contracts/v1/common.js';
import {
  readCalendarAuditWindow,
  type CalendarAuditReadResult,
} from './adapter.js';
import type { CalendarEventListTransport } from './contracts.js';
import { loadOfficialCalendarEventListTransport } from './official-client.js';

export type ConfiguredCalendarOwnershipAuditResult =
  | {
      readonly status: 'observed';
      readonly audit: CalendarOwnershipAuditResult;
      readonly observedAt: IsoInstant;
      readonly attemptedExternalMutations: 0;
      readonly completedExternalMutations: 0;
    }
  | {
      readonly status: 'failed' | 'repair-required';
      readonly code: string;
      readonly retryable: boolean;
      readonly attemptedExternalMutations: 0;
      readonly completedExternalMutations: 0;
    };

/**
 * The sole M-13 composition boundary. It binds the configured calendar,
 * application scope, marker, budgets, desired-plan derivation, and read grant.
 */
export async function runConfiguredCalendarOwnershipAudit(options: {
  readonly config: GoogleCalendarAuditConfig;
  readonly plan: EffectiveDayPlan;
  readonly timeMin: IsoInstant;
  readonly timeMax: IsoInstant;
  readonly adoptionApprovals: readonly CalendarAdoptionApproval[];
  readonly previousFingerprint?: string;
  readonly force: boolean;
  readonly signal?: AbortSignal;
  readonly transport?: CalendarEventListTransport;
}): Promise<ConfiguredCalendarOwnershipAuditResult> {
  const projection = projectCalendarDay({
    plan: options.plan,
    scopeId: options.config.scopeId,
    timeMin: options.timeMin,
    timeMax: options.timeMax,
  });
  if (projection.status !== 'projected')
    return failure('failed', 'calendar-audit-request-invalid', false);

  let transport: CalendarEventListTransport;
  try {
    transport =
      options.transport ??
      loadOfficialCalendarEventListTransport(
        options.config.credentialReferencePath,
      );
  } catch (error: unknown) {
    const code =
      error instanceof Error &&
      error.message === 'calendar-audit-credential-reference-unsafe'
        ? 'calendar-audit-credential-reference-unsafe'
        : 'calendar-audit-credential-reference-invalid';
    return failure('repair-required', code, false);
  }

  const read = await readCalendarAuditWindow(
    {
      calendarId: options.config.calendarId,
      requestTimeoutMs: options.config.requestTimeoutMs,
      maximumPages: options.config.maximumPages,
      maximumEvents: options.config.maximumEvents,
      maximumWindowDays: options.config.maximumWindowDays,
      transport,
    },
    {
      timeMin: options.timeMin,
      timeMax: options.timeMax,
      timeZone: options.plan.timeZone,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    },
  );
  if (read.status !== 'observed') return readFailure(read);

  const audit = auditCalendarOwnership({
    calendarId: options.config.calendarId,
    timeMin: options.timeMin,
    timeMax: options.timeMax,
    plan: options.plan,
    desired: projection.desired,
    observed: read.events,
    ownership: {
      classification: 'verified-application-owned',
      scopeId: options.config.scopeId,
      ownershipMarker: calendarOwnershipMarker,
    },
    adoptionApprovals: options.adoptionApprovals,
    invalidProviderItemCount: read.invalidItemCount,
    unsupportedProviderItemCount: read.unsupportedItemCount,
    ...(options.previousFingerprint === undefined
      ? {}
      : { previousFingerprint: options.previousFingerprint }),
    force: options.force,
  });
  return {
    status: 'observed',
    audit,
    observedAt: read.observedAt,
    attemptedExternalMutations: 0,
    completedExternalMutations: 0,
  };
}

function readFailure(
  read: Exclude<CalendarAuditReadResult, { status: 'observed' }>,
): ConfiguredCalendarOwnershipAuditResult {
  return failure(read.status, read.code, read.retryable);
}

function failure(
  status: 'failed' | 'repair-required',
  code: string,
  retryable: boolean,
): ConfiguredCalendarOwnershipAuditResult {
  return {
    status,
    code,
    retryable,
    attemptedExternalMutations: 0,
    completedExternalMutations: 0,
  };
}
