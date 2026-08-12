import { createHash } from 'node:crypto';

import {
  contractVersion,
  type CalendarEventFields,
  type CalendarMutationIntent,
  type CalendarOwnership,
  type IsoInstant,
} from '../../contracts/v1/index.js';
import { calendarOwnershipMarker } from '../../config/google-calendar.js';
import { isIsoInstant } from '../../domain/runtime-validation.js';
import type {
  CalendarExecutionJournalRecord,
  CalendarExecutionStatePort,
  CalendarExecutionStepRecord,
  CalendarWriterLeaseAcquisition,
} from '../../ports/calendar-execution-state.js';
import type { CalendarMutationTransport } from '../../ports/calendar-mutation-transport.js';
import {
  executeCalendarRollbackQualification,
  fingerprintCalendarRollbackActions,
  type CalendarRollbackExecutionManifest,
} from './rollback-qualification.js';
import {
  planCalendarRollback,
  providerRestoredEventIdForIntent,
  type CalendarRollbackSnapshot,
} from './rollback-planner.js';
import {
  executeCalendarWriterQualification,
  fingerprintCalendarIntentSet,
  hashCalendarReference,
  isExactOwnedCalendarEvent,
  providerEventIdForIntent,
  sameCalendarEventFields,
  type CalendarWriterExecutionManifest,
} from './writer-qualification.js';

export interface M14LiveQualificationOptions {
  readonly calendarId: string;
  readonly calendarReferenceHash: string;
  readonly productionCalendarReferenceHash: string;
  readonly qualificationRunId: string;
  readonly approvalExpiresAt: IsoInstant;
  readonly scopeId: string;
  readonly timeZone: string;
  readonly requestTimeoutMs: number;
  readonly leaseDurationSeconds: number;
  readonly clock: () => IsoInstant;
  readonly signal: AbortSignal;
  readonly state: CalendarExecutionStatePort;
  readonly transport: CalendarMutationTransport;
}

export interface M14LiveQualificationEvidence {
  readonly status: 'succeeded' | 'failed';
  readonly code:
    | 'm14-live-qualified'
    | 'm14-live-input-invalid'
    | 'm14-live-setup-failed'
    | 'm14-live-noop-failed'
    | 'm14-live-injected-retry-failed'
    | 'm14-live-readback-failed'
    | 'm14-live-rollback-failed'
    | 'm14-live-cleanup-incomplete'
    | 'm14-live-execution-failed'
    | 'm14-live-recovered';
  readonly calendarReferenceHash: string;
  readonly grantScope: 'calendar.events.owned';
  readonly injectedJournalFailureObserved: boolean;
  readonly retryConvergenceObserved: boolean;
  readonly forwardMutationCount: number;
  readonly rollbackMutationCount: number;
  readonly cleanupMutationCount: number;
  readonly finalOwnedEventCount: number;
  readonly executionFingerprints: readonly string[];
}

const description = 'Imported from PowerSchool Bell Schedule.';
const auditFingerprint = digest('m14-auto-lesson-2-live-qualification-v1');

/**
 * Runs the exact approved nonproduction lifecycle and leaves no owned test
 * events behind when every gate succeeds.
 */
export async function runM14LiveQualification(
  options: M14LiveQualificationOptions,
): Promise<M14LiveQualificationEvidence> {
  const empty = failure(options, 'm14-live-input-invalid');
  if (!validOptions(options)) return empty;

  let result: M14LiveQualificationEvidence;
  try {
    result = await runM14LiveQualificationCore(options);
  } catch {
    result = failure(options, 'm14-live-execution-failed');
  }
  if (result.status === 'succeeded') return result;
  return recoverAfterFailure(options, result);
}

/** Reconciles only the four deterministic qualification references to empty. */
export async function recoverM14LiveQualification(
  options: M14LiveQualificationOptions,
): Promise<M14LiveQualificationEvidence> {
  if (!validOptions(options)) return failure(options, 'm14-live-input-invalid');
  const recovery = await recoverKnownQualificationEvents(options);
  if (recovery.status === 'failed')
    return failure(options, 'm14-live-cleanup-incomplete', {
      cleanupMutationCount: recovery.completedExternalMutations,
      finalOwnedEventCount: recovery.finalOwnedEventCount,
      executionFingerprints: recovery.executionFingerprints,
    });
  return {
    ...failure(options, 'm14-live-recovered'),
    status: 'succeeded',
    cleanupMutationCount: recovery.completedExternalMutations,
    finalOwnedEventCount: 0,
    executionFingerprints: recovery.executionFingerprints,
  };
}

async function runM14LiveQualificationCore(
  options: M14LiveQualificationOptions,
): Promise<M14LiveQualificationEvidence> {
  const ownership: CalendarOwnership = {
    classification: 'verified-application-owned',
    scopeId: options.scopeId,
    ownershipMarker: calendarOwnershipMarker,
  };
  const seedReplace = fields(
    'M14 Qualification Seed Replace',
    '2035-04-13T01:00:00.000Z',
    '2035-04-13T01:15:00.000Z',
    options.timeZone,
  );
  const seedDelete = fields(
    'M14 Qualification Seed Delete',
    '2035-04-13T01:30:00.000Z',
    '2035-04-13T01:45:00.000Z',
    options.timeZone,
  );
  const setupIntents = setupIntentSet(
    options.qualificationRunId,
    ownership,
    seedReplace,
    seedDelete,
  );
  const replaceReference = providerEventIdForIntent(setupIntents[0]!.intentId);
  const deleteReference = providerEventIdForIntent(setupIntents[1]!.intentId);
  const mainIntents = mainIntentSet(
    options.qualificationRunId,
    ownership,
    replaceReference,
    deleteReference,
    options.timeZone,
  );
  const noOpIntents = noOpIntentSet(
    options.qualificationRunId,
    replaceReference,
  );
  const mainCreateReference = providerEventIdForIntent(
    mainIntents[0]!.intentId,
  );
  const restoredDeleteReference = providerRestoredEventIdForIntent(
    mainIntents[2]!.intentId,
  );
  const knownReferences = [
    replaceReference,
    deleteReference,
    mainCreateReference,
    restoredDeleteReference,
  ] as const;
  const executionFingerprints: string[] = [];
  let forwardMutationCount = 0;
  let rollbackMutationCount = 0;
  let cleanupMutationCount = 0;
  let injectedJournalFailureObserved = false;
  let retryConvergenceObserved = false;

  const setupManifest = writerManifest(
    options,
    setupIntents,
    'm14-live-setup-approval',
  );
  const setup = await executeCalendarWriterQualification({
    ...writerOptions(options, setupIntents, setupManifest),
    leaseId: 'm14-live-setup-lease',
    ownerId: 'm14-live-writer',
  });
  executionFingerprints.push(setup.executionFingerprint);
  forwardMutationCount += setup.completedExternalMutations;
  if (setup.status !== 'succeeded')
    return failure(options, 'm14-live-setup-failed', {
      forwardMutationCount,
      executionFingerprints,
    });

  if (!(await exactEvent(options, replaceReference, ownership, seedReplace)))
    return failure(options, 'm14-live-noop-failed', {
      forwardMutationCount,
      executionFingerprints,
    });
  const noOpManifest = writerManifest(
    options,
    noOpIntents,
    'm14-live-noop-approval',
  );
  const noOp = await executeCalendarWriterQualification({
    ...writerOptions(options, noOpIntents, noOpManifest),
    leaseId: 'm14-live-noop-lease',
    ownerId: 'm14-live-writer',
  });
  executionFingerprints.push(noOp.executionFingerprint);
  if (
    noOp.status !== 'succeeded' ||
    noOp.completedExternalMutations !== 0 ||
    noOp.stepCounts.noOp !== 1
  )
    return failure(options, 'm14-live-noop-failed', {
      forwardMutationCount,
      executionFingerprints,
    });

  const mainManifest = writerManifest(
    options,
    mainIntents,
    'm14-live-main-approval',
  );
  const injectedState = new FailOnceAfterMutationState(options.state);
  const firstMain = await executeCalendarWriterQualification({
    ...writerOptions(options, mainIntents, mainManifest),
    leaseId: 'm14-live-main-lease',
    ownerId: 'm14-live-writer',
    state: injectedState,
  });
  executionFingerprints.push(firstMain.executionFingerprint);
  forwardMutationCount += firstMain.completedExternalMutations;
  injectedJournalFailureObserved =
    injectedState.triggered &&
    firstMain.status === 'failed' &&
    firstMain.code === 'calendar-write-state-unavailable' &&
    firstMain.completedExternalMutations === 1;

  const secondMain = await executeCalendarWriterQualification({
    ...writerOptions(options, mainIntents, mainManifest),
    leaseId: 'm14-live-main-lease',
    ownerId: 'm14-live-writer',
  });
  executionFingerprints.push(secondMain.executionFingerprint);
  forwardMutationCount += secondMain.completedExternalMutations;
  retryConvergenceObserved =
    secondMain.status === 'succeeded' &&
    firstMain.completedExternalMutations === 1 &&
    secondMain.completedExternalMutations === 2 &&
    secondMain.stepCounts.mutated === 3;
  if (
    !injectedJournalFailureObserved ||
    !retryConvergenceObserved ||
    secondMain.status !== 'succeeded'
  )
    return failure(options, 'm14-live-injected-retry-failed', {
      injectedJournalFailureObserved,
      retryConvergenceObserved,
      forwardMutationCount,
      executionFingerprints,
    });

  if (
    !(await exactEvent(
      options,
      mainCreateReference,
      ownership,
      mainIntents[0]!.desired,
    )) ||
    !(await exactEvent(
      options,
      replaceReference,
      ownership,
      mainIntents[1]!.desired,
    )) ||
    !(await absentEvent(options, deleteReference))
  )
    return failure(options, 'm14-live-readback-failed', {
      injectedJournalFailureObserved,
      retryConvergenceObserved,
      forwardMutationCount,
      executionFingerprints,
    });

  const mainJournal = await options.state.loadExecution(
    secondMain.executionFingerprint,
  );
  const mainSnapshots: readonly CalendarRollbackSnapshot[] = [
    {
      intentId: mainIntents[1]!.intentId,
      eventReference: replaceReference,
      ownership,
      ...seedReplace,
    },
    {
      intentId: mainIntents[2]!.intentId,
      eventReference: deleteReference,
      ownership,
      ...seedDelete,
    },
  ];
  const mainRollback = await rollback(
    options,
    secondMain.executionFingerprint,
    mainIntents,
    mainJournal,
    mainSnapshots,
    'm14-live-main-rollback-approval',
    'm14-live-main-rollback-lease',
  );
  executionFingerprints.push(mainRollback.executionFingerprint);
  rollbackMutationCount += mainRollback.completedExternalMutations;
  if (mainRollback.status !== 'succeeded')
    return failure(options, 'm14-live-rollback-failed', {
      injectedJournalFailureObserved,
      retryConvergenceObserved,
      forwardMutationCount,
      rollbackMutationCount,
      executionFingerprints,
    });

  const setupJournal = await options.state.loadExecution(
    setup.executionFingerprint,
  );
  const setupRollback = await rollback(
    options,
    setup.executionFingerprint,
    setupIntents,
    setupJournal,
    [],
    'm14-live-setup-rollback-approval',
    'm14-live-setup-rollback-lease',
  );
  executionFingerprints.push(setupRollback.executionFingerprint);
  rollbackMutationCount += setupRollback.completedExternalMutations;
  if (setupRollback.status !== 'succeeded')
    return failure(options, 'm14-live-rollback-failed', {
      injectedJournalFailureObserved,
      retryConvergenceObserved,
      forwardMutationCount,
      rollbackMutationCount,
      executionFingerprints,
    });

  const cleanupIntents = [
    {
      contractVersion,
      intentId: `${options.qualificationRunId}-cleanup-restored-delete`,
      planId: 'm14-live-plan',
      notifyAttendees: false,
      kind: 'delete',
      ownership,
      existingEventReference: restoredDeleteReference,
      reason: 'obsolete-owned-event',
    },
  ] as const satisfies readonly CalendarMutationIntent[];
  const cleanupManifest = writerManifest(
    options,
    cleanupIntents,
    'm14-live-final-cleanup-approval',
  );
  const cleanup = await executeCalendarWriterQualification({
    ...writerOptions(options, cleanupIntents, cleanupManifest),
    leaseId: 'm14-live-final-cleanup-lease',
    ownerId: 'm14-live-writer',
  });
  executionFingerprints.push(cleanup.executionFingerprint);
  cleanupMutationCount += cleanup.completedExternalMutations;
  if (cleanup.status !== 'succeeded')
    return failure(options, 'm14-live-cleanup-incomplete', {
      injectedJournalFailureObserved,
      retryConvergenceObserved,
      forwardMutationCount,
      rollbackMutationCount,
      cleanupMutationCount,
      executionFingerprints,
    });

  let finalOwnedEventCount = 0;
  for (const reference of knownReferences)
    if (!(await absentEvent(options, reference))) finalOwnedEventCount += 1;
  if (finalOwnedEventCount !== 0)
    return failure(options, 'm14-live-cleanup-incomplete', {
      injectedJournalFailureObserved,
      retryConvergenceObserved,
      forwardMutationCount,
      rollbackMutationCount,
      cleanupMutationCount,
      finalOwnedEventCount,
      executionFingerprints,
    });

  return {
    status: 'succeeded',
    code: 'm14-live-qualified',
    calendarReferenceHash: options.calendarReferenceHash,
    grantScope: 'calendar.events.owned',
    injectedJournalFailureObserved,
    retryConvergenceObserved,
    forwardMutationCount,
    rollbackMutationCount,
    cleanupMutationCount,
    finalOwnedEventCount,
    executionFingerprints,
  };
}

async function recoverAfterFailure(
  options: M14LiveQualificationOptions,
  original: M14LiveQualificationEvidence,
): Promise<M14LiveQualificationEvidence> {
  try {
    const recovery = await recoverKnownQualificationEvents(options);
    if (recovery.status === 'succeeded')
      return {
        ...original,
        cleanupMutationCount:
          original.cleanupMutationCount + recovery.completedExternalMutations,
        finalOwnedEventCount: 0,
        executionFingerprints: [
          ...original.executionFingerprints,
          ...recovery.executionFingerprints,
        ],
      };
    return {
      ...original,
      code: 'm14-live-cleanup-incomplete',
      cleanupMutationCount:
        original.cleanupMutationCount + recovery.completedExternalMutations,
      finalOwnedEventCount: recovery.finalOwnedEventCount,
      executionFingerprints: [
        ...original.executionFingerprints,
        ...recovery.executionFingerprints,
      ],
    };
  } catch {
    return { ...original, code: 'm14-live-cleanup-incomplete' };
  }
}

async function recoverKnownQualificationEvents(
  options: M14LiveQualificationOptions,
): Promise<{
  readonly status: 'succeeded' | 'failed';
  readonly completedExternalMutations: number;
  readonly finalOwnedEventCount: number;
  readonly executionFingerprints: readonly string[];
}> {
  const ownership: CalendarOwnership = {
    classification: 'verified-application-owned',
    scopeId: options.scopeId,
    ownershipMarker: calendarOwnershipMarker,
  };
  const seedReplace = fields(
    'M14 Qualification Seed Replace',
    '2035-04-13T01:00:00.000Z',
    '2035-04-13T01:15:00.000Z',
    options.timeZone,
  );
  const seedDelete = fields(
    'M14 Qualification Seed Delete',
    '2035-04-13T01:30:00.000Z',
    '2035-04-13T01:45:00.000Z',
    options.timeZone,
  );
  const setupIntents = setupIntentSet(
    options.qualificationRunId,
    ownership,
    seedReplace,
    seedDelete,
  );
  const replaceReference = providerEventIdForIntent(setupIntents[0]!.intentId);
  const deleteReference = providerEventIdForIntent(setupIntents[1]!.intentId);
  const mainIntents = mainIntentSet(
    options.qualificationRunId,
    ownership,
    replaceReference,
    deleteReference,
    options.timeZone,
  );
  const candidates = [
    {
      label: 'replace',
      eventReference: replaceReference,
      allowed: [seedReplace, mainIntents[1]!.desired],
    },
    {
      label: 'delete',
      eventReference: deleteReference,
      allowed: [seedDelete],
    },
    {
      label: 'create',
      eventReference: providerEventIdForIntent(mainIntents[0]!.intentId),
      allowed: [mainIntents[0]!.desired],
    },
    {
      label: 'restored-delete',
      eventReference: providerRestoredEventIdForIntent(
        mainIntents[2]!.intentId,
      ),
      allowed: [seedDelete],
    },
  ] as const;

  let observedCount = 0;
  for (const candidate of candidates) {
    const observed = await options.transport.getEvent({
      calendarId: options.calendarId,
      eventReference: candidate.eventReference,
      timeoutMs: options.requestTimeoutMs,
      signal: options.signal,
    });
    if (observed.status === 'not-found') continue;
    observedCount += 1;
    if (
      !isExactOwnedCalendarEvent(
        observed.event,
        candidate.eventReference,
        ownership,
      ) ||
      !candidate.allowed.some((desired) =>
        sameCalendarEventFields(observed.event, desired),
      )
    )
      return {
        status: 'failed',
        completedExternalMutations: 0,
        finalOwnedEventCount: observedCount,
        executionFingerprints: [],
      };
  }

  const intents = candidates.map((candidate): CalendarMutationIntent => ({
    contractVersion,
    intentId: `${options.qualificationRunId}-recover-${candidate.label}`,
    planId: 'm14-live-recovery-plan',
    notifyAttendees: false,
    kind: 'delete',
    ownership,
    existingEventReference: candidate.eventReference,
    reason: 'obsolete-owned-event',
  }));
  const manifest = writerManifest(
    options,
    intents,
    'm14-live-recovery-approval',
  );
  const cleanup = await executeCalendarWriterQualification({
    ...writerOptions(options, intents, manifest),
    leaseId: 'm14-live-recovery-lease',
    ownerId: 'm14-live-writer',
  });
  if (cleanup.status !== 'succeeded')
    return {
      status: 'failed',
      completedExternalMutations: cleanup.completedExternalMutations,
      finalOwnedEventCount: observedCount,
      executionFingerprints: [cleanup.executionFingerprint],
    };

  let finalOwnedEventCount = 0;
  for (const candidate of candidates)
    if (!(await absentEvent(options, candidate.eventReference)))
      finalOwnedEventCount += 1;
  return {
    status: finalOwnedEventCount === 0 ? 'succeeded' : 'failed',
    completedExternalMutations: cleanup.completedExternalMutations,
    finalOwnedEventCount,
    executionFingerprints: [cleanup.executionFingerprint],
  };
}

function setupIntentSet(
  runId: string,
  ownership: CalendarOwnership,
  replaceFields: CalendarEventFields,
  deleteFields: CalendarEventFields,
): readonly [
  CalendarMutationIntent & { readonly kind: 'create' },
  CalendarMutationIntent & { readonly kind: 'create' },
] {
  return [
    {
      contractVersion,
      intentId: `${runId}-setup-replace`,
      planId: 'm14-live-plan',
      notifyAttendees: false,
      kind: 'create',
      ownership,
      desired: replaceFields,
    },
    {
      contractVersion,
      intentId: `${runId}-setup-delete`,
      planId: 'm14-live-plan',
      notifyAttendees: false,
      kind: 'create',
      ownership,
      desired: deleteFields,
    },
  ];
}

function mainIntentSet(
  runId: string,
  ownership: CalendarOwnership,
  replaceReference: string,
  deleteReference: string,
  timeZone: string,
) {
  return [
    {
      contractVersion,
      intentId: `${runId}-main-create`,
      planId: 'm14-live-plan',
      notifyAttendees: false,
      kind: 'create',
      ownership,
      desired: fields(
        'M14 Qualification Created',
        '2035-04-13T02:00:00.000Z',
        '2035-04-13T02:15:00.000Z',
        timeZone,
      ),
    },
    {
      contractVersion,
      intentId: `${runId}-main-replace`,
      planId: 'm14-live-plan',
      notifyAttendees: false,
      kind: 'replace',
      ownership,
      existingEventReference: replaceReference,
      desired: fields(
        'M14 Qualification Replaced',
        '2035-04-13T02:30:00.000Z',
        '2035-04-13T02:45:00.000Z',
        timeZone,
      ),
    },
    {
      contractVersion,
      intentId: `${runId}-main-delete`,
      planId: 'm14-live-plan',
      notifyAttendees: false,
      kind: 'delete',
      ownership,
      existingEventReference: deleteReference,
      reason: 'obsolete-owned-event',
    },
  ] as const satisfies readonly CalendarMutationIntent[];
}

function noOpIntentSet(
  runId: string,
  existingEventReference: string,
): readonly [CalendarMutationIntent & { readonly kind: 'no-op' }] {
  return [
    {
      contractVersion,
      intentId: `${runId}-main-noop`,
      planId: 'm14-live-plan',
      notifyAttendees: false,
      kind: 'no-op',
      existingEventReference,
      reason: 'semantic-match',
    },
  ];
}

function writerManifest(
  options: M14LiveQualificationOptions,
  intents: readonly CalendarMutationIntent[],
  approvalId: string,
): CalendarWriterExecutionManifest {
  const issuedAt = options.clock();
  return {
    version: 1,
    kind: 'calendar-writer-execution-approval',
    environment: 'non-production',
    approvalId,
    scopeId: options.scopeId,
    calendarReferenceHash: options.calendarReferenceHash,
    auditFingerprint,
    intentSetFingerprint: fingerprintCalendarIntentSet(intents),
    allowedIntentIds: intents.map((intent) => intent.intentId),
    issuedAt,
    expiresAt: manifestExpiry(options, issuedAt),
  };
}

function writerOptions(
  options: M14LiveQualificationOptions,
  intents: readonly CalendarMutationIntent[],
  manifest: CalendarWriterExecutionManifest,
) {
  return {
    environment: 'non-production' as const,
    calendarId: options.calendarId,
    scopeId: options.scopeId,
    auditFingerprint,
    intents,
    manifest,
    leaseDurationSeconds: options.leaseDurationSeconds,
    requestTimeoutMs: options.requestTimeoutMs,
    clock: options.clock,
    signal: options.signal,
    state: options.state,
    transport: options.transport,
  };
}

async function rollback(
  options: M14LiveQualificationOptions,
  sourceExecutionFingerprint: string,
  intents: readonly CalendarMutationIntent[],
  journal: CalendarExecutionJournalRecord | undefined,
  beforeSnapshots: readonly CalendarRollbackSnapshot[],
  approvalId: string,
  leaseId: string,
) {
  if (journal?.status !== 'succeeded')
    throw new Error('m14-live-forward-journal-invalid');
  const plan = planCalendarRollback({
    scopeId: options.scopeId,
    intents,
    steps: journal.steps,
    beforeSnapshots,
  });
  if (plan.status !== 'ready')
    throw new Error('m14-live-rollback-plan-invalid');
  const issuedAt = options.clock();
  const manifest: CalendarRollbackExecutionManifest = {
    version: 1,
    kind: 'calendar-writer-rollback-approval',
    environment: 'non-production',
    approvalId,
    scopeId: options.scopeId,
    calendarReferenceHash: options.calendarReferenceHash,
    sourceExecutionFingerprint,
    rollbackEvidenceFingerprint: plan.fingerprint,
    actionSetFingerprint: fingerprintCalendarRollbackActions(plan.actions),
    allowedRollbackIds: plan.actions.map((action) => action.rollbackId),
    issuedAt,
    expiresAt: manifestExpiry(options, issuedAt),
  };
  return executeCalendarRollbackQualification({
    environment: 'non-production',
    calendarId: options.calendarId,
    scopeId: options.scopeId,
    sourceExecutionFingerprint,
    intents,
    steps: journal.steps,
    beforeSnapshots,
    manifest,
    leaseId,
    ownerId: 'm14-live-writer',
    leaseDurationSeconds: options.leaseDurationSeconds,
    requestTimeoutMs: options.requestTimeoutMs,
    clock: options.clock,
    signal: options.signal,
    state: options.state,
    transport: options.transport,
  });
}

async function exactEvent(
  options: M14LiveQualificationOptions,
  eventReference: string,
  ownership: CalendarOwnership,
  desired: CalendarEventFields,
): Promise<boolean> {
  const observed = await options.transport.getEvent({
    calendarId: options.calendarId,
    eventReference,
    timeoutMs: options.requestTimeoutMs,
    signal: options.signal,
  });
  return (
    observed.status === 'found' &&
    isExactOwnedCalendarEvent(observed.event, eventReference, ownership) &&
    sameCalendarEventFields(observed.event, desired)
  );
}

async function absentEvent(
  options: M14LiveQualificationOptions,
  eventReference: string,
): Promise<boolean> {
  const observed = await options.transport.getEvent({
    calendarId: options.calendarId,
    eventReference,
    timeoutMs: options.requestTimeoutMs,
    signal: options.signal,
  });
  return observed.status === 'not-found';
}

function validOptions(options: M14LiveQualificationOptions): boolean {
  return (
    options.calendarId !== 'primary' &&
    options.calendarReferenceHash ===
      hashCalendarReference(options.calendarId) &&
    options.calendarReferenceHash !== options.productionCalendarReferenceHash &&
    /^sha256:[a-f0-9]{64}$/u.test(options.productionCalendarReferenceHash) &&
    /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$/u.test(options.scopeId) &&
    /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,63}$/u.test(options.qualificationRunId) &&
    isIsoInstant(options.approvalExpiresAt) &&
    Number.isSafeInteger(options.requestTimeoutMs) &&
    options.requestTimeoutMs >= 1_000 &&
    options.requestTimeoutMs <= 60_000 &&
    Number.isSafeInteger(options.leaseDurationSeconds) &&
    options.leaseDurationSeconds * 1_000 >=
      options.requestTimeoutMs * 8 + 5_000 &&
    !options.signal.aborted
  );
}

function manifestExpiry(
  options: M14LiveQualificationOptions,
  issuedAt: IsoInstant,
): IsoInstant {
  return new Date(
    Math.min(
      Date.parse(issuedAt) + 15 * 60_000,
      Date.parse(options.approvalExpiresAt),
    ),
  ).toISOString();
}

function fields(
  summary: string,
  startsAt: IsoInstant,
  endsAt: IsoInstant,
  timeZone: string,
): CalendarEventFields {
  return { summary, description, startsAt, endsAt, timeZone };
}

function failure(
  options: Pick<M14LiveQualificationOptions, 'calendarReferenceHash'>,
  code: Exclude<M14LiveQualificationEvidence['code'], 'm14-live-qualified'>,
  partial: Partial<M14LiveQualificationEvidence> = {},
): M14LiveQualificationEvidence {
  return {
    status: 'failed',
    code,
    calendarReferenceHash: options.calendarReferenceHash,
    grantScope: 'calendar.events.owned',
    injectedJournalFailureObserved: false,
    retryConvergenceObserved: false,
    forwardMutationCount: 0,
    rollbackMutationCount: 0,
    cleanupMutationCount: 0,
    finalOwnedEventCount: 0,
    executionFingerprints: [],
    ...partial,
  };
}

function digest(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

class FailOnceAfterMutationState implements CalendarExecutionStatePort {
  triggered = false;

  constructor(private readonly delegate: CalendarExecutionStatePort) {}

  acquireLease(
    request: Parameters<CalendarExecutionStatePort['acquireLease']>[0],
  ): Promise<CalendarWriterLeaseAcquisition> {
    return this.delegate.acquireLease(request);
  }

  releaseLease(
    request: Parameters<CalendarExecutionStatePort['releaseLease']>[0],
  ): Promise<void> {
    return this.delegate.releaseLease(request);
  }

  loadExecution(
    request: string,
  ): Promise<CalendarExecutionJournalRecord | undefined> {
    return this.delegate.loadExecution(request);
  }

  beginExecution(record: CalendarExecutionJournalRecord): Promise<void> {
    return this.delegate.beginExecution(record);
  }

  resumeExecution(
    request: Parameters<CalendarExecutionStatePort['resumeExecution']>[0],
  ): Promise<void> {
    return this.delegate.resumeExecution(request);
  }

  recordStep(request: {
    readonly executionFingerprint: string;
    readonly step: CalendarExecutionStepRecord;
  }): Promise<void> {
    if (
      !this.triggered &&
      request.step.status === 'succeeded' &&
      request.step.outcome === 'mutated'
    ) {
      this.triggered = true;
      return Promise.reject(new Error('m14-injected-journal-failure'));
    }
    return this.delegate.recordStep(request);
  }

  finishExecution(
    request: Parameters<CalendarExecutionStatePort['finishExecution']>[0],
  ): Promise<void> {
    return this.delegate.finishExecution(request);
  }
}
