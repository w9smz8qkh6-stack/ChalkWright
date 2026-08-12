import {
  hasExactKeys,
  isEnumValue,
  isIsoDate,
  isIsoInstant,
  isJsonSafeValue,
  isNonEmptyString,
  isNonNegativeInteger,
  isPlainObject,
} from '../runtime-validation.js';
import { stableFingerprint, stableSerialize } from '../pure-values.js';

export const operationalCheckKinds = [
  'catalog-coverage',
  'source-sync',
  'assignment-freshness',
  'standalone-readiness',
  'compatibility-route',
  'display-discovery',
  'preview-diagnostics',
] as const;

export type OperationalCheckKind = (typeof operationalCheckKinds)[number];

export const operationalIssueCodes = [
  'assignment-date-mismatch',
  'assignment-stale',
  'assignment-unknown',
  'catalog-coverage-incomplete',
  'compatibility-route-unavailable',
  'display-discovery-incomplete',
  'preview-diagnostics-error',
  'preview-diagnostics-warning',
  'source-sync-stale',
  'source-sync-unavailable',
  'standalone-not-ready',
] as const;

export type OperationalIssueCode = (typeof operationalIssueCodes)[number];
export type OperationalIssueSeverity = 'warning' | 'error';

export type OperationalScope =
  | { readonly kind: 'global' }
  | {
      readonly kind: 'screen';
      readonly screenId: string;
      readonly roomId?: string;
      readonly targetDate?: string;
    };

interface ObservationBase<Kind extends OperationalCheckKind> {
  readonly check: Kind;
  readonly observedAt: string;
  readonly scope: OperationalScope;
}

export interface CatalogCoverageObservation extends ObservationBase<'catalog-coverage'> {
  readonly requiredCount: number;
  readonly availableCount: number;
}

export interface SourceSyncObservation extends ObservationBase<'source-sync'> {
  readonly state: 'current' | 'stale' | 'unknown';
  readonly lastSuccessfulAt?: string;
}

export interface AssignmentFreshnessObservation extends ObservationBase<'assignment-freshness'> {
  readonly scope: Extract<OperationalScope, { readonly kind: 'screen' }> & {
    readonly targetDate: string;
  };
  readonly assignmentDate: string;
  readonly freshness: 'fresh' | 'stale' | 'unknown';
}

export interface StandaloneReadinessObservation extends ObservationBase<'standalone-readiness'> {
  readonly ready: boolean;
}

export interface CompatibilityRouteObservation extends ObservationBase<'compatibility-route'> {
  readonly available: boolean;
}

export interface DisplayDiscoveryObservation extends ObservationBase<'display-discovery'> {
  readonly expectedCount: number;
  readonly discoveredCount: number;
}

export interface PreviewDiagnosticsObservation extends ObservationBase<'preview-diagnostics'> {
  readonly warningCount: number;
  readonly errorCount: number;
}

export type OperationalObservation =
  | CatalogCoverageObservation
  | SourceSyncObservation
  | AssignmentFreshnessObservation
  | StandaloneReadinessObservation
  | CompatibilityRouteObservation
  | DisplayDiscoveryObservation
  | PreviewDiagnosticsObservation;

export interface OperationalIssue {
  readonly code: OperationalIssueCode;
  readonly severity: OperationalIssueSeverity;
  readonly scope: OperationalScope;
  /** Derived only from the redacted issue code and scope. */
  readonly fingerprint: string;
}

export interface OperationalReport {
  readonly generatedAt: string;
  readonly status: 'healthy' | 'degraded' | 'unhealthy';
  readonly observations: readonly OperationalObservation[];
  readonly issues: readonly OperationalIssue[];
}

const opaqueIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/u;

function safely(check: () => boolean): boolean {
  try {
    return check();
  } catch {
    return false;
  }
}

function isOpaqueScopeId(value: unknown): value is string {
  return isNonEmptyString(value) && opaqueIdPattern.test(value);
}

export function isOperationalScope(value: unknown): value is OperationalScope {
  return safely(() => {
    if (!isJsonSafeValue(value) || !isPlainObject(value)) return false;
    if (value.kind === 'global') return hasExactKeys(value, ['kind']);
    return (
      value.kind === 'screen' &&
      hasExactKeys(value, ['kind', 'screenId'], ['roomId', 'targetDate']) &&
      isOpaqueScopeId(value.screenId) &&
      (value.roomId === undefined || isOpaqueScopeId(value.roomId)) &&
      (value.targetDate === undefined || isIsoDate(value.targetDate))
    );
  });
}

function isBase(
  value: Record<string, unknown>,
  check: OperationalCheckKind,
  scopeKind: OperationalScope['kind'],
): boolean {
  return (
    value.check === check &&
    isIsoInstant(value.observedAt) &&
    isOperationalScope(value.scope) &&
    value.scope.kind === scopeKind
  );
}

export function isOperationalObservation(
  value: unknown,
): value is OperationalObservation {
  return safely(() => {
    if (!isJsonSafeValue(value) || !isPlainObject(value)) return false;
    switch (value.check) {
      case 'catalog-coverage':
        return (
          hasExactKeys(value, [
            'check',
            'observedAt',
            'scope',
            'requiredCount',
            'availableCount',
          ]) &&
          isBase(value, 'catalog-coverage', 'global') &&
          isNonNegativeInteger(value.requiredCount) &&
          isNonNegativeInteger(value.availableCount)
        );
      case 'source-sync':
        return (
          hasExactKeys(
            value,
            ['check', 'observedAt', 'scope', 'state'],
            ['lastSuccessfulAt'],
          ) &&
          isBase(value, 'source-sync', 'global') &&
          isIsoInstant(value.observedAt) &&
          isEnumValue(value.state, ['current', 'stale', 'unknown'] as const) &&
          (value.lastSuccessfulAt === undefined ||
            (isIsoInstant(value.lastSuccessfulAt) &&
              Date.parse(value.lastSuccessfulAt) <=
                Date.parse(value.observedAt)))
        );
      case 'assignment-freshness':
        if (!isOperationalScope(value.scope)) return false;
        return (
          hasExactKeys(value, [
            'check',
            'observedAt',
            'scope',
            'assignmentDate',
            'freshness',
          ]) &&
          value.scope.kind === 'screen' &&
          value.scope.targetDate !== undefined &&
          isBase(value, 'assignment-freshness', 'screen') &&
          isIsoDate(value.assignmentDate) &&
          isEnumValue(value.freshness, ['fresh', 'stale', 'unknown'] as const)
        );
      case 'standalone-readiness':
        return (
          hasExactKeys(value, ['check', 'observedAt', 'scope', 'ready']) &&
          isBase(value, 'standalone-readiness', 'global') &&
          typeof value.ready === 'boolean'
        );
      case 'compatibility-route':
        return (
          hasExactKeys(value, ['check', 'observedAt', 'scope', 'available']) &&
          isBase(value, 'compatibility-route', 'screen') &&
          typeof value.available === 'boolean'
        );
      case 'display-discovery':
        return (
          hasExactKeys(value, [
            'check',
            'observedAt',
            'scope',
            'expectedCount',
            'discoveredCount',
          ]) &&
          isBase(value, 'display-discovery', 'screen') &&
          isNonNegativeInteger(value.expectedCount) &&
          isNonNegativeInteger(value.discoveredCount)
        );
      case 'preview-diagnostics':
        return (
          hasExactKeys(value, [
            'check',
            'observedAt',
            'scope',
            'warningCount',
            'errorCount',
          ]) &&
          isBase(value, 'preview-diagnostics', 'screen') &&
          isNonNegativeInteger(value.warningCount) &&
          isNonNegativeInteger(value.errorCount)
        );
      default:
        return false;
    }
  });
}

export function issueFingerprint(
  code: OperationalIssueCode,
  scope: OperationalScope,
): string | undefined {
  if (!isEnumValue(code, operationalIssueCodes) || !isOperationalScope(scope))
    return undefined;
  return stableFingerprint({ code, scope });
}

function expectedSeverity(
  code: OperationalIssueCode,
): OperationalIssueSeverity {
  return code === 'assignment-stale' ||
    code === 'preview-diagnostics-warning' ||
    code === 'source-sync-stale'
    ? 'warning'
    : 'error';
}

function issue(
  code: OperationalIssueCode,
  severity: OperationalIssueSeverity,
  scope: OperationalScope,
): OperationalIssue {
  return {
    code,
    severity,
    scope: { ...scope },
    fingerprint: stableFingerprint({ code, scope }),
  };
}

function observationIssues(
  observation: OperationalObservation,
): readonly OperationalIssue[] {
  switch (observation.check) {
    case 'catalog-coverage':
      return observation.availableCount < observation.requiredCount
        ? [issue('catalog-coverage-incomplete', 'error', observation.scope)]
        : [];
    case 'source-sync':
      return observation.state === 'stale'
        ? [issue('source-sync-stale', 'warning', observation.scope)]
        : observation.state === 'unknown'
          ? [issue('source-sync-unavailable', 'error', observation.scope)]
          : [];
    case 'assignment-freshness': {
      const result: OperationalIssue[] = [];
      if (observation.assignmentDate !== observation.scope.targetDate)
        result.push(
          issue('assignment-date-mismatch', 'error', observation.scope),
        );
      if (observation.freshness === 'stale')
        result.push(issue('assignment-stale', 'warning', observation.scope));
      if (observation.freshness === 'unknown')
        result.push(issue('assignment-unknown', 'error', observation.scope));
      return result;
    }
    case 'standalone-readiness':
      return observation.ready
        ? []
        : [issue('standalone-not-ready', 'error', observation.scope)];
    case 'compatibility-route':
      return observation.available
        ? []
        : [
            issue(
              'compatibility-route-unavailable',
              'error',
              observation.scope,
            ),
          ];
    case 'display-discovery':
      return observation.discoveredCount < observation.expectedCount
        ? [issue('display-discovery-incomplete', 'error', observation.scope)]
        : [];
    case 'preview-diagnostics':
      return observation.errorCount > 0
        ? [issue('preview-diagnostics-error', 'error', observation.scope)]
        : observation.warningCount > 0
          ? [issue('preview-diagnostics-warning', 'warning', observation.scope)]
          : [];
  }
}

function observationKey(observation: OperationalObservation): string {
  return stableSerialize({
    check: observation.check,
    scope: observation.scope,
  });
}

function cloneObservation(
  observation: OperationalObservation,
): OperationalObservation {
  // Validation above proves an exact JSON round trip; cloning keeps the pure
  // result independent from later caller mutation.
  return JSON.parse(JSON.stringify(observation)) as OperationalObservation;
}

export function buildOperationalReport(input: {
  readonly generatedAt: unknown;
  readonly observations: unknown;
}): OperationalReport | undefined {
  try {
    if (
      !isJsonSafeValue(input) ||
      !isPlainObject(input) ||
      !hasExactKeys(input, ['generatedAt', 'observations']) ||
      !isIsoInstant(input.generatedAt) ||
      !Array.isArray(input.observations) ||
      !input.observations.every(isOperationalObservation)
    )
      return undefined;
    const observations: OperationalObservation[] = input.observations
      .map(cloneObservation)
      .sort((left, right) =>
        observationKey(left).localeCompare(observationKey(right)),
      );
    if (
      new Set(observations.map(observationKey)).size !== observations.length ||
      operationalCheckKinds.some(
        (check) => !observations.some((entry) => entry.check === check),
      )
    )
      return undefined;
    const issues = observations
      .flatMap(observationIssues)
      .sort((left, right) => left.fingerprint.localeCompare(right.fingerprint));
    const status = issues.some((entry) => entry.severity === 'error')
      ? 'unhealthy'
      : issues.length > 0
        ? 'degraded'
        : 'healthy';
    return { generatedAt: input.generatedAt, status, observations, issues };
  } catch {
    return undefined;
  }
}

export function isOperationalIssue(value: unknown): value is OperationalIssue {
  return safely(() => {
    if (
      !isJsonSafeValue(value) ||
      !isPlainObject(value) ||
      !hasExactKeys(value, ['code', 'severity', 'scope', 'fingerprint']) ||
      !isEnumValue(value.code, operationalIssueCodes) ||
      !isEnumValue(value.severity, ['warning', 'error'] as const) ||
      value.severity !== expectedSeverity(value.code) ||
      !isOperationalScope(value.scope)
    )
      return false;
    return value.fingerprint === issueFingerprint(value.code, value.scope);
  });
}

export function isOperationalReport(
  value: unknown,
): value is OperationalReport {
  return safely(() => {
    if (
      !isJsonSafeValue(value) ||
      !isPlainObject(value) ||
      !hasExactKeys(value, [
        'generatedAt',
        'status',
        'observations',
        'issues',
      ]) ||
      !isIsoInstant(value.generatedAt) ||
      !isEnumValue(value.status, [
        'healthy',
        'degraded',
        'unhealthy',
      ] as const) ||
      !Array.isArray(value.observations) ||
      !value.observations.every(isOperationalObservation) ||
      !Array.isArray(value.issues) ||
      !value.issues.every(isOperationalIssue)
    )
      return false;
    const rebuilt = buildOperationalReport({
      generatedAt: value.generatedAt,
      observations: value.observations,
    });
    return (
      rebuilt !== undefined &&
      stableSerialize(rebuilt) === stableSerialize(value)
    );
  });
}
