import type { OpaqueId } from '../../contracts/v1/common.js';
import type { EffectiveDayPlan } from '../../domain/plans.js';
import { calendarOwnershipMarker } from '../../config/google-calendar.js';
import type { CalendarExecutionStatePort } from '../../ports/calendar-execution-state.js';
import type { CalendarMutationTransport } from '../../ports/calendar-mutation-transport.js';
import type { CalendarEventListTransport } from '../../infrastructure/google-calendar/contracts.js';
import { readCalendarAuditWindow } from '../../infrastructure/google-calendar/adapter.js';
import { auditCalendarOwnership } from './ownership-audit.js';
import { projectCalendarDay } from './projection-policy.js';
import {
  executeCalendarWriterQualification,
  fingerprintCalendarIntentSet,
  hashCalendarReference,
} from './writer-qualification.js';

export interface M17CanarySyncOptions {
  readonly calendarId: string;
  readonly scopeId: OpaqueId;
  readonly plan: EffectiveDayPlan;
  readonly timeMin: string;
  readonly timeMax: string;
  readonly requestTimeoutMs: number;
  readonly maximumPages: number;
  readonly maximumEvents: number;
  readonly leaseDurationSeconds: number;
  readonly clock: () => string;
  readonly signal: AbortSignal;
  readonly listTransport: CalendarEventListTransport;
  readonly mutationTransport?: CalendarMutationTransport;
  readonly state: CalendarExecutionStatePort;
  readonly execute: boolean;
}

export interface M17CanarySyncEvidence {
  readonly status: 'succeeded' | 'failed' | 'repair-required';
  readonly code: string;
  readonly observedEventCount: number;
  readonly intentCount: number;
  readonly attemptedExternalMutations: number;
  readonly completedExternalMutations: number;
}

/** Reconciles one verified local day into only the configured canary Calendar. */
export async function synchronizeM17CanaryCalendar(
  options: M17CanarySyncOptions,
): Promise<M17CanarySyncEvidence> {
  if (options.execute && options.mutationTransport === undefined)
    return failed('m17-canary-mutation-capability-required');
  const projection = projectCalendarDay({
    plan: options.plan,
    scopeId: options.scopeId,
    timeMin: options.timeMin,
    timeMax: options.timeMax,
  });
  if (projection.status !== 'projected')
    return failed('m17-canary-plan-invalid');
  const read = await readCalendarAuditWindow(
    {
      calendarId: options.calendarId,
      requestTimeoutMs: options.requestTimeoutMs,
      maximumPages: options.maximumPages,
      maximumEvents: options.maximumEvents,
      maximumWindowDays: 1,
      transport: options.listTransport,
      now: options.clock,
    },
    {
      timeMin: options.timeMin,
      timeMax: options.timeMax,
      timeZone: options.plan.timeZone,
      signal: options.signal,
    },
  );
  if (read.status !== 'observed')
    return {
      ...failed(read.code),
      status: read.status === 'repair-required' ? 'repair-required' : 'failed',
    };
  const audit = auditCalendarOwnership({
    calendarId: options.calendarId,
    timeMin: options.timeMin,
    timeMax: options.timeMax,
    plan: options.plan,
    desired: projection.desired,
    observed: read.events,
    ownership: {
      classification: 'verified-application-owned',
      scopeId: options.scopeId,
      ownershipMarker: calendarOwnershipMarker,
    },
    adoptionApprovals: [],
    invalidProviderItemCount: read.invalidItemCount,
    unsupportedProviderItemCount: read.unsupportedItemCount,
    force: true,
  });
  if (!audit.evidence.readyForReconciliation)
    return failed('m17-canary-audit-blocked', read.events.length);
  if (audit.intents.length === 0)
    return {
      status: 'succeeded',
      code: 'm17-canary-calendar-converged',
      observedEventCount: read.events.length,
      intentCount: 0,
      attemptedExternalMutations: 0,
      completedExternalMutations: 0,
    };
  if (!options.execute)
    return {
      status: 'succeeded',
      code: 'm17-canary-calendar-preflight-ready',
      observedEventCount: read.events.length,
      intentCount: audit.intents.length,
      attemptedExternalMutations: 0,
      completedExternalMutations: 0,
    };
  const issuedAt = options.clock();
  const expiresAt = new Date(Date.parse(issuedAt) + 15 * 60_000).toISOString();
  const result = await executeCalendarWriterQualification({
    environment: 'parallel-canary',
    calendarId: options.calendarId,
    scopeId: options.scopeId,
    auditFingerprint: audit.evidence.auditFingerprint,
    intents: audit.intents,
    manifest: {
      version: 1,
      kind: 'calendar-writer-execution-approval',
      environment: 'parallel-canary',
      approvalId:
        `m17:${audit.evidence.auditFingerprint.slice(-32)}` as OpaqueId,
      scopeId: options.scopeId,
      calendarReferenceHash: hashCalendarReference(options.calendarId),
      auditFingerprint: audit.evidence.auditFingerprint,
      intentSetFingerprint: fingerprintCalendarIntentSet(audit.intents),
      allowedIntentIds: audit.intents.map((intent) => intent.intentId),
      issuedAt,
      expiresAt,
    },
    leaseId:
      `m17-lease:${audit.evidence.auditFingerprint.slice(-24)}` as OpaqueId,
    ownerId: 'chalkwright-m17-canary' as OpaqueId,
    leaseDurationSeconds: options.leaseDurationSeconds,
    requestTimeoutMs: options.requestTimeoutMs,
    clock: options.clock,
    signal: options.signal,
    state: options.state,
    transport: options.mutationTransport!,
  });
  return {
    status: result.status === 'succeeded' ? 'succeeded' : 'failed',
    code: result.code,
    observedEventCount: read.events.length,
    intentCount: audit.intents.length,
    attemptedExternalMutations: result.attemptedExternalMutations,
    completedExternalMutations: result.completedExternalMutations,
  };
}

function failed(code: string, observedEventCount = 0): M17CanarySyncEvidence {
  return {
    status: 'failed',
    code,
    observedEventCount,
    intentCount: 0,
    attemptedExternalMutations: 0,
    completedExternalMutations: 0,
  };
}
