import type { IsoDate, IsoInstant } from '../../contracts/v1/common.js';
import {
  displayStates,
  type DisplayState,
} from '../../contracts/v1/display.js';
import type { ScreenId } from '../../domain/identities.js';
import {
  containsUndefined,
  hasExactKeys,
  isEnumValue,
  isIsoDate,
  isIsoInstant,
  isNonNegativeInteger,
  isPlainObject,
} from '../../domain/runtime-validation.js';
import type { SafeStateRecord } from '../../ports/application-state.js';

export const m12ScenarioKinds = [
  'normal',
  'changed',
  'gap',
  'no-class',
  'future-day',
  'stale-cache',
  'auth-failure',
] as const;

export type M12ScenarioKind = (typeof m12ScenarioKinds)[number];

export const m12ContentKinds = [
  'schedule',
  'check-in',
  'objective',
  'bellringer',
  'vocabulary',
  'generic',
  'attendance',
  'media',
  'next-day',
] as const;

export const m12RouteFamilies = [
  'display',
  'displays',
  'day-plan',
  'target',
  'preview',
  'overrides',
  'hold',
  'qr',
  'media',
  'assets',
  'manifest',
  'health',
  'readiness',
  'attendance',
  'attendance-redirect',
] as const;

const m12AcceptedRouteExtensions = [
  'hold',
  'attendance',
  'attendance-redirect',
] as const;

const legacyM12RouteFamilies = m12RouteFamilies.filter(
  (family) =>
    !(m12AcceptedRouteExtensions as readonly string[]).includes(family),
);

export interface M12ParitySnapshot {
  readonly plan: {
    readonly variation:
      'normal' | 'changed' | 'gap' | 'no-class' | 'future-day';
    readonly meetingCount: number;
    readonly verification: 'verified' | 'unverified' | 'absent';
    readonly scopeIsolation: 'strict' | 'cross-scope';
    readonly timingBoundaries: 'preserved' | 'different';
    readonly stateSequence: readonly DisplayState[];
    readonly nextClassDay: 'none' | 'tomorrow' | 'next-week' | 'next-class-day';
    readonly fallbackAuthority: 'disabled' | 'unverified';
  };
  readonly display: {
    readonly state: DisplayState;
    readonly currentMeeting: boolean;
    readonly nextMeeting: boolean;
    readonly shell: 'standard' | 'full-screen';
    readonly contentKinds: readonly (typeof m12ContentKinds)[number][];
    readonly classroomEnrichment: 'preserved' | 'different';
    readonly vocabularyRotation: 'preserved' | 'different';
    readonly attendanceResolution: 'preserved' | 'different';
    readonly attendanceMatrix: 'preserved' | 'different';
    readonly previewSemantics: 'preserved' | 'different';
    readonly overrideSemantics: 'preserved' | 'different';
    readonly attendance: 'visible' | 'hidden' | 'unavailable';
    readonly qr: 'visible' | 'hidden' | 'unavailable';
    readonly media: 'ready' | 'fallback' | 'not-applicable';
    readonly polling: 'legacy-compatible' | 'different';
    readonly carousel: 'client-local-pause' | 'server-persistent-hold';
    readonly layout: 'fits' | 'overflow';
    readonly assets: 'local-only' | 'external';
  };
  readonly routes: {
    readonly families: readonly (typeof m12RouteFamilies)[number][];
    readonly getHead: 'preserved' | 'different';
    readonly cachePolicy: 'preserved' | 'different';
    readonly securityHeaders: 'preserved' | 'weaker';
    readonly compatibilityRoute: 'preserved' | 'deferred';
  };
  readonly operations: {
    readonly providerSessionLifecycle: 'preserved' | 'different';
    readonly powerschoolExtendedReads: 'preserved' | 'different';
    readonly classroomReadPipeline: 'preserved' | 'different';
    readonly legacyGoogleReadScope: 'preserved' | 'different';
    readonly source:
      'succeeded' | 'repair-required' | 'failed' | 'not-applicable';
    readonly classroom:
      'succeeded' | 'degraded' | 'skipped' | 'failed' | 'not-applicable';
    readonly readiness: 'ready' | 'not-ready';
    readonly lastKnownGood: 'current' | 'retained' | 'absent';
    readonly jobSequence: 'auth-first' | 'different';
    readonly refreshCadence: 'legacy-weekday-0620' | 'shadow-sun-fri-0720';
    readonly briefWorkflows: 'distinct' | 'missing';
    readonly alertSemantics: 'preserved' | 'different';
    readonly healthDiagnostics: 'preserved' | 'different';
    readonly persistence: 'preserved' | 'different';
    readonly serviceLifecycle: 'preserved' | 'different';
    readonly rollbackReadiness: 'preserved' | 'different';
    readonly operatorSecurity: 'preserved' | 'different';
    readonly networkIsolation: 'preserved' | 'different';
    readonly dependencyIndependence: 'preserved' | 'different';
    readonly attemptedExternalMutations: number;
    readonly completedExternalMutations: number;
  };
}

export interface M12ParityCase {
  readonly id: string;
  readonly kind: M12ScenarioKind;
  readonly date: IsoDate;
  readonly screenId: ScreenId;
  readonly reference: M12ParitySnapshot;
  readonly candidate: M12ParitySnapshot;
}

export interface M12ParityDifference {
  readonly code: string;
  readonly surface: 'plan' | 'display' | 'routes' | 'operations';
  readonly behaviorIds: readonly string[];
  readonly disposition: 'accepted' | 'unexplained';
  readonly severity: 'info' | 'error';
}

export interface M12ParityCaseResult {
  readonly id: string;
  readonly kind: M12ScenarioKind;
  readonly equivalent: boolean;
  readonly differenceCount: number;
  readonly acceptedDifferenceCount: number;
  readonly unexplainedDifferenceCount: number;
  readonly behaviorIds: readonly string[];
  readonly differences: readonly M12ParityDifference[];
}

export interface M12ParitySuiteResult {
  readonly equivalent: boolean;
  readonly caseCount: number;
  readonly acceptedDifferenceCount: number;
  readonly unexplainedDifferenceCount: number;
  readonly behaviorIds: readonly string[];
  readonly cases: readonly M12ParityCaseResult[];
}

type ComparisonEvidenceRecord = Extract<
  SafeStateRecord,
  { readonly kind: 'comparison-evidence' }
>;

interface ComparisonRule {
  readonly path: readonly [
    'plan' | 'display' | 'routes' | 'operations',
    string,
  ];
  readonly code: string;
  readonly behaviorIds: readonly string[];
}

const rules: readonly ComparisonRule[] = [
  rule('plan', 'variation', 'plan-variation-different', [
    'PLAN-001',
    'PLAN-004',
    'PLAN-006',
  ]),
  rule('plan', 'meetingCount', 'plan-meeting-count-different', ['PLAN-001']),
  rule('plan', 'verification', 'plan-verification-different', ['PLAN-001']),
  rule('plan', 'scopeIsolation', 'plan-scope-isolation-different', [
    'PLAN-002',
  ]),
  rule('plan', 'timingBoundaries', 'plan-timing-boundaries-different', [
    'PLAN-003',
  ]),
  rule('plan', 'stateSequence', 'plan-state-sequence-different', [
    'PLAN-004',
    'PLAN-005',
  ]),
  rule('plan', 'nextClassDay', 'plan-next-class-day-different', ['PLAN-006']),
  rule('plan', 'fallbackAuthority', 'plan-fallback-authority-different', [
    'PLAN-007',
  ]),
  rule('display', 'state', 'display-state-different', ['PLAN-004', 'DISP-008']),
  rule('display', 'currentMeeting', 'display-current-meeting-different', [
    'PLAN-004',
  ]),
  rule('display', 'nextMeeting', 'display-next-meeting-different', [
    'PLAN-004',
    'PLAN-006',
  ]),
  rule('display', 'shell', 'display-shell-different', ['DISP-008']),
  rule('display', 'contentKinds', 'display-content-kinds-different', [
    'CONTENT-001',
    'CONTENT-002',
    'CONTENT-003',
    'CONTENT-004',
    'VOC-001',
    'VOC-002',
  ]),
  rule(
    'display',
    'classroomEnrichment',
    'display-classroom-enrichment-different',
    ['GC-002', 'GC-003', 'GC-004', 'GC-005'],
  ),
  rule(
    'display',
    'vocabularyRotation',
    'display-vocabulary-rotation-different',
    ['VOC-001', 'VOC-002'],
  ),
  rule(
    'display',
    'attendanceResolution',
    'display-attendance-resolution-different',
    ['ATT-001', 'ATT-002'],
  ),
  rule('display', 'attendanceMatrix', 'display-attendance-matrix-different', [
    'ATT-006',
  ]),
  rule('display', 'previewSemantics', 'display-preview-semantics-different', [
    'PRE-001',
    'PRE-002',
    'PRE-003',
  ]),
  rule('display', 'overrideSemantics', 'display-override-semantics-different', [
    'OVR-001',
    'OVR-002',
    'OVR-003',
  ]),
  rule('display', 'attendance', 'display-attendance-different', [
    'ATT-001',
    'ATT-003',
  ]),
  rule('display', 'qr', 'display-qr-different', ['ATT-003', 'ATT-004']),
  rule('display', 'media', 'display-media-different', [
    'MEDIA-001',
    'MEDIA-002',
  ]),
  rule('display', 'polling', 'display-polling-different', [
    'DISP-002',
    'DISP-003',
  ]),
  rule('display', 'carousel', 'display-carousel-model-strengthened', [
    'DISP-004',
    'DISP-005',
    'DISP-006',
  ]),
  rule('display', 'layout', 'display-layout-different', ['DISP-007']),
  rule('display', 'assets', 'display-assets-different', ['DISP-009']),
  rule('routes', 'families', 'route-families-different', [
    'ATT-005',
    'DISP-006',
    'HTTP-001',
  ]),
  rule('routes', 'getHead', 'route-method-contract-different', ['HTTP-002']),
  rule('routes', 'cachePolicy', 'route-cache-policy-different', ['HTTP-002']),
  rule('routes', 'securityHeaders', 'route-security-headers-different', [
    'HTTP-003',
    'SEC-002',
  ]),
  rule('routes', 'compatibilityRoute', 'route-compatibility-different', [
    'DISP-001',
    'NET-002',
  ]),
  rule(
    'operations',
    'providerSessionLifecycle',
    'operations-provider-session-lifecycle-different',
    [
      'PS-002',
      'PS-003',
      'PS-004',
      'PS-005',
      'PS-006',
      'PS-007',
      'PS-008',
      'PS-009',
    ],
  ),
  rule(
    'operations',
    'powerschoolExtendedReads',
    'operations-powerschool-extended-reads-different',
    ['PS-010', 'PS-011'],
  ),
  rule(
    'operations',
    'classroomReadPipeline',
    'operations-classroom-read-pipeline-different',
    ['GC-001', 'GC-002', 'GC-003', 'GC-004', 'GC-005', 'GC-006'],
  ),
  rule(
    'operations',
    'legacyGoogleReadScope',
    'operations-legacy-google-read-scope-different',
    ['GC-007'],
  ),
  rule('operations', 'source', 'operations-source-outcome-different', [
    'PS-001',
    'CAL-007',
  ]),
  rule('operations', 'classroom', 'operations-classroom-outcome-different', [
    'GC-001',
    'GC-006',
  ]),
  rule('operations', 'readiness', 'operations-readiness-different', [
    'HEALTH-001',
  ]),
  rule('operations', 'lastKnownGood', 'operations-last-known-good-different', [
    'HEALTH-002',
  ]),
  rule('operations', 'jobSequence', 'operations-job-sequence-different', [
    'OPS-002',
    'CAL-007',
  ]),
  rule('operations', 'refreshCadence', 'operations-refresh-cadence-approved', [
    'OPS-002',
    'U-003',
  ]),
  rule('operations', 'briefWorkflows', 'operations-brief-workflows-different', [
    'OPS-005',
    'U-015',
  ]),
  rule('operations', 'alertSemantics', 'operations-alert-semantics-different', [
    'ALERT-001',
  ]),
  rule(
    'operations',
    'healthDiagnostics',
    'operations-health-diagnostics-different',
    ['HEALTH-003'],
  ),
  rule('operations', 'persistence', 'operations-persistence-different', [
    'PERSIST-001',
    'PERSIST-002',
    'PERSIST-003',
  ]),
  rule(
    'operations',
    'serviceLifecycle',
    'operations-service-lifecycle-different',
    ['OPS-001', 'OPS-003'],
  ),
  rule(
    'operations',
    'rollbackReadiness',
    'operations-rollback-readiness-different',
    ['OPS-004'],
  ),
  rule(
    'operations',
    'operatorSecurity',
    'operations-operator-security-different',
    ['SEC-001'],
  ),
  rule(
    'operations',
    'networkIsolation',
    'operations-network-isolation-different',
    ['NET-001'],
  ),
  rule(
    'operations',
    'dependencyIndependence',
    'operations-dependency-independence-different',
    ['DEP-001'],
  ),
  rule(
    'operations',
    'attemptedExternalMutations',
    'operations-attempted-mutations-different',
    ['PS-001', 'GC-001'],
  ),
  rule(
    'operations',
    'completedExternalMutations',
    'operations-completed-mutations-different',
    ['PS-001', 'GC-001'],
  ),
];

function rule(
  surface: ComparisonRule['path'][0],
  field: string,
  code: string,
  behaviorIds: readonly string[],
): ComparisonRule {
  return { path: [surface, field], code, behaviorIds };
}

/** Compare finite normalized facts and never return either input value. */
export function compareM12ParityCase(
  comparison: M12ParityCase,
): M12ParityCaseResult {
  let valid = false;
  try {
    valid = isM12ParityCase(comparison);
  } catch {
    // Treat hostile accessors and cyclic values like every other invalid input.
  }
  if (!valid) throw new Error('m12-comparison-case-invalid');
  const differences: M12ParityDifference[] = [];
  for (const comparisonRule of rules) {
    const reference = valueAt(comparison.reference, comparisonRule.path);
    const candidate = valueAt(comparison.candidate, comparisonRule.path);
    if (sameValue(reference, candidate)) continue;
    const accepted = isAcceptedDifference(
      comparisonRule.code,
      reference,
      candidate,
    );
    differences.push({
      code: comparisonRule.code,
      surface: comparisonRule.path[0],
      behaviorIds: uniqueSorted(comparisonRule.behaviorIds),
      disposition: accepted ? 'accepted' : 'unexplained',
      severity: accepted ? 'info' : 'error',
    });
  }
  if (
    comparison.candidate.operations.attemptedExternalMutations !== 0 ||
    comparison.candidate.operations.completedExternalMutations !== 0
  ) {
    differences.push({
      code: 'operations-source-mutation-boundary-violated',
      surface: 'operations',
      behaviorIds: uniqueSorted(['PS-001', 'GC-001']),
      disposition: 'unexplained',
      severity: 'error',
    });
  }
  differences.sort((left, right) => left.code.localeCompare(right.code));
  const acceptedDifferenceCount = differences.filter(
    ({ disposition }) => disposition === 'accepted',
  ).length;
  const unexplainedDifferenceCount =
    differences.length - acceptedDifferenceCount;
  return {
    id: comparison.id,
    kind: comparison.kind,
    equivalent: unexplainedDifferenceCount === 0,
    differenceCount: differences.length,
    acceptedDifferenceCount,
    unexplainedDifferenceCount,
    behaviorIds: uniqueSorted(
      differences.flatMap(({ behaviorIds }) => behaviorIds),
    ),
    differences,
  };
}

/** Required scenarios are exact so a passing suite cannot silently omit a gate. */
export function compareM12ParitySuite(
  manifest: readonly M12ParityCase[],
): M12ParitySuiteResult {
  let valid = false;
  try {
    valid = isM12Manifest(manifest);
  } catch {
    // Do not surface hostile input details through the comparison boundary.
  }
  if (!valid) throw new Error('m12-comparison-manifest-invalid');
  const cases = manifest.map(compareM12ParityCase);
  const acceptedDifferenceCount = cases.reduce(
    (total, result) => total + result.acceptedDifferenceCount,
    0,
  );
  const unexplainedDifferenceCount = cases.reduce(
    (total, result) => total + result.unexplainedDifferenceCount,
    0,
  );
  return {
    equivalent: unexplainedDifferenceCount === 0,
    caseCount: cases.length,
    acceptedDifferenceCount,
    unexplainedDifferenceCount,
    behaviorIds: uniqueSorted(cases.flatMap(({ behaviorIds }) => behaviorIds)),
    cases,
  };
}

/** Project one value-free result into the existing strict SQLite evidence kind. */
export function toM12ComparisonEvidence(options: {
  readonly result: M12ParityCaseResult;
  readonly comparison: M12ParityCase;
  readonly comparedAt: IsoInstant;
}): ComparisonEvidenceRecord {
  let valid = false;
  try {
    valid =
      isM12ParityCase(options.comparison) &&
      isM12ParityCaseResult(options.result) &&
      options.result.id === options.comparison.id &&
      options.result.kind === options.comparison.kind &&
      isIsoInstant(options.comparedAt);
  } catch {
    // Evidence construction has one sanitized failure contract.
  }
  if (!valid) throw new Error('m12-comparison-evidence-invalid');
  const expected = compareM12ParityCase(options.comparison);
  if (!sameValue(options.result, expected))
    throw new Error('m12-comparison-evidence-invalid');
  return {
    kind: 'comparison-evidence',
    recordKey: `m12-${options.comparison.id}`,
    scope: {
      date: options.comparison.date,
      screenId: options.comparison.screenId,
    },
    data: {
      comparedAt: options.comparedAt,
      equal: options.result.differenceCount === 0,
      differenceCodes: options.result.differences.map(({ code }) => code),
      diagnostics: options.result.differences.map((difference) => ({
        code: difference.code,
        severity: difference.severity,
        message:
          difference.disposition === 'accepted'
            ? 'The comparison found an explicitly accepted replacement difference.'
            : 'The comparison found an unexplained material behavior difference.',
      })),
    },
  };
}

function isM12Manifest(value: unknown): value is readonly M12ParityCase[] {
  if (
    !Array.isArray(value) ||
    containsUndefined(value) ||
    value.length !== m12ScenarioKinds.length ||
    !value.every(isM12ParityCase)
  )
    return false;
  return (
    new Set(value.map(({ id }) => id)).size === value.length &&
    new Set(value.map(({ kind }) => kind)).size === m12ScenarioKinds.length &&
    m12ScenarioKinds.every((kind) => value.some((entry) => entry.kind === kind))
  );
}

function isM12ParityCase(value: unknown): value is M12ParityCase {
  if (!(
    isPlainObject(value) &&
    hasExactKeys(value, [
      'id',
      'kind',
      'date',
      'screenId',
      'reference',
      'candidate',
    ]) &&
    typeof value.id === 'string' &&
    value.id === `m12-${String(value.kind)}` &&
    isEnumValue(value.kind, m12ScenarioKinds) &&
    isIsoDate(value.date) &&
    typeof value.screenId === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value.screenId) &&
    isM12ParitySnapshot(value.reference) &&
    isM12ParitySnapshot(value.candidate)
  ))
    return false;
  // The trusted reference defines the scenario. Candidate facts may differ on
  // any field so the comparator can report, rather than reject, real drift.
  return snapshotMatchesScenario(value.kind, value.reference);
}

function isM12ParitySnapshot(value: unknown): value is M12ParitySnapshot {
  if (
    !isPlainObject(value) ||
    !hasExactKeys(value, ['plan', 'display', 'routes', 'operations']) ||
    containsUndefined(value)
  )
    return false;
  return (
    isPlan(value.plan) &&
    isDisplay(value.display) &&
    isRoutes(value.routes) &&
    isOperations(value.operations)
  );
}

function isPlan(value: unknown): boolean {
  return (
    isPlainObject(value) &&
    hasExactKeys(value, [
      'variation',
      'meetingCount',
      'verification',
      'scopeIsolation',
      'timingBoundaries',
      'stateSequence',
      'nextClassDay',
      'fallbackAuthority',
    ]) &&
    isEnumValue(value.variation, [
      'normal',
      'changed',
      'gap',
      'no-class',
      'future-day',
    ]) &&
    isNonNegativeInteger(value.meetingCount) &&
    value.meetingCount <= 24 &&
    isEnumValue(value.verification, ['verified', 'unverified', 'absent']) &&
    isEnumValue(value.scopeIsolation, ['strict', 'cross-scope']) &&
    isEnumValue(value.timingBoundaries, ['preserved', 'different']) &&
    enumArray(value.stateSequence, displayStates, 1, displayStates.length) &&
    new Set(value.stateSequence as readonly unknown[]).size ===
      (value.stateSequence as readonly unknown[]).length &&
    isEnumValue(value.nextClassDay, [
      'none',
      'tomorrow',
      'next-week',
      'next-class-day',
    ]) &&
    isEnumValue(value.fallbackAuthority, ['disabled', 'unverified'])
  );
}

function snapshotMatchesScenario(
  kind: M12ScenarioKind,
  snapshot: M12ParitySnapshot,
): boolean {
  switch (kind) {
    case 'normal':
      return (
        snapshot.plan.variation === 'normal' &&
        snapshot.plan.meetingCount > 0 &&
        snapshot.display.state === 'in_class_content' &&
        snapshot.operations.source === 'succeeded' &&
        snapshot.operations.classroom === 'succeeded' &&
        snapshot.operations.readiness === 'ready' &&
        snapshot.operations.lastKnownGood === 'current'
      );
    case 'changed':
      return (
        snapshot.plan.variation === 'changed' &&
        snapshot.plan.meetingCount > 0 &&
        snapshot.operations.source === 'succeeded' &&
        snapshot.operations.readiness === 'ready'
      );
    case 'gap':
      return (
        snapshot.plan.variation === 'gap' &&
        snapshot.plan.meetingCount > 0 &&
        snapshot.display.state === 'idle' &&
        !snapshot.display.currentMeeting &&
        snapshot.display.nextMeeting
      );
    case 'no-class':
      return (
        snapshot.plan.variation === 'no-class' &&
        snapshot.plan.meetingCount === 0 &&
        snapshot.plan.verification === 'absent' &&
        snapshot.display.state === 'no_classes' &&
        !snapshot.display.currentMeeting &&
        !snapshot.display.nextMeeting
      );
    case 'future-day':
      return (
        snapshot.plan.variation === 'future-day' &&
        snapshot.display.state === 'day_complete' &&
        snapshot.plan.nextClassDay !== 'none' &&
        !snapshot.display.currentMeeting &&
        snapshot.display.nextMeeting
      );
    case 'stale-cache':
      return (
        snapshot.plan.variation === 'normal' &&
        snapshot.plan.meetingCount > 0 &&
        snapshot.operations.source === 'succeeded' &&
        snapshot.operations.classroom === 'degraded' &&
        snapshot.operations.lastKnownGood === 'retained'
      );
    case 'auth-failure':
      return (
        snapshot.plan.variation === 'normal' &&
        snapshot.operations.source === 'repair-required' &&
        snapshot.operations.classroom === 'skipped' &&
        snapshot.operations.readiness === 'not-ready' &&
        snapshot.operations.lastKnownGood === 'retained'
      );
  }
}

function isDisplay(value: unknown): boolean {
  return (
    isPlainObject(value) &&
    hasExactKeys(value, [
      'state',
      'currentMeeting',
      'nextMeeting',
      'shell',
      'contentKinds',
      'classroomEnrichment',
      'vocabularyRotation',
      'attendanceResolution',
      'attendanceMatrix',
      'previewSemantics',
      'overrideSemantics',
      'attendance',
      'qr',
      'media',
      'polling',
      'carousel',
      'layout',
      'assets',
    ]) &&
    isEnumValue(value.state, displayStates) &&
    typeof value.currentMeeting === 'boolean' &&
    typeof value.nextMeeting === 'boolean' &&
    isEnumValue(value.shell, ['standard', 'full-screen']) &&
    enumArray(value.contentKinds, m12ContentKinds, 0, m12ContentKinds.length) &&
    new Set(value.contentKinds as readonly unknown[]).size ===
      (value.contentKinds as readonly unknown[]).length &&
    isEnumValue(value.classroomEnrichment, ['preserved', 'different']) &&
    isEnumValue(value.vocabularyRotation, ['preserved', 'different']) &&
    isEnumValue(value.attendanceResolution, ['preserved', 'different']) &&
    isEnumValue(value.attendanceMatrix, ['preserved', 'different']) &&
    isEnumValue(value.previewSemantics, ['preserved', 'different']) &&
    isEnumValue(value.overrideSemantics, ['preserved', 'different']) &&
    isEnumValue(value.attendance, ['visible', 'hidden', 'unavailable']) &&
    isEnumValue(value.qr, ['visible', 'hidden', 'unavailable']) &&
    isEnumValue(value.media, ['ready', 'fallback', 'not-applicable']) &&
    isEnumValue(value.polling, ['legacy-compatible', 'different']) &&
    isEnumValue(value.carousel, [
      'client-local-pause',
      'server-persistent-hold',
    ]) &&
    isEnumValue(value.layout, ['fits', 'overflow']) &&
    isEnumValue(value.assets, ['local-only', 'external'])
  );
}

function isRoutes(value: unknown): boolean {
  return (
    isPlainObject(value) &&
    hasExactKeys(value, [
      'families',
      'getHead',
      'cachePolicy',
      'securityHeaders',
      'compatibilityRoute',
    ]) &&
    isCanonicalEnumSubset(value.families, m12RouteFamilies) &&
    isEnumValue(value.getHead, ['preserved', 'different']) &&
    isEnumValue(value.cachePolicy, ['preserved', 'different']) &&
    isEnumValue(value.securityHeaders, ['preserved', 'weaker']) &&
    isEnumValue(value.compatibilityRoute, ['preserved', 'deferred'])
  );
}

function isOperations(value: unknown): boolean {
  return (
    isPlainObject(value) &&
    hasExactKeys(value, [
      'providerSessionLifecycle',
      'powerschoolExtendedReads',
      'classroomReadPipeline',
      'legacyGoogleReadScope',
      'source',
      'classroom',
      'readiness',
      'lastKnownGood',
      'jobSequence',
      'refreshCadence',
      'briefWorkflows',
      'alertSemantics',
      'healthDiagnostics',
      'persistence',
      'serviceLifecycle',
      'rollbackReadiness',
      'operatorSecurity',
      'networkIsolation',
      'dependencyIndependence',
      'attemptedExternalMutations',
      'completedExternalMutations',
    ]) &&
    isEnumValue(value.providerSessionLifecycle, ['preserved', 'different']) &&
    isEnumValue(value.powerschoolExtendedReads, ['preserved', 'different']) &&
    isEnumValue(value.classroomReadPipeline, ['preserved', 'different']) &&
    isEnumValue(value.legacyGoogleReadScope, ['preserved', 'different']) &&
    isEnumValue(value.source, [
      'succeeded',
      'repair-required',
      'failed',
      'not-applicable',
    ]) &&
    isEnumValue(value.classroom, [
      'succeeded',
      'degraded',
      'skipped',
      'failed',
      'not-applicable',
    ]) &&
    isEnumValue(value.readiness, ['ready', 'not-ready']) &&
    isEnumValue(value.lastKnownGood, ['current', 'retained', 'absent']) &&
    isEnumValue(value.jobSequence, ['auth-first', 'different']) &&
    isEnumValue(value.refreshCadence, [
      'legacy-weekday-0620',
      'shadow-sun-fri-0720',
    ]) &&
    isEnumValue(value.briefWorkflows, ['distinct', 'missing']) &&
    isEnumValue(value.alertSemantics, ['preserved', 'different']) &&
    isEnumValue(value.healthDiagnostics, ['preserved', 'different']) &&
    isEnumValue(value.persistence, ['preserved', 'different']) &&
    isEnumValue(value.serviceLifecycle, ['preserved', 'different']) &&
    isEnumValue(value.rollbackReadiness, ['preserved', 'different']) &&
    isEnumValue(value.operatorSecurity, ['preserved', 'different']) &&
    isEnumValue(value.networkIsolation, ['preserved', 'different']) &&
    isEnumValue(value.dependencyIndependence, ['preserved', 'different']) &&
    isNonNegativeInteger(value.attemptedExternalMutations) &&
    value.attemptedExternalMutations <= 1_000 &&
    isNonNegativeInteger(value.completedExternalMutations) &&
    value.completedExternalMutations <= value.attemptedExternalMutations
  );
}

function enumArray<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
  minimum: number,
  maximum: number,
): boolean {
  return (
    Array.isArray(value) &&
    !containsUndefined(value) &&
    value.length >= minimum &&
    value.length <= maximum &&
    value.every((entry) => isEnumValue(entry, values))
  );
}

function valueAt(
  snapshot: M12ParitySnapshot,
  [surface, field]: ComparisonRule['path'],
): unknown {
  return (snapshot[surface] as unknown as Record<string, unknown>)[field];
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isAcceptedDifference(
  code: string,
  reference: unknown,
  candidate: unknown,
): boolean {
  return (
    (code === 'display-carousel-model-strengthened' &&
      reference === 'client-local-pause' &&
      candidate === 'server-persistent-hold') ||
    (code === 'operations-refresh-cadence-approved' &&
      reference === 'legacy-weekday-0620' &&
      candidate === 'shadow-sun-fri-0720') ||
    (code === 'route-families-different' &&
      sameValue(reference, legacyM12RouteFamilies) &&
      sameValue(candidate, m12RouteFamilies))
  );
}

function isCanonicalEnumSubset<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
): boolean {
  if (!enumArray(value, values, 1, values.length)) return false;
  const entries = value as readonly string[];
  return (
    new Set(entries).size === entries.length &&
    sameValue(
      entries,
      values.filter((entry) => entries.includes(entry)),
    )
  );
}

function uniqueSorted(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function isM12ParityCaseResult(value: unknown): value is M12ParityCaseResult {
  if (!(
    isPlainObject(value) &&
    hasExactKeys(value, [
      'id',
      'kind',
      'equivalent',
      'differenceCount',
      'acceptedDifferenceCount',
      'unexplainedDifferenceCount',
      'behaviorIds',
      'differences',
    ]) &&
    typeof value.id === 'string' &&
    value.id === `m12-${String(value.kind)}` &&
    isEnumValue(value.kind, m12ScenarioKinds) &&
    typeof value.equivalent === 'boolean' &&
    isNonNegativeInteger(value.differenceCount) &&
    isNonNegativeInteger(value.acceptedDifferenceCount) &&
    isNonNegativeInteger(value.unexplainedDifferenceCount) &&
    value.differenceCount ===
      value.acceptedDifferenceCount + value.unexplainedDifferenceCount &&
    Array.isArray(value.behaviorIds) &&
    value.behaviorIds.every(
      (entry) => typeof entry === 'string' && /^[A-Z]+-[0-9]{3}$/u.test(entry),
    ) &&
    sameValue(value.behaviorIds, uniqueSorted(value.behaviorIds)) &&
    Array.isArray(value.differences) &&
    value.differences.length === value.differenceCount &&
    value.equivalent === (value.unexplainedDifferenceCount === 0)
  ))
    return false;
  if (!value.differences.every(isM12ParityDifference)) return false;
  const differences = value.differences as readonly M12ParityDifference[];
  return (
    new Set(differences.map(({ code }) => code)).size === differences.length &&
    value.acceptedDifferenceCount ===
      differences.filter(({ disposition }) => disposition === 'accepted')
        .length &&
    value.unexplainedDifferenceCount ===
      differences.filter(({ disposition }) => disposition === 'unexplained')
        .length &&
    sameValue(
      value.behaviorIds,
      uniqueSorted(differences.flatMap(({ behaviorIds }) => behaviorIds)),
    )
  );
}

function isM12ParityDifference(value: unknown): value is M12ParityDifference {
  return (
    isPlainObject(value) &&
    hasExactKeys(value, [
      'code',
      'surface',
      'behaviorIds',
      'disposition',
      'severity',
    ]) &&
    typeof value.code === 'string' &&
    /^[a-z][a-z0-9-]{0,95}$/u.test(value.code) &&
    isEnumValue(value.surface, ['plan', 'display', 'routes', 'operations']) &&
    Array.isArray(value.behaviorIds) &&
    value.behaviorIds.length > 0 &&
    value.behaviorIds.every(
      (entry) => typeof entry === 'string' && /^[A-Z]+-[0-9]{3}$/u.test(entry),
    ) &&
    sameValue(value.behaviorIds, uniqueSorted(value.behaviorIds)) &&
    isEnumValue(value.disposition, ['accepted', 'unexplained']) &&
    isEnumValue(value.severity, ['info', 'error']) &&
    (value.disposition === 'accepted'
      ? value.severity === 'info'
      : value.severity === 'error')
  );
}
