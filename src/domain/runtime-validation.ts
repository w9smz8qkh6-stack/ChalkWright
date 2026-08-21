import { contractVersion } from '../contracts/v1/common.js';
import type {
  ContractDiagnostic,
  Freshness,
  Provenance,
} from '../contracts/v1/common.js';
import type { DayPlanMeeting } from '../contracts/v1/day-plan.js';
import type { ScheduleObservation } from '../contracts/v1/schedule.js';
import type { AttendanceLinks, AttendanceSummary } from './attendance.js';
import type { StaticClassContent } from './content.js';
import type { CanonicalPlan, EffectiveDayPlan } from './plans.js';
import type { ScopedDisplayOverride } from './overrides.js';
import type {
  VocabularyHistoryEntry,
  VocabularySelection,
} from './vocabulary.js';

type PlainObject = Record<string, unknown>;

function safelyValidate(check: () => boolean): boolean {
  try {
    return check();
  } catch {
    return false;
  }
}

function hasOnlyEnumerableDataProperties(value: object): boolean {
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== 'string')) return false;
  return keys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return (
      descriptor !== undefined && 'value' in descriptor && descriptor.enumerable
    );
  });
}

/**
 * Accepts only ordinary, dense JSON arrays. Holes, accessors, proxies, symbol
 * properties, and named properties would not round-trip through JSON exactly.
 */
function isInspectableArray(value: unknown): value is readonly unknown[] {
  try {
    if (!Array.isArray(value)) return false;
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== 'string')) return false;
    const elementKeys = keys.filter(
      (key): key is string => typeof key === 'string' && key !== 'length',
    );
    if (elementKeys.length !== value.length) return false;
    return elementKeys.every((key) => {
      if (!/^(?:0|[1-9]\d*)$/u.test(key)) return false;
      const index = Number(key);
      if (!Number.isSafeInteger(index) || index >= value.length) return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return (
        descriptor !== undefined &&
        'value' in descriptor &&
        descriptor.enumerable
      );
    });
  } catch {
    return false;
  }
}

const verificationStates = new Set(['verified', 'unverified', 'synthetic']);
const diagnosticSeverities = new Set(['info', 'warning', 'error']);
const contentCardTypes = new Set([
  'announcement',
  'bellringer',
  'objective',
  'agenda',
  'assessment_prompt',
  'reminder',
  'card',
  'vocabulary',
  'generic',
]);
const actionableErrorCategories = new Set([
  'invalid-input',
  'not-found',
  'stale-observation',
  'authentication-repair-required',
  'authorization-denied',
  'ownership-ambiguous',
  'conflict',
  'timeout',
  'unavailable',
  'unsafe-configuration',
  'internal',
]);

export function isPlainObject(value: unknown): value is PlainObject {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value))
      return false;
    const prototype = Object.getPrototypeOf(value);
    return (
      (prototype === Object.prototype || prototype === null) &&
      hasOnlyEnumerableDataProperties(value)
    );
  } catch {
    return false;
  }
}

export function hasExactKeys(
  value: PlainObject,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  try {
    if (!isPlainObject(value)) return false;
    const allowed = new Set([...required, ...optional]);
    return (
      required.every(
        (key) => Object.hasOwn(value, key) && value[key] !== undefined,
      ) &&
      Object.keys(value).every(
        (key) => allowed.has(key) && value[key] !== undefined,
      )
    );
  } catch {
    return false;
  }
}

export function containsUndefined(value: unknown): boolean {
  const ancestors = new WeakSet<object>();
  const visit = (entry: unknown): boolean => {
    if (entry === undefined) return true;
    if (entry === null || typeof entry !== 'object') return false;
    if (ancestors.has(entry)) return true;
    if (Array.isArray(entry)) {
      if (!isInspectableArray(entry)) return true;
      ancestors.add(entry);
      const result = entry.some(visit);
      ancestors.delete(entry);
      return result;
    }
    if (!isPlainObject(entry)) return true;
    ancestors.add(entry);
    const result = Object.values(entry).some(visit);
    ancestors.delete(entry);
    return result;
  };
  try {
    return visit(value);
  } catch {
    return true;
  }
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function isNonNegativeInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value) && value >= 0;
}

export function isEnumValue<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
): value is Values[number] {
  return typeof value === 'string' && values.includes(value);
}

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= (days[month - 1] ?? 0);
}

/** Accepts the repository's canonical UTC form, with no offset or excess precision. */
export function isIsoInstant(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match =
    /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{3})?Z$/u.exec(value);
  if (match === null || !isIsoDate(match[1])) return false;
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  const second = Number(match[4]);
  if (hour > 23 || minute > 59 || second > 59) return false;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return false;
  const normalized = parsed.toISOString();
  return match[5] === undefined
    ? normalized.replace('.000Z', 'Z') === value
    : normalized === value;
}

export function isIanaTimeZone(value: unknown): value is string {
  if (!isNonEmptyString(value)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

export function isStringArray(value: unknown): value is readonly string[] {
  return safelyValidate(
    () => isInspectableArray(value) && value.every(isNonEmptyString),
  );
}

export function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

export function isOptionalNonEmptyString(value: unknown): boolean {
  return value === undefined || isNonEmptyString(value);
}

export function isOptionalIsoDate(value: unknown): boolean {
  return value === undefined || isIsoDate(value);
}

export function isOptionalIsoInstant(value: unknown): boolean {
  return value === undefined || isIsoInstant(value);
}

export function isOptionalFiniteNumber(value: unknown): boolean {
  return value === undefined || isFiniteNumber(value);
}

export function isOptionalNonNegativeInteger(value: unknown): boolean {
  return value === undefined || isNonNegativeInteger(value);
}

export function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const parsed = new URL(value);
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      parsed.username.length === 0 &&
      parsed.password.length === 0
    );
  } catch {
    return false;
  }
}

export function isContractDiagnostic(
  value: unknown,
): value is ContractDiagnostic {
  return safelyValidate(
    () =>
      isPlainObject(value) &&
      hasExactKeys(value, ['code', 'severity', 'message']) &&
      isNonEmptyString(value.code) &&
      typeof value.message === 'string' &&
      typeof value.severity === 'string' &&
      diagnosticSeverities.has(value.severity),
  );
}

export function isDiagnostics(
  value: unknown,
): value is readonly ContractDiagnostic[] {
  return safelyValidate(
    () => isInspectableArray(value) && value.every(isContractDiagnostic),
  );
}

export function isProvenance(value: unknown): value is Provenance {
  return safelyValidate(
    () =>
      isPlainObject(value) &&
      hasExactKeys(value, [
        'source',
        'method',
        'observedAt',
        'verification',
        'sourceReference',
      ]) &&
      isEnumValue(value.source, [
        'synthetic-fixture',
        'powerschool',
        'google-classroom',
        'local-configuration',
        'legacy-transition',
      ] as const) &&
      isEnumValue(value.method, [
        'fixture',
        'session-http',
        'browser-read',
        'api-read',
        'local-import',
      ] as const) &&
      isIsoInstant(value.observedAt) &&
      typeof value.verification === 'string' &&
      verificationStates.has(value.verification) &&
      isNonEmptyString(value.sourceReference),
  );
}

export function isFreshness(value: unknown): value is Freshness {
  return safelyValidate(
    () =>
      isPlainObject(value) &&
      hasExactKeys(
        value,
        ['state', 'observedAt'],
        ['expiresAt', 'lastSuccessfulAt'],
      ) &&
      isEnumValue(value.state, ['fresh', 'stale', 'unknown'] as const) &&
      isIsoInstant(value.observedAt) &&
      isOptionalIsoInstant(value.expiresAt) &&
      isOptionalIsoInstant(value.lastSuccessfulAt),
  );
}

function isSchedulePeriod(value: unknown): boolean {
  return (
    isPlainObject(value) &&
    hasExactKeys(
      value,
      ['periodId', 'courseKey', 'blockLabel', 'startsAt', 'endsAt'],
      ['roomKey'],
    ) &&
    isNonEmptyString(value.periodId) &&
    isNonEmptyString(value.courseKey) &&
    typeof value.blockLabel === 'string' &&
    isOptionalNonEmptyString(value.roomKey) &&
    isIsoInstant(value.startsAt) &&
    isIsoInstant(value.endsAt) &&
    value.startsAt < value.endsAt
  );
}

export function isScheduleObservation(
  value: unknown,
): value is ScheduleObservation {
  return safelyValidate(
    () =>
      isPlainObject(value) &&
      hasExactKeys(value, [
        'contractVersion',
        'observationId',
        'observedForDate',
        'kind',
        'verification',
        'periods',
        'provenance',
        'freshness',
        'diagnostics',
      ]) &&
      value.contractVersion === contractVersion &&
      isNonEmptyString(value.observationId) &&
      isIsoDate(value.observedForDate) &&
      isEnumValue(value.kind, ['normal', 'special', 'no-classes'] as const) &&
      typeof value.verification === 'string' &&
      verificationStates.has(value.verification) &&
      isInspectableArray(value.periods) &&
      value.periods.every(isSchedulePeriod) &&
      (value.kind === 'no-classes'
        ? value.periods.length === 0
        : value.periods.length > 0) &&
      isProvenance(value.provenance) &&
      isFreshness(value.freshness) &&
      isDiagnostics(value.diagnostics),
  );
}

export function isDayPlanMeeting(value: unknown): value is DayPlanMeeting {
  return safelyValidate(() => {
    if (
      !isPlainObject(value) ||
      !hasExactKeys(value, [
        'meetingId',
        'courseKey',
        'blockLabel',
        'checkInOpensAt',
        'officialStartsAt',
        'checkInClosesAt',
        'contentStartsAt',
        'dismissalStartsAt',
        'officialEndsAt',
      ]) ||
      !isNonEmptyString(value.meetingId) ||
      !isNonEmptyString(value.courseKey) ||
      typeof value.blockLabel !== 'string' ||
      !isIsoInstant(value.checkInOpensAt) ||
      !isIsoInstant(value.officialStartsAt) ||
      !isIsoInstant(value.checkInClosesAt) ||
      !isIsoInstant(value.contentStartsAt) ||
      !isIsoInstant(value.dismissalStartsAt) ||
      !isIsoInstant(value.officialEndsAt)
    )
      return false;
    const checkInOpensAt = Date.parse(value.checkInOpensAt);
    const officialStartsAt = Date.parse(value.officialStartsAt);
    const checkInClosesAt = Date.parse(value.checkInClosesAt);
    const contentStartsAt = Date.parse(value.contentStartsAt);
    const dismissalStartsAt = Date.parse(value.dismissalStartsAt);
    const officialEndsAt = Date.parse(value.officialEndsAt);
    return (
      checkInOpensAt < officialStartsAt &&
      officialStartsAt === checkInClosesAt &&
      officialStartsAt === contentStartsAt &&
      contentStartsAt < dismissalStartsAt &&
      dismissalStartsAt < officialEndsAt
    );
  });
}

const canonicalPlanKeys = [
  'contractVersion',
  'planId',
  'date',
  'timeZone',
  'roomId',
  'sourceObservationIds',
  'verification',
  'meetings',
  'diagnostics',
] as const;

export function isCanonicalPlan(value: unknown): value is CanonicalPlan {
  return safelyValidate(
    () =>
      isPlainObject(value) &&
      hasExactKeys(value, canonicalPlanKeys) &&
      value.contractVersion === contractVersion &&
      isNonEmptyString(value.planId) &&
      isIsoDate(value.date) &&
      isIanaTimeZone(value.timeZone) &&
      isNonEmptyString(value.roomId) &&
      isStringArray(value.sourceObservationIds) &&
      value.sourceObservationIds.length > 0 &&
      typeof value.verification === 'string' &&
      verificationStates.has(value.verification) &&
      isInspectableArray(value.meetings) &&
      value.meetings.every(isDayPlanMeeting) &&
      isDiagnostics(value.diagnostics),
  );
}

export function isEffectivePlan(value: unknown): value is EffectiveDayPlan {
  return safelyValidate(
    () =>
      isPlainObject(value) &&
      hasExactKeys(value, [
        'contractVersion',
        'effectivePlanId',
        'canonicalPlanId',
        'date',
        'timeZone',
        'roomId',
        'screenId',
        'verification',
        'meetings',
        'diagnostics',
      ]) &&
      value.contractVersion === contractVersion &&
      isNonEmptyString(value.effectivePlanId) &&
      isNonEmptyString(value.canonicalPlanId) &&
      isIsoDate(value.date) &&
      isIanaTimeZone(value.timeZone) &&
      isNonEmptyString(value.roomId) &&
      isNonEmptyString(value.screenId) &&
      typeof value.verification === 'string' &&
      verificationStates.has(value.verification) &&
      isInspectableArray(value.meetings) &&
      value.meetings.every(isDayPlanMeeting) &&
      isDiagnostics(value.diagnostics),
  );
}

export function isContentCard(value: unknown): boolean {
  return safelyValidate(
    () =>
      isPlainObject(value) &&
      hasExactKeys(
        value,
        ['type', 'title', 'lines'],
        ['featured', 'details', 'accent', 'durationSeconds', 'dueDate'],
      ) &&
      typeof value.type === 'string' &&
      contentCardTypes.has(value.type) &&
      typeof value.title === 'string' &&
      isStringArray(value.lines) &&
      isOptionalString(value.featured) &&
      (value.details === undefined || isStringArray(value.details)) &&
      isOptionalString(value.accent) &&
      (value.durationSeconds === undefined ||
        (isFiniteNumber(value.durationSeconds) && value.durationSeconds > 0)) &&
      isOptionalIsoDate(value.dueDate),
  );
}

export function isStaticClassContent(
  value: unknown,
): value is StaticClassContent {
  return safelyValidate(
    () =>
      isPlainObject(value) &&
      hasExactKeys(value, [], ['items']) &&
      (value.items === undefined ||
        (isInspectableArray(value.items) && value.items.every(isContentCard))),
  );
}

export function isAttendanceLinks(value: unknown): value is AttendanceLinks {
  return safelyValidate(() => {
    if (
      !isPlainObject(value) ||
      !hasExactKeys(
        value,
        [],
        [
          'directPrefilled',
          'directResponder',
          'wrapper',
          'quick',
          'teacherDisplay',
          'classroom',
        ],
      )
    )
      return false;
    return Object.values(value).every(isHttpUrl);
  });
}

export function isAttendanceSummary(
  value: unknown,
): value is AttendanceSummary {
  return safelyValidate(() => {
    if (
      !isPlainObject(value) ||
      !hasExactKeys(
        value,
        [],
        [
          'rosterCount',
          'presentCount',
          'tardyCount',
          'absentCount',
          'responseCount',
        ],
      )
    )
      return false;
    return Object.values(value).every(isNonNegativeInteger);
  });
}

export function isDisplayCard(value: unknown): boolean {
  return safelyValidate(
    () =>
      isPlainObject(value) &&
      hasExactKeys(
        value,
        ['cardId', 'title'],
        [
          'type',
          'body',
          'lines',
          'featured',
          'details',
          'accent',
          'durationSeconds',
          'vocabulary',
        ],
      ) &&
      isNonEmptyString(value.cardId) &&
      typeof value.title === 'string' &&
      isOptionalString(value.type) &&
      isOptionalString(value.body) &&
      (value.lines === undefined || isStringArray(value.lines)) &&
      isOptionalString(value.featured) &&
      (value.details === undefined || isStringArray(value.details)) &&
      isOptionalString(value.accent) &&
      (value.durationSeconds === undefined ||
        (isFiniteNumber(value.durationSeconds) && value.durationSeconds > 0)) &&
      (value.vocabulary === undefined ||
        (isPlainObject(value.vocabulary) &&
          hasExactKeys(
            value.vocabulary,
            ['term', 'definition'],
            [
              'pronunciation',
              'partOfSpeech',
              'example',
              'vietnamese',
              'translations',
            ],
          ) &&
          isNonEmptyString(value.vocabulary.term) &&
          isNonEmptyString(value.vocabulary.definition) &&
          isOptionalString(value.vocabulary.pronunciation) &&
          isOptionalString(value.vocabulary.partOfSpeech) &&
          isOptionalString(value.vocabulary.example) &&
          (value.vocabulary.vietnamese === undefined ||
            isVietnamese(value.vocabulary.vietnamese)) &&
          (value.vocabulary.translations === undefined ||
            isVocabularyTranslations(value.vocabulary.translations)))),
  );
}

export function isClassDisplayOverride(value: unknown): boolean {
  return safelyValidate(
    () =>
      isPlainObject(value) &&
      hasExactKeys(
        value,
        [],
        ['cards', 'cardsMode', 'hideAssignments', 'dismissalMessage'],
      ) &&
      (value.cards === undefined ||
        (isInspectableArray(value.cards) &&
          value.cards.every(isDisplayCard))) &&
      (value.cardsMode === undefined ||
        value.cardsMode === 'append' ||
        value.cardsMode === 'replace') &&
      (value.hideAssignments === undefined ||
        typeof value.hideAssignments === 'boolean') &&
      isOptionalString(value.dismissalMessage),
  );
}

export function isScopedDisplayOverride(
  value: unknown,
): value is ScopedDisplayOverride {
  return safelyValidate(() => {
    if (
      !isPlainObject(value) ||
      !hasExactKeys(
        value,
        ['screenId', 'date'],
        ['announcement', 'simulator', 'classes'],
      ) ||
      !isNonEmptyString(value.screenId) ||
      !isIsoDate(value.date) ||
      (value.announcement !== undefined &&
        typeof value.announcement !== 'string' &&
        !isDisplayCard(value.announcement))
    )
      return false;
    if (
      value.simulator !== undefined &&
      (!isPlainObject(value.simulator) ||
        !hasExactKeys(
          value.simulator,
          [],
          ['forcedState', 'forcedMeetingId'],
        ) ||
        !isOptionalString(value.simulator.forcedState) ||
        !isOptionalNonEmptyString(value.simulator.forcedMeetingId))
    )
      return false;
    return (
      value.classes === undefined ||
      (isPlainObject(value.classes) &&
        Object.entries(value.classes).every(
          ([key, entry]) =>
            isNonEmptyString(key) && isClassDisplayOverride(entry),
        ))
    );
  });
}

export function isVietnamese(value: unknown): boolean {
  return safelyValidate(
    () =>
      isPlainObject(value) &&
      hasExactKeys(value, [], ['term', 'definition', 'example']) &&
      Object.values(value).every((entry) => typeof entry === 'string'),
  );
}

export function isVocabularyTranslations(value: unknown): boolean {
  return safelyValidate(() => {
    if (!isInspectableArray(value) || value.length < 1 || value.length > 3)
      return false;
    const languageCodes = new Set<string>();
    for (const translation of value) {
      if (
        !isPlainObject(translation) ||
        !hasExactKeys(
          translation,
          ['languageCode'],
          ['term', 'definition', 'example'],
        ) ||
        !isEnumValue(translation.languageCode, [
          'vi',
          'ko',
          'zh-Hans',
        ] as const) ||
        !isOptionalString(translation.term) ||
        !isOptionalString(translation.definition) ||
        !isOptionalString(translation.example) ||
        languageCodes.has(translation.languageCode) ||
        [translation.term, translation.definition, translation.example].every(
          (entry) => entry === undefined,
        )
      )
        return false;
      languageCodes.add(translation.languageCode);
    }
    return true;
  });
}

export function isVocabularyContext(value: unknown): boolean {
  return safelyValidate(() => {
    if (
      !isPlainObject(value) ||
      !hasExactKeys(value, [
        'assignmentRefs',
        'classroomCourseId',
        'meetingDate',
        'vocabularyPolicy',
        'vocabularyReuse',
        'candidateCount',
        'usedCandidateCount',
        'unusedCandidateCount',
      ]) ||
      !isInspectableArray(value.assignmentRefs)
    )
      return false;
    const referencesValid = value.assignmentRefs.every(
      (entry) =>
        isPlainObject(entry) &&
        hasExactKeys(
          entry,
          ['courseWorkId', 'title', 'timing', 'updateTime'],
          ['dueDate'],
        ) &&
        isNonEmptyString(entry.courseWorkId) &&
        typeof entry.title === 'string' &&
        isEnumValue(entry.timing, ['recent', 'upcoming'] as const) &&
        isIsoInstant(entry.updateTime) &&
        isOptionalIsoDate(entry.dueDate),
    );
    return (
      referencesValid &&
      typeof value.classroomCourseId === 'string' &&
      isIsoDate(value.meetingDate) &&
      isEnumValue(value.vocabularyPolicy, [
        'recorded_same_meeting',
        'unused_focused',
        'unused_best_available',
        'exhausted_best_available',
      ] as const) &&
      isEnumValue(value.vocabularyReuse, [
        'recorded_same_meeting',
        'new',
        'repeat_after_exhaustion',
      ] as const) &&
      isNonNegativeInteger(value.candidateCount) &&
      isNonNegativeInteger(value.usedCandidateCount) &&
      isNonNegativeInteger(value.unusedCandidateCount)
    );
  });
}

export function isVocabularyCandidate(value: unknown): boolean {
  return safelyValidate(
    () =>
      isPlainObject(value) &&
      hasExactKeys(
        value,
        ['term', 'definition', 'source'],
        [
          'subjects',
          'classIds',
          'keywords',
          'codeHsUnits',
          'pronunciation',
          'partOfSpeech',
          'example',
          'vietnamese',
          'translations',
          'accent',
          'durationSeconds',
        ],
      ) &&
      isNonEmptyString(value.term) &&
      isNonEmptyString(value.definition) &&
      isEnumValue(value.source, ['class', 'subject', 'codehs'] as const) &&
      (value.subjects === undefined || isStringArray(value.subjects)) &&
      (value.classIds === undefined || isStringArray(value.classIds)) &&
      (value.keywords === undefined || isStringArray(value.keywords)) &&
      (value.codeHsUnits === undefined || isStringArray(value.codeHsUnits)) &&
      isOptionalString(value.pronunciation) &&
      isOptionalString(value.partOfSpeech) &&
      isOptionalString(value.example) &&
      (value.vietnamese === undefined || isVietnamese(value.vietnamese)) &&
      (value.translations === undefined ||
        isVocabularyTranslations(value.translations)) &&
      isOptionalString(value.accent) &&
      (value.durationSeconds === undefined ||
        (isFiniteNumber(value.durationSeconds) && value.durationSeconds > 0)),
  );
}

export function isVocabularyHistoryEntry(
  value: unknown,
): value is VocabularyHistoryEntry {
  return safelyValidate(
    () =>
      isPlainObject(value) &&
      hasExactKeys(
        value,
        ['classId', 'meetingKey', 'date', 'term'],
        [
          'definition',
          'source',
          'pronunciation',
          'partOfSpeech',
          'example',
          'vietnamese',
          'translations',
          'accent',
          'durationSeconds',
          'selectionContext',
        ],
      ) &&
      isNonEmptyString(value.classId) &&
      isNonEmptyString(value.meetingKey) &&
      isIsoDate(value.date) &&
      isNonEmptyString(value.term) &&
      isOptionalString(value.definition) &&
      (value.source === undefined ||
        isEnumValue(value.source, ['class', 'subject', 'codehs'] as const)) &&
      isOptionalString(value.pronunciation) &&
      isOptionalString(value.partOfSpeech) &&
      isOptionalString(value.example) &&
      (value.vietnamese === undefined || isVietnamese(value.vietnamese)) &&
      (value.translations === undefined ||
        isVocabularyTranslations(value.translations)) &&
      isOptionalString(value.accent) &&
      (value.durationSeconds === undefined ||
        (isFiniteNumber(value.durationSeconds) && value.durationSeconds > 0)) &&
      (value.selectionContext === undefined ||
        isVocabularyContext(value.selectionContext)),
  );
}

export function isVocabularySelection(
  value: unknown,
): value is VocabularySelection {
  return safelyValidate(() => {
    if (
      !isPlainObject(value) ||
      !hasExactKeys(
        value,
        ['diagnostics'],
        [
          'candidate',
          'repeated',
          'accent',
          'durationSeconds',
          'lines',
          'selectionContext',
          'historyIntent',
        ],
      ) ||
      !isDiagnostics(value.diagnostics) ||
      (value.candidate !== undefined &&
        !isVocabularyCandidate(value.candidate)) ||
      (value.repeated !== undefined && typeof value.repeated !== 'boolean') ||
      !isOptionalString(value.accent) ||
      (value.durationSeconds !== undefined &&
        (!isFiniteNumber(value.durationSeconds) ||
          value.durationSeconds <= 0)) ||
      (value.lines !== undefined && !isStringArray(value.lines)) ||
      (value.selectionContext !== undefined &&
        !isVocabularyContext(value.selectionContext))
    )
      return false;
    return (
      value.historyIntent === undefined ||
      (isPlainObject(value.historyIntent) &&
        hasExactKeys(value.historyIntent, ['kind', 'intentId', 'entry']) &&
        value.historyIntent.kind === 'record-selection' &&
        isNonEmptyString(value.historyIntent.intentId) &&
        isVocabularyHistoryEntry(value.historyIntent.entry))
    );
  });
}

export function isJobOutcome(value: unknown): boolean {
  return safelyValidate(() => {
    if (
      !isPlainObject(value) ||
      !hasExactKeys(value, [
        'contractVersion',
        'runId',
        'jobName',
        'startedAt',
        'finishedAt',
        'diagnostics',
        'category',
        'attemptedExternalMutations',
        'completedExternalMutations',
      ]) ||
      value.contractVersion !== contractVersion ||
      !isNonEmptyString(value.runId) ||
      !isNonEmptyString(value.jobName) ||
      !isIsoInstant(value.startedAt) ||
      !isIsoInstant(value.finishedAt) ||
      value.startedAt > value.finishedAt ||
      !isDiagnostics(value.diagnostics) ||
      !isEnumValue(value.category, [
        'succeeded',
        'degraded',
        'skipped',
        'repair-required',
        'failed',
      ] as const) ||
      !isNonNegativeInteger(value.attemptedExternalMutations) ||
      !isNonNegativeInteger(value.completedExternalMutations) ||
      value.completedExternalMutations > value.attemptedExternalMutations
    )
      return false;
    return (
      value.category !== 'repair-required' ||
      (value.attemptedExternalMutations === 0 &&
        value.completedExternalMutations === 0)
    );
  });
}

export function isActionableError(value: unknown): boolean {
  return safelyValidate(
    () =>
      isPlainObject(value) &&
      hasExactKeys(value, [
        'category',
        'code',
        'message',
        'retryable',
        'diagnostics',
      ]) &&
      typeof value.category === 'string' &&
      actionableErrorCategories.has(value.category) &&
      isNonEmptyString(value.code) &&
      typeof value.message === 'string' &&
      typeof value.retryable === 'boolean' &&
      isDiagnostics(value.diagnostics),
  );
}

/** Useful for validating arbitrary nested data without accepting NaN or undefined. */
export function isJsonSafeValue(value: unknown): boolean {
  const ancestors = new WeakSet<object>();
  const visit = (entry: unknown): boolean => {
    if (
      entry === null ||
      typeof entry === 'string' ||
      typeof entry === 'boolean'
    )
      return true;
    if (typeof entry === 'number') return Number.isFinite(entry);
    if (typeof entry !== 'object') return false;
    if (ancestors.has(entry)) return false;
    if (Array.isArray(entry)) {
      if (!isInspectableArray(entry)) return false;
      ancestors.add(entry);
      const result = entry.every(visit);
      ancestors.delete(entry);
      return result;
    }
    if (!isPlainObject(entry)) return false;
    ancestors.add(entry);
    const result =
      Object.keys(entry).every(isNonEmptyString) &&
      Object.values(entry).every(visit);
    ancestors.delete(entry);
    return result;
  };
  try {
    return visit(value);
  } catch {
    return false;
  }
}
