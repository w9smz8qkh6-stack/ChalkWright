import { createHash } from 'node:crypto';

import type {
  CalendarMutationIntent,
  CalendarOwnership,
} from '../../contracts/v1/calendar.js';
import type { IsoInstant, OpaqueId } from '../../contracts/v1/common.js';
import { epoch, stableSerialize } from '../../domain/pure-values.js';
import {
  hasExactKeys,
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
import {
  planCalendarRollback,
  type CalendarRollbackAction,
  type CalendarRollbackSnapshot,
} from './rollback-planner.js';
import {
  hashCalendarReference,
  isExactOwnedCalendarEvent,
  sameCalendarEventFields,
  type CalendarWriterExecutionEnvironment,
} from './writer-qualification.js';

export interface CalendarRollbackExecutionManifest {
  readonly version: 1;
  readonly kind: 'calendar-writer-rollback-approval';
  readonly environment: CalendarWriterExecutionEnvironment;
  readonly approvalId: OpaqueId;
  readonly scopeId: OpaqueId;
  readonly calendarReferenceHash: string;
  readonly sourceExecutionFingerprint: string;
  readonly rollbackEvidenceFingerprint: string;
  readonly actionSetFingerprint: string;
  readonly allowedRollbackIds: readonly OpaqueId[];
  readonly issuedAt: IsoInstant;
  readonly expiresAt: IsoInstant;
}

export interface CalendarRollbackQualificationOptions {
  readonly environment: CalendarWriterExecutionEnvironment;
  readonly calendarId: string;
  readonly scopeId: OpaqueId;
  readonly sourceExecutionFingerprint: string;
  readonly intents: readonly CalendarMutationIntent[];
  readonly steps: readonly CalendarExecutionStepRecord[];
  readonly beforeSnapshots: readonly CalendarRollbackSnapshot[];
  readonly manifest: CalendarRollbackExecutionManifest;
  readonly leaseId: OpaqueId;
  readonly ownerId: OpaqueId;
  readonly leaseDurationSeconds: number;
  readonly requestTimeoutMs: number;
  readonly clock: () => IsoInstant;
  readonly signal: AbortSignal;
  readonly state: CalendarExecutionStatePort;
  readonly transport: CalendarMutationTransport;
}

export interface CalendarRollbackExecutionEvidence {
  readonly executionFingerprint: string;
  readonly manifestFingerprint: string;
  readonly status: 'succeeded' | 'failed' | 'refused';
  readonly code:
    | 'calendar-rollback-qualified'
    | 'calendar-rollback-replayed'
    | 'calendar-rollback-input-invalid'
    | 'calendar-rollback-approval-invalid'
    | 'calendar-rollback-lease-conflict'
    | 'calendar-rollback-aborted'
    | 'calendar-rollback-ownership-refused'
    | 'calendar-rollback-state-unavailable'
    | CalendarMutationTransportError['code'];
  readonly attemptedExternalMutations: number;
  readonly completedExternalMutations: number;
  readonly stepCounts: {
    readonly mutated: number;
    readonly alreadyConverged: number;
    readonly refused: number;
  };
}

const sha256Pattern = /^sha256:[a-f0-9]{64}$/u;

export function fingerprintCalendarRollbackActions(
  actions: readonly CalendarRollbackAction[],
): string {
  return digest(
    [...actions].sort((left, right) =>
      left.rollbackId.localeCompare(right.rollbackId),
    ),
  );
}

export function fingerprintCalendarRollbackManifest(
  manifest: CalendarRollbackExecutionManifest,
): string {
  return digest(manifest);
}

/**
 * Applies only an exact inverse plan derived again from the original sanitized
 * execution evidence. No operational entry point constructs this capability.
 */
export async function executeCalendarRollbackQualification(
  options: CalendarRollbackQualificationOptions,
): Promise<CalendarRollbackExecutionEvidence> {
  const plan = safePlan(options);
  const manifestFingerprint = safeManifestFingerprint(options.manifest);
  const actionSetFingerprint =
    plan?.status === 'ready'
      ? safeActionSetFingerprint(plan.actions)
      : undefined;
  const executionFingerprint = digest({
    manifestFingerprint,
    actionSetFingerprint: actionSetFingerprint ?? 'invalid-action-set',
  });
  const refuse = (
    code: CalendarRollbackExecutionEvidence['code'],
  ): CalendarRollbackExecutionEvidence => ({
    executionFingerprint,
    manifestFingerprint,
    status: 'refused',
    code,
    attemptedExternalMutations: 0,
    completedExternalMutations: 0,
    stepCounts: counts([]),
  });

  const now = safeNow(options.clock);
  if (
    plan?.status !== 'ready' ||
    plan.actions.length < 1 ||
    actionSetFingerprint === undefined ||
    !safeBoolean(() => validInput(options, plan.actions, now))
  )
    return refuse('calendar-rollback-input-invalid');
  if (
    !safeBoolean(() =>
      validManifest(options, plan.fingerprint, actionSetFingerprint, now),
    )
  )
    return refuse('calendar-rollback-approval-invalid');
  if (options.signal.aborted) return refuse('calendar-rollback-aborted');

  let existing: CalendarExecutionJournalRecord | undefined;
  try {
    existing = await options.state.loadExecution(executionFingerprint);
  } catch {
    return refuse('calendar-rollback-state-unavailable');
  }
  if (
    existing !== undefined &&
    !safeBoolean(() =>
      journalMatches(
        existing!,
        plan.actions,
        options.scopeId,
        executionFingerprint,
        manifestFingerprint,
      ),
    )
  )
    return refuse('calendar-rollback-state-unavailable');
  if (existing?.status === 'succeeded') {
    return {
      executionFingerprint,
      manifestFingerprint,
      status: 'succeeded',
      code: 'calendar-rollback-replayed',
      attemptedExternalMutations: 0,
      completedExternalMutations: 0,
      stepCounts: counts(existing.steps),
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
      return refuse('calendar-rollback-lease-conflict');
  } catch {
    return refuse('calendar-rollback-state-unavailable');
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

    for (const action of orderedActions(plan.actions)) {
      const prior = currentSteps.find(
        (step) => step.intentId === action.rollbackId,
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
          'calendar-rollback-aborted',
        );

      let convergence: RollbackConvergence;
      try {
        convergence = await inspectConvergence(options, action);
      } catch (error: unknown) {
        const classified = classifyMutationError(error, options.signal);
        const failed = failedStep(action, classified.code);
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
      if (convergence.status === 'refused') {
        const failed = failedStep(
          action,
          'calendar-rollback-ownership-refused',
        );
        await options.state.recordStep({ executionFingerprint, step: failed });
        currentSteps = replaceStep(currentSteps, failed);
        return await failExecution(
          options,
          executionFingerprint,
          manifestFingerprint,
          currentSteps,
          attemptedExternalMutations,
          completedExternalMutations,
          'calendar-rollback-ownership-refused',
        );
      }
      if (convergence.status === 'converged') {
        const succeeded: CalendarExecutionStepRecord = {
          intentId: action.rollbackId,
          intentKind: rollbackIntentKind(action),
          status: 'succeeded',
          outcome: 'already-converged',
          providerReferenceHash: digest(action.eventReference),
        };
        await options.state.recordStep({
          executionFingerprint,
          step: succeeded,
        });
        currentSteps = replaceStep(currentSteps, succeeded);
        continue;
      }

      const attempted: CalendarExecutionStepRecord = {
        intentId: action.rollbackId,
        intentKind: rollbackIntentKind(action),
        status: 'attempted',
        providerReferenceHash: digest(action.eventReference),
      };
      await options.state.recordStep({ executionFingerprint, step: attempted });
      currentSteps = replaceStep(currentSteps, attempted);
      attemptedExternalMutations += 1;
      try {
        const response = await applyRollback(options, action, convergence);
        completedExternalMutations += 1;
        if (response === 'response-invalid')
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
      code: 'calendar-rollback-qualified',
      attemptedExternalMutations,
      completedExternalMutations,
      stepCounts: counts(currentSteps),
    };
  } catch {
    return {
      executionFingerprint,
      manifestFingerprint,
      status: 'failed',
      code: 'calendar-rollback-state-unavailable',
      attemptedExternalMutations,
      completedExternalMutations,
      stepCounts: counts(currentSteps),
    };
  } finally {
    try {
      await options.state.releaseLease({
        scopeId: options.scopeId,
        leaseId: options.leaseId,
        ownerId: options.ownerId,
      });
    } catch {
      // A failed release cannot widen authority; the finite lease expires.
    }
  }
}

type RollbackConvergence =
  | { readonly status: 'converged' }
  | { readonly status: 'refused' }
  | {
      readonly status: 'mutation-required';
      readonly existing?: CalendarWriterObservedEvent;
    };

async function inspectConvergence(
  options: CalendarRollbackQualificationOptions,
  action: CalendarRollbackAction,
): Promise<RollbackConvergence> {
  const observed = await options.transport.getEvent({
    calendarId: options.calendarId,
    eventReference: action.eventReference,
    timeoutMs: options.requestTimeoutMs,
    signal: options.signal,
  });
  if (action.kind === 'delete-created') {
    if (observed.status === 'not-found') return { status: 'converged' };
    return isExactOwnedCalendarEvent(
      observed.event,
      action.eventReference,
      action.ownership,
    )
      ? { status: 'mutation-required', existing: observed.event }
      : { status: 'refused' };
  }
  if (observed.status === 'not-found')
    return action.sourceIntentKind === 'delete'
      ? { status: 'mutation-required' }
      : { status: 'refused' };
  if (
    !isExactOwnedCalendarEvent(
      observed.event,
      action.eventReference,
      action.ownership,
    )
  )
    return { status: 'refused' };
  return sameCalendarEventFields(observed.event, action.desired)
    ? { status: 'converged' }
    : { status: 'mutation-required', existing: observed.event };
}

async function applyRollback(
  options: CalendarRollbackQualificationOptions,
  action: CalendarRollbackAction,
  convergence: Extract<
    RollbackConvergence,
    { readonly status: 'mutation-required' }
  >,
): Promise<'completed' | 'response-invalid'> {
  if (options.signal.aborted)
    throw new CalendarMutationTransportError('calendar-write-timeout', true);
  if (action.kind === 'delete-created') {
    if (convergence.existing === undefined)
      throw new CalendarMutationTransportError(
        'calendar-write-conflict',
        false,
      );
    await options.transport.deleteEvent({
      calendarId: options.calendarId,
      eventReference: action.eventReference,
      expectedEtag: convergence.existing.etag,
      ownership: action.ownership,
      sendUpdates: 'none',
      timeoutMs: options.requestTimeoutMs,
      signal: options.signal,
    });
    return 'completed';
  }
  const restored =
    convergence.existing === undefined
      ? await options.transport.insertEvent({
          calendarId: options.calendarId,
          eventReference: action.eventReference,
          desired: action.desired,
          ownership: action.ownership,
          sendUpdates: 'none',
          timeoutMs: options.requestTimeoutMs,
          signal: options.signal,
        })
      : await options.transport.updateEvent({
          calendarId: options.calendarId,
          eventReference: action.eventReference,
          expectedEtag: convergence.existing.etag,
          desired: action.desired,
          ownership: action.ownership,
          sendUpdates: 'none',
          timeoutMs: options.requestTimeoutMs,
          signal: options.signal,
        });
  return isExactOwnedCalendarEvent(
    restored,
    action.eventReference,
    action.ownership,
  ) && sameCalendarEventFields(restored, action.desired)
    ? 'completed'
    : 'response-invalid';
}

function validInput(
  options: CalendarRollbackQualificationOptions,
  actions: readonly CalendarRollbackAction[],
  now: string,
): boolean {
  return (
    options.calendarId !== 'primary' &&
    /^[A-Za-z0-9][A-Za-z0-9._@-]{0,511}$/u.test(options.calendarId) &&
    boundedId(options.scopeId) &&
    boundedId(options.leaseId) &&
    boundedId(options.ownerId) &&
    sha256Pattern.test(options.sourceExecutionFingerprint) &&
    isIsoInstant(now) &&
    Number.isSafeInteger(options.leaseDurationSeconds) &&
    options.leaseDurationSeconds >= 5 &&
    options.leaseDurationSeconds <= 900 &&
    Number.isSafeInteger(options.requestTimeoutMs) &&
    options.requestTimeoutMs >= 1_000 &&
    options.requestTimeoutMs <= 60_000 &&
    actions.length <= 100 &&
    options.leaseDurationSeconds * 1_000 >=
      actions.length * options.requestTimeoutMs * 2 + 5_000 &&
    new Set(actions.map((action) => action.rollbackId)).size === actions.length
  );
}

function validManifest(
  options: CalendarRollbackQualificationOptions,
  rollbackEvidenceFingerprint: string,
  actionSetFingerprint: string,
  now: string,
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
      'sourceExecutionFingerprint',
      'rollbackEvidenceFingerprint',
      'actionSetFingerprint',
      'allowedRollbackIds',
      'issuedAt',
      'expiresAt',
    ]) ||
    manifest.version !== 1 ||
    manifest.kind !== 'calendar-writer-rollback-approval' ||
    (options.environment !== 'non-production' &&
      options.environment !== 'production-trial') ||
    manifest.environment !== options.environment ||
    !boundedId(manifest.approvalId) ||
    manifest.scopeId !== options.scopeId ||
    manifest.calendarReferenceHash !==
      hashCalendarReference(options.calendarId) ||
    manifest.sourceExecutionFingerprint !==
      options.sourceExecutionFingerprint ||
    manifest.rollbackEvidenceFingerprint !== rollbackEvidenceFingerprint ||
    manifest.actionSetFingerprint !== actionSetFingerprint ||
    !Array.isArray(manifest.allowedRollbackIds) ||
    manifest.allowedRollbackIds.some((value) => !boundedId(value)) ||
    new Set(manifest.allowedRollbackIds).size !==
      manifest.allowedRollbackIds.length ||
    !isIsoInstant(manifest.issuedAt) ||
    !isIsoInstant(manifest.expiresAt)
  )
    return false;
  const plan = planCalendarRollback({
    scopeId: options.scopeId,
    intents: options.intents,
    steps: options.steps,
    beforeSnapshots: options.beforeSnapshots,
  });
  if (plan.status !== 'ready') return false;
  const approved = [...manifest.allowedRollbackIds].sort();
  const actual = plan.actions.map((action) => action.rollbackId).sort();
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

function journalMatches(
  journal: CalendarExecutionJournalRecord,
  actions: readonly CalendarRollbackAction[],
  scopeId: string,
  executionFingerprint: string,
  manifestFingerprint: string,
): boolean {
  const expected = new Map(
    actions.map((action) => [action.rollbackId, rollbackIntentKind(action)]),
  );
  if (
    !validJournalRecord(journal, executionFingerprint) ||
    journal.manifestFingerprint !== manifestFingerprint ||
    journal.scopeId !== scopeId ||
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
            (step.outcome === 'mutated' ||
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
    !boundedId(step.intentId) ||
    !['create', 'replace', 'delete'].includes(step.intentKind) ||
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
    (step.outcome === 'mutated' || step.outcome === 'already-converged')
  );
}

function rollbackIntentKind(
  action: CalendarRollbackAction,
): CalendarMutationIntent['kind'] {
  if (action.kind === 'delete-created') return 'delete';
  return action.sourceIntentKind === 'delete' ? 'create' : 'replace';
}

function failedStep(
  action: CalendarRollbackAction,
  errorCode: string,
): CalendarExecutionStepRecord {
  return {
    intentId: action.rollbackId,
    intentKind: rollbackIntentKind(action),
    status: 'failed',
    outcome: 'refused',
    errorCode,
    providerReferenceHash: digest(action.eventReference),
  };
}

async function failExecution(
  options: CalendarRollbackQualificationOptions,
  executionFingerprint: string,
  manifestFingerprint: string,
  steps: readonly CalendarExecutionStepRecord[],
  attemptedExternalMutations: number,
  completedExternalMutations: number,
  code: CalendarRollbackExecutionEvidence['code'],
): Promise<CalendarRollbackExecutionEvidence> {
  try {
    await options.state.finishExecution({
      executionFingerprint,
      status: 'failed',
      finishedAt: safeNow(options.clock),
    });
  } catch {
    code = 'calendar-rollback-state-unavailable';
  }
  return {
    executionFingerprint,
    manifestFingerprint,
    status: 'failed',
    code,
    attemptedExternalMutations,
    completedExternalMutations,
    stepCounts: counts(steps),
  };
}

function counts(
  steps: readonly CalendarExecutionStepRecord[],
): CalendarRollbackExecutionEvidence['stepCounts'] {
  const succeeded = steps.filter((step) => step.status === 'succeeded');
  return {
    mutated: succeeded.filter((step) => step.outcome === 'mutated').length,
    alreadyConverged: succeeded.filter(
      (step) => step.outcome === 'already-converged',
    ).length,
    refused: steps.filter((step) => step.outcome === 'refused').length,
  };
}

function orderedActions(
  actions: readonly CalendarRollbackAction[],
): readonly CalendarRollbackAction[] {
  return [...actions].sort(
    (left, right) =>
      rollbackPriority(left) - rollbackPriority(right) ||
      left.rollbackId.localeCompare(right.rollbackId),
  );
}

function rollbackPriority(action: CalendarRollbackAction): number {
  if (action.kind === 'delete-created') return 0;
  return action.sourceIntentKind === 'replace' ? 1 : 2;
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

function safePlan(options: CalendarRollbackQualificationOptions) {
  try {
    return planCalendarRollback({
      scopeId: options.scopeId,
      intents: options.intents,
      steps: options.steps,
      beforeSnapshots: options.beforeSnapshots,
    });
  } catch {
    return undefined;
  }
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
  manifest: CalendarRollbackExecutionManifest,
): string {
  try {
    return fingerprintCalendarRollbackManifest(manifest);
  } catch {
    return digest('invalid-rollback-manifest');
  }
}

function safeActionSetFingerprint(
  actions: readonly CalendarRollbackAction[],
): string | undefined {
  try {
    return Array.isArray(actions)
      ? fingerprintCalendarRollbackActions(actions)
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

function digest(value: unknown): string {
  return `sha256:${createHash('sha256').update(stableSerialize(value)).digest('hex')}`;
}
