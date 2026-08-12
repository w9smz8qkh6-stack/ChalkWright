import { createHash } from 'node:crypto';

import type {
  CalendarEventFields,
  CalendarMutationIntent,
  CalendarOwnership,
  CalendarReplaceIntent,
} from '../../contracts/v1/calendar.js';
import type { IsoInstant, OpaqueId } from '../../contracts/v1/common.js';
import { calendarOwnershipMarker } from '../../config/google-calendar.js';
import type {
  CalendarAdoptionApproval,
  ObservedCalendarEvent,
} from '../../domain/calendar-audit.js';
import type { EffectiveDayPlan } from '../../domain/plans.js';
import { epoch, stableSerialize } from '../../domain/pure-values.js';
import {
  hasExactKeys,
  isEffectivePlan,
  isIsoInstant,
  isPlainObject,
} from '../../domain/runtime-validation.js';
import type {
  CalendarExecutionJournalRecord,
  CalendarExecutionStatePort,
  CalendarExecutionStepRecord,
} from '../../ports/calendar-execution-state.js';
import {
  CalendarMutationTransportError,
  type CalendarMutationTransport,
  type CalendarProductionTrialObservedEvent,
  type CalendarProductionTrialTransport,
  type CalendarWriterObservedEvent,
} from '../../ports/calendar-mutation-transport.js';
import {
  auditCalendarOwnership,
  calendarEventEvidenceReference,
  fingerprintEvent,
} from './ownership-audit.js';
import {
  calendarProjectionDescription,
  projectCalendarDay,
} from './projection-policy.js';
import {
  executeCalendarWriterQualification,
  fingerprintCalendarIntentSet,
  hashCalendarProviderReference,
  hashCalendarReference,
  isExactOwnedCalendarEvent,
  sameCalendarEventFields,
  type CalendarWriterExecutionManifest,
} from './writer-qualification.js';
import {
  readCalendarAuditWindow,
  type CalendarAuditReadResult,
} from '../../infrastructure/google-calendar/adapter.js';
import type { CalendarEventListTransport } from '../../infrastructure/google-calendar/contracts.js';

export const m15ApprovedDate = '2026-08-11' as const;
export const m15ApprovedM13AuditFingerprint =
  'sha256:2a5eb7e86b4fdc86e0aaac99d30546fcc23da8fdf0959828e6dd3ed6bdd822e7' as const;
export const m15ApprovedCandidateEvidenceReferences = [
  'sha256:1cc0428e43fee068393299224a75f7e41befc1555bb5f941d468bedbb839d44e',
  'sha256:5bcedf493c20736cf55a6ffddcdb346b16659a6eac9af14db9be8b6f6fa07d48',
  'sha256:fcc7cb5deb007c521cdf8d60e10513e63e3ec9f12239fdc983cc939596063898',
] as const;

const sha256Pattern = /^sha256:[a-f0-9]{64}$/u;
const maximumApprovalWindowMs = 15 * 60_000;

export interface M15ApprovedEvidencePolicy {
  readonly date: string;
  readonly auditFingerprint: string;
  readonly candidateEvidenceReferences: readonly [string, string, string];
}

const fixedM15EvidencePolicy: M15ApprovedEvidencePolicy = {
  date: m15ApprovedDate,
  auditFingerprint: m15ApprovedM13AuditFingerprint,
  candidateEvidenceReferences: m15ApprovedCandidateEvidenceReferences,
};

export interface M15ProductionTrialOptions {
  readonly calendarId: string;
  readonly scopeId: OpaqueId;
  readonly timeMin: IsoInstant;
  readonly timeMax: IsoInstant;
  readonly plan: EffectiveDayPlan;
  readonly requestTimeoutMs: number;
  readonly maximumPages: number;
  readonly maximumEvents: number;
  readonly maximumWindowDays: number;
  readonly leaseDurationSeconds: number;
  readonly overallTimeoutMs: number;
  readonly legacyWriterExclusionFingerprint: string;
  readonly backupFingerprint: string;
  readonly implementationFingerprint: string;
  readonly clock: () => IsoInstant;
  readonly signal: AbortSignal;
  readonly listTransport: CalendarEventListTransport;
  readonly mutationTransport: CalendarProductionTrialTransport;
  readonly state: CalendarExecutionStatePort;
}

export interface M15PreparedItem {
  readonly approval: CalendarAdoptionApproval;
  readonly evidenceReference: string;
  readonly intent: CalendarReplaceIntent;
  readonly before: CalendarEventFields;
  readonly reminderPolicy: 'provider-default';
  readonly preflightEtagHash: string;
}

export interface M15PreparedProductionTrial {
  readonly version: 1;
  readonly kind: 'm15-production-trial-prepared';
  readonly date: string;
  readonly calendarReferenceHash: string;
  readonly scopeId: OpaqueId;
  readonly timeMin: IsoInstant;
  readonly timeMax: IsoInstant;
  readonly planSnapshot: EffectiveDayPlan;
  readonly planReferenceHash: string;
  readonly approvedM13AuditFingerprint: string;
  readonly approvedAuditFingerprint: string;
  readonly intentSetFingerprint: string;
  readonly adoptionSetFingerprint: string;
  readonly noOpPreflightFingerprint: string;
  readonly legacyWriterExclusionFingerprint: string;
  readonly backupFingerprint: string;
  readonly implementationFingerprint: string;
  readonly preparedAt: IsoInstant;
  readonly items: readonly M15PreparedItem[];
  readonly proposalFingerprint: string;
}

export interface M15ProductionTrialApproval {
  readonly version: 1;
  readonly kind: 'm15-production-trial-approval';
  readonly environment: 'production-trial';
  readonly approvalId: OpaqueId;
  readonly proposalFingerprint: string;
  readonly calendarReferenceHash: string;
  readonly scopeId: OpaqueId;
  readonly approvedAuditFingerprint: string;
  readonly intentSetFingerprint: string;
  readonly adoptionSetFingerprint: string;
  readonly noOpPreflightFingerprint: string;
  readonly legacyWriterExclusionFingerprint: string;
  readonly backupFingerprint: string;
  readonly implementationFingerprint: string;
  readonly issuedAt: IsoInstant;
  readonly expiresAt: IsoInstant;
}

export type M15PreparationResult =
  | {
      readonly status: 'ready';
      readonly code: 'm15-production-preflight-ready';
      readonly prepared: M15PreparedProductionTrial;
      readonly observedEventCount: 3;
      readonly approvedAdoptionCount: 3;
      readonly proposedReplaceCount: 3;
      readonly attemptedExternalMutations: 0;
      readonly completedExternalMutations: 0;
    }
  | {
      readonly status: 'blocked';
      readonly code:
        | 'm15-production-input-invalid'
        | 'm15-production-read-failed'
        | 'm15-production-audit-drift'
        | 'm15-production-adoption-invalid'
        | 'm15-production-noop-preflight-failed';
      readonly attemptedExternalMutations: 0;
      readonly completedExternalMutations: 0;
      readonly diagnostic?:
        | {
            readonly kind: 'audit-drift';
            readonly auditFingerprint: string;
            readonly candidateEvidenceReferences: readonly string[];
            readonly observed: number;
            readonly legacyCandidates: number;
            readonly verifiedOwned: number;
            readonly approvedAdoptions: number;
            readonly ambiguous: number;
            readonly unrelated: number;
            readonly invalidProviderItems: number;
            readonly unsupportedProviderItems: number;
          }
        | {
            readonly kind: 'noop-preflight';
            readonly failureCode: string;
          };
    };

export interface M15ProductionTrialEvidence {
  readonly status: 'succeeded' | 'failed' | 'refused';
  readonly code:
    | 'm15-production-trial-succeeded'
    | 'm15-production-trial-input-invalid'
    | 'm15-production-trial-approval-invalid'
    | 'm15-production-trial-preflight-drift'
    | 'm15-production-trial-execution-failed'
    | 'm15-production-trial-readback-failed'
    | 'm15-production-trial-rollback-incomplete';
  readonly proposalFingerprint: string;
  readonly approvalFingerprint: string;
  readonly attemptedExternalMutations: number;
  readonly completedExternalMutations: number;
  readonly rollbackAttemptedExternalMutations: number;
  readonly rollbackCompletedExternalMutations: number;
  readonly exactReadOnlyNoOpPreflight: boolean;
  readonly replacedEventCount: number;
  readonly rollbackReadyCount: number;
  readonly executionFingerprints: readonly string[];
}

export async function prepareM15ProductionTrial(
  options: M15ProductionTrialOptions,
): Promise<M15PreparationResult> {
  return prepareM15ProductionTrialAgainstPolicy(
    options,
    fixedM15EvidencePolicy,
  );
}

/** Credential-free synthetic seam; architecture tests forbid entrypoint imports. */
export function createSyntheticM15ProductionTrialEngine(
  policy: M15ApprovedEvidencePolicy,
): {
  readonly prepare: (
    options: M15ProductionTrialOptions,
  ) => Promise<M15PreparationResult>;
  readonly execute: (
    options: M15ProductionTrialOptions,
    prepared: M15PreparedProductionTrial,
    approval: M15ProductionTrialApproval,
  ) => Promise<M15ProductionTrialEvidence>;
} {
  const frozen = {
    date: policy.date,
    auditFingerprint: policy.auditFingerprint,
    candidateEvidenceReferences: [...policy.candidateEvidenceReferences] as [
      string,
      string,
      string,
    ],
  };
  return {
    prepare: (options) =>
      prepareM15ProductionTrialAgainstPolicy(options, frozen),
    execute: (options, prepared, approval) =>
      executePreparedM15ProductionTrialAgainstPolicy(
        options,
        prepared,
        approval,
        frozen,
      ),
  };
}

async function prepareM15ProductionTrialAgainstPolicy(
  options: M15ProductionTrialOptions,
  policy: M15ApprovedEvidencePolicy,
): Promise<M15PreparationResult> {
  if (!validOptions(options, policy))
    return blocked('m15-production-input-invalid');
  const projection = projectCalendarDay({
    plan: options.plan,
    scopeId: options.scopeId,
    timeMin: options.timeMin,
    timeMax: options.timeMax,
  });
  if (projection.status !== 'projected' || projection.desired.length !== 3)
    return blocked('m15-production-input-invalid');

  const read = await readCalendarAuditWindow(
    {
      calendarId: options.calendarId,
      requestTimeoutMs: options.requestTimeoutMs,
      maximumPages: options.maximumPages,
      maximumEvents: options.maximumEvents,
      maximumWindowDays: options.maximumWindowDays,
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
  if (read.status !== 'observed') return readBlocked(read);

  const ownership = productionOwnership(options.scopeId);
  const initial = auditCalendarOwnership({
    calendarId: options.calendarId,
    timeMin: options.timeMin,
    timeMax: options.timeMax,
    plan: options.plan,
    desired: projection.desired,
    observed: read.events,
    ownership,
    adoptionApprovals: [],
    invalidProviderItemCount: read.invalidItemCount,
    unsupportedProviderItemCount: read.unsupportedItemCount,
    force: true,
  });
  if (!exactApprovedInitialAudit(initial, read.events, policy))
    return blocked('m15-production-audit-drift', {
      kind: 'audit-drift',
      auditFingerprint: initial.evidence.auditFingerprint,
      candidateEvidenceReferences: initial.evidence.candidateEvidenceReferences,
      observed: initial.evidence.counts.observed,
      legacyCandidates: initial.evidence.counts.legacyCandidates,
      verifiedOwned: initial.evidence.counts.verifiedOwned,
      approvedAdoptions: initial.evidence.counts.approvedAdoptions,
      ambiguous: initial.evidence.counts.ambiguous,
      unrelated: initial.evidence.counts.unrelated,
      invalidProviderItems: initial.evidence.counts.invalidProviderItems,
      unsupportedProviderItems:
        initial.evidence.counts.unsupportedProviderItems,
    });

  const approvals = read.events.map((event): CalendarAdoptionApproval => ({
    eventReference: event.eventReference,
    eventFingerprint: fingerprintEvent(event),
    scopeId: options.scopeId,
    ownershipMarker: calendarOwnershipMarker,
    disposition: 'approved-adoption',
  }));
  const approved = auditCalendarOwnership({
    calendarId: options.calendarId,
    timeMin: options.timeMin,
    timeMax: options.timeMax,
    plan: options.plan,
    desired: projection.desired,
    observed: read.events,
    ownership,
    adoptionApprovals: approvals,
    invalidProviderItemCount: read.invalidItemCount,
    unsupportedProviderItemCount: read.unsupportedItemCount,
    force: true,
  });
  if (!exactApprovedAdoptionAudit(approved))
    return blocked('m15-production-adoption-invalid');

  const eventsByReference = new Map(
    read.events.map((event) => [event.eventReference, event]),
  );
  const approvalsByReference = new Map(
    approvals.map((approval) => [approval.eventReference, approval]),
  );
  const items: M15PreparedItem[] = [];
  for (const intent of [...approved.intents].sort((left, right) =>
    left.intentId.localeCompare(right.intentId),
  )) {
    if (intent.kind !== 'replace')
      return blocked('m15-production-adoption-invalid');
    const observed = eventsByReference.get(intent.existingEventReference);
    const approval = approvalsByReference.get(intent.existingEventReference);
    if (observed === undefined || approval === undefined)
      return blocked('m15-production-adoption-invalid');
    const exact = await exactReadOnlyPreflight(
      options,
      observed,
      approval,
      intent,
    );
    if (exact.status === 'failed')
      return blocked('m15-production-noop-preflight-failed', {
        kind: 'noop-preflight',
        failureCode: exact.code,
      });
    items.push({
      approval,
      evidenceReference: calendarEventEvidenceReference(observed),
      intent,
      before: calendarFields(observed),
      reminderPolicy: exact.event.reminderPolicy,
      preflightEtagHash: digest(exact.event.etag),
    });
  }
  if (items.length !== 3)
    return blocked('m15-production-noop-preflight-failed');

  const preparedAt = options.clock();
  const base = {
    version: 1 as const,
    kind: 'm15-production-trial-prepared' as const,
    date: policy.date,
    calendarReferenceHash: hashCalendarReference(options.calendarId),
    scopeId: options.scopeId,
    timeMin: options.timeMin,
    timeMax: options.timeMax,
    planSnapshot: options.plan,
    planReferenceHash: digest({
      canonicalPlanId: options.plan.canonicalPlanId,
      effectivePlanId: options.plan.effectivePlanId,
      date: options.plan.date,
    }),
    approvedM13AuditFingerprint: policy.auditFingerprint,
    approvedAuditFingerprint: approved.evidence.auditFingerprint,
    intentSetFingerprint: fingerprintCalendarIntentSet(
      items.map((item) => item.intent),
    ),
    adoptionSetFingerprint: digest(items.map((item) => item.approval)),
    noOpPreflightFingerprint: digest(
      items.map((item) => ({
        evidenceReference: item.evidenceReference,
        eventFingerprint: item.approval.eventFingerprint,
        reminderPolicy: item.reminderPolicy,
        preflightEtagHash: item.preflightEtagHash,
      })),
    ),
    legacyWriterExclusionFingerprint: options.legacyWriterExclusionFingerprint,
    backupFingerprint: options.backupFingerprint,
    implementationFingerprint: options.implementationFingerprint,
    preparedAt,
    items,
  };
  const prepared: M15PreparedProductionTrial = {
    ...base,
    proposalFingerprint: fingerprintPreparedBase(base),
  };
  return {
    status: 'ready',
    code: 'm15-production-preflight-ready',
    prepared,
    observedEventCount: 3,
    approvedAdoptionCount: 3,
    proposedReplaceCount: 3,
    attemptedExternalMutations: 0,
    completedExternalMutations: 0,
  };
}

export async function executePreparedM15ProductionTrial(
  options: M15ProductionTrialOptions,
  prepared: M15PreparedProductionTrial,
  approval: M15ProductionTrialApproval,
): Promise<M15ProductionTrialEvidence> {
  return executePreparedM15ProductionTrialAgainstPolicy(
    options,
    prepared,
    approval,
    fixedM15EvidencePolicy,
  );
}

async function executePreparedM15ProductionTrialAgainstPolicy(
  options: M15ProductionTrialOptions,
  prepared: M15PreparedProductionTrial,
  approval: M15ProductionTrialApproval,
  policy: M15ApprovedEvidencePolicy,
): Promise<M15ProductionTrialEvidence> {
  const proposalFingerprint = safePreparedFingerprint(prepared);
  const approvalFingerprint = safeDigest(approval);
  const empty = evidenceBase(proposalFingerprint, approvalFingerprint);
  if (
    !validOptions(options, policy) ||
    !validPrepared(options, prepared, policy)
  )
    return {
      ...empty,
      status: 'refused',
      code: 'm15-production-trial-input-invalid',
    };
  if (!validApproval(options, prepared, approval))
    return {
      ...empty,
      status: 'refused',
      code: 'm15-production-trial-approval-invalid',
    };

  const states = await Promise.all(
    prepared.items.map((item) => observedTrialState(options, item)),
  );
  if (states.some((state) => state === 'drift'))
    return {
      ...empty,
      status: 'refused',
      code: 'm15-production-trial-preflight-drift',
    };

  let attemptedExternalMutations = 0;
  let completedExternalMutations = 0;
  const executionFingerprints: string[] = [];
  for (const [index, item] of prepared.items.entries()) {
    const manifest = writerManifest(prepared, approval, item.intent, index);
    const state = states[index]!;
    const transport =
      state === 'legacy-unowned'
        ? approvedAdoptionTransport(
            options.mutationTransport,
            item,
            productionOwnership(options.scopeId),
          )
        : options.mutationTransport;
    const result = await executeCalendarWriterQualification({
      environment: 'production-trial',
      calendarId: options.calendarId,
      scopeId: options.scopeId,
      auditFingerprint: prepared.approvedAuditFingerprint,
      intents: [item.intent],
      manifest,
      leaseId: `m15-forward-lease-${index + 1}`,
      ownerId: 'm15-production-writer',
      leaseDurationSeconds: options.leaseDurationSeconds,
      requestTimeoutMs: options.requestTimeoutMs,
      clock: options.clock,
      signal: options.signal,
      state: options.state,
      transport,
    });
    executionFingerprints.push(result.executionFingerprint);
    attemptedExternalMutations += result.attemptedExternalMutations;
    completedExternalMutations += result.completedExternalMutations;
    if (result.status !== 'succeeded') {
      const rollback = await compensatePreparedItems(
        options,
        prepared,
        approval,
      );
      return {
        ...empty,
        status: 'failed',
        code: rollback.complete
          ? 'm15-production-trial-execution-failed'
          : 'm15-production-trial-rollback-incomplete',
        attemptedExternalMutations,
        completedExternalMutations,
        rollbackAttemptedExternalMutations: rollback.attempted,
        rollbackCompletedExternalMutations: rollback.completed,
        exactReadOnlyNoOpPreflight: true,
        executionFingerprints: [
          ...executionFingerprints,
          ...rollback.executionFingerprints,
        ],
      };
    }
  }

  for (const item of prepared.items) {
    const state = await observedTrialState(options, item);
    if (state !== 'desired-owned') {
      const rollback = await compensatePreparedItems(
        options,
        prepared,
        approval,
      );
      return {
        ...empty,
        status: 'failed',
        code: rollback.complete
          ? 'm15-production-trial-readback-failed'
          : 'm15-production-trial-rollback-incomplete',
        attemptedExternalMutations,
        completedExternalMutations,
        rollbackAttemptedExternalMutations: rollback.attempted,
        rollbackCompletedExternalMutations: rollback.completed,
        exactReadOnlyNoOpPreflight: true,
        executionFingerprints: [
          ...executionFingerprints,
          ...rollback.executionFingerprints,
        ],
      };
    }
  }
  return {
    ...empty,
    status: 'succeeded',
    code: 'm15-production-trial-succeeded',
    attemptedExternalMutations,
    completedExternalMutations,
    exactReadOnlyNoOpPreflight: true,
    replacedEventCount: 3,
    rollbackReadyCount: 3,
    executionFingerprints,
  };
}

function exactApprovedInitialAudit(
  result: ReturnType<typeof auditCalendarOwnership>,
  events: readonly ObservedCalendarEvent[],
  policy: M15ApprovedEvidencePolicy,
): boolean {
  const counts = result.evidence.counts;
  return (
    !result.evidence.readyForReconciliation &&
    result.intents.length === 0 &&
    counts.observed === 3 &&
    counts.verifiedOwned === 0 &&
    counts.approvedAdoptions === 0 &&
    counts.legacyCandidates === 3 &&
    counts.ambiguous === 0 &&
    counts.unrelated === 0 &&
    counts.invalidProviderItems === 0 &&
    counts.unsupportedProviderItems === 0 &&
    sameStrings(
      result.evidence.candidateEvidenceReferences,
      policy.candidateEvidenceReferences,
    ) &&
    sameStrings(
      events.map(calendarEventEvidenceReference),
      policy.candidateEvidenceReferences,
    )
  );
}

function exactApprovedAdoptionAudit(
  result: ReturnType<typeof auditCalendarOwnership>,
): boolean {
  const counts = result.evidence.counts;
  const intents = result.intents;
  return (
    result.evidence.readyForReconciliation &&
    result.evidence.blockerCodes.length === 0 &&
    counts.observed === 3 &&
    counts.approvedAdoptions === 3 &&
    counts.verifiedOwned === 0 &&
    counts.legacyCandidates === 0 &&
    counts.ambiguous === 0 &&
    counts.unrelated === 0 &&
    result.evidence.proposedIntentCounts.replace === 3 &&
    result.evidence.proposedIntentCounts.create === 0 &&
    result.evidence.proposedIntentCounts.delete === 0 &&
    result.evidence.proposedIntentCounts.noOp === 0 &&
    intents.length === 3 &&
    intents.every((intent) => intent.kind === 'replace')
  );
}

async function exactReadOnlyPreflight(
  options: M15ProductionTrialOptions,
  observed: ObservedCalendarEvent,
  approval: CalendarAdoptionApproval,
  intent: CalendarReplaceIntent,
): Promise<
  | {
      readonly status: 'ok';
      readonly event: CalendarProductionTrialObservedEvent;
    }
  | { readonly status: 'failed'; readonly code: string }
> {
  try {
    const read = await options.mutationTransport.getAdoptionCandidateEvent({
      calendarId: options.calendarId,
      eventReference: observed.eventReference,
      timeoutMs: options.requestTimeoutMs,
      signal: options.signal,
    });
    if (read.status !== 'found')
      return { status: 'failed', code: 'event-not-found' };
    if (Object.keys(read.event.ownership).length !== 0)
      return { status: 'failed', code: 'ownership-present' };
    if (fingerprintWriterEvent(read.event) !== approval.eventFingerprint)
      return { status: 'failed', code: 'event-fingerprint-different' };
    if (approval.eventReference !== intent.existingEventReference)
      return { status: 'failed', code: 'event-reference-different' };
    if (!sameCalendarEventFields(read.event, calendarFields(observed)))
      return { status: 'failed', code: 'event-fields-different' };
    return { status: 'ok', event: read.event };
  } catch (error: unknown) {
    if (error instanceof CalendarMutationTransportError)
      return {
        status: 'failed',
        code: error.diagnosticCode ?? error.code,
      };
    return { status: 'failed', code: 'event-read-failed' };
  }
}

function approvedAdoptionTransport(
  transport: CalendarProductionTrialTransport,
  item: M15PreparedItem,
  ownership: CalendarOwnership,
): CalendarMutationTransport {
  return {
    async getEvent(request) {
      if (request.eventReference !== item.intent.existingEventReference)
        throw conflict();
      const read = await transport.getAdoptionCandidateEvent(request);
      if (read.status !== 'found') return read;
      if (
        Object.keys(read.event.ownership).length !== 0 ||
        fingerprintWriterEvent(read.event) !== item.approval.eventFingerprint ||
        !sameCalendarEventFields(read.event, item.before)
      )
        throw conflict();
      const { reminderPolicy: _reminderPolicy, ...event } = read.event;
      return {
        status: 'found',
        event: {
          ...event,
          ownership: {
            owner: 'classroom-hub',
            scopeId: ownership.scopeId,
            ownershipMarker: ownership.ownershipMarker,
          },
        },
      };
    },
    async insertEvent() {
      throw conflict();
    },
    async updateEvent(request) {
      if (
        request.eventReference !== item.intent.existingEventReference ||
        !sameCalendarEventFields(request.desired, item.intent.desired)
      )
        throw conflict();
      const updated = await transport.updateAdoptedEvent({
        ...request,
        reminderPolicy: item.reminderPolicy,
      });
      const { reminderPolicy: _reminderPolicy, ...event } = updated;
      return event;
    },
    async deleteEvent() {
      throw conflict();
    },
  };
}

async function observedTrialState(
  options: M15ProductionTrialOptions,
  item: M15PreparedItem,
): Promise<'legacy-unowned' | 'legacy-owned' | 'desired-owned' | 'drift'> {
  try {
    const read = await options.mutationTransport.getAdoptionCandidateEvent({
      calendarId: options.calendarId,
      eventReference: item.intent.existingEventReference,
      timeoutMs: options.requestTimeoutMs,
      signal: options.signal,
    });
    if (read.status !== 'found') return 'drift';
    if (read.event.reminderPolicy !== item.reminderPolicy) return 'drift';
    const { reminderPolicy: _reminderPolicy, ...writerEvent } = read.event;
    const owned = isExactOwnedCalendarEvent(
      writerEvent,
      item.intent.existingEventReference,
      item.intent.ownership,
    );
    if (
      !owned &&
      Object.keys(writerEvent.ownership).length === 0 &&
      fingerprintWriterEvent(writerEvent) === item.approval.eventFingerprint &&
      sameCalendarEventFields(writerEvent, item.before)
    )
      return 'legacy-unowned';
    if (owned && sameCalendarEventFields(writerEvent, item.before))
      return 'legacy-owned';
    if (owned && sameCalendarEventFields(writerEvent, item.intent.desired))
      return 'desired-owned';
    return 'drift';
  } catch {
    return 'drift';
  }
}

async function compensatePreparedItems(
  options: M15ProductionTrialOptions,
  prepared: M15PreparedProductionTrial,
  approval: M15ProductionTrialApproval,
): Promise<{
  readonly complete: boolean;
  readonly attempted: number;
  readonly completed: number;
  readonly executionFingerprints: readonly string[];
}> {
  let attempted = 0;
  let completed = 0;
  let complete = true;
  const executionFingerprints: string[] = [];
  for (const [index, item] of [...prepared.items].reverse().entries()) {
    const state = await observedTrialState(options, item);
    if (state === 'legacy-unowned' || state === 'legacy-owned') continue;
    if (state !== 'desired-owned') {
      complete = false;
      continue;
    }
    const result = await executeLegacyCompensation(
      options,
      prepared,
      approval,
      item,
      index,
    );
    executionFingerprints.push(result.executionFingerprint);
    attempted += result.attempted;
    completed += result.completed;
    if (!result.succeeded) complete = false;
  }
  for (const item of prepared.items) {
    const state = await observedTrialState(options, item);
    if (state !== 'legacy-unowned' && state !== 'legacy-owned')
      complete = false;
  }
  return { complete, attempted, completed, executionFingerprints };
}

function writerManifest(
  prepared: M15PreparedProductionTrial,
  approval: M15ProductionTrialApproval,
  intent: CalendarReplaceIntent,
  index: number,
): CalendarWriterExecutionManifest {
  return {
    version: 1,
    kind: 'calendar-writer-execution-approval',
    environment: 'production-trial',
    approvalId: `${approval.approvalId}-forward-${index + 1}`,
    scopeId: prepared.scopeId,
    calendarReferenceHash: prepared.calendarReferenceHash,
    auditFingerprint: prepared.approvedAuditFingerprint,
    intentSetFingerprint: fingerprintCalendarIntentSet([intent]),
    allowedIntentIds: [intent.intentId],
    issuedAt: approval.issuedAt,
    expiresAt: approval.expiresAt,
  };
}

async function executeLegacyCompensation(
  options: M15ProductionTrialOptions,
  prepared: M15PreparedProductionTrial,
  approval: M15ProductionTrialApproval,
  item: M15PreparedItem,
  index: number,
): Promise<{
  readonly succeeded: boolean;
  readonly attempted: number;
  readonly completed: number;
  readonly executionFingerprint: string;
}> {
  const intentId = `m15-compensate-${item.intent.intentId}`;
  const manifestFingerprint = digest({
    kind: 'm15-production-compensation',
    proposalFingerprint: prepared.proposalFingerprint,
    approvalFingerprint: fingerprintM15ProductionTrialApproval(approval),
    intentId,
    eventReferenceHash: hashCalendarProviderReference(
      item.intent.existingEventReference,
    ),
    before: item.before,
  });
  const executionFingerprint = digest({ manifestFingerprint });
  const result = (
    succeeded: boolean,
    attempted: number,
    completed: number,
  ) => ({ succeeded, attempted, completed, executionFingerprint });
  let existing: CalendarExecutionJournalRecord | undefined;
  try {
    existing = await options.state.loadExecution(executionFingerprint);
    if (
      existing !== undefined &&
      (existing.executionFingerprint !== executionFingerprint ||
        existing.manifestFingerprint !== manifestFingerprint ||
        existing.scopeId !== options.scopeId)
    )
      return result(false, 0, 0);
    const current = await observedTrialState(options, item);
    if (
      existing?.status === 'succeeded' &&
      (current === 'legacy-owned' || current === 'legacy-unowned')
    )
      return result(true, 0, 0);
    const lease = await options.state.acquireLease({
      scopeId: options.scopeId,
      leaseId: `m15-compensation-lease-${index + 1}`,
      ownerId: 'm15-production-writer',
      now: options.clock(),
      expiresAt: new Date(
        epoch(options.clock())! + options.leaseDurationSeconds * 1_000,
      ).toISOString(),
    });
    if (lease.status === 'conflict') return result(false, 0, 0);
    try {
      if (existing === undefined) {
        existing = {
          executionFingerprint,
          manifestFingerprint,
          scopeId: options.scopeId,
          status: 'running',
          startedAt: options.clock(),
          steps: [],
        };
        await options.state.beginExecution(existing);
      } else if (existing.status === 'failed') {
        await options.state.resumeExecution({ executionFingerprint });
      }
      const observed = await observedTrialState(options, item);
      if (observed === 'legacy-owned' || observed === 'legacy-unowned') {
        const step = compensationStep(
          intentId,
          item.intent.existingEventReference,
          'already-converged',
        );
        await options.state.recordStep({ executionFingerprint, step });
        await options.state.finishExecution({
          executionFingerprint,
          status: 'succeeded',
          finishedAt: options.clock(),
        });
        return result(true, 0, 0);
      }
      if (observed !== 'desired-owned') return result(false, 0, 0);
      const read = await options.mutationTransport.getAdoptionCandidateEvent({
        calendarId: options.calendarId,
        eventReference: item.intent.existingEventReference,
        timeoutMs: options.requestTimeoutMs,
        signal: options.signal,
      });
      if (read.status !== 'found') return result(false, 0, 0);
      await options.state.recordStep({
        executionFingerprint,
        step: {
          intentId,
          intentKind: 'replace',
          status: 'attempted',
          providerReferenceHash: hashCalendarProviderReference(
            item.intent.existingEventReference,
          ),
        },
      });
      const restored = await options.mutationTransport.restoreAdoptedEvent({
        calendarId: options.calendarId,
        eventReference: item.intent.existingEventReference,
        expectedEtag: read.event.etag,
        desiredLegacySnapshot: item.before,
        ownership: item.intent.ownership,
        reminderPolicy: item.reminderPolicy,
        sendUpdates: 'none',
        timeoutMs: options.requestTimeoutMs,
        signal: options.signal,
      });
      const { reminderPolicy: _reminderPolicy, ...writerEvent } = restored;
      if (
        !isExactOwnedCalendarEvent(
          writerEvent,
          item.intent.existingEventReference,
          item.intent.ownership,
        ) ||
        !sameCalendarEventFields(writerEvent, item.before)
      )
        return result(false, 1, 1);
      await options.state.recordStep({
        executionFingerprint,
        step: compensationStep(
          intentId,
          item.intent.existingEventReference,
          'mutated',
        ),
      });
      await options.state.finishExecution({
        executionFingerprint,
        status: 'succeeded',
        finishedAt: options.clock(),
      });
      return result(true, 1, 1);
    } catch {
      try {
        await options.state.finishExecution({
          executionFingerprint,
          status: 'failed',
          finishedAt: options.clock(),
        });
      } catch {
        // The lease remains finite and the exact provider read decides retry.
      }
      return result(false, 1, 0);
    } finally {
      try {
        await options.state.releaseLease({
          scopeId: options.scopeId,
          leaseId: `m15-compensation-lease-${index + 1}`,
          ownerId: 'm15-production-writer',
        });
      } catch {
        // The finite lease expires without widening provider authority.
      }
    }
  } catch {
    return result(false, 0, 0);
  }
}

function compensationStep(
  intentId: string,
  eventReference: string,
  outcome: 'mutated' | 'already-converged',
): CalendarExecutionStepRecord {
  return {
    intentId,
    intentKind: 'replace',
    status: 'succeeded',
    outcome,
    providerReferenceHash: hashCalendarProviderReference(eventReference),
  };
}

export function fingerprintM15ProductionTrialApproval(
  approval: M15ProductionTrialApproval,
): string {
  return safeDigest(approval);
}

export function fingerprintM15PreparedProductionTrial(
  prepared: Omit<M15PreparedProductionTrial, 'proposalFingerprint'>,
): string {
  return fingerprintPreparedBase(prepared);
}

export function buildM15ProductionTrialApproval(options: {
  readonly prepared: M15PreparedProductionTrial;
  readonly approvalId: OpaqueId;
  readonly issuedAt: IsoInstant;
  readonly expiresAt: IsoInstant;
}): M15ProductionTrialApproval {
  return {
    version: 1,
    kind: 'm15-production-trial-approval',
    environment: 'production-trial',
    approvalId: options.approvalId,
    proposalFingerprint: options.prepared.proposalFingerprint,
    calendarReferenceHash: options.prepared.calendarReferenceHash,
    scopeId: options.prepared.scopeId,
    approvedAuditFingerprint: options.prepared.approvedAuditFingerprint,
    intentSetFingerprint: options.prepared.intentSetFingerprint,
    adoptionSetFingerprint: options.prepared.adoptionSetFingerprint,
    noOpPreflightFingerprint: options.prepared.noOpPreflightFingerprint,
    legacyWriterExclusionFingerprint:
      options.prepared.legacyWriterExclusionFingerprint,
    backupFingerprint: options.prepared.backupFingerprint,
    implementationFingerprint: options.prepared.implementationFingerprint,
    issuedAt: options.issuedAt,
    expiresAt: options.expiresAt,
  };
}

export function isM15PreparedProductionTrialForOptions(
  options: M15ProductionTrialOptions,
  value: unknown,
): value is M15PreparedProductionTrial {
  return validPrepared(
    options,
    value as M15PreparedProductionTrial,
    fixedM15EvidencePolicy,
  );
}

export function isM15ProductionTrialApprovalForOptions(
  options: M15ProductionTrialOptions,
  prepared: M15PreparedProductionTrial,
  value: unknown,
): value is M15ProductionTrialApproval {
  return validApproval(options, prepared, value as M15ProductionTrialApproval);
}

function validApproval(
  options: M15ProductionTrialOptions,
  prepared: M15PreparedProductionTrial,
  approval: M15ProductionTrialApproval,
): boolean {
  if (
    !isPlainObject(approval) ||
    !hasExactKeys(approval, [
      'version',
      'kind',
      'environment',
      'approvalId',
      'proposalFingerprint',
      'calendarReferenceHash',
      'scopeId',
      'approvedAuditFingerprint',
      'intentSetFingerprint',
      'adoptionSetFingerprint',
      'noOpPreflightFingerprint',
      'legacyWriterExclusionFingerprint',
      'backupFingerprint',
      'implementationFingerprint',
      'issuedAt',
      'expiresAt',
    ]) ||
    approval.version !== 1 ||
    approval.kind !== 'm15-production-trial-approval' ||
    approval.environment !== 'production-trial' ||
    !boundedId(approval.approvalId) ||
    approval.proposalFingerprint !== prepared.proposalFingerprint ||
    approval.calendarReferenceHash !== prepared.calendarReferenceHash ||
    approval.scopeId !== prepared.scopeId ||
    approval.approvedAuditFingerprint !== prepared.approvedAuditFingerprint ||
    approval.intentSetFingerprint !== prepared.intentSetFingerprint ||
    approval.adoptionSetFingerprint !== prepared.adoptionSetFingerprint ||
    approval.noOpPreflightFingerprint !== prepared.noOpPreflightFingerprint ||
    approval.legacyWriterExclusionFingerprint !==
      prepared.legacyWriterExclusionFingerprint ||
    approval.backupFingerprint !== prepared.backupFingerprint ||
    approval.implementationFingerprint !== prepared.implementationFingerprint ||
    !isIsoInstant(approval.issuedAt) ||
    !isIsoInstant(approval.expiresAt)
  )
    return false;
  const issued = epoch(approval.issuedAt);
  const expires = epoch(approval.expiresAt);
  const now = epoch(options.clock());
  return (
    issued !== undefined &&
    expires !== undefined &&
    now !== undefined &&
    expires > issued &&
    expires - issued <= maximumApprovalWindowMs &&
    issued <= now &&
    now + options.overallTimeoutMs <= expires
  );
}

function validPrepared(
  options: M15ProductionTrialOptions,
  prepared: M15PreparedProductionTrial,
  policy: M15ApprovedEvidencePolicy,
): boolean {
  try {
    if (
      !isPlainObject(prepared) ||
      !hasExactKeys(prepared, [
        'version',
        'kind',
        'date',
        'calendarReferenceHash',
        'scopeId',
        'timeMin',
        'timeMax',
        'planSnapshot',
        'planReferenceHash',
        'approvedM13AuditFingerprint',
        'approvedAuditFingerprint',
        'intentSetFingerprint',
        'adoptionSetFingerprint',
        'noOpPreflightFingerprint',
        'legacyWriterExclusionFingerprint',
        'backupFingerprint',
        'implementationFingerprint',
        'preparedAt',
        'items',
        'proposalFingerprint',
      ]) ||
      prepared.version !== 1 ||
      prepared.kind !== 'm15-production-trial-prepared' ||
      prepared.date !== policy.date ||
      prepared.calendarReferenceHash !==
        hashCalendarReference(options.calendarId) ||
      prepared.scopeId !== options.scopeId ||
      prepared.timeMin !== options.timeMin ||
      prepared.timeMax !== options.timeMax ||
      stableSerialize(prepared.planSnapshot) !==
        stableSerialize(options.plan) ||
      prepared.planReferenceHash !==
        digest({
          canonicalPlanId: options.plan.canonicalPlanId,
          effectivePlanId: options.plan.effectivePlanId,
          date: options.plan.date,
        }) ||
      prepared.approvedM13AuditFingerprint !== policy.auditFingerprint ||
      !sha256Pattern.test(prepared.approvedAuditFingerprint) ||
      prepared.legacyWriterExclusionFingerprint !==
        options.legacyWriterExclusionFingerprint ||
      prepared.backupFingerprint !== options.backupFingerprint ||
      prepared.implementationFingerprint !==
        options.implementationFingerprint ||
      !isIsoInstant(prepared.preparedAt) ||
      !Array.isArray(prepared.items) ||
      prepared.items.length !== 3 ||
      !prepared.items.every((item) => validPreparedItem(item, policy)) ||
      prepared.intentSetFingerprint !==
        fingerprintCalendarIntentSet(
          prepared.items.map((item) => item.intent),
        ) ||
      prepared.adoptionSetFingerprint !==
        digest(prepared.items.map((item) => item.approval)) ||
      prepared.noOpPreflightFingerprint !==
        digest(
          prepared.items.map((item) => ({
            evidenceReference: item.evidenceReference,
            eventFingerprint: item.approval.eventFingerprint,
            reminderPolicy: item.reminderPolicy,
            preflightEtagHash: item.preflightEtagHash,
          })),
        ) ||
      !sameStrings(
        prepared.items.map((item) => item.evidenceReference),
        policy.candidateEvidenceReferences,
      ) ||
      new Set(prepared.items.map((item) => item.intent.intentId)).size !== 3 ||
      new Set(prepared.items.map((item) => item.intent.existingEventReference))
        .size !== 3 ||
      prepared.proposalFingerprint !==
        fingerprintPreparedBase(preparedWithoutFingerprint(prepared))
    )
      return false;
    return true;
  } catch {
    return false;
  }
}

function validPreparedItem(
  item: M15PreparedItem,
  policy: M15ApprovedEvidencePolicy,
): boolean {
  if (
    isPlainObject(item) &&
    hasExactKeys(item, [
      'approval',
      'evidenceReference',
      'intent',
      'before',
      'reminderPolicy',
      'preflightEtagHash',
    ]) &&
    item.intent.kind === 'replace' &&
    item.approval.disposition === 'approved-adoption' &&
    item.approval.eventReference === item.intent.existingEventReference &&
    item.approval.scopeId === item.intent.ownership.scopeId &&
    item.approval.ownershipMarker === item.intent.ownership.ownershipMarker &&
    item.intent.ownership.classification === 'verified-application-owned' &&
    item.intent.ownership.ownershipMarker === calendarOwnershipMarker &&
    sha256Pattern.test(item.approval.eventFingerprint) &&
    sha256Pattern.test(item.evidenceReference) &&
    policy.candidateEvidenceReferences.includes(item.evidenceReference) &&
    item.reminderPolicy === 'provider-default' &&
    sha256Pattern.test(item.preflightEtagHash)
  ) {
    const observed: ObservedCalendarEvent = {
      ...item.before,
      eventReference: item.intent.existingEventReference,
      eventType: 'default',
      recurringInstance: false,
      privateOwnership: {},
    };
    return (
      item.approval.eventFingerprint === fingerprintEvent(observed) &&
      item.evidenceReference === calendarEventEvidenceReference(observed) &&
      item.intent.desired.summary === item.before.summary &&
      item.intent.desired.startsAt === item.before.startsAt &&
      item.intent.desired.endsAt === item.before.endsAt &&
      item.intent.desired.timeZone === item.before.timeZone &&
      item.intent.desired.description === calendarProjectionDescription &&
      /^Imported from PowerSchool Bell Schedule \(.{1,256}\)\.$/u.test(
        item.before.description,
      )
    );
  }
  return false;
}

function validOptions(
  options: M15ProductionTrialOptions,
  policy: M15ApprovedEvidencePolicy,
): boolean {
  return (
    /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/u.test(policy.date) &&
    sha256Pattern.test(policy.auditFingerprint) &&
    policy.candidateEvidenceReferences.length === 3 &&
    policy.candidateEvidenceReferences.every((value) =>
      sha256Pattern.test(value),
    ) &&
    new Set(policy.candidateEvidenceReferences).size === 3 &&
    options.calendarId !== 'primary' &&
    /^[A-Za-z0-9][A-Za-z0-9._@-]{0,511}$/u.test(options.calendarId) &&
    boundedId(options.scopeId) &&
    isEffectivePlan(options.plan) &&
    options.plan.date === policy.date &&
    options.plan.verification === 'verified' &&
    options.plan.meetings.length === 3 &&
    isIsoInstant(options.timeMin) &&
    isIsoInstant(options.timeMax) &&
    Number.isSafeInteger(options.requestTimeoutMs) &&
    options.requestTimeoutMs >= 1_000 &&
    options.requestTimeoutMs <= 60_000 &&
    Number.isSafeInteger(options.maximumPages) &&
    options.maximumPages >= 1 &&
    options.maximumPages <= 10 &&
    Number.isSafeInteger(options.maximumEvents) &&
    options.maximumEvents >= 3 &&
    options.maximumEvents <= 1_000 &&
    Number.isSafeInteger(options.maximumWindowDays) &&
    options.maximumWindowDays >= 1 &&
    options.maximumWindowDays <= 31 &&
    Number.isSafeInteger(options.leaseDurationSeconds) &&
    options.leaseDurationSeconds >= 60 &&
    options.leaseDurationSeconds <= 900 &&
    Number.isSafeInteger(options.overallTimeoutMs) &&
    options.overallTimeoutMs >= 60_000 &&
    options.overallTimeoutMs <= 10 * 60_000 &&
    sha256Pattern.test(options.legacyWriterExclusionFingerprint) &&
    sha256Pattern.test(options.backupFingerprint) &&
    sha256Pattern.test(options.implementationFingerprint) &&
    options.signal instanceof AbortSignal
  );
}

function productionOwnership(scopeId: OpaqueId): CalendarOwnership {
  return {
    classification: 'verified-application-owned',
    scopeId,
    ownershipMarker: calendarOwnershipMarker,
  };
}

function calendarFields(event: CalendarEventFields): CalendarEventFields {
  return {
    summary: event.summary,
    description: event.description,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    timeZone: event.timeZone,
  };
}

function fingerprintWriterEvent(event: CalendarWriterObservedEvent): string {
  return fingerprintEvent({
    ...calendarFields(event),
    eventReference: event.eventReference,
    eventType: 'default',
    recurringInstance: false,
    privateOwnership: event.ownership,
  });
}

function fingerprintPreparedBase(
  value: Omit<M15PreparedProductionTrial, 'proposalFingerprint'>,
): string {
  return digest(value);
}

function preparedWithoutFingerprint(
  prepared: M15PreparedProductionTrial,
): Omit<M15PreparedProductionTrial, 'proposalFingerprint'> {
  const { proposalFingerprint: _proposalFingerprint, ...base } = prepared;
  return base;
}

function evidenceBase(
  proposalFingerprint: string,
  approvalFingerprint: string,
): Omit<M15ProductionTrialEvidence, 'status' | 'code'> {
  return {
    proposalFingerprint,
    approvalFingerprint,
    attemptedExternalMutations: 0,
    completedExternalMutations: 0,
    rollbackAttemptedExternalMutations: 0,
    rollbackCompletedExternalMutations: 0,
    exactReadOnlyNoOpPreflight: false,
    replacedEventCount: 0,
    rollbackReadyCount: 0,
    executionFingerprints: [],
  };
}

function blocked(
  code: Extract<M15PreparationResult, { status: 'blocked' }>['code'],
  diagnostic?: Extract<
    M15PreparationResult,
    { status: 'blocked' }
  >['diagnostic'],
): M15PreparationResult {
  return {
    status: 'blocked',
    code,
    attemptedExternalMutations: 0,
    completedExternalMutations: 0,
    ...(diagnostic === undefined ? {} : { diagnostic }),
  };
}

function readBlocked(
  _read: Exclude<CalendarAuditReadResult, { status: 'observed' }>,
): M15PreparationResult {
  return blocked('m15-production-read-failed');
}

function sameStrings(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    stableSerialize([...left].sort()) === stableSerialize([...right].sort())
  );
}

function boundedId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$/u.test(value)
  );
}

function digest(value: unknown): string {
  return `sha256:${createHash('sha256').update(stableSerialize(value)).digest('hex')}`;
}

function safeDigest(value: unknown): string {
  try {
    return digest(value);
  } catch {
    return digest('invalid-m15-value');
  }
}

function safePreparedFingerprint(prepared: M15PreparedProductionTrial): string {
  try {
    return prepared.proposalFingerprint;
  } catch {
    return digest('invalid-m15-prepared');
  }
}

function conflict(): CalendarMutationTransportError {
  return new CalendarMutationTransportError('calendar-write-conflict', false);
}
