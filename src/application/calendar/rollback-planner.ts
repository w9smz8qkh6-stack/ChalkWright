import { createHash } from 'node:crypto';

import type {
  CalendarEventFields,
  CalendarMutationIntent,
  CalendarOwnership,
} from '../../contracts/v1/calendar.js';
import type { OpaqueId } from '../../contracts/v1/common.js';
import { contractVersion } from '../../contracts/v1/common.js';
import { calendarOwnershipMarker } from '../../config/google-calendar.js';
import { epoch, stableSerialize } from '../../domain/pure-values.js';
import {
  hasExactKeys,
  isIanaTimeZone,
  isIsoInstant,
  isPlainObject,
} from '../../domain/runtime-validation.js';
import type { CalendarExecutionStepRecord } from '../../ports/calendar-execution-state.js';
import { calendarProjectionDescription } from './projection-policy.js';
import { providerEventIdForIntent } from './writer-qualification.js';

export interface CalendarRollbackSnapshot extends CalendarEventFields {
  readonly intentId: OpaqueId;
  readonly eventReference: OpaqueId;
  readonly ownership: CalendarOwnership;
}

export type CalendarRollbackAction =
  | {
      readonly kind: 'delete-created';
      readonly rollbackId: OpaqueId;
      readonly eventReference: OpaqueId;
      readonly ownership: CalendarOwnership;
    }
  | {
      readonly kind: 'restore-event';
      readonly rollbackId: OpaqueId;
      readonly eventReference: OpaqueId;
      readonly ownership: CalendarOwnership;
      readonly sourceIntentKind: 'replace' | 'delete';
      readonly desired: CalendarEventFields;
    };

export type CalendarRollbackPlan =
  | {
      readonly status: 'ready';
      readonly fingerprint: string;
      readonly actions: readonly CalendarRollbackAction[];
    }
  | {
      readonly status: 'blocked';
      readonly code: 'calendar-rollback-evidence-invalid';
      readonly fingerprint: string;
      readonly actions: readonly [];
    };

/** Google retains deleted IDs as tombstones, so restore uses a fresh stable ID. */
export function providerRestoredEventIdForIntent(intentId: OpaqueId): OpaqueId {
  return `ch${createHash('sha256')
    .update(`rollback-restore:${intentId}`)
    .digest('hex')}`;
}

/** Produces inert inverse actions only for journaled, completed mutations. */
export function planCalendarRollback(options: {
  readonly scopeId: OpaqueId;
  readonly intents: readonly CalendarMutationIntent[];
  readonly steps: readonly CalendarExecutionStepRecord[];
  readonly beforeSnapshots: readonly CalendarRollbackSnapshot[];
}): CalendarRollbackPlan {
  const fingerprint = safeDigest(options);
  try {
    if (!boundedId(options.scopeId)) return blocked(fingerprint);
    if (
      !Array.isArray(options.intents) ||
      !Array.isArray(options.steps) ||
      !Array.isArray(options.beforeSnapshots) ||
      !options.intents.every(validRollbackIntent)
    )
      return blocked(fingerprint);
    const intents = new Map(
      options.intents.map((intent) => [intent.intentId, intent]),
    );
    const snapshots = new Map(
      options.beforeSnapshots.map((snapshot) => [snapshot.intentId, snapshot]),
    );
    if (
      intents.size !== options.intents.length ||
      snapshots.size !== options.beforeSnapshots.length ||
      options.steps.length !== options.intents.length ||
      new Set(options.steps.map((step) => step.intentId)).size !==
        options.steps.length ||
      options.steps.some(
        (step) => !validForwardStep(step, intents.get(step.intentId)),
      )
    )
      return blocked(fingerprint);

    const expectedSnapshots = new Set(
      options.steps
        .filter((step) => step.outcome === 'mutated')
        .map((step) => intents.get(step.intentId)!)
        .filter(
          (intent) => intent.kind === 'replace' || intent.kind === 'delete',
        )
        .map((intent) => intent.intentId),
    );
    if (
      expectedSnapshots.size !== options.beforeSnapshots.length ||
      options.beforeSnapshots.some(
        (snapshot) => !expectedSnapshots.has(snapshot.intentId),
      )
    )
      return blocked(fingerprint);

    const actions: CalendarRollbackAction[] = [];
    for (const step of options.steps) {
      if (step.outcome !== 'mutated') continue;
      const intent = intents.get(step.intentId)!;
      const snapshot = snapshots.get(step.intentId);
      if (intent.kind === 'no-op') return blocked(fingerprint);
      if (!validOwnership(intent.ownership, options.scopeId))
        return blocked(fingerprint);
      if (intent.kind === 'create') {
        if (snapshot !== undefined) return blocked(fingerprint);
        actions.push({
          kind: 'delete-created',
          rollbackId: rollbackId(intent.intentId),
          eventReference: providerEventIdForIntent(intent.intentId),
          ownership: intent.ownership,
        });
        continue;
      }
      if (
        snapshot === undefined ||
        !validSnapshot(snapshot, intent, options.scopeId)
      )
        return blocked(fingerprint);
      actions.push({
        kind: 'restore-event',
        rollbackId: rollbackId(intent.intentId),
        eventReference:
          intent.kind === 'delete'
            ? providerRestoredEventIdForIntent(intent.intentId)
            : snapshot.eventReference,
        ownership: snapshot.ownership,
        sourceIntentKind: intent.kind,
        desired: fields(snapshot),
      });
    }
    return { status: 'ready', fingerprint, actions };
  } catch {
    return blocked(fingerprint);
  }
}

function validForwardStep(
  step: CalendarExecutionStepRecord,
  intent: CalendarMutationIntent | undefined,
): boolean {
  if (
    intent === undefined ||
    !isPlainObject(step) ||
    !hasExactKeys(step, [
      'intentId',
      'intentKind',
      'status',
      'outcome',
      'providerReferenceHash',
    ]) ||
    step.intentKind !== intent.kind ||
    step.status !== 'succeeded' ||
    step.providerReferenceHash !== digest(eventReferenceForIntent(intent))
  )
    return false;
  return intent.kind === 'no-op'
    ? step.outcome === 'no-op'
    : step.outcome === 'mutated' || step.outcome === 'already-converged';
}

function eventReferenceForIntent(intent: CalendarMutationIntent): string {
  return intent.kind === 'create'
    ? providerEventIdForIntent(intent.intentId)
    : intent.existingEventReference;
}

function validSnapshot(
  snapshot: CalendarRollbackSnapshot,
  intent: Exclude<
    CalendarMutationIntent,
    { readonly kind: 'no-op' | 'create' }
  >,
  scopeId: string,
): boolean {
  return (
    isPlainObject(snapshot) &&
    hasExactKeys(snapshot, [
      'intentId',
      'eventReference',
      'ownership',
      'summary',
      'description',
      'startsAt',
      'endsAt',
      'timeZone',
    ]) &&
    boundedId(snapshot.intentId) &&
    boundedReference(snapshot.eventReference) &&
    snapshot.intentId === intent.intentId &&
    snapshot.eventReference === intent.existingEventReference &&
    (intent.kind !== 'delete' ||
      googleCompatibleEventId(snapshot.eventReference)) &&
    validOwnership(snapshot.ownership, scopeId) &&
    validFields(snapshot, false)
  );
}

function validRollbackIntent(intent: CalendarMutationIntent): boolean {
  if (
    !isPlainObject(intent) ||
    intent.contractVersion !== contractVersion ||
    !boundedId(intent.intentId) ||
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
      boundedReference(intent.existingEventReference) &&
      intent.reason === 'semantic-match'
    );
  if (!validOwnership(intent.ownership, intent.ownership.scopeId)) return false;
  const base = [
    'contractVersion',
    'intentId',
    'planId',
    'notifyAttendees',
    'kind',
    'ownership',
  ];
  if (intent.kind === 'create')
    return (
      hasExactKeys(intent, [...base, 'desired']) && validFields(intent.desired)
    );
  if (!boundedReference(intent.existingEventReference)) return false;
  if (intent.kind === 'replace')
    return (
      hasExactKeys(intent, [...base, 'existingEventReference', 'desired']) &&
      validFields(intent.desired)
    );
  return (
    hasExactKeys(intent, [...base, 'existingEventReference', 'reason']) &&
    (intent.reason === 'obsolete-owned-event' ||
      intent.reason === 'replace-owned-event')
  );
}

function validOwnership(value: CalendarOwnership, scopeId: string): boolean {
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
    typeof value.summary === 'string' &&
    value.summary.length >= 1 &&
    value.summary.length <= 256 &&
    value.summary.trim() === value.summary &&
    value.summary.normalize('NFC') === value.summary &&
    !/[\p{Cc}\p{Cs}\p{Zl}\p{Zp}]/u.test(value.summary) &&
    value.description === calendarProjectionDescription &&
    isIsoInstant(value.startsAt) &&
    isIsoInstant(value.endsAt) &&
    start !== undefined &&
    end !== undefined &&
    start < end &&
    isIanaTimeZone(value.timeZone)
  );
}

function fields(value: CalendarEventFields): CalendarEventFields {
  return {
    summary: value.summary,
    description: value.description,
    startsAt: value.startsAt,
    endsAt: value.endsAt,
    timeZone: value.timeZone,
  };
}

function rollbackId(intentId: string): OpaqueId {
  return `rollback-${createHash('sha256').update(intentId).digest('hex')}`;
}

function blocked(fingerprint: string): CalendarRollbackPlan {
  return {
    status: 'blocked',
    code: 'calendar-rollback-evidence-invalid',
    fingerprint,
    actions: [],
  };
}

function boundedId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$/u.test(value)
  );
}

function boundedReference(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= 1_024 &&
    !/[\0\r\n]/u.test(value)
  );
}

function googleCompatibleEventId(value: string): boolean {
  return /^[0-9a-v]{5,1024}$/u.test(value);
}

function digest(value: unknown): string {
  return `sha256:${createHash('sha256').update(stableSerialize(value)).digest('hex')}`;
}

function safeDigest(value: unknown): string {
  try {
    return digest(value);
  } catch {
    return digest('invalid-rollback-evidence');
  }
}
