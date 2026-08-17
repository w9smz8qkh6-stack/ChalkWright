import { createHash } from 'node:crypto';

import type {
  IsoDate,
  IsoInstant,
  OpaqueId,
} from '../../contracts/v1/common.js';
import type { DisplayState } from '../../contracts/v1/display.js';
import type { ScreenId } from '../../domain/identities.js';
import { stableSerialize } from '../../domain/pure-values.js';
import { displayStates } from '../../contracts/v1/display.js';
import {
  hasExactKeys,
  isEnumValue,
  isIsoDate,
  isIsoInstant,
  isPlainObject,
} from '../../domain/runtime-validation.js';
import type { SafeStateRecord } from '../../ports/application-state.js';

export interface M17SemanticMeeting {
  readonly startsAt: IsoInstant;
  readonly endsAt: IsoInstant;
  readonly summary: string;
}

export interface M17SemanticSnapshot {
  readonly date: IsoDate;
  readonly timeZone: 'Asia/Ho_Chi_Minh';
  readonly meetings: readonly M17SemanticMeeting[];
  readonly calendar: readonly M17SemanticMeeting[];
  readonly ownershipCoverage: 'all-owned' | 'foreign-present' | 'missing';
  readonly readiness: 'ready' | 'not-ready';
  readonly displayState: DisplayState;
  readonly planVerification: 'verified' | 'unverified' | 'absent';
}

export interface M17SemanticComparisonInput {
  readonly version: 1;
  readonly kind: 'chalkwright-m17-semantic-comparison';
  readonly comparedAt: IsoInstant;
  readonly date: IsoDate;
  readonly screenId: ScreenId;
  readonly reference: M17SemanticSnapshot;
  readonly candidate: M17SemanticSnapshot;
}

export interface M17SemanticComparisonResult {
  readonly equivalent: boolean;
  readonly differenceCodes: readonly string[];
  readonly evidence: Extract<
    SafeStateRecord,
    { readonly kind: 'comparison-evidence' }
  >;
  readonly evidenceFingerprint: string;
}

const fields = [
  ['date', 'm17-date-different'],
  ['timeZone', 'm17-time-zone-different'],
  ['meetings', 'm17-plan-semantics-different'],
  ['calendar', 'm17-calendar-semantics-different'],
  ['ownershipCoverage', 'm17-calendar-ownership-different'],
  ['readiness', 'm17-readiness-different'],
  ['displayState', 'm17-display-state-different'],
  ['planVerification', 'm17-plan-verification-different'],
] as const;

/** Compares only normalized semantics; provider-generated IDs are unrepresentable. */
export function compareM17CanarySemantics(
  input: M17SemanticComparisonInput,
): M17SemanticComparisonResult {
  if (!isM17SemanticComparisonInput(input))
    throw new Error('m17-comparison-input-invalid');
  const differenceCodes: string[] = fields
    .filter(([field]) => !same(input.reference[field], input.candidate[field]))
    .map(([, code]) => code);
  for (const [side, snapshot] of [
    ['reference', input.reference],
    ['candidate', input.candidate],
  ] as const) {
    if (snapshot.readiness !== 'ready')
      differenceCodes.push(`m17-${side}-not-ready`);
    if (snapshot.ownershipCoverage !== 'all-owned')
      differenceCodes.push(`m17-${side}-ownership-not-qualified`);
    if (snapshot.planVerification !== 'verified')
      differenceCodes.push(`m17-${side}-plan-not-verified`);
  }
  differenceCodes.sort();
  const semanticInputFingerprint = digest({
    reference: input.reference,
    candidate: input.candidate,
  });
  const observationFingerprint = digest({
    comparedAt: input.comparedAt,
    reference: input.reference,
    candidate: input.candidate,
  });
  const evidence = {
    kind: 'comparison-evidence',
    recordKey:
      `m17-preactivation-${observationFingerprint.slice(-24)}` as OpaqueId,
    scope: { date: input.date, screenId: input.screenId },
    data: {
      comparedAt: input.comparedAt,
      equal: differenceCodes.length === 0,
      differenceCodes,
      diagnostics: [
        {
          code: `m17-semantic-input-${semanticInputFingerprint.slice('sha256:'.length)}`,
          severity: 'info' as const,
          message:
            'The retained evidence binds both complete normalized semantic inputs.',
        },
        ...differenceCodes.map((code) => ({
          code,
          severity: 'error' as const,
          message: 'The M-17 canary has an unexplained semantic difference.',
        })),
      ],
    },
  } as const;
  return {
    equivalent: differenceCodes.length === 0,
    differenceCodes,
    evidence,
    evidenceFingerprint: digest(evidence),
  };
}

export function isM17SemanticComparisonInput(
  value: unknown,
): value is M17SemanticComparisonInput {
  if (!isPlainObject(value)) return false;
  const record = value as unknown as Record<string, unknown>;
  return (
    hasExactKeys(record, [
      'version',
      'kind',
      'comparedAt',
      'date',
      'screenId',
      'reference',
      'candidate',
    ]) &&
    record.version === 1 &&
    record.kind === 'chalkwright-m17-semantic-comparison' &&
    isIsoInstant(record.comparedAt) &&
    isIsoDate(record.date) &&
    comparisonDateWithinLookahead(record.comparedAt, record.date) &&
    typeof record.screenId === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/u.test(record.screenId) &&
    isSnapshot(record.reference, record.date) &&
    isSnapshot(record.candidate, record.date)
  );
}

function isSnapshot(
  value: unknown,
  date: string,
): value is M17SemanticSnapshot {
  if (!isPlainObject(value)) return false;
  const record = value as unknown as Record<string, unknown>;
  return (
    hasExactKeys(record, [
      'date',
      'timeZone',
      'meetings',
      'calendar',
      'ownershipCoverage',
      'readiness',
      'displayState',
      'planVerification',
    ]) &&
    record.date === date &&
    record.timeZone === 'Asia/Ho_Chi_Minh' &&
    isMeetings(record.meetings, date) &&
    isMeetings(record.calendar, date) &&
    isEnumValue(record.ownershipCoverage, [
      'all-owned',
      'foreign-present',
      'missing',
    ] as const) &&
    isEnumValue(record.readiness, ['ready', 'not-ready'] as const) &&
    isEnumValue(record.displayState, displayStates) &&
    isEnumValue(record.planVerification, [
      'verified',
      'unverified',
      'absent',
    ] as const)
  );
}

function isMeetings(
  value: unknown,
  date: string,
): value is readonly M17SemanticMeeting[] {
  if (!Array.isArray(value) || value.length > 32) return false;
  let previous = '';
  for (const item of value) {
    if (!isPlainObject(item)) return false;
    const record = item as unknown as Record<string, unknown>;
    if (
      !hasExactKeys(record, ['startsAt', 'endsAt', 'summary']) ||
      !isIsoInstant(record.startsAt) ||
      !isIsoInstant(record.endsAt) ||
      Date.parse(record.endsAt) <= Date.parse(record.startsAt) ||
      localDate(record.startsAt) !== date ||
      localDate(record.endsAt) !== date ||
      record.startsAt < previous ||
      typeof record.summary !== 'string' ||
      record.summary.trim() !== record.summary ||
      record.summary.length < 1 ||
      record.summary.length > 160 ||
      /[\p{Cc}\p{Cs}\p{Zl}\p{Zp}]/u.test(record.summary)
    )
      return false;
    previous = record.startsAt;
  }
  return true;
}

function comparisonDateWithinLookahead(
  comparedAt: string,
  date: string,
): boolean {
  const observedDate = localDate(comparedAt);
  if (date < observedDate) return false;
  const observed = Date.parse(`${observedDate}T00:00:00.000Z`);
  const compared = Date.parse(`${date}T00:00:00.000Z`);
  return (
    Number.isFinite(compared) && compared - observed <= 7 * 24 * 60 * 60_000
  );
}

function localDate(instant: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(instant));
  const value = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${value.year}-${value.month}-${value.day}`;
}

function same(left: unknown, right: unknown): boolean {
  return stableSerialize(left) === stableSerialize(right);
}

export function m17EvidenceFingerprint(value: unknown): string {
  return digest(value);
}

function digest(value: unknown): string {
  return `sha256:${createHash('sha256').update(stableSerialize(value)).digest('hex')}`;
}
