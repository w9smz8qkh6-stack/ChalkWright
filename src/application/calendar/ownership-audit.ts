import { createHash } from 'node:crypto';

import type {
  CalendarEventFields,
  CalendarMutationIntent,
  CalendarOwnership,
} from '../../contracts/v1/calendar.js';
import type { OpaqueId } from '../../contracts/v1/common.js';
import { calendarOwnershipMarker } from '../../config/google-calendar.js';
import { calendarProjectionDescription } from './projection-policy.js';
import type {
  CalendarAdoptionApproval,
  ObservedCalendarEvent,
} from '../../domain/calendar-audit.js';
import type { EffectiveDayPlan } from '../../domain/plans.js';
import { epoch, stableSerialize } from '../../domain/pure-values.js';
import {
  hasExactKeys,
  isIanaTimeZone,
  isIsoInstant,
  isPlainObject,
} from '../../domain/runtime-validation.js';
import {
  planCalendarReconciliation,
  type DesiredCalendarEvent,
  type ExistingCalendarEvent,
} from '../planning/calendar-intents.js';

export type CalendarOwnershipClassification =
  | 'verified-owned'
  | 'approved-adoption'
  | 'legacy-match-candidate'
  | 'ambiguous'
  | 'unrelated';

export interface CalendarAuditCounts {
  readonly observed: number;
  readonly verifiedOwned: number;
  readonly approvedAdoptions: number;
  readonly legacyCandidates: number;
  readonly ambiguous: number;
  readonly unrelated: number;
  readonly invalidProviderItems: number;
  readonly unsupportedProviderItems: number;
}

export interface CalendarIntentCounts {
  readonly noOp: number;
  readonly create: number;
  readonly replace: number;
  readonly delete: number;
}

export interface CalendarAuditEvidence {
  readonly auditFingerprint: string;
  readonly readyForReconciliation: boolean;
  readonly counts: CalendarAuditCounts;
  readonly proposedIntentCounts: CalendarIntentCounts;
  readonly eligibleIntentCount: number;
  readonly blockerCodes: readonly string[];
  readonly candidateEvidenceReferences: readonly string[];
  readonly attemptedExternalMutations: 0;
  readonly completedExternalMutations: 0;
}

export interface CalendarOwnershipAuditResult {
  readonly evidence: CalendarAuditEvidence;
  readonly intents: readonly CalendarMutationIntent[];
}

export interface CalendarOwnershipAuditOptions {
  readonly calendarId: string;
  readonly timeMin: string;
  readonly timeMax: string;
  readonly plan: EffectiveDayPlan;
  readonly desired: readonly DesiredCalendarEvent[];
  readonly observed: readonly ObservedCalendarEvent[];
  readonly ownership: CalendarOwnership;
  readonly adoptionApprovals: readonly CalendarAdoptionApproval[];
  readonly invalidProviderItemCount: number;
  readonly unsupportedProviderItemCount: number;
  readonly previousFingerprint?: string;
  readonly force: boolean;
}

interface ClassifiedEvent {
  readonly classification: CalendarOwnershipClassification;
  readonly event: ObservedCalendarEvent;
  readonly evidenceReference: string;
}

/**
 * Produces inert decisions only. Unmarked matches, partial markers, recurring
 * instances, stale adoption approvals, and malformed provider entries suppress
 * every eligible mutation intent.
 */
export function auditCalendarOwnership(
  options: CalendarOwnershipAuditOptions,
): CalendarOwnershipAuditResult {
  if (!validAuditContext(options))
    return blocked(options, ['calendar-audit-context-invalid'], []);
  if (!validOwnership(options.ownership) || !validApprovals(options))
    return blocked(options, ['calendar-adoption-manifest-invalid'], []);
  if (!options.observed.every(validObservedEvent))
    return blocked(options, ['calendar-observation-invalid'], []);
  const observedReferences = new Set(
    options.observed.map((event) => event.eventReference),
  );
  if (observedReferences.size !== options.observed.length)
    return blocked(options, ['calendar-observation-duplicate'], []);

  const approvalByReference = new Map(
    options.adoptionApprovals.map((approval) => [
      approval.eventReference,
      approval,
    ]),
  );
  const classified = options.observed.map((event) =>
    classifyEvent(
      event,
      options.desired,
      options.ownership,
      approvalByReference,
    ),
  );
  const staleApproval = options.adoptionApprovals.some(
    (approval) => !observedReferences.has(approval.eventReference),
  );
  const blockers = new Set<string>();
  if (options.invalidProviderItemCount > 0)
    blockers.add('calendar-provider-items-invalid');
  if (options.unsupportedProviderItemCount > 0)
    blockers.add('calendar-provider-items-unsupported');
  if (staleApproval) blockers.add('calendar-adoption-approval-stale');
  if (
    classified.some(
      (entry) => entry.classification === 'legacy-match-candidate',
    )
  )
    blockers.add('calendar-legacy-adoption-required');
  if (classified.some((entry) => entry.classification === 'ambiguous'))
    blockers.add('calendar-ownership-ambiguous');

  const owned = classified.flatMap((entry): ExistingCalendarEvent[] => {
    if (
      entry.classification !== 'verified-owned' &&
      entry.classification !== 'approved-adoption'
    )
      return [];
    return [
      {
        eventReference: entry.event.eventReference,
        ownership: options.ownership,
        summary: entry.event.summary,
        description: entry.event.description,
        startsAt: entry.event.startsAt,
        endsAt: entry.event.endsAt,
        timeZone: entry.event.timeZone,
      },
    ];
  });
  const plan = planCalendarReconciliation({
    plan: options.plan,
    desired: options.desired,
    existing: owned,
    ownership: options.ownership,
    force: options.force,
    ...(options.previousFingerprint === undefined
      ? {}
      : { previousFingerprint: options.previousFingerprint }),
  });
  if (plan.diagnostics.some((entry) => entry.severity === 'error'))
    blockers.add('calendar-intent-plan-invalid');

  const counts = classificationCounts(
    classified,
    options.invalidProviderItemCount,
    options.unsupportedProviderItemCount,
  );
  const readyForReconciliation = blockers.size === 0;
  const evidence = evidenceFor(
    options,
    counts,
    plan.intents,
    readyForReconciliation,
    [...blockers].sort(),
    classified,
  );
  return {
    evidence,
    intents: readyForReconciliation ? plan.intents : [],
  };
}

function classifyEvent(
  event: ObservedCalendarEvent,
  desired: readonly DesiredCalendarEvent[],
  ownership: CalendarOwnership,
  approvalByReference: ReadonlyMap<string, CalendarAdoptionApproval>,
): ClassifiedEvent {
  const evidenceReference = calendarEventEvidenceReference(event);
  const properties = event.privateOwnership;
  const markerCount = [
    properties.owner,
    properties.scopeId,
    properties.ownershipMarker,
  ].filter((value) => value !== undefined).length;
  if (event.recurringInstance)
    return { classification: 'ambiguous', event, evidenceReference };
  if (
    properties.owner === 'classroom-hub' &&
    properties.scopeId === ownership.scopeId &&
    properties.ownershipMarker === ownership.ownershipMarker
  )
    return { classification: 'verified-owned', event, evidenceReference };
  if (markerCount > 0)
    return { classification: 'ambiguous', event, evidenceReference };

  const exactDesiredMatch = desired.some((entry) => sameFields(event, entry));
  const approvedLegacyMatch = desired.some((entry) =>
    legacyCompatibleFields(event, entry),
  );
  const adoptableMatch = exactDesiredMatch || approvedLegacyMatch;
  const approval = approvalByReference.get(event.eventReference);
  if (approval !== undefined) {
    if (
      approval.scopeId === ownership.scopeId &&
      approval.ownershipMarker === ownership.ownershipMarker &&
      approval.eventFingerprint === fingerprintEvent(event) &&
      adoptableMatch
    )
      return { classification: 'approved-adoption', event, evidenceReference };
    return { classification: 'ambiguous', event, evidenceReference };
  }
  if (adoptableMatch)
    return {
      classification: 'legacy-match-candidate',
      event,
      evidenceReference,
    };
  if (desired.some((entry) => overlapsOrSharesSummary(event, entry)))
    return { classification: 'ambiguous', event, evidenceReference };
  return { classification: 'unrelated', event, evidenceReference };
}

export function calendarEventEvidenceReference(
  event: ObservedCalendarEvent,
): string {
  return digest({
    eventReference: event.eventReference,
    eventType: event.eventType,
    recurringInstance: event.recurringInstance,
    privateOwnership: event.privateOwnership,
    fields: eventFields(event),
  });
}

function legacyCompatibleFields(
  event: ObservedCalendarEvent,
  desired: DesiredCalendarEvent,
): boolean {
  return (
    desired.description === calendarProjectionDescription &&
    event.summary === desired.summary &&
    event.startsAt === desired.startsAt &&
    event.endsAt === desired.endsAt &&
    event.timeZone === desired.timeZone &&
    validLegacyPowerSchoolDescription(event.description)
  );
}

function validLegacyPowerSchoolDescription(value: string): boolean {
  const prefix = 'Imported from PowerSchool Bell Schedule (';
  const suffix = ').';
  if (!value.startsWith(prefix) || !value.endsWith(suffix)) return false;
  const label = value.slice(prefix.length, -suffix.length);
  if (
    label.length < 1 ||
    label.length > 256 ||
    label.trim() !== label ||
    label.normalize('NFC') !== label ||
    /[\p{Cc}\p{Cs}\p{Zl}\p{Zp}]/u.test(label)
  )
    return false;
  let depth = 0;
  for (const character of label) {
    if (character === '(') depth += 1;
    if (character === ')') depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0;
}

export function fingerprintEvent(event: ObservedCalendarEvent): string {
  return digest(eventFields(event));
}

function eventFields(event: CalendarEventFields): object {
  return {
    summary: event.summary,
    description: event.description,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    timeZone: event.timeZone,
  };
}

function sameFields(
  event: ObservedCalendarEvent,
  desired: DesiredCalendarEvent,
): boolean {
  return (
    stableSerialize(eventFields(event)) ===
    stableSerialize(eventFields(desired))
  );
}

function overlapsOrSharesSummary(
  event: ObservedCalendarEvent,
  desired: DesiredCalendarEvent,
): boolean {
  const eventStart = epoch(event.startsAt);
  const eventEnd = epoch(event.endsAt);
  const desiredStart = epoch(desired.startsAt);
  const desiredEnd = epoch(desired.endsAt);
  return (
    event.summary === desired.summary ||
    (eventStart !== undefined &&
      eventEnd !== undefined &&
      desiredStart !== undefined &&
      desiredEnd !== undefined &&
      eventStart < desiredEnd &&
      desiredStart < eventEnd)
  );
}

function validOwnership(value: CalendarOwnership): boolean {
  return (
    value.classification === 'verified-application-owned' &&
    boundedId(value.scopeId) &&
    value.ownershipMarker === calendarOwnershipMarker
  );
}

function validAuditContext(options: {
  readonly calendarId: string;
  readonly timeMin: string;
  readonly timeMax: string;
}): boolean {
  const start = epoch(options.timeMin);
  const end = epoch(options.timeMax);
  return (
    (options.calendarId === 'primary' ||
      /^[A-Za-z0-9][A-Za-z0-9._@-]{0,511}$/u.test(options.calendarId)) &&
    isIsoInstant(options.timeMin) &&
    isIsoInstant(options.timeMax) &&
    start !== undefined &&
    end !== undefined &&
    start < end &&
    end - start <= 31 * 86_400_000
  );
}

function validObservedEvent(value: ObservedCalendarEvent): boolean {
  if (
    !isPlainObject(value) ||
    !hasExactKeys(value, [
      'eventReference',
      'eventType',
      'recurringInstance',
      'privateOwnership',
      'summary',
      'description',
      'startsAt',
      'endsAt',
      'timeZone',
    ]) ||
    !boundedId(value.eventReference, 1_024) ||
    value.eventType !== 'default' ||
    typeof value.recurringInstance !== 'boolean' ||
    !boundedText(value.summary, 3_000, false) ||
    !boundedText(value.description, 30_000, true) ||
    !isIsoInstant(value.startsAt) ||
    !isIsoInstant(value.endsAt) ||
    epoch(value.startsAt) === undefined ||
    epoch(value.endsAt) === undefined ||
    epoch(value.startsAt)! >= epoch(value.endsAt)! ||
    !isIanaTimeZone(value.timeZone) ||
    !isPlainObject(value.privateOwnership) ||
    !hasExactKeys(
      value.privateOwnership,
      [],
      ['owner', 'scopeId', 'ownershipMarker'],
    )
  )
    return false;
  return [
    value.privateOwnership.owner,
    value.privateOwnership.scopeId,
    value.privateOwnership.ownershipMarker,
  ].every((entry) => entry === undefined || boundedText(entry, 128, false));
}

function validApprovals(options: {
  readonly adoptionApprovals: readonly CalendarAdoptionApproval[];
  readonly observed: readonly ObservedCalendarEvent[];
  readonly invalidProviderItemCount: number;
  readonly unsupportedProviderItemCount: number;
}): boolean {
  if (
    !Number.isSafeInteger(options.invalidProviderItemCount) ||
    options.invalidProviderItemCount < 0 ||
    !Number.isSafeInteger(options.unsupportedProviderItemCount) ||
    options.unsupportedProviderItemCount < 0 ||
    options.adoptionApprovals.length > 500 ||
    options.observed.length > 1_000
  )
    return false;
  const references = new Set<string>();
  for (const approval of options.adoptionApprovals) {
    if (
      approval.disposition !== 'approved-adoption' ||
      !boundedId(approval.eventReference, 1_024) ||
      !/^sha256:[a-f0-9]{64}$/u.test(approval.eventFingerprint) ||
      !boundedId(approval.scopeId) ||
      !boundedId(approval.ownershipMarker) ||
      references.has(approval.eventReference)
    )
      return false;
    references.add(approval.eventReference);
  }
  return true;
}

function classificationCounts(
  classified: readonly ClassifiedEvent[],
  invalidProviderItems: number,
  unsupportedProviderItems: number,
): CalendarAuditCounts {
  const count = (classification: CalendarOwnershipClassification): number =>
    classified.filter((entry) => entry.classification === classification)
      .length;
  return {
    observed: classified.length,
    verifiedOwned: count('verified-owned'),
    approvedAdoptions: count('approved-adoption'),
    legacyCandidates: count('legacy-match-candidate'),
    ambiguous: count('ambiguous'),
    unrelated: count('unrelated'),
    invalidProviderItems,
    unsupportedProviderItems,
  };
}

function evidenceFor(
  options: CalendarOwnershipAuditOptions,
  counts: CalendarAuditCounts,
  intents: readonly CalendarMutationIntent[],
  readyForReconciliation: boolean,
  blockerCodes: readonly string[],
  classified: readonly ClassifiedEvent[],
): CalendarAuditEvidence {
  const proposedIntentCounts = intentCounts(intents);
  const candidateEvidenceReferences = classified
    .filter(
      (entry) =>
        entry.classification === 'legacy-match-candidate' ||
        entry.classification === 'ambiguous',
    )
    .map((entry) => entry.evidenceReference)
    .sort();
  return {
    auditFingerprint: digest({
      calendarReferenceHash: digest(options.calendarId),
      window: { timeMin: options.timeMin, timeMax: options.timeMax },
      ownership: options.ownership ?? 'invalid',
      planHash: digest(options.plan),
      desiredHash: digest(options.desired),
      adoptionManifestHash: digest(options.adoptionApprovals),
      counts,
      proposedIntentCounts,
      proposedIntentFingerprints: intents.map(digest).sort(),
      blockerCodes,
      classifiedEventFingerprints: classified
        .map((entry) =>
          digest({
            classification: entry.classification,
            evidenceReference: entry.evidenceReference,
          }),
        )
        .sort(),
      candidateEvidenceReferences,
    }),
    readyForReconciliation,
    counts,
    proposedIntentCounts,
    eligibleIntentCount: readyForReconciliation ? intents.length : 0,
    blockerCodes,
    candidateEvidenceReferences,
    attemptedExternalMutations: 0,
    completedExternalMutations: 0,
  };
}

function intentCounts(
  intents: readonly CalendarMutationIntent[],
): CalendarIntentCounts {
  return {
    noOp: intents.filter((intent) => intent.kind === 'no-op').length,
    create: intents.filter((intent) => intent.kind === 'create').length,
    replace: intents.filter((intent) => intent.kind === 'replace').length,
    delete: intents.filter((intent) => intent.kind === 'delete').length,
  };
}

function blocked(
  options: CalendarOwnershipAuditOptions,
  blockerCodes: readonly string[],
  classified: readonly ClassifiedEvent[],
): CalendarOwnershipAuditResult {
  const counts = classificationCounts(
    classified,
    safeCount(options.invalidProviderItemCount),
    safeCount(options.unsupportedProviderItemCount),
  );
  return {
    evidence: evidenceFor(options, counts, [], false, blockerCodes, classified),
    intents: [],
  };
}

function safeCount(value: number): number {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function digest(value: unknown): string {
  return `sha256:${createHash('sha256').update(stableSerialize(value)).digest('hex')}`;
}

function boundedId(value: string, maximum = 128): boolean {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= maximum &&
    !/[\0\r\n]/u.test(value)
  );
}

function boundedText(
  value: unknown,
  maximumBytes: number,
  allowEmpty: boolean,
): value is string {
  return (
    typeof value === 'string' &&
    Buffer.byteLength(value, 'utf8') <= maximumBytes &&
    (allowEmpty || value.length > 0) &&
    !/[\0\r\n]/u.test(value)
  );
}
