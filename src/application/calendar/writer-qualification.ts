import { createHash } from 'node:crypto';

import type {
  CalendarEventFields,
  CalendarMutationIntent,
  CalendarOwnership,
} from '../../contracts/v1/calendar.js';
import type { IsoInstant, OpaqueId } from '../../contracts/v1/common.js';
import { contractVersion } from '../../contracts/v1/common.js';
import { calendarOwnershipMarker } from '../../config/google-calendar.js';
import { epoch, stableSerialize } from '../../domain/pure-values.js';
import {
  hasExactKeys,
  isIanaTimeZone,
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
  type CalendarWriterObservedEvent,
} from '../../ports/calendar-mutation-transport.js';
import { calendarProjectionDescription } from './projection-policy.js';

export interface CalendarWriterExecutionManifest {
  readonly version: 1;
  readonly kind: 'calendar-writer-execution-approval';
  readonly environment: CalendarWriterExecutionEnvironment;
  readonly approvalId: OpaqueId;
  readonly scopeId: OpaqueId;
  readonly calendarReferenceHash: string;
  readonly auditFingerprint: string;
  readonly intentSetFingerprint: string;
  readonly allowedIntentIds: readonly OpaqueId[];
  readonly issuedAt: IsoInstant;
  readonly expiresAt: IsoInstant;
}

export type CalendarWriterExecutionEnvironment =
  'non-production' | 'production-trial' | 'parallel-canary';

export interface CalendarWriterQualificationOptions {
  readonly environment: CalendarWriterExecutionEnvironment;
  readonly calendarId: string;
  readonly scopeId: OpaqueId;
  readonly auditFingerprint: string;
  readonly intents: readonly CalendarMutationIntent[];
  readonly manifest: CalendarWriterExecutionManifest;
  readonly leaseId: OpaqueId;
  readonly ownerId: OpaqueId;
  readonly leaseDurationSeconds: number;
  readonly requestTimeoutMs: number;
  readonly clock: () => IsoInstant;
  readonly signal: AbortSignal;
  readonly state: CalendarExecutionStatePort;
  readonly transport: CalendarMutationTransport;
}

export interface CalendarWriterExecutionEvidence {
  readonly executionFingerprint: string;
  readonly manifestFingerprint: string;
  readonly status: 'succeeded' | 'failed' | 'refused';
  readonly code:
    | 'calendar-write-qualified'
    | 'calendar-write-replayed'
    | 'calendar-write-input-invalid'
    | 'calendar-write-approval-invalid'
    | 'calendar-write-lease-conflict'
    | 'calendar-write-aborted'
    | 'calendar-write-ownership-refused'
    | 'calendar-write-state-unavailable'
    | CalendarMutationTransportError['code'];
  readonly attemptedExternalMutations: number;
  readonly completedExternalMutations: number;
  readonly stepCounts: {
    readonly noOp: number;
    readonly mutated: number;
    readonly alreadyConverged: number;
    readonly refused: number;
  };
}

const sha256Pattern = /^sha256:[a-f0-9]{64}$/u;
const maximumIntents = 100;

export function hashCalendarReference(calendarId: string): string {
  return digest(calendarId);
}

export function hashCalendarProviderReference(
  eventReference: OpaqueId,
): string {
  return digest(eventReference);
}

export function fingerprintCalendarIntentSet(
  intents: readonly CalendarMutationIntent[],
): string {
  return digest(
    [...intents].sort((left, right) =>
      left.intentId.localeCompare(right.intentId),
    ),
  );
}

export function fingerprintCalendarExecutionManifest(
  manifest: CalendarWriterExecutionManifest,
): string {
  return digest(manifest);
}

/** Google event IDs accept lowercase base32hex; a SHA-256 hex digest is valid. */
export function providerEventIdForIntent(intentId: OpaqueId): OpaqueId {
  return `ch${createHash('sha256').update(intentId).digest('hex')}`;
}

/**
 * Executes only an exact, short-lived approval for the caller's explicit
 * environment. Production-trial callers must remain isolated behind their own
 * stronger adoption and operational preflight boundary.
 */
export async function executeCalendarWriterQualification(
  options: CalendarWriterQualificationOptions,
): Promise<CalendarWriterExecutionEvidence> {
  const manifestFingerprint = safeManifestFingerprint(options.manifest);
  const intentSetFingerprint = safeIntentSetFingerprint(options.intents);
  const executionFingerprint = digest({
    manifestFingerprint,
    intentSetFingerprint: intentSetFingerprint ?? 'invalid-intent-set',
  });
  const emptyCounts = stepCounts([]);
  const refuse = (
    code: CalendarWriterExecutionEvidence['code'],
  ): CalendarWriterExecutionEvidence => ({
    executionFingerprint,
    manifestFingerprint,
    status: 'refused',
    code,
    attemptedExternalMutations: 0,
    completedExternalMutations: 0,
    stepCounts: emptyCounts,
  });

  const now = safeNow(options.clock);
  if (
    intentSetFingerprint === undefined ||
    !safeBoolean(() => validExecutionInput(options, now))
  )
    return refuse('calendar-write-input-invalid');
  if (
    !safeBoolean(() =>
      validManifestForExecution(options, now, intentSetFingerprint),
    )
  )
    return refuse('calendar-write-approval-invalid');
  if (options.signal.aborted) return refuse('calendar-write-aborted');

  let existing: CalendarExecutionJournalRecord | undefined;
  try {
    existing = await options.state.loadExecution(executionFingerprint);
  } catch {
    return refuse('calendar-write-state-unavailable');
  }
  if (
    existing !== undefined &&
    !safeBoolean(() =>
      journalMatches(
        existing!,
        options,
        executionFingerprint,
        manifestFingerprint,
      ),
    )
  )
    return refuse('calendar-write-state-unavailable');
  if (existing?.status === 'succeeded') {
    return {
      executionFingerprint,
      manifestFingerprint,
      status: 'succeeded',
      code: 'calendar-write-replayed',
      attemptedExternalMutations: 0,
      completedExternalMutations: 0,
      stepCounts: stepCounts(existing.steps),
    };
  }

  const expiresAt = new Date(
    epoch(now)! + options.leaseDurationSeconds * 1_000,
  ).toISOString();
  try {
    const lease = await options.state.acquireLease({
      scopeId: options.scopeId,
      leaseId: options.leaseId,
      ownerId: options.ownerId,
      now,
      expiresAt,
    });
    if (lease.status === 'conflict')
      return refuse('calendar-write-lease-conflict');
  } catch {
    return refuse('calendar-write-state-unavailable');
  }

  let attemptedExternalMutations = 0;
  let completedExternalMutations = 0;
  let currentSteps = existing?.steps ?? [];
  try {
    if (existing === undefined) {
      existing = {
        executionFingerprint,
        manifestFingerprint,
        scopeId: options.scopeId,
        status: 'running',
        startedAt: now,
        steps: [],
      };
      await options.state.beginExecution(existing);
    } else if (existing.status === 'failed') {
      await options.state.resumeExecution({ executionFingerprint });
    }

    for (const intent of orderedIntents(options.intents)) {
      const prior = currentSteps.find(
        (step) => step.intentId === intent.intentId,
      );
      if (prior?.status === 'succeeded') continue;
      if (options.signal.aborted)
        return await failExecution(
          options,
          executionFingerprint,
          manifestFingerprint,
          currentSteps,
          attemptedExternalMutations,
          completedExternalMutations,
          'calendar-write-aborted',
        );

      if (intent.kind === 'no-op') {
        const step: CalendarExecutionStepRecord = {
          intentId: intent.intentId,
          intentKind: intent.kind,
          status: 'succeeded',
          outcome: 'no-op',
          providerReferenceHash: digest(intent.existingEventReference),
        };
        await options.state.recordStep({ executionFingerprint, step });
        currentSteps = replaceStep(currentSteps, step);
        continue;
      }

      let convergence: Convergence;
      try {
        convergence = await inspectConvergence(options, intent);
      } catch (error: unknown) {
        const classified = classifyMutationError(error, options.signal);
        const step: CalendarExecutionStepRecord = {
          intentId: intent.intentId,
          intentKind: intent.kind,
          status: 'failed',
          outcome: 'refused',
          errorCode: classified.code,
          providerReferenceHash: digest(eventReferenceForIntent(intent)),
        };
        await options.state.recordStep({ executionFingerprint, step });
        currentSteps = replaceStep(currentSteps, step);
        return await failExecution(
          options,
          executionFingerprint,
          manifestFingerprint,
          currentSteps,
          attemptedExternalMutations,
          completedExternalMutations,
          classified.code,
        );
      }
      if (convergence.status === 'refused') {
        const step: CalendarExecutionStepRecord = {
          intentId: intent.intentId,
          intentKind: intent.kind,
          status: 'failed',
          outcome: 'refused',
          errorCode: 'calendar-write-ownership-refused',
          providerReferenceHash: digest(convergence.eventReference),
        };
        await options.state.recordStep({ executionFingerprint, step });
        currentSteps = replaceStep(currentSteps, step);
        return await failExecution(
          options,
          executionFingerprint,
          manifestFingerprint,
          currentSteps,
          attemptedExternalMutations,
          completedExternalMutations,
          'calendar-write-ownership-refused',
        );
      }
      if (convergence.status === 'converged') {
        const step: CalendarExecutionStepRecord = {
          intentId: intent.intentId,
          intentKind: intent.kind,
          status: 'succeeded',
          outcome:
            prior?.status === 'attempted' || prior?.status === 'failed'
              ? 'mutated'
              : 'already-converged',
          providerReferenceHash: digest(convergence.eventReference),
        };
        await options.state.recordStep({ executionFingerprint, step });
        currentSteps = replaceStep(currentSteps, step);
        continue;
      }

      const attempted: CalendarExecutionStepRecord = {
        intentId: intent.intentId,
        intentKind: intent.kind,
        status: 'attempted',
        providerReferenceHash: digest(convergence.eventReference),
      };
      await options.state.recordStep({ executionFingerprint, step: attempted });
      currentSteps = replaceStep(currentSteps, attempted);
      attemptedExternalMutations += 1;
      try {
        const application = await applyMutation(options, intent, convergence);
        completedExternalMutations += 1;
        if (application === 'response-invalid')
          throw new CalendarMutationTransportError(
            'calendar-write-unavailable',
            false,
          );
      } catch (error: unknown) {
        const classified = classifyMutationError(error, options.signal);
        const failed: CalendarExecutionStepRecord = {
          ...attempted,
          status: 'failed',
          outcome: 'refused',
          errorCode: classified.code,
        };
        await options.state.recordStep({ executionFingerprint, step: failed });
        currentSteps = replaceStep(currentSteps, failed);
        return await failExecution(
          options,
          executionFingerprint,
          manifestFingerprint,
          currentSteps,
          attemptedExternalMutations,
          completedExternalMutations,
          classified.code,
        );
      }
      const succeeded: CalendarExecutionStepRecord = {
        ...attempted,
        status: 'succeeded',
        outcome: 'mutated',
      };
      await options.state.recordStep({ executionFingerprint, step: succeeded });
      currentSteps = replaceStep(currentSteps, succeeded);
    }

    await options.state.finishExecution({
      executionFingerprint,
      status: 'succeeded',
      finishedAt: safeNow(options.clock),
    });
    return {
      executionFingerprint,
      manifestFingerprint,
      status: 'succeeded',
      code: 'calendar-write-qualified',
      attemptedExternalMutations,
      completedExternalMutations,
      stepCounts: stepCounts(currentSteps),
    };
  } catch {
    return {
      executionFingerprint,
      manifestFingerprint,
      status: 'failed',
      code: 'calendar-write-state-unavailable',
      attemptedExternalMutations,
      completedExternalMutations,
      stepCounts: stepCounts(currentSteps),
    };
  } finally {
    try {
      await options.state.releaseLease({
        scopeId: options.scopeId,
        leaseId: options.leaseId,
        ownerId: options.ownerId,
      });
    } catch {
      // A release failure leaves the finite lease to expire; it never widens authority.
    }
  }
}

type Convergence =
  | { readonly status: 'converged'; readonly eventReference: OpaqueId }
  | {
      readonly status: 'mutation-required';
      readonly eventReference: OpaqueId;
      readonly existing?: CalendarWriterObservedEvent;
    }
  | { readonly status: 'refused'; readonly eventReference: OpaqueId };

function eventReferenceForIntent(
  intent: Exclude<CalendarMutationIntent, { readonly kind: 'no-op' }>,
): OpaqueId {
  return intent.kind === 'create'
    ? providerEventIdForIntent(intent.intentId)
    : intent.existingEventReference;
}

async function inspectConvergence(
  options: CalendarWriterQualificationOptions,
  intent: Exclude<CalendarMutationIntent, { readonly kind: 'no-op' }>,
): Promise<Convergence> {
  const eventReference = eventReferenceForIntent(intent);
  const observed = await options.transport.getEvent({
    calendarId: options.calendarId,
    eventReference,
    timeoutMs: options.requestTimeoutMs,
    signal: options.signal,
  });
  if (intent.kind === 'create') {
    if (observed.status === 'not-found')
      return { status: 'mutation-required', eventReference };
    return isExactOwnedCalendarEvent(
      observed.event,
      eventReference,
      intent.ownership,
    ) && sameCalendarEventFields(observed.event, intent.desired)
      ? { status: 'converged', eventReference }
      : { status: 'refused', eventReference };
  }
  if (intent.kind === 'delete') {
    if (observed.status === 'not-found')
      return { status: 'converged', eventReference };
    return isExactOwnedCalendarEvent(
      observed.event,
      eventReference,
      intent.ownership,
    )
      ? {
          status: 'mutation-required',
          eventReference,
          existing: observed.event,
        }
      : { status: 'refused', eventReference };
  }
  if (observed.status === 'not-found')
    return { status: 'refused', eventReference };
  if (
    !isExactOwnedCalendarEvent(observed.event, eventReference, intent.ownership)
  )
    return { status: 'refused', eventReference };
  return sameCalendarEventFields(observed.event, intent.desired)
    ? { status: 'converged', eventReference }
    : { status: 'mutation-required', eventReference, existing: observed.event };
}

async function applyMutation(
  options: CalendarWriterQualificationOptions,
  intent: Exclude<CalendarMutationIntent, { readonly kind: 'no-op' }>,
  convergence: Extract<Convergence, { readonly status: 'mutation-required' }>,
): Promise<'completed' | 'response-invalid'> {
  if (options.signal.aborted)
    throw new CalendarMutationTransportError('calendar-write-timeout', true);
  if (intent.kind === 'create') {
    const created = await options.transport.insertEvent({
      calendarId: options.calendarId,
      eventReference: convergence.eventReference,
      desired: intent.desired,
      ownership: intent.ownership,
      sendUpdates: 'none',
      timeoutMs: options.requestTimeoutMs,
      signal: options.signal,
    });
    return !(
      !isExactOwnedCalendarEvent(
        created,
        convergence.eventReference,
        intent.ownership,
      ) || !sameCalendarEventFields(created, intent.desired)
    )
      ? 'completed'
      : 'response-invalid';
  }
  if (convergence.existing === undefined)
    throw new CalendarMutationTransportError('calendar-write-conflict', false);
  if (intent.kind === 'replace') {
    const updated = await options.transport.updateEvent({
      calendarId: options.calendarId,
      eventReference: convergence.eventReference,
      expectedEtag: convergence.existing.etag,
      desired: intent.desired,
      ownership: intent.ownership,
      sendUpdates: 'none',
      timeoutMs: options.requestTimeoutMs,
      signal: options.signal,
    });
    return !(
      !isExactOwnedCalendarEvent(
        updated,
        convergence.eventReference,
        intent.ownership,
      ) || !sameCalendarEventFields(updated, intent.desired)
    )
      ? 'completed'
      : 'response-invalid';
  }
  await options.transport.deleteEvent({
    calendarId: options.calendarId,
    eventReference: convergence.eventReference,
    expectedEtag: convergence.existing.etag,
    ownership: intent.ownership,
    sendUpdates: 'none',
    timeoutMs: options.requestTimeoutMs,
    signal: options.signal,
  });
  return 'completed';
}

async function failExecution(
  options: CalendarWriterQualificationOptions,
  executionFingerprint: string,
  manifestFingerprint: string,
  steps: readonly CalendarExecutionStepRecord[],
  attemptedExternalMutations: number,
  completedExternalMutations: number,
  code: CalendarWriterExecutionEvidence['code'],
): Promise<CalendarWriterExecutionEvidence> {
  try {
    await options.state.finishExecution({
      executionFingerprint,
      status: 'failed',
      finishedAt: safeNow(options.clock),
    });
  } catch {
    code = 'calendar-write-state-unavailable';
  }
  return {
    executionFingerprint,
    manifestFingerprint,
    status: 'failed',
    code,
    attemptedExternalMutations,
    completedExternalMutations,
    stepCounts: stepCounts(steps),
  };
}

function validExecutionInput(
  options: CalendarWriterQualificationOptions,
  now: string,
): boolean {
  if (
    options.calendarId === 'primary' ||
    !/^[A-Za-z0-9][A-Za-z0-9._@-]{0,511}$/u.test(options.calendarId) ||
    !boundedId(options.scopeId) ||
    !boundedId(options.leaseId) ||
    !boundedId(options.ownerId) ||
    !sha256Pattern.test(options.auditFingerprint) ||
    !isIsoInstant(now) ||
    !Number.isSafeInteger(options.leaseDurationSeconds) ||
    options.leaseDurationSeconds < 5 ||
    options.leaseDurationSeconds > 900 ||
    !Number.isSafeInteger(options.requestTimeoutMs) ||
    options.requestTimeoutMs < 1_000 ||
    options.requestTimeoutMs > 60_000 ||
    !Array.isArray(options.intents) ||
    options.intents.length < 1 ||
    options.intents.length > maximumIntents ||
    options.leaseDurationSeconds * 1_000 <
      options.intents.length * options.requestTimeoutMs * 2 + 5_000 ||
    !options.intents.every((intent) => validIntent(intent, options.scopeId))
  )
    return false;
  const ids = options.intents.map((intent) => intent.intentId);
  const planIds = new Set(options.intents.map((intent) => intent.planId));
  const eventReferences = options.intents.map((intent) =>
    intent.kind === 'create'
      ? providerEventIdForIntent(intent.intentId)
      : intent.existingEventReference,
  );
  return (
    new Set(ids).size === ids.length &&
    planIds.size === 1 &&
    new Set(eventReferences).size === eventReferences.length
  );
}

function validManifestForExecution(
  options: CalendarWriterQualificationOptions,
  now: string,
  intentSetFingerprint: string,
): boolean {
  const manifest = options.manifest;
  if (
    !isPlainObject(manifest) ||
    !hasExactKeys(manifest, [
      'version',
      'kind',
      'environment',
      'approvalId',
      'scopeId',
      'calendarReferenceHash',
      'auditFingerprint',
      'intentSetFingerprint',
      'allowedIntentIds',
      'issuedAt',
      'expiresAt',
    ]) ||
    manifest.version !== 1 ||
    manifest.kind !== 'calendar-writer-execution-approval' ||
    (options.environment !== 'non-production' &&
      options.environment !== 'production-trial' &&
      options.environment !== 'parallel-canary') ||
    manifest.environment !== options.environment ||
    !boundedId(manifest.approvalId) ||
    manifest.scopeId !== options.scopeId ||
    manifest.calendarReferenceHash !==
      hashCalendarReference(options.calendarId) ||
    manifest.auditFingerprint !== options.auditFingerprint ||
    manifest.intentSetFingerprint !== intentSetFingerprint ||
    !Array.isArray(manifest.allowedIntentIds) ||
    manifest.allowedIntentIds.some((value) => !boundedIntentId(value)) ||
    new Set(manifest.allowedIntentIds).size !==
      manifest.allowedIntentIds.length ||
    !isIsoInstant(manifest.issuedAt) ||
    !isIsoInstant(manifest.expiresAt)
  )
    return false;
  const approved = [...manifest.allowedIntentIds].sort();
  const actual = options.intents.map((intent) => intent.intentId).sort();
  const issued = epoch(manifest.issuedAt);
  const expires = epoch(manifest.expiresAt);
  const current = epoch(now);
  return (
    stableSerialize(approved) === stableSerialize(actual) &&
    issued !== undefined &&
    expires !== undefined &&
    current !== undefined &&
    issued <= current &&
    current < expires &&
    expires - issued <= 30 * 60_000
  );
}

function validIntent(intent: CalendarMutationIntent, scopeId: string): boolean {
  if (
    !isPlainObject(intent) ||
    intent.contractVersion !== contractVersion ||
    !boundedIntentId(intent.intentId) ||
    !boundedId(intent.planId) ||
    intent.notifyAttendees !== false
  )
    return false;
  if (intent.kind === 'no-op')
    return (
      hasExactKeys(intent, [
        'contractVersion',
        'intentId',
        'planId',
        'notifyAttendees',
        'kind',
        'existingEventReference',
        'reason',
      ]) &&
      boundedId(intent.existingEventReference, 1_024) &&
      intent.reason === 'semantic-match'
    );
  const required = [
    'contractVersion',
    'intentId',
    'planId',
    'notifyAttendees',
    'kind',
    'ownership',
  ];
  if (!validOwnership(intent.ownership, scopeId)) return false;
  if (intent.kind === 'create')
    return (
      hasExactKeys(intent, [...required, 'desired']) &&
      validFields(intent.desired)
    );
  if (intent.kind === 'replace')
    return (
      hasExactKeys(intent, [
        ...required,
        'existingEventReference',
        'desired',
      ]) &&
      boundedId(intent.existingEventReference, 1_024) &&
      validFields(intent.desired)
    );
  return (
    hasExactKeys(intent, [...required, 'existingEventReference', 'reason']) &&
    boundedId(intent.existingEventReference, 1_024) &&
    (intent.reason === 'obsolete-owned-event' ||
      intent.reason === 'replace-owned-event')
  );
}

function validOwnership(value: unknown, scopeId: string): boolean {
  return (
    isPlainObject(value) &&
    hasExactKeys(value, ['classification', 'scopeId', 'ownershipMarker']) &&
    value.classification === 'verified-application-owned' &&
    value.scopeId === scopeId &&
    value.ownershipMarker === calendarOwnershipMarker
  );
}

function validFields(value: CalendarEventFields, exactShape = true): boolean {
  const start = epoch(value.startsAt);
  const end = epoch(value.endsAt);
  return (
    isPlainObject(value) &&
    (!exactShape ||
      hasExactKeys(value, [
        'summary',
        'description',
        'startsAt',
        'endsAt',
        'timeZone',
      ])) &&
    validSummary(value.summary) &&
    value.description === calendarProjectionDescription &&
    isIsoInstant(value.startsAt) &&
    isIsoInstant(value.endsAt) &&
    start !== undefined &&
    end !== undefined &&
    start < end &&
    isIanaTimeZone(value.timeZone)
  );
}

function validSummary(value: string): boolean {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= 256 &&
    value.trim() === value &&
    value.normalize('NFC') === value &&
    !/[\p{Cc}\p{Cs}\p{Zl}\p{Zp}]/u.test(value)
  );
}

export function isExactOwnedCalendarEvent(
  event: CalendarWriterObservedEvent,
  eventReference: string,
  ownership: CalendarOwnership,
): boolean {
  return (
    isPlainObject(event) &&
    hasExactKeys(event, [
      'eventReference',
      'etag',
      'ownership',
      'summary',
      'description',
      'startsAt',
      'endsAt',
      'timeZone',
    ]) &&
    event.eventReference === eventReference &&
    boundedEtag(event.etag) &&
    validObservedOwnership(event.ownership, ownership) &&
    validObservedFields(event)
  );
}

function validObservedFields(value: CalendarEventFields): boolean {
  const start = epoch(value.startsAt);
  const end = epoch(value.endsAt);
  return (
    isPlainObject(value) &&
    validSummary(value.summary) &&
    typeof value.description === 'string' &&
    Buffer.byteLength(value.description, 'utf8') <= 1_024 &&
    value.description.normalize('NFC') === value.description &&
    !/[\p{Cc}\p{Cs}\p{Zl}\p{Zp}]/u.test(value.description) &&
    isIsoInstant(value.startsAt) &&
    isIsoInstant(value.endsAt) &&
    start !== undefined &&
    end !== undefined &&
    start < end &&
    isIanaTimeZone(value.timeZone)
  );
}

function validObservedOwnership(
  value: unknown,
  expected: CalendarOwnership,
): boolean {
  return (
    isPlainObject(value) &&
    hasExactKeys(value, ['owner', 'scopeId', 'ownershipMarker']) &&
    value.owner === 'classroom-hub' &&
    value.scopeId === expected.scopeId &&
    value.ownershipMarker === expected.ownershipMarker
  );
}

export function sameCalendarEventFields(
  observed: CalendarEventFields,
  desired: CalendarEventFields,
): boolean {
  return (
    stableSerialize({
      summary: observed.summary,
      description: observed.description,
      startsAt: observed.startsAt,
      endsAt: observed.endsAt,
      timeZone: observed.timeZone,
    }) === stableSerialize(desired)
  );
}

function stepCounts(
  steps: readonly CalendarExecutionStepRecord[],
): CalendarWriterExecutionEvidence['stepCounts'] {
  const succeeded = steps.filter((step) => step.status === 'succeeded');
  return {
    noOp: succeeded.filter((step) => step.outcome === 'no-op').length,
    mutated: succeeded.filter((step) => step.outcome === 'mutated').length,
    alreadyConverged: succeeded.filter(
      (step) => step.outcome === 'already-converged',
    ).length,
    refused: steps.filter((step) => step.outcome === 'refused').length,
  };
}

function journalMatches(
  journal: CalendarExecutionJournalRecord,
  options: CalendarWriterQualificationOptions,
  executionFingerprint: string,
  manifestFingerprint: string,
): boolean {
  const expected = new Map(
    options.intents.map((intent) => [intent.intentId, intent.kind]),
  );
  if (
    !validJournalRecord(journal, executionFingerprint) ||
    journal.manifestFingerprint !== manifestFingerprint ||
    journal.scopeId !== options.scopeId ||
    new Set(journal.steps.map((step) => step.intentId)).size !==
      journal.steps.length ||
    journal.steps.some(
      (step) =>
        expected.get(step.intentId) !== step.intentKind ||
        !validJournalStep(step),
    )
  )
    return false;
  return journal.status !== 'succeeded'
    ? true
    : journal.steps.length === expected.size &&
        journal.steps.every(
          (step) =>
            step.status === 'succeeded' &&
            (step.intentKind === 'no-op'
              ? step.outcome === 'no-op'
              : step.outcome === 'mutated' ||
                step.outcome === 'already-converged'),
        );
}

function validJournalRecord(
  journal: CalendarExecutionJournalRecord,
  executionFingerprint: string,
): boolean {
  if (!isPlainObject(journal) || !Array.isArray(journal.steps)) return false;
  const terminal =
    journal.status === 'succeeded' || journal.status === 'failed';
  return (
    hasExactKeys(
      journal,
      terminal
        ? [
            'executionFingerprint',
            'manifestFingerprint',
            'scopeId',
            'status',
            'startedAt',
            'finishedAt',
            'steps',
          ]
        : [
            'executionFingerprint',
            'manifestFingerprint',
            'scopeId',
            'status',
            'startedAt',
            'steps',
          ],
    ) &&
    journal.executionFingerprint === executionFingerprint &&
    sha256Pattern.test(journal.executionFingerprint) &&
    sha256Pattern.test(journal.manifestFingerprint) &&
    boundedId(journal.scopeId) &&
    (terminal || journal.status === 'running') &&
    isIsoInstant(journal.startedAt) &&
    (!terminal || isIsoInstant(journal.finishedAt))
  );
}

function validJournalStep(step: CalendarExecutionStepRecord): boolean {
  if (
    !isPlainObject(step) ||
    !boundedIntentId(step.intentId) ||
    !['no-op', 'create', 'replace', 'delete'].includes(step.intentKind) ||
    !sha256Pattern.test(step.providerReferenceHash ?? '')
  )
    return false;
  if (step.status === 'attempted')
    return hasExactKeys(step, [
      'intentId',
      'intentKind',
      'status',
      'providerReferenceHash',
    ]);
  if (step.status === 'failed')
    return (
      hasExactKeys(step, [
        'intentId',
        'intentKind',
        'status',
        'outcome',
        'providerReferenceHash',
        'errorCode',
      ]) &&
      step.outcome === 'refused' &&
      boundedId(step.errorCode, 128)
    );
  return (
    step.status === 'succeeded' &&
    hasExactKeys(step, [
      'intentId',
      'intentKind',
      'status',
      'outcome',
      'providerReferenceHash',
    ]) &&
    (step.outcome === 'no-op' ||
      step.outcome === 'mutated' ||
      step.outcome === 'already-converged')
  );
}

function replaceStep(
  steps: readonly CalendarExecutionStepRecord[],
  replacement: CalendarExecutionStepRecord,
): readonly CalendarExecutionStepRecord[] {
  return [
    ...steps.filter((step) => step.intentId !== replacement.intentId),
    replacement,
  ];
}

function orderedIntents(
  intents: readonly CalendarMutationIntent[],
): readonly CalendarMutationIntent[] {
  const priority: Readonly<Record<CalendarMutationIntent['kind'], number>> = {
    'no-op': 0,
    create: 1,
    replace: 2,
    delete: 3,
  };
  return [...intents].sort(
    (left, right) =>
      priority[left.kind] - priority[right.kind] ||
      left.intentId.localeCompare(right.intentId),
  );
}

function classifyMutationError(
  error: unknown,
  signal: AbortSignal,
): CalendarMutationTransportError {
  if (error instanceof CalendarMutationTransportError) return error;
  return new CalendarMutationTransportError(
    signal.aborted ? 'calendar-write-timeout' : 'calendar-write-unavailable',
    signal.aborted,
  );
}

function safeManifestFingerprint(
  manifest: CalendarWriterExecutionManifest,
): string {
  try {
    return fingerprintCalendarExecutionManifest(manifest);
  } catch {
    return digest('invalid-manifest');
  }
}

function safeIntentSetFingerprint(
  intents: readonly CalendarMutationIntent[],
): string | undefined {
  try {
    return Array.isArray(intents)
      ? fingerprintCalendarIntentSet(intents)
      : undefined;
  } catch {
    return undefined;
  }
}

function safeBoolean(check: () => boolean): boolean {
  try {
    return check();
  } catch {
    return false;
  }
}

function safeNow(clock: () => string): string {
  try {
    const value = clock();
    return isIsoInstant(value) ? value : '1970-01-01T00:00:00.000Z';
  } catch {
    return '1970-01-01T00:00:00.000Z';
  }
}

function boundedId(value: unknown, maximum = 128): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= maximum &&
    !/[\0\r\n]/u.test(value)
  );
}

function boundedIntentId(value: unknown): value is string {
  return boundedId(value, 512);
}

function boundedEtag(value: unknown): value is string {
  return boundedId(value, 512);
}

function digest(value: unknown): string {
  return `sha256:${createHash('sha256').update(stableSerialize(value)).digest('hex')}`;
}
