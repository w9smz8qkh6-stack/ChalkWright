import type { IsoDate, IsoInstant } from '../../contracts/v1/common.js';
import type { ScheduleKind } from '../../contracts/v1/schedule.js';
import type { Clock } from '../../domain/determinism.js';
import {
  hasExactKeys,
  isIsoDate,
  isIsoInstant,
  isPlainObject,
} from '../../domain/runtime-validation.js';
import { stableFingerprint } from '../../domain/pure-values.js';

export interface PowerSchoolCharacterizationPolicy {
  readonly origin: string;
  readonly requestedDate: IsoDate;
  readonly windowStartsAt: IsoInstant;
  readonly windowEndsAt: IsoInstant;
  readonly statusPath: string;
  readonly bellPath: string;
  readonly allowedMethods: readonly ('GET' | 'HEAD')[];
  readonly maximumTopLevelRequests: number;
  readonly maximumConcurrency: 1;
  readonly requestTimeoutMs: number;
  readonly totalTimeoutMs: number;
  readonly maximumResponseBytesPerRequest: number;
  readonly maximumEvidenceRetentionMs: number;
  readonly authenticationCooloffMs: number;
  readonly repairAllowed: false;
}

export interface CharacterizationReadRequest {
  readonly origin: string;
  readonly path: string;
  readonly method: 'GET' | 'HEAD';
  readonly timeoutMs: number;
  readonly maximumTopLevelRequests: number;
}

export type CharacterizationSurface = 'auth' | 'bell';
export type CharacterizationTransport = 'session-http' | 'browser-read';
export type CharacterizationRedirectClassification =
  'none' | 'same-origin' | 'authentication' | 'off-origin' | 'not-applicable';

export interface CharacterizationSourceMetadata {
  readonly surface: CharacterizationSurface;
  readonly transport: CharacterizationTransport;
  readonly httpStatus?: number;
  readonly redirectClassification: CharacterizationRedirectClassification;
  readonly responseBytes: number;
  readonly durationMs: number;
  readonly diagnosticCodes: readonly string[];
}

export const normalizedScheduleFieldNames = [
  'date',
  'kind',
  'periods',
  'periods.blockLabel',
  'periods.courseKey',
  'periods.endsAt',
  'periods.periodId',
  'periods.roomKey',
  'periods.startsAt',
] as const;

export type NormalizedScheduleFieldName =
  (typeof normalizedScheduleFieldNames)[number];

export interface CharacterizationNormalizedSummary {
  readonly fieldNames: readonly NormalizedScheduleFieldName[];
  readonly periodCount: number;
  readonly roomKeyCount: number;
}

export type CharacterizationStatusResult =
  | {
      readonly status: 'authenticated';
      readonly finalOrigin: string;
      readonly topLevelRequests: number;
      readonly metadata: CharacterizationSourceMetadata;
    }
  | {
      readonly status: 'authentication-required';
      readonly finalOrigin: string;
      readonly topLevelRequests: number;
      readonly metadata: CharacterizationSourceMetadata;
    }
  | {
      readonly status: 'failed';
      readonly finalOrigin: string;
      readonly topLevelRequests: number;
      readonly metadata: CharacterizationSourceMetadata;
    };

export type CharacterizationScheduleResult =
  | {
      readonly status: 'observed';
      readonly finalOrigin: string;
      readonly topLevelRequests: number;
      readonly observation: CharacterizationObservation;
      readonly metadata: CharacterizationSourceMetadata;
      readonly normalizedSummary: CharacterizationNormalizedSummary;
    }
  | {
      readonly status: 'authentication-required' | 'failed';
      readonly finalOrigin: string;
      readonly topLevelRequests: number;
      readonly metadata: CharacterizationSourceMetadata;
      readonly normalizedSummary: CharacterizationNormalizedSummary;
    };

/** Read-only dependency: it has no repair, form, body, cookie, or profile input. */
export interface PowerSchoolCharacterizationSource {
  readStatus(
    request: CharacterizationReadRequest,
    signal: AbortSignal,
  ): Promise<CharacterizationStatusResult>;
  readBellSchedule(
    request: CharacterizationReadRequest,
    signal: AbortSignal,
  ): Promise<CharacterizationScheduleResult>;
}

export interface CharacterizedPeriod {
  readonly periodId: string;
  readonly courseKey: string;
  readonly blockLabel: string;
  readonly roomKey?: string;
  readonly startsAt: IsoInstant;
  readonly endsAt: IsoInstant;
}

export interface CharacterizationObservation {
  readonly requestedDate: IsoDate;
  readonly observedForDate: IsoDate;
  readonly kind: ScheduleKind;
  readonly verification: 'verified' | 'unverified' | 'synthetic';
  readonly periods: readonly CharacterizedPeriod[];
  readonly provenance: {
    readonly source: 'powerschool';
    readonly method: CharacterizationTransport;
    readonly observedAt: IsoInstant;
    readonly verification: 'verified' | 'unverified' | 'synthetic';
    readonly sourceReference: string;
  };
  readonly freshness: {
    readonly state: 'fresh' | 'stale' | 'unknown';
    readonly observedAt: IsoInstant;
    readonly expiresAt?: IsoInstant;
    readonly lastSuccessfulAt?: IsoInstant;
  };
  readonly capturedAt: IsoInstant;
  readonly diagnosticCodes: readonly string[];
}

export interface CharacterizedSchedule {
  readonly date: IsoDate;
  readonly kind: ScheduleKind;
  readonly periods: readonly CharacterizedPeriod[];
}

export type CharacterizationFailureCode =
  | 'authentication-required'
  | 'budget-exceeded'
  | 'outside-window'
  | 'profile-write-not-authorized'
  | 'off-origin'
  | 'observation-invalid'
  | 'observation-stale'
  | 'observation-wrong-date'
  | 'read-failed'
  | 'response-invalid'
  | 'response-over-budget'
  | 'timeout'
  | 'window-ended';

/** This is the only record intended for later evidence persistence. */
export interface PowerSchoolCharacterizationEvidence {
  readonly evidenceVersion: '1.0.0';
  readonly requestedDate: IsoDate;
  readonly startedAt: IsoInstant;
  readonly completedAt: IsoInstant;
  readonly deleteAfter: IsoInstant;
  readonly outcome: 'changed' | 'no-op' | 'failed';
  readonly authenticationClassification:
    'not-checked' | 'authenticated' | 'authentication-required' | 'failed';
  readonly topLevelRequests: number;
  readonly aggregateResponseBytes: number;
  readonly aggregateDurationMs: number;
  readonly selectedTransports: readonly CharacterizationTransport[];
  readonly surfaces: readonly CharacterizationSurfaceEvidence[];
  readonly normalizedSummary: CharacterizationNormalizedSummary;
  readonly codes: readonly string[];
  readonly lastKnownGoodPreserved: boolean;
  readonly fingerprint: string | null;
  readonly failureCode?: CharacterizationFailureCode;
  readonly cooloffUntil?: IsoInstant;
}

export interface CharacterizationSurfaceEvidence {
  readonly surface: CharacterizationSurface;
  readonly method: 'GET';
  readonly classification:
    'authenticated' | 'authentication-required' | 'failed' | 'observed';
  readonly transport: CharacterizationTransport;
  readonly httpStatus?: number;
  readonly redirectClassification: CharacterizationRedirectClassification;
  readonly responseBytes: number;
  readonly durationMs: number;
  readonly diagnosticCodes: readonly string[];
}

const characterizationFailureCodes = new Set<CharacterizationFailureCode>([
  'authentication-required',
  'budget-exceeded',
  'outside-window',
  'profile-write-not-authorized',
  'off-origin',
  'observation-invalid',
  'observation-stale',
  'observation-wrong-date',
  'read-failed',
  'response-invalid',
  'response-over-budget',
  'timeout',
  'window-ended',
]);

const finalAuthorizationWindow = Object.freeze({
  startsAt: '2026-08-09T04:24:00.000Z',
  endsAt: '2026-08-09T05:24:00.000Z',
});

const historicalZeroRequestPreflightWindow = Object.freeze({
  startsAt: '2026-08-09T04:15:00.000Z',
  endsAt: '2026-08-09T04:35:00.000Z',
});

function isInsideWindow(
  instant: string,
  window: Readonly<{ startsAt: string; endsAt: string }>,
): boolean {
  return instant >= window.startsAt && instant < window.endsAt;
}

const characterizationDiagnosticCodes = new Set([
  'source-authentication-required',
  'source-bell-observed',
  'source-browser-fallback',
  'source-http-status-unavailable',
  'source-normalization-warning',
  'source-redirect-observed',
  'source-response-over-budget',
  'source-status-observed',
  'source-timeout',
  'source-unavailable',
]);

export interface PowerSchoolCharacterizationResult {
  readonly status: 'changed' | 'no-op' | 'failed';
  readonly evidence: PowerSchoolCharacterizationEvidence;
  readonly effective?: CharacterizedSchedule;
  readonly candidate?: CharacterizedSchedule;
}

export interface PowerSchoolCharacterizationDependencies {
  readonly clock: Clock;
  /** Monotonic milliseconds, injected so budget behavior is deterministic. */
  readonly monotonicNow: () => number;
  readonly source: PowerSchoolCharacterizationSource;
}

class CharacterizationTimeout extends Error {}

function bounded<Value>(
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<Value>,
): Promise<Value> {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    let settled = false;
    const finish = (complete: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      complete();
    };
    const timer = setTimeout(() => {
      controller.abort();
      finish(() => reject(new CharacterizationTimeout()));
    }, timeoutMs);
    Promise.resolve()
      .then(() => operation(controller.signal))
      .then(
        (value) => finish(() => resolve(value)),
        (error: unknown) => finish(() => reject(error)),
      );
  });
}

function addMilliseconds(value: IsoInstant, milliseconds: number): IsoInstant {
  return new Date(Date.parse(value) + milliseconds).toISOString();
}

function isTopLevelRequestCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 1;
}

function isRedactedCode(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= 128 &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value)
  );
}

function isCharacterizationDiagnosticCode(value: unknown): value is string {
  return isRedactedCode(value) && characterizationDiagnosticCodes.has(value);
}

function validMetadata(
  value: unknown,
  expectedSurface: CharacterizationSurface,
): value is CharacterizationSourceMetadata {
  return (
    isPlainObject(value) &&
    hasExactKeys(
      value,
      [
        'surface',
        'transport',
        'redirectClassification',
        'responseBytes',
        'durationMs',
        'diagnosticCodes',
      ],
      ['httpStatus'],
    ) &&
    value.surface === expectedSurface &&
    (value.transport === 'session-http' ||
      value.transport === 'browser-read') &&
    (value.httpStatus === undefined ||
      (Number.isSafeInteger(value.httpStatus) &&
        Number(value.httpStatus) >= 100 &&
        Number(value.httpStatus) <= 599)) &&
    (value.redirectClassification === 'none' ||
      value.redirectClassification === 'same-origin' ||
      value.redirectClassification === 'authentication' ||
      value.redirectClassification === 'off-origin' ||
      value.redirectClassification === 'not-applicable') &&
    Number.isSafeInteger(value.responseBytes) &&
    Number(value.responseBytes) >= 0 &&
    Number(value.responseBytes) <= 16 * 1024 * 1024 &&
    Number.isFinite(value.durationMs) &&
    Number(value.durationMs) >= 0 &&
    Number(value.durationMs) <= 120_000 &&
    Array.isArray(value.diagnosticCodes) &&
    Object.keys(value.diagnosticCodes).length ===
      value.diagnosticCodes.length &&
    value.diagnosticCodes.length <= 16 &&
    value.diagnosticCodes.every(isCharacterizationDiagnosticCode) &&
    new Set(value.diagnosticCodes).size === value.diagnosticCodes.length
  );
}

function validNormalizedSummary(
  value: unknown,
): value is CharacterizationNormalizedSummary {
  if (
    !isPlainObject(value) ||
    !hasExactKeys(value, ['fieldNames', 'periodCount', 'roomKeyCount']) ||
    !Array.isArray(value.fieldNames)
  ) {
    return false;
  }
  const fieldNames: readonly unknown[] = value.fieldNames;
  return (
    Object.keys(fieldNames).length === fieldNames.length &&
    fieldNames.length <= normalizedScheduleFieldNames.length &&
    fieldNames.every((field) =>
      normalizedScheduleFieldNames.includes(
        field as NormalizedScheduleFieldName,
      ),
    ) &&
    new Set(fieldNames).size === fieldNames.length &&
    [...fieldNames]
      .sort()
      .every((field, index) => field === fieldNames[index]) &&
    Number.isSafeInteger(value.periodCount) &&
    Number(value.periodCount) >= 0 &&
    Number(value.periodCount) <= 64 &&
    Number.isSafeInteger(value.roomKeyCount) &&
    Number(value.roomKeyCount) >= 0 &&
    Number(value.roomKeyCount) <= Number(value.periodCount)
  );
}

function validStatusResult(
  value: unknown,
): value is CharacterizationStatusResult {
  return (
    isPlainObject(value) &&
    hasExactKeys(value, [
      'status',
      'finalOrigin',
      'topLevelRequests',
      'metadata',
    ]) &&
    (value.status === 'authenticated' ||
      value.status === 'authentication-required' ||
      value.status === 'failed') &&
    typeof value.finalOrigin === 'string' &&
    isTopLevelRequestCount(value.topLevelRequests) &&
    validMetadata(value.metadata, 'auth')
  );
}

function validScheduleResult(
  value: unknown,
): value is CharacterizationScheduleResult {
  if (!isPlainObject(value) || typeof value.status !== 'string') return false;
  if (value.status === 'observed') {
    return (
      hasExactKeys(value, [
        'status',
        'finalOrigin',
        'topLevelRequests',
        'observation',
        'metadata',
        'normalizedSummary',
      ]) &&
      typeof value.finalOrigin === 'string' &&
      isTopLevelRequestCount(value.topLevelRequests) &&
      validMetadata(value.metadata, 'bell') &&
      validNormalizedSummary(value.normalizedSummary) &&
      validCharacterizationObservation(value.observation)
    );
  }
  return (
    (value.status === 'authentication-required' || value.status === 'failed') &&
    hasExactKeys(value, [
      'status',
      'finalOrigin',
      'topLevelRequests',
      'metadata',
      'normalizedSummary',
    ]) &&
    typeof value.finalOrigin === 'string' &&
    isTopLevelRequestCount(value.topLevelRequests) &&
    validMetadata(value.metadata, 'bell') &&
    validNormalizedSummary(value.normalizedSummary) &&
    value.normalizedSummary.fieldNames.length === 0 &&
    value.normalizedSummary.periodCount === 0 &&
    value.normalizedSummary.roomKeyCount === 0
  );
}

function validSurfaceEvidence(
  value: unknown,
): value is CharacterizationSurfaceEvidence {
  if (
    !isPlainObject(value) ||
    !hasExactKeys(
      value,
      [
        'surface',
        'method',
        'classification',
        'transport',
        'redirectClassification',
        'responseBytes',
        'durationMs',
        'diagnosticCodes',
      ],
      ['httpStatus'],
    ) ||
    value.method !== 'GET'
  ) {
    return false;
  }
  const classificationValid =
    (value.surface === 'auth' &&
      (value.classification === 'authenticated' ||
        value.classification === 'authentication-required' ||
        value.classification === 'failed')) ||
    (value.surface === 'bell' &&
      (value.classification === 'observed' ||
        value.classification === 'authentication-required' ||
        value.classification === 'failed'));
  if (!classificationValid) return false;
  const metadata = {
    surface: value.surface,
    transport: value.transport,
    ...(value.httpStatus === undefined ? {} : { httpStatus: value.httpStatus }),
    redirectClassification: value.redirectClassification,
    responseBytes: value.responseBytes,
    durationMs: value.durationMs,
    diagnosticCodes: value.diagnosticCodes,
  };
  return validMetadata(metadata, value.surface as CharacterizationSurface);
}

/** Strict validator for the only persistable M-07B evidence record. */
export function isPowerSchoolCharacterizationEvidence(
  value: unknown,
): value is PowerSchoolCharacterizationEvidence {
  if (
    !isPlainObject(value) ||
    !hasExactKeys(
      value,
      [
        'evidenceVersion',
        'requestedDate',
        'startedAt',
        'completedAt',
        'deleteAfter',
        'outcome',
        'authenticationClassification',
        'topLevelRequests',
        'aggregateResponseBytes',
        'aggregateDurationMs',
        'selectedTransports',
        'surfaces',
        'normalizedSummary',
        'codes',
        'lastKnownGoodPreserved',
        'fingerprint',
      ],
      ['failureCode', 'cooloffUntil'],
    ) ||
    value.evidenceVersion !== '1.0.0' ||
    value.requestedDate !== '2026-08-10' ||
    !isIsoInstant(value.startedAt) ||
    !isIsoInstant(value.completedAt) ||
    !isIsoInstant(value.deleteAfter) ||
    value.completedAt < value.startedAt ||
    value.deleteAfter !== addMilliseconds(value.completedAt, 604_800_000) ||
    (value.outcome !== 'changed' &&
      value.outcome !== 'no-op' &&
      value.outcome !== 'failed') ||
    (value.authenticationClassification !== 'not-checked' &&
      value.authenticationClassification !== 'authenticated' &&
      value.authenticationClassification !== 'authentication-required' &&
      value.authenticationClassification !== 'failed') ||
    !Number.isSafeInteger(value.topLevelRequests) ||
    Number(value.topLevelRequests) < 0 ||
    Number(value.topLevelRequests) > 8 ||
    !Number.isSafeInteger(value.aggregateResponseBytes) ||
    Number(value.aggregateResponseBytes) < 0 ||
    Number(value.aggregateResponseBytes) > 32 * 1024 * 1024 ||
    !Number.isFinite(value.aggregateDurationMs) ||
    Number(value.aggregateDurationMs) < 0 ||
    Number(value.aggregateDurationMs) > 240_000 ||
    typeof value.lastKnownGoodPreserved !== 'boolean' ||
    !Array.isArray(value.surfaces) ||
    Object.keys(value.surfaces).length !== value.surfaces.length ||
    value.surfaces.length > 2 ||
    !value.surfaces.every(validSurfaceEvidence) ||
    !validNormalizedSummary(value.normalizedSummary) ||
    !Array.isArray(value.selectedTransports) ||
    Object.keys(value.selectedTransports).length !==
      value.selectedTransports.length ||
    !value.selectedTransports.every(
      (transport) =>
        transport === 'session-http' || transport === 'browser-read',
    ) ||
    new Set(value.selectedTransports).size !==
      value.selectedTransports.length ||
    !Array.isArray(value.codes) ||
    Object.keys(value.codes).length !== value.codes.length ||
    value.codes.length > 33 ||
    !value.codes.every(
      (code) =>
        isCharacterizationDiagnosticCode(code) ||
        (isRedactedCode(code) &&
          characterizationFailureCodes.has(
            code as CharacterizationFailureCode,
          )),
    ) ||
    new Set(value.codes).size !== value.codes.length
  ) {
    return false;
  }
  const surfaces = value.surfaces as readonly CharacterizationSurfaceEvidence[];
  const expectedTransports = [
    ...new Set(surfaces.map((surface) => surface.transport)),
  ];
  const selectedTransports =
    value.selectedTransports as readonly CharacterizationTransport[];
  const codes = value.codes as readonly string[];
  const requiredCodes = [
    ...new Set([
      ...(typeof value.failureCode === 'string' ? [value.failureCode] : []),
      ...surfaces.flatMap((surface) => surface.diagnosticCodes),
    ]),
  ];
  if (
    (surfaces.length > 0 && surfaces[0]?.surface !== 'auth') ||
    (surfaces.length > 1 && surfaces[1]?.surface !== 'bell') ||
    expectedTransports.length !== selectedTransports.length ||
    expectedTransports.some(
      (transport, index) => transport !== selectedTransports[index],
    ) ||
    Number(value.aggregateResponseBytes) !==
      surfaces.reduce((total, surface) => total + surface.responseBytes, 0) ||
    Number(value.aggregateDurationMs) !==
      surfaces.reduce((total, surface) => total + surface.durationMs, 0) ||
    requiredCodes.some((code) => !codes.includes(code))
  ) {
    return false;
  }
  if (value.outcome === 'failed') {
    if (
      value.failureCode === 'profile-write-not-authorized' ||
      value.failureCode === 'outside-window'
    ) {
      const zeroRequestShape =
        value.authenticationClassification === 'not-checked' &&
        value.topLevelRequests === 0 &&
        value.aggregateResponseBytes === 0 &&
        value.aggregateDurationMs === 0 &&
        value.selectedTransports.length === 0 &&
        surfaces.length === 0 &&
        value.normalizedSummary.fieldNames.length === 0 &&
        value.normalizedSummary.periodCount === 0 &&
        value.normalizedSummary.roomKeyCount === 0 &&
        value.codes.length === 1 &&
        value.codes[0] === value.failureCode &&
        value.lastKnownGoodPreserved === false &&
        value.fingerprint === null &&
        value.cooloffUntil === undefined &&
        value.completedAt === value.startedAt;
      return (
        zeroRequestShape &&
        (value.failureCode === 'profile-write-not-authorized'
          ? isInsideWindow(value.startedAt, finalAuthorizationWindow) ||
            isInsideWindow(
              value.startedAt,
              historicalZeroRequestPreflightWindow,
            )
          : !isInsideWindow(value.startedAt, finalAuthorizationWindow))
      );
    }
    return (
      typeof value.failureCode === 'string' &&
      characterizationFailureCodes.has(
        value.failureCode as CharacterizationFailureCode,
      ) &&
      isInsideWindow(value.startedAt, finalAuthorizationWindow) &&
      (value.failureCode === 'window-ended'
        ? value.completedAt >= finalAuthorizationWindow.endsAt
        : value.completedAt < finalAuthorizationWindow.endsAt) &&
      value.codes.includes(value.failureCode) &&
      (value.lastKnownGoodPreserved
        ? typeof value.fingerprint === 'string' &&
          /^fnv1a64:[0-9a-f]{16}$/u.test(value.fingerprint)
        : value.fingerprint === null) &&
      (value.failureCode === 'authentication-required'
        ? value.authenticationClassification === 'authentication-required' &&
          isIsoInstant(value.cooloffUntil) &&
          value.cooloffUntil === addMilliseconds(value.completedAt, 1_800_000)
        : value.cooloffUntil === undefined)
    );
  }
  return (
    value.failureCode === undefined &&
    value.cooloffUntil === undefined &&
    value.authenticationClassification === 'authenticated' &&
    isInsideWindow(value.startedAt, finalAuthorizationWindow) &&
    value.completedAt < finalAuthorizationWindow.endsAt &&
    surfaces.length === 2 &&
    surfaces[0]?.classification === 'authenticated' &&
    surfaces[1]?.classification === 'observed' &&
    typeof value.fingerprint === 'string' &&
    /^fnv1a64:[0-9a-f]{16}$/u.test(value.fingerprint)
  );
}

function safeAllowedText(value: string, maximum: number): boolean {
  return (
    value.length > 0 &&
    value.length <= maximum &&
    !/[\u0000-\u001f\u007f]/u.test(value) &&
    !value.startsWith('/') &&
    !/(?:https?:\/\/|(?:javascript|data|file):|<\/?[a-z]|set-cookie\s*:|(?:session|cookie|token|password)\s*=)/iu.test(
      value,
    )
  );
}

function validCharacterizedPeriod(
  value: unknown,
): value is CharacterizedPeriod {
  return (
    isPlainObject(value) &&
    hasExactKeys(
      value,
      ['periodId', 'courseKey', 'blockLabel', 'startsAt', 'endsAt'],
      ['roomKey'],
    ) &&
    typeof value.periodId === 'string' &&
    safeAllowedText(value.periodId, 128) &&
    typeof value.courseKey === 'string' &&
    safeAllowedText(value.courseKey, 128) &&
    typeof value.blockLabel === 'string' &&
    safeAllowedText(value.blockLabel, 256) &&
    (value.roomKey === undefined ||
      (typeof value.roomKey === 'string' &&
        safeAllowedText(value.roomKey, 128))) &&
    isIsoInstant(value.startsAt) &&
    isIsoInstant(value.endsAt) &&
    value.startsAt < value.endsAt
  );
}

function validCharacterizationObservation(
  value: unknown,
): value is CharacterizationObservation {
  if (
    !isPlainObject(value) ||
    !hasExactKeys(value, [
      'requestedDate',
      'observedForDate',
      'kind',
      'verification',
      'periods',
      'provenance',
      'freshness',
      'capturedAt',
      'diagnosticCodes',
    ]) ||
    !isIsoDate(value.requestedDate) ||
    !isIsoDate(value.observedForDate) ||
    (value.kind !== 'normal' &&
      value.kind !== 'special' &&
      value.kind !== 'no-classes') ||
    (value.verification !== 'verified' &&
      value.verification !== 'unverified' &&
      value.verification !== 'synthetic') ||
    !Array.isArray(value.periods) ||
    Object.keys(value.periods).length !== value.periods.length ||
    value.periods.length > 64 ||
    !value.periods.every(validCharacterizedPeriod) ||
    !isPlainObject(value.provenance) ||
    !hasExactKeys(value.provenance, [
      'source',
      'method',
      'observedAt',
      'verification',
      'sourceReference',
    ]) ||
    value.provenance.source !== 'powerschool' ||
    (value.provenance.method !== 'session-http' &&
      value.provenance.method !== 'browser-read') ||
    !isIsoInstant(value.provenance.observedAt) ||
    value.provenance.verification !== value.verification ||
    typeof value.provenance.sourceReference !== 'string' ||
    !safeAllowedText(value.provenance.sourceReference, 128) ||
    !isPlainObject(value.freshness) ||
    !hasExactKeys(
      value.freshness,
      ['state', 'observedAt'],
      ['expiresAt', 'lastSuccessfulAt'],
    ) ||
    (value.freshness.state !== 'fresh' &&
      value.freshness.state !== 'stale' &&
      value.freshness.state !== 'unknown') ||
    !isIsoInstant(value.freshness.observedAt) ||
    (value.freshness.expiresAt !== undefined &&
      !isIsoInstant(value.freshness.expiresAt)) ||
    (value.freshness.lastSuccessfulAt !== undefined &&
      !isIsoInstant(value.freshness.lastSuccessfulAt)) ||
    !isIsoInstant(value.capturedAt) ||
    !Array.isArray(value.diagnosticCodes) ||
    Object.keys(value.diagnosticCodes).length !==
      value.diagnosticCodes.length ||
    value.diagnosticCodes.length > 16 ||
    !value.diagnosticCodes.every(isCharacterizationDiagnosticCode) ||
    new Set(value.diagnosticCodes).size !== value.diagnosticCodes.length
  ) {
    return false;
  }
  const periodIds = new Set<string>();
  return value.periods.every((period) => {
    if (
      period.startsAt.slice(0, 10) !== value.observedForDate ||
      period.endsAt.slice(0, 10) !== value.observedForDate ||
      periodIds.has(period.periodId)
    ) {
      return false;
    }
    periodIds.add(period.periodId);
    return true;
  });
}

function projectObservation(
  value: unknown,
  requestedDate: IsoDate,
  now: IsoInstant,
):
  | { readonly status: 'accepted'; readonly schedule: CharacterizedSchedule }
  | {
      readonly status: 'rejected';
      readonly code: CharacterizationFailureCode;
    } {
  if (!validCharacterizationObservation(value)) {
    return { status: 'rejected', code: 'observation-invalid' };
  }
  const observation = value;
  if (
    observation.requestedDate !== requestedDate ||
    observation.observedForDate !== requestedDate
  ) {
    return { status: 'rejected', code: 'observation-wrong-date' };
  }
  if (
    observation.verification !== 'verified' ||
    observation.provenance.verification !== 'verified' ||
    observation.freshness.state !== 'fresh' ||
    observation.provenance.observedAt > now ||
    observation.freshness.observedAt > now ||
    observation.capturedAt > now ||
    (observation.freshness.lastSuccessfulAt !== undefined &&
      observation.freshness.lastSuccessfulAt > now) ||
    (observation.freshness.expiresAt !== undefined &&
      observation.freshness.expiresAt <= now)
  ) {
    return { status: 'rejected', code: 'observation-stale' };
  }
  if (
    observation.periods.length > 64 ||
    (observation.kind === 'no-classes' && observation.periods.length !== 0) ||
    (observation.kind !== 'no-classes' && observation.periods.length === 0)
  ) {
    return { status: 'rejected', code: 'observation-invalid' };
  }
  const periods: CharacterizedPeriod[] = [];
  const periodIds = new Set<string>();
  for (const period of observation.periods) {
    if (
      !safeAllowedText(period.periodId, 128) ||
      !safeAllowedText(period.courseKey, 128) ||
      !safeAllowedText(period.blockLabel, 256) ||
      (period.roomKey !== undefined && !safeAllowedText(period.roomKey, 128)) ||
      period.startsAt.slice(0, 10) !== requestedDate ||
      period.endsAt.slice(0, 10) !== requestedDate ||
      Date.parse(period.startsAt) >= Date.parse(period.endsAt) ||
      periodIds.has(period.periodId)
    ) {
      return { status: 'rejected', code: 'observation-invalid' };
    }
    periodIds.add(period.periodId);
    periods.push({
      periodId: period.periodId,
      courseKey: period.courseKey,
      blockLabel: period.blockLabel,
      ...(period.roomKey === undefined ? {} : { roomKey: period.roomKey }),
      startsAt: period.startsAt,
      endsAt: period.endsAt,
    });
  }
  periods.sort(
    (left, right) =>
      left.startsAt.localeCompare(right.startsAt) ||
      left.periodId.localeCompare(right.periodId),
  );
  return {
    status: 'accepted',
    schedule: { date: requestedDate, kind: observation.kind, periods },
  };
}

function validBaseline(
  value: unknown,
  requestedDate: IsoDate,
): value is CharacterizedSchedule {
  if (
    !isPlainObject(value) ||
    !hasExactKeys(value, ['date', 'kind', 'periods']) ||
    value.date !== requestedDate ||
    (value.kind !== 'normal' &&
      value.kind !== 'special' &&
      value.kind !== 'no-classes') ||
    !Array.isArray(value.periods) ||
    Object.keys(value.periods).length !== value.periods.length ||
    value.periods.length > 64 ||
    (value.kind === 'no-classes'
      ? value.periods.length !== 0
      : value.periods.length === 0)
  ) {
    return false;
  }
  const periodIds = new Set<string>();
  for (const period of value.periods) {
    if (
      !isPlainObject(period) ||
      !hasExactKeys(
        period,
        ['periodId', 'courseKey', 'blockLabel', 'startsAt', 'endsAt'],
        ['roomKey'],
      ) ||
      typeof period.periodId !== 'string' ||
      !safeAllowedText(period.periodId, 128) ||
      typeof period.courseKey !== 'string' ||
      !safeAllowedText(period.courseKey, 128) ||
      typeof period.blockLabel !== 'string' ||
      !safeAllowedText(period.blockLabel, 256) ||
      (period.roomKey !== undefined &&
        (typeof period.roomKey !== 'string' ||
          !safeAllowedText(period.roomKey, 128))) ||
      !isIsoInstant(period.startsAt) ||
      !isIsoInstant(period.endsAt) ||
      period.startsAt.slice(0, 10) !== value.date ||
      period.endsAt.slice(0, 10) !== value.date ||
      Date.parse(period.startsAt) >= Date.parse(period.endsAt) ||
      periodIds.has(period.periodId)
    ) {
      return false;
    }
    periodIds.add(period.periodId);
  }
  return true;
}

function cloneSchedule(value: CharacterizedSchedule): CharacterizedSchedule {
  return structuredClone(value);
}

function semanticFingerprint(value: CharacterizedSchedule): string {
  return stableFingerprint({
    ...value,
    periods: [...value.periods].sort(
      (left, right) =>
        left.startsAt.localeCompare(right.startsAt) ||
        left.periodId.localeCompare(right.periodId),
    ),
  });
}

function normalizedSummaryFor(
  value: CharacterizedSchedule,
): CharacterizationNormalizedSummary {
  const hasRoomKeys = value.periods.some(
    (period) => period.roomKey !== undefined,
  );
  return {
    fieldNames: normalizedScheduleFieldNames.filter(
      (field) => field !== 'periods.roomKey' || hasRoomKeys,
    ),
    periodCount: value.periods.length,
    roomKeyCount: value.periods.filter((period) => period.roomKey !== undefined)
      .length,
  };
}

const emptyNormalizedSummary: CharacterizationNormalizedSummary = {
  fieldNames: [],
  periodCount: 0,
  roomKeyCount: 0,
};

function summariesEqual(
  left: CharacterizationNormalizedSummary,
  right: CharacterizationNormalizedSummary,
): boolean {
  return (
    left.periodCount === right.periodCount &&
    left.roomKeyCount === right.roomKeyCount &&
    left.fieldNames.length === right.fieldNames.length &&
    left.fieldNames.every((field, index) => field === right.fieldNames[index])
  );
}

function surfaceEvidence(
  classification: CharacterizationSurfaceEvidence['classification'],
  metadata: CharacterizationSourceMetadata,
): CharacterizationSurfaceEvidence {
  return {
    surface: metadata.surface,
    method: 'GET',
    classification,
    transport: metadata.transport,
    ...(metadata.httpStatus === undefined
      ? {}
      : { httpStatus: metadata.httpStatus }),
    redirectClassification: metadata.redirectClassification,
    responseBytes: metadata.responseBytes,
    durationMs: metadata.durationMs,
    diagnosticCodes: [...metadata.diagnosticCodes],
  };
}

/**
 * Qualifies one sequential characterization attempt. Synthetic callers use
 * settling doubles; the one authorized live caller is isolated behind the
 * fixed process-group supervisor so its provider activity cannot outlive the
 * governing window or request budget.
 */
export async function characterizePowerSchoolOnce(options: {
  readonly policy: PowerSchoolCharacterizationPolicy;
  readonly dependencies: PowerSchoolCharacterizationDependencies;
  readonly lastKnownGood?: CharacterizedSchedule;
}): Promise<PowerSchoolCharacterizationResult> {
  const { policy, dependencies } = options;
  validateCharacterizationPolicy(policy);
  if (
    options.lastKnownGood !== undefined &&
    !validBaseline(options.lastKnownGood, policy.requestedDate)
  ) {
    throw new Error('powerschool-characterization-baseline-invalid');
  }
  const startedAt = dependencies.clock.now();
  if (!isIsoInstant(startedAt))
    throw new Error('powerschool-characterization-clock-invalid');
  let topLevelRequests = 0;
  let aggregateResponseBytes = 0;
  let aggregateDurationMs = 0;
  let authenticationClassification: PowerSchoolCharacterizationEvidence['authenticationClassification'] =
    'not-checked';
  let normalizedSummary = emptyNormalizedSummary;
  let observationDiagnosticCodes: readonly string[] = [];
  const surfaces: CharacterizationSurfaceEvidence[] = [];

  const selectedTransports = (): readonly CharacterizationTransport[] => [
    ...new Set(surfaces.map((surface) => surface.transport)),
  ];

  const evidenceCodes = (
    failureCode?: CharacterizationFailureCode,
  ): readonly string[] => [
    ...new Set([
      ...(failureCode === undefined ? [] : [failureCode]),
      ...surfaces.flatMap((surface) => surface.diagnosticCodes),
      ...observationDiagnosticCodes,
    ]),
  ];

  const failure = (
    code: CharacterizationFailureCode,
    authenticationFailure = false,
    preserveLastKnownGood = true,
  ): PowerSchoolCharacterizationResult => {
    const completedAt = dependencies.clock.now();
    if (!isIsoInstant(completedAt) || completedAt < startedAt)
      throw new Error('powerschool-characterization-clock-invalid');
    const preserved =
      preserveLastKnownGood && options.lastKnownGood !== undefined;
    return {
      status: 'failed',
      evidence: {
        evidenceVersion: '1.0.0',
        requestedDate: policy.requestedDate,
        startedAt,
        completedAt,
        deleteAfter: addMilliseconds(
          completedAt,
          policy.maximumEvidenceRetentionMs,
        ),
        outcome: 'failed',
        authenticationClassification,
        topLevelRequests,
        aggregateResponseBytes,
        aggregateDurationMs,
        selectedTransports: selectedTransports(),
        surfaces: structuredClone(surfaces),
        normalizedSummary: structuredClone(normalizedSummary),
        codes: evidenceCodes(code),
        lastKnownGoodPreserved: preserved,
        fingerprint: !preserved
          ? null
          : semanticFingerprint(options.lastKnownGood),
        failureCode: code,
        ...(authenticationFailure
          ? {
              cooloffUntil: addMilliseconds(
                completedAt,
                policy.authenticationCooloffMs,
              ),
            }
          : {}),
      },
      ...(!preserved
        ? {}
        : { effective: cloneSchedule(options.lastKnownGood) }),
    };
  };

  if (startedAt < policy.windowStartsAt || startedAt >= policy.windowEndsAt) {
    return failure('outside-window', false, false);
  }

  const startedMonotonic = dependencies.monotonicNow();
  if (!Number.isFinite(startedMonotonic)) {
    throw new Error('powerschool-characterization-monotonic-clock-invalid');
  }

  const recordSurface = (
    classification: CharacterizationSurfaceEvidence['classification'],
    metadata: CharacterizationSourceMetadata,
  ): boolean => {
    surfaces.push(surfaceEvidence(classification, metadata));
    aggregateResponseBytes += metadata.responseBytes;
    aggregateDurationMs += metadata.durationMs;
    return (
      metadata.responseBytes <= policy.maximumResponseBytesPerRequest &&
      metadata.durationMs <= policy.requestTimeoutMs
    );
  };

  const remaining = (): number => {
    const current = dependencies.monotonicNow();
    if (!Number.isFinite(current) || current < startedMonotonic) return 0;
    return policy.totalTimeoutMs - (current - startedMonotonic);
  };
  const remainingWindow = (): number => {
    const current = dependencies.clock.now();
    if (!isIsoInstant(current) || current < startedAt) {
      throw new Error('powerschool-characterization-clock-invalid');
    }
    return Date.parse(policy.windowEndsAt) - Date.parse(current);
  };
  const timeout = (): number =>
    Math.min(policy.requestTimeoutMs, remaining(), remainingWindow());

  let status: unknown;
  try {
    const limit = timeout();
    if (limit <= 0) return failure('window-ended');
    status = await bounded(limit, (signal) =>
      dependencies.source.readStatus(
        {
          origin: policy.origin,
          path: policy.statusPath,
          method: 'GET',
          timeoutMs: limit,
          maximumTopLevelRequests: policy.maximumTopLevelRequests,
        },
        signal,
      ),
    );
  } catch (error: unknown) {
    return failure(
      error instanceof CharacterizationTimeout
        ? remainingWindow() <= 0
          ? 'window-ended'
          : 'timeout'
        : 'read-failed',
    );
  }
  if (!validStatusResult(status)) {
    return failure('response-invalid');
  }
  if (status.topLevelRequests > policy.maximumTopLevelRequests) {
    return failure('budget-exceeded');
  }
  authenticationClassification = status.status;
  topLevelRequests += status.topLevelRequests;
  if (!recordSurface(status.status, status.metadata)) {
    return failure('response-over-budget');
  }
  if (remainingWindow() <= 0) return failure('window-ended');
  if (topLevelRequests > policy.maximumTopLevelRequests || remaining() <= 0) {
    return failure('budget-exceeded');
  }
  if (status.finalOrigin !== policy.origin) return failure('off-origin');
  if (status.status === 'authentication-required') {
    return failure('authentication-required', true);
  }
  if (status.status === 'failed') return failure('read-failed');
  if (topLevelRequests >= policy.maximumTopLevelRequests) {
    return failure('budget-exceeded');
  }

  let schedule: unknown;
  try {
    const limit = timeout();
    if (limit <= 0) return failure('window-ended');
    schedule = await bounded(limit, (signal) =>
      dependencies.source.readBellSchedule(
        {
          origin: policy.origin,
          path: policy.bellPath,
          method: 'GET',
          timeoutMs: limit,
          maximumTopLevelRequests:
            policy.maximumTopLevelRequests - topLevelRequests,
        },
        signal,
      ),
    );
  } catch (error: unknown) {
    return failure(
      error instanceof CharacterizationTimeout
        ? remainingWindow() <= 0
          ? 'window-ended'
          : 'timeout'
        : 'read-failed',
    );
  }
  if (!validScheduleResult(schedule)) {
    return failure('response-invalid');
  }
  if (
    schedule.topLevelRequests >
    policy.maximumTopLevelRequests - topLevelRequests
  ) {
    return failure('budget-exceeded');
  }
  const scheduleClassification =
    schedule.status === 'observed' ? 'observed' : schedule.status;
  topLevelRequests += schedule.topLevelRequests;
  if (!recordSurface(scheduleClassification, schedule.metadata)) {
    return failure('response-over-budget');
  }
  if (remainingWindow() <= 0) return failure('window-ended');
  normalizedSummary = schedule.normalizedSummary;
  if (topLevelRequests > policy.maximumTopLevelRequests || remaining() < 0) {
    return failure('budget-exceeded');
  }
  if (schedule.finalOrigin !== policy.origin) return failure('off-origin');
  if (schedule.status === 'authentication-required') {
    authenticationClassification = 'authentication-required';
    return failure('authentication-required', true);
  }
  if (schedule.status !== 'observed') return failure('read-failed');
  observationDiagnosticCodes = [...schedule.observation.diagnosticCodes];

  const evaluationAt = dependencies.clock.now();
  if (!isIsoInstant(evaluationAt) || evaluationAt < startedAt) {
    throw new Error('powerschool-characterization-clock-invalid');
  }
  const projected = projectObservation(
    schedule.observation,
    policy.requestedDate,
    evaluationAt,
  );
  if (projected.status === 'rejected') return failure(projected.code);
  const calculatedSummary = normalizedSummaryFor(projected.schedule);
  if (!summariesEqual(schedule.normalizedSummary, calculatedSummary)) {
    return failure('response-invalid');
  }
  normalizedSummary = calculatedSummary;
  const fingerprint = semanticFingerprint(projected.schedule);
  const unchanged =
    options.lastKnownGood !== undefined &&
    semanticFingerprint(options.lastKnownGood) === fingerprint;
  const completedAt = dependencies.clock.now();
  if (!isIsoInstant(completedAt) || completedAt < startedAt)
    throw new Error('powerschool-characterization-clock-invalid');
  if (completedAt >= policy.windowEndsAt) return failure('window-ended');
  return {
    status: unchanged ? 'no-op' : 'changed',
    evidence: {
      evidenceVersion: '1.0.0',
      requestedDate: policy.requestedDate,
      startedAt,
      completedAt,
      deleteAfter: addMilliseconds(
        completedAt,
        policy.maximumEvidenceRetentionMs,
      ),
      outcome: unchanged ? 'no-op' : 'changed',
      authenticationClassification,
      topLevelRequests,
      aggregateResponseBytes,
      aggregateDurationMs,
      selectedTransports: selectedTransports(),
      surfaces: structuredClone(surfaces),
      normalizedSummary: structuredClone(normalizedSummary),
      codes: evidenceCodes(),
      lastKnownGoodPreserved: false,
      fingerprint,
    },
    effective: cloneSchedule(projected.schedule),
    candidate: cloneSchedule(projected.schedule),
  };
}

/**
 * Produces the bounded zero-request outcome required when Chrome cannot open
 * the managed persistent profile without writes that this authorization
 * explicitly forbids. It never receives a source or profile capability.
 */
export function characterizePowerSchoolProfilePreflight(options: {
  readonly policy: PowerSchoolCharacterizationPolicy;
  readonly clock: Clock;
}): PowerSchoolCharacterizationResult {
  validateCharacterizationPolicy(options.policy);
  const instant = options.clock.now();
  if (!isIsoInstant(instant)) {
    throw new Error('powerschool-characterization-clock-invalid');
  }
  const insideWindow =
    instant >= options.policy.windowStartsAt &&
    instant < options.policy.windowEndsAt;
  const failureCode: CharacterizationFailureCode = insideWindow
    ? 'profile-write-not-authorized'
    : 'outside-window';
  const evidence: PowerSchoolCharacterizationEvidence = {
    evidenceVersion: '1.0.0',
    requestedDate: options.policy.requestedDate,
    startedAt: instant,
    completedAt: instant,
    deleteAfter: addMilliseconds(
      instant,
      options.policy.maximumEvidenceRetentionMs,
    ),
    outcome: 'failed',
    authenticationClassification: 'not-checked',
    topLevelRequests: 0,
    aggregateResponseBytes: 0,
    aggregateDurationMs: 0,
    selectedTransports: [],
    surfaces: [],
    normalizedSummary: structuredClone(emptyNormalizedSummary),
    codes: [failureCode],
    lastKnownGoodPreserved: false,
    fingerprint: null,
    failureCode,
  };
  if (!isPowerSchoolCharacterizationEvidence(evidence)) {
    throw new Error('powerschool-characterization-evidence-invalid');
  }
  return { status: 'failed', evidence };
}

export function validateCharacterizationPolicy(
  policy: PowerSchoolCharacterizationPolicy,
): void {
  if (
    policy.origin !== 'https://tasv.powerschool.com' ||
    policy.requestedDate !== '2026-08-10' ||
    policy.windowStartsAt !== finalAuthorizationWindow.startsAt ||
    policy.windowEndsAt !== finalAuthorizationWindow.endsAt ||
    policy.statusPath !== '/teachers/home.html' ||
    policy.bellPath !==
      '/teachers/aet_schedulebell.html?target_date=08/10/2026' ||
    policy.allowedMethods.length !== 2 ||
    policy.allowedMethods[0] !== 'GET' ||
    policy.allowedMethods[1] !== 'HEAD' ||
    policy.maximumTopLevelRequests !== 8 ||
    policy.maximumConcurrency !== 1 ||
    policy.requestTimeoutMs !== 10_000 ||
    policy.totalTimeoutMs !== 120_000 ||
    policy.maximumResponseBytesPerRequest !== 2 * 1024 * 1024 ||
    policy.maximumEvidenceRetentionMs !== 604_800_000 ||
    policy.authenticationCooloffMs !== 1_800_000 ||
    policy.repairAllowed !== false
  ) {
    throw new Error('powerschool-characterization-policy-invalid');
  }
}
