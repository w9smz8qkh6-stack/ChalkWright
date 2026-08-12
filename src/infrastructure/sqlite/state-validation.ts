import type {
  SafeStateRecord,
  SafeStateRecordKind,
  StateScope,
} from '../../ports/application-state.js';
import {
  containsUndefined,
  hasExactKeys,
  isAttendanceLinks,
  isAttendanceSummary,
  isCanonicalPlan,
  isDiagnostics,
  isEffectivePlan,
  isIanaTimeZone,
  isIsoDate,
  isIsoInstant,
  isJobOutcome,
  isNonEmptyString,
  isNonNegativeInteger,
  isPlainObject,
  isScheduleObservation,
  isScopedDisplayOverride,
  isStaticClassContent,
  isStringArray,
  isVocabularyHistoryEntry,
  isVocabularySelection,
} from '../../domain/runtime-validation.js';

export { isCanonicalPlan, isEffectivePlan };

const kinds = new Set<SafeStateRecordKind>([
  'schedule-observation',
  'configuration',
  'mapping',
  'content',
  'vocabulary-selection',
  'vocabulary-history',
  'attendance',
  'override',
  'hold',
  'calendar-ownership-candidate',
  'calendar-reconciliation-state',
  'alert-state',
  'job-run',
  'comparison-evidence',
  'temporary-operational-state',
]);

function isScope(value: unknown): value is StateScope {
  return (
    isPlainObject(value) &&
    hasExactKeys(
      value,
      [],
      ['date', 'screenId', 'roomId', 'classId', 'meetingId', 'planId'],
    ) &&
    (value.date === undefined || isIsoDate(value.date)) &&
    (value.screenId === undefined || isNonEmptyString(value.screenId)) &&
    (value.roomId === undefined || isNonEmptyString(value.roomId)) &&
    (value.classId === undefined || isNonEmptyString(value.classId)) &&
    (value.meetingId === undefined || isNonEmptyString(value.meetingId)) &&
    (value.planId === undefined || isNonEmptyString(value.planId))
  );
}

function hasScope(
  scope: StateScope,
  ...keys: readonly (keyof StateScope)[]
): boolean {
  return keys.every((key) => isNonEmptyString(scope[key]));
}

function isConfiguration(data: Record<string, unknown>): boolean {
  return (
    hasExactKeys(data, [
      'configurationVersion',
      'effectiveAt',
      'timeZone',
      'morningCutoff',
      'showCheckIn',
      'checkInOpenMinutesBefore',
      'dismissalWarningMinutesBefore',
    ]) &&
    isNonEmptyString(data.configurationVersion) &&
    isIsoInstant(data.effectiveAt) &&
    isIanaTimeZone(data.timeZone) &&
    typeof data.morningCutoff === 'string' &&
    /^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(data.morningCutoff) &&
    typeof data.showCheckIn === 'boolean' &&
    isNonNegativeInteger(data.checkInOpenMinutesBefore) &&
    isNonNegativeInteger(data.dismissalWarningMinutesBefore)
  );
}

function isMapping(data: Record<string, unknown>): boolean {
  return (
    hasExactKeys(
      data,
      ['classId', 'courseKey', 'roomId'],
      ['screenId', 'periodId'],
    ) &&
    isNonEmptyString(data.classId) &&
    isNonEmptyString(data.courseKey) &&
    isNonEmptyString(data.roomId) &&
    (data.screenId === undefined || isNonEmptyString(data.screenId)) &&
    (data.periodId === undefined || isNonEmptyString(data.periodId))
  );
}

function isHold(data: Record<string, unknown>): boolean {
  if (
    !hasExactKeys(
      data,
      ['status', 'heldAt', 'reasonCode'],
      ['expiresAt', 'releasedAt', 'expiredAt'],
    ) ||
    (data.status !== 'held' &&
      data.status !== 'released' &&
      data.status !== 'expired') ||
    !isIsoInstant(data.heldAt) ||
    !isNonEmptyString(data.reasonCode) ||
    (data.expiresAt !== undefined && !isIsoInstant(data.expiresAt)) ||
    (data.releasedAt !== undefined && !isIsoInstant(data.releasedAt)) ||
    (data.expiredAt !== undefined && !isIsoInstant(data.expiredAt))
  )
    return false;
  const heldAt = Date.parse(data.heldAt as string);
  return (
    (data.expiresAt === undefined || Date.parse(data.expiresAt) >= heldAt) &&
    (data.releasedAt === undefined || Date.parse(data.releasedAt) >= heldAt) &&
    (data.expiredAt === undefined || Date.parse(data.expiredAt) >= heldAt) &&
    (data.status === 'held'
      ? data.releasedAt === undefined && data.expiredAt === undefined
      : data.status === 'released'
        ? data.releasedAt !== undefined && data.expiredAt === undefined
        : data.expiredAt !== undefined && data.releasedAt === undefined)
  );
}

function isCalendarCandidate(data: Record<string, unknown>): boolean {
  return (
    hasExactKeys(data, [
      'scopeId',
      'ownershipMarker',
      'evidenceReference',
      'status',
    ]) &&
    isNonEmptyString(data.scopeId) &&
    isNonEmptyString(data.ownershipMarker) &&
    isNonEmptyString(data.evidenceReference) &&
    (data.status === 'candidate' ||
      data.status === 'rejected' ||
      data.status === 'superseded')
  );
}

function isCalendarState(data: Record<string, unknown>): boolean {
  return (
    hasExactKeys(data, [
      'scopeId',
      'lastSuccessfulFingerprint',
      'completedAt',
    ]) &&
    isNonEmptyString(data.scopeId) &&
    isNonEmptyString(data.lastSuccessfulFingerprint) &&
    isIsoInstant(data.completedAt)
  );
}

function isJobRun(data: Record<string, unknown>): boolean {
  return (
    hasExactKeys(
      data,
      [
        'outcome',
        'errorCodes',
        'incidentCodes',
        'requestedDates',
        'provenanceReferences',
      ],
      ['inputFingerprint', 'outputFingerprint', 'latestStateReference'],
    ) &&
    isJobOutcome(data.outcome) &&
    isPlainObject(data.outcome) &&
    typeof data.outcome.jobName === 'string' &&
    data.outcome.jobName.length <= 128 &&
    isBoundedEvidenceCodes(data.errorCodes) &&
    isBoundedEvidenceCodes(data.incidentCodes) &&
    Array.isArray(data.requestedDates) &&
    data.requestedDates.length <= 366 &&
    data.requestedDates.every(isIsoDate) &&
    isBoundedEvidenceCodes(data.provenanceReferences) &&
    (data.inputFingerprint === undefined ||
      isNonEmptyString(data.inputFingerprint)) &&
    (data.outputFingerprint === undefined ||
      isNonEmptyString(data.outputFingerprint)) &&
    (data.latestStateReference === undefined ||
      isNonEmptyString(data.latestStateReference))
  );
}

function isBoundedEvidenceCodes(value: unknown): value is readonly string[] {
  return (
    isStringArray(value) &&
    value.length <= 128 &&
    value.every((entry) => entry.length <= 128)
  );
}

export function isAlertCheckpoint(data: unknown): boolean {
  if (
    !isPlainObject(data) ||
    !hasExactKeys(
      data,
      [
        'activeIssueFingerprints',
        'lastSuccessfulIssueFingerprints',
        'lastDecision',
        'decidedAt',
        'deliveryMode',
        'deliveryState',
      ],
      ['lastSuccessfulDeliveryAt'],
    ) ||
    !Array.isArray(data.activeIssueFingerprints) ||
    !isFingerprintArray(data.activeIssueFingerprints) ||
    !isFingerprintArray(data.lastSuccessfulIssueFingerprints) ||
    (data.lastDecision !== 'new' &&
      data.lastDecision !== 'unchanged' &&
      data.lastDecision !== 'repeat' &&
      data.lastDecision !== 'recovery' &&
      data.lastDecision !== 'mixed' &&
      data.lastDecision !== 'no-send') ||
    !isIsoInstant(data.decidedAt) ||
    (data.lastSuccessfulDeliveryAt !== undefined &&
      !isIsoInstant(data.lastSuccessfulDeliveryAt)) ||
    (data.deliveryMode !== 'report-only' && data.deliveryMode !== 'fake') ||
    (data.deliveryState !== 'not-attempted' &&
      data.deliveryState !== 'delivered' &&
      data.deliveryState !== 'failed')
  )
    return false;
  return (
    (data.lastSuccessfulIssueFingerprints.length === 0 ||
      data.lastSuccessfulDeliveryAt !== undefined) &&
    (data.deliveryState !== 'delivered' ||
      (data.lastSuccessfulDeliveryAt !== undefined &&
        data.lastSuccessfulDeliveryAt >= data.decidedAt &&
        arraysEqual(
          data.lastSuccessfulIssueFingerprints,
          data.activeIssueFingerprints,
        ))) &&
    (data.deliveryState === 'delivered' ||
      data.lastSuccessfulDeliveryAt === undefined ||
      data.lastSuccessfulDeliveryAt <= data.decidedAt) &&
    (data.deliveryMode === 'report-only'
      ? data.lastDecision === 'no-send' &&
        data.deliveryState === 'not-attempted'
      : data.deliveryState === 'not-attempted'
        ? data.lastDecision === 'unchanged'
        : data.lastDecision === 'new' ||
          data.lastDecision === 'repeat' ||
          data.lastDecision === 'recovery' ||
          data.lastDecision === 'mixed')
  );
}

function arraysEqual(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((entry, index) => entry === right[index])
  );
}

function isFingerprintArray(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.length <= 128 &&
    isStringArray(value) &&
    value.every(
      (fingerprint, index) =>
        /^fnv1a64:[0-9a-f]{16}$/u.test(fingerprint) &&
        (index === 0 || value[index - 1]! < fingerprint),
    )
  );
}

function isComparison(data: Record<string, unknown>): boolean {
  return (
    hasExactKeys(data, [
      'comparedAt',
      'equal',
      'differenceCodes',
      'diagnostics',
    ]) &&
    isIsoInstant(data.comparedAt) &&
    typeof data.equal === 'boolean' &&
    isStringArray(data.differenceCodes) &&
    isDiagnostics(data.diagnostics)
  );
}

function isTemporaryState(data: Record<string, unknown>): boolean {
  return (
    hasExactKeys(data, ['state', 'code', 'observedAt']) &&
    (data.state === 'pending' ||
      data.state === 'ready' ||
      data.state === 'completed' ||
      data.state === 'failed') &&
    isNonEmptyString(data.code) &&
    isIsoInstant(data.observedAt)
  );
}

export function isSafeStateRecord(value: unknown): value is SafeStateRecord {
  if (
    !isPlainObject(value) ||
    !hasExactKeys(
      value,
      ['kind', 'recordKey', 'scope', 'data'],
      ['active', 'academicYearEnd', 'expiresAt'],
    ) ||
    !kinds.has(value.kind as SafeStateRecordKind) ||
    !isNonEmptyString(value.recordKey) ||
    !isScope(value.scope) ||
    !isPlainObject(value.data) ||
    (value.active !== undefined && typeof value.active !== 'boolean') ||
    (value.academicYearEnd !== undefined &&
      !isIsoDate(value.academicYearEnd)) ||
    (value.expiresAt !== undefined && !isIsoInstant(value.expiresAt)) ||
    containsUndefined(value)
  )
    return false;

  const kind = value.kind as SafeStateRecordKind;
  const scope = value.scope;
  const data = value.data;
  switch (kind) {
    case 'schedule-observation':
      return (
        hasExactKeys(data, ['observation']) &&
        isScheduleObservation(data.observation) &&
        hasScope(scope, 'date', 'roomId') &&
        scope.date === data.observation.observedForDate &&
        data.observation.periods.every(
          (period) =>
            period.roomKey === undefined || period.roomKey === scope.roomId,
        )
      );
    case 'configuration':
      return isConfiguration(data);
    case 'mapping':
      return (
        isMapping(data) &&
        hasScope(scope, 'classId', 'roomId') &&
        scope.classId === data.classId &&
        scope.roomId === data.roomId &&
        (data.screenId === undefined || scope.screenId === data.screenId)
      );
    case 'content':
      return (
        hasExactKeys(data, ['classId', 'content']) &&
        isNonEmptyString(data.classId) &&
        isStaticClassContent(data.content) &&
        hasScope(scope, 'classId') &&
        scope.classId === data.classId
      );
    case 'vocabulary-selection':
      return (
        hasExactKeys(data, ['selection']) &&
        isVocabularySelection(data.selection) &&
        hasScope(scope, 'date', 'classId', 'meetingId') &&
        (data.selection.selectionContext === undefined ||
          data.selection.selectionContext.meetingDate === scope.date) &&
        (data.selection.historyIntent === undefined ||
          (data.selection.historyIntent.entry.date === scope.date &&
            data.selection.historyIntent.entry.classId === scope.classId &&
            data.selection.historyIntent.entry.meetingKey === scope.meetingId))
      );
    case 'vocabulary-history':
      return (
        hasExactKeys(data, ['entries']) &&
        Array.isArray(data.entries) &&
        data.entries.every(isVocabularyHistoryEntry) &&
        hasScope(scope, 'classId') &&
        data.entries.every((entry) => entry.classId === scope.classId)
      );
    case 'attendance':
      return (
        hasExactKeys(data, ['links', 'summary']) &&
        isAttendanceLinks(data.links) &&
        isAttendanceSummary(data.summary) &&
        hasScope(scope, 'date', 'classId', 'meetingId')
      );
    case 'override':
      return (
        hasExactKeys(data, ['override']) &&
        isScopedDisplayOverride(data.override) &&
        hasScope(scope, 'date', 'screenId') &&
        scope.date === data.override.date &&
        scope.screenId === data.override.screenId
      );
    case 'hold':
      return (
        isHold(data) &&
        hasScope(scope, 'date', 'screenId', 'meetingId', 'planId') &&
        (data.status === 'held'
          ? value.expiresAt === data.expiresAt
          : value.expiresAt === undefined)
      );
    case 'calendar-ownership-candidate':
      return isCalendarCandidate(data);
    case 'calendar-reconciliation-state':
      return isCalendarState(data);
    case 'alert-state':
      return (
        value.recordKey === 'operations-alert-checkpoint' &&
        isAlertCheckpoint(data) &&
        Object.keys(scope).length === 0
      );
    case 'job-run':
      return value.recordKey.length <= 128 && isJobRun(data);
    case 'comparison-evidence':
      return isComparison(data) && hasScope(scope, 'date', 'screenId');
    case 'temporary-operational-state':
      return isTemporaryState(data);
  }
}
