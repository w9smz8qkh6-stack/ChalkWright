import {
  hasExactKeys,
  isEnumValue,
  isIanaTimeZone,
  isIsoDate,
  isIsoInstant,
  isJsonSafeValue,
  isNonNegativeInteger,
  isPlainObject,
} from '../runtime-validation.js';
import { operationalIssueCodes, type OperationalIssueCode } from './health.js';

export interface BriefCounts {
  readonly screens: number;
  readonly meetings: number;
  readonly issues: number;
}

interface BriefBase {
  readonly timeZone: string;
  readonly generatedAt: string;
  readonly targetDate: string;
  readonly status: 'healthy' | 'degraded' | 'unhealthy';
  readonly counts: BriefCounts;
  readonly issueCodes: readonly OperationalIssueCode[];
}

/**
 * This intentionally minimal contract does not settle U-015 content,
 * destination, recipients, delivery, or failure wording.
 */
export interface MorningOperationalBrief extends BriefBase {
  readonly kind: 'morning';
  readonly targetDateSemantics: 'current-local-day';
}

/** The evening workflow remains distinct while U-015 details stay unresolved. */
export interface EveningScheduleBrief extends BriefBase {
  readonly kind: 'evening';
  readonly targetDateSemantics: 'next-configured-class-day';
}

export type OperatorBrief = MorningOperationalBrief | EveningScheduleBrief;

function isBriefCounts(value: unknown): value is BriefCounts {
  return (
    isJsonSafeValue(value) &&
    isPlainObject(value) &&
    hasExactKeys(value, ['screens', 'meetings', 'issues']) &&
    isNonNegativeInteger(value.screens) &&
    isNonNegativeInteger(value.meetings) &&
    isNonNegativeInteger(value.issues)
  );
}

function isIssueCodes(
  value: unknown,
): value is readonly OperationalIssueCode[] {
  return (
    Array.isArray(value) &&
    isJsonSafeValue(value) &&
    value.every(
      (entry, index) =>
        isEnumValue(entry, operationalIssueCodes) &&
        (index === 0 || value[index - 1]! < entry),
    )
  );
}

const warningIssueCodes = new Set<OperationalIssueCode>([
  'assignment-stale',
  'preview-diagnostics-warning',
  'source-sync-stale',
]);

function expectedBriefStatus(
  issueCodes: readonly OperationalIssueCode[],
): OperatorBrief['status'] {
  if (issueCodes.length === 0) return 'healthy';
  return issueCodes.every((code) => warningIssueCodes.has(code))
    ? 'degraded'
    : 'unhealthy';
}

function localIsoDate(instant: string, timeZone: string): string | undefined {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(instant));
    const part = (type: Intl.DateTimeFormatPartTypes): string | undefined =>
      parts.find((entry) => entry.type === type)?.value;
    const year = part('year');
    const month = part('month');
    const day = part('day');
    return year === undefined || month === undefined || day === undefined
      ? undefined
      : `${year}-${month}-${day}`;
  } catch {
    return undefined;
  }
}

export function isOperatorBrief(value: unknown): value is OperatorBrief {
  try {
    if (
      !isJsonSafeValue(value) ||
      !isPlainObject(value) ||
      !hasExactKeys(value, [
        'kind',
        'targetDateSemantics',
        'timeZone',
        'generatedAt',
        'targetDate',
        'status',
        'counts',
        'issueCodes',
      ]) ||
      !isIanaTimeZone(value.timeZone) ||
      !isIsoInstant(value.generatedAt) ||
      !isIsoDate(value.targetDate) ||
      !isEnumValue(value.status, [
        'healthy',
        'degraded',
        'unhealthy',
      ] as const) ||
      !isBriefCounts(value.counts) ||
      !isIssueCodes(value.issueCodes) ||
      value.counts.issues < value.issueCodes.length ||
      value.status !== expectedBriefStatus(value.issueCodes)
    )
      return false;
    return (
      (value.kind === 'morning' &&
        value.targetDateSemantics === 'current-local-day') ||
      (value.kind === 'evening' &&
        value.targetDateSemantics === 'next-configured-class-day')
    );
  } catch {
    return false;
  }
}

interface BriefInput {
  readonly timeZone: unknown;
  readonly generatedAt: unknown;
  readonly targetDate: unknown;
  readonly status: unknown;
  readonly counts: unknown;
  readonly issueCodes: unknown;
}

function buildBrief(
  kind: OperatorBrief['kind'],
  input: BriefInput,
): OperatorBrief | undefined {
  try {
    if (
      !isJsonSafeValue(input) ||
      !isPlainObject(input) ||
      !hasExactKeys(input, [
        'timeZone',
        'generatedAt',
        'targetDate',
        'status',
        'counts',
        'issueCodes',
      ]) ||
      !Array.isArray(input.issueCodes) ||
      !input.issueCodes.every((entry) =>
        isEnumValue(entry, operationalIssueCodes),
      )
    )
      return undefined;
    const issueCodes = [...new Set(input.issueCodes)].sort();
    if (
      !isIanaTimeZone(input.timeZone) ||
      !isIsoInstant(input.generatedAt) ||
      !isIsoDate(input.targetDate)
    )
      return undefined;
    const generatedForDate = localIsoDate(input.generatedAt, input.timeZone);
    if (
      generatedForDate === undefined ||
      (kind === 'morning' && input.targetDate !== generatedForDate) ||
      // The caller supplies the class date using existing schedule policy.
      // Calendar-day arithmetic is unsafe across weekends and schedule gaps.
      (kind === 'evening' && input.targetDate <= generatedForDate)
    )
      return undefined;
    const candidate = {
      kind,
      targetDateSemantics:
        kind === 'morning' ? 'current-local-day' : 'next-configured-class-day',
      timeZone: input.timeZone,
      generatedAt: input.generatedAt,
      targetDate: input.targetDate,
      status: input.status,
      counts:
        isPlainObject(input.counts) && isBriefCounts(input.counts)
          ? { ...input.counts }
          : input.counts,
      issueCodes,
    };
    return isOperatorBrief(candidate) ? candidate : undefined;
  } catch {
    return undefined;
  }
}

export function buildMorningBrief(
  input: BriefInput,
): MorningOperationalBrief | undefined {
  return buildBrief('morning', input) as MorningOperationalBrief | undefined;
}

export function buildEveningBrief(
  input: BriefInput,
): EveningScheduleBrief | undefined {
  return buildBrief('evening', input) as EveningScheduleBrief | undefined;
}
