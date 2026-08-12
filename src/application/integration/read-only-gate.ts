import { refreshGoogleClassroom } from '../classroom/refresh.js';
import { acquireCanonicalPlan } from '../read-only/acquire-canonical-plan.js';
import { googleClassroomCourseworkReadScope } from '../../config/google-classroom.js';
import type { IsoDate, IsoInstant } from '../../contracts/v1/common.js';
import type {
  CourseMapping,
  CourseworkEnrichment,
} from '../../domain/coursework.js';
import type {
  CoursePlanMapping,
  PlanTimingPolicy,
} from '../../domain/plan-derivation.js';
import type { RoomId } from '../../domain/identities.js';
import { courseKeyFromSectionCode } from '../../domain/identities.js';
import {
  isIanaTimeZone,
  isIsoDate,
  isIsoInstant,
} from '../../domain/runtime-validation.js';
import type { ClassroomEnrichmentCache } from '../../ports/classroom-cache.js';
import type {
  EnrichmentObservationSource,
  ScheduleObservationSource,
} from '../../ports/read-sources.js';

export const m10PermissionInventory = deepFreeze({
  powerSchool: {
    capability: 'schedule-read',
    providerMethods: ['GET', 'HEAD'],
    repair: 'separate-operator-present',
  },
  googleClassroom: {
    capability: 'published-coursework-read',
    operation: 'courses.courseWork.list',
    scope: googleClassroomCourseworkReadScope,
  },
  calendar: { capability: 'absent' },
} as const);

export type M10ScheduleStatus =
  'planned' | 'not-found' | 'repair-required' | 'failed';

export type M10ClassroomStatus =
  | 'refreshed'
  | 'degraded'
  | 'repair-required'
  | 'retained'
  | 'failed'
  | 'not-run';

export interface M10ClassroomCase {
  readonly mappings: readonly CourseMapping[];
  readonly refreshedAt: IsoInstant;
  readonly cacheFreshSeconds: number;
  readonly backoffBaseSeconds: number;
  readonly backoffMaximumSeconds: number;
  readonly maximumParallelCourses: number;
  readonly expectedStatus: Exclude<M10ClassroomStatus, 'not-run'>;
}

export interface M10IntegrationCase {
  readonly caseId: string;
  readonly date: IsoDate;
  readonly roomId: RoomId;
  readonly scheduleMappings: readonly CoursePlanMapping[];
  readonly timing: PlanTimingPolicy;
  readonly expectedScheduleStatus: M10ScheduleStatus;
  readonly classroom?: M10ClassroomCase;
}

export interface M10IntegrationManifest {
  readonly version: 1;
  readonly cases: readonly M10IntegrationCase[];
}

export interface M10CaseResult {
  readonly caseId: string;
  readonly scheduleStatus: M10ScheduleStatus;
  readonly classroomStatus: M10ClassroomStatus;
  readonly meetingCount: number;
  readonly attemptedClassroomReads: number;
  readonly classroomCacheWrites: number;
  readonly freshCacheCount: number;
  readonly staleCacheCount: number;
  readonly missingCacheCount: number;
  readonly scopeIsolation: 'verified' | 'not-planned';
  readonly differences: readonly M10DifferenceCode[];
  readonly attemptedSourceMutations: 0;
  readonly completedSourceMutations: 0;
  readonly eligibleCalendarIntents: 0;
}

export type M10DifferenceCode =
  | 'schedule-outcome-difference'
  | 'schedule-mapping-difference'
  | 'classroom-outcome-difference'
  | 'plan-scope-difference'
  | 'integration-aborted';

export interface M10IntegrationResult {
  readonly status: 'passed' | 'differences';
  readonly permissionInventory: typeof m10PermissionInventory;
  readonly cases: readonly M10CaseResult[];
  readonly plannedCaseCount: number;
  readonly repairRequiredCaseCount: number;
  readonly differenceCount: number;
  readonly attemptedSourceMutations: 0;
  readonly completedSourceMutations: 0;
  readonly eligibleCalendarIntents: 0;
  readonly calendarCapabilityConstructed: false;
}

export interface M10IntegrationDependencies {
  readonly scheduleSourceForCase: (
    caseId: string,
    signal: AbortSignal,
  ) => ScheduleObservationSource;
  readonly classroomSourceForCase: (
    caseId: string,
    signal: AbortSignal,
  ) => EnrichmentObservationSource<CourseworkEnrichment>;
  readonly classroomCache: ClassroomEnrichmentCache;
  readonly signal: AbortSignal;
}

/**
 * Runs the read-only integration comparison without accepting any Calendar,
 * provider-write, credential-repair, command, or generic network capability.
 */
export async function runM10ReadOnlyIntegrationGate(
  manifest: M10IntegrationManifest,
  dependencies: M10IntegrationDependencies,
): Promise<M10IntegrationResult> {
  assertManifest(manifest);
  const signal = dependencies.signal;
  const results: M10CaseResult[] = [];
  for (const testCase of manifest.cases) {
    if (signal.aborted) {
      results.push(abortedResult(testCase));
      continue;
    }
    let schedule: Awaited<ReturnType<typeof acquireCanonicalPlan>>;
    try {
      schedule = await acquireCanonicalPlan(
        dependencies.scheduleSourceForCase(testCase.caseId, signal),
        {
          date: testCase.date,
          roomId: testCase.roomId,
          mappings: testCase.scheduleMappings,
          timing: testCase.timing,
        },
      );
    } catch {
      results.push(failedScheduleResult(testCase));
      continue;
    }
    const scheduleStatus = schedule.status;
    const differences: M10DifferenceCode[] = [];
    if (scheduleStatus !== testCase.expectedScheduleStatus)
      differences.push(
        schedule.status === 'not-found' &&
          schedule.diagnostics.some((entry) =>
            [
              'schedule-room-mismatch',
              'course-mapping-missing',
              'course-mapping-ambiguous',
            ].includes(entry.code),
          )
          ? 'schedule-mapping-difference'
          : 'schedule-outcome-difference',
      );
    const scopeIsolation =
      schedule.status === 'planned'
        ? schedule.plan.roomId === testCase.roomId
          ? 'verified'
          : 'not-planned'
        : 'not-planned';
    if (schedule.status === 'planned' && scopeIsolation !== 'verified')
      differences.push('plan-scope-difference');

    let classroomStatus: M10ClassroomStatus = 'not-run';
    let attemptedClassroomReads = 0;
    let classroomCacheWrites = 0;
    let freshCacheCount = 0;
    let staleCacheCount = 0;
    let missingCacheCount = 0;
    if (schedule.status === 'planned' && testCase.classroom !== undefined) {
      const classroom = testCase.classroom;
      let batch: Awaited<ReturnType<typeof refreshGoogleClassroom>>;
      try {
        batch = await refreshGoogleClassroom({
          date: testCase.date,
          mappings: classroom.mappings,
          source: dependencies.classroomSourceForCase(testCase.caseId, signal),
          cache: dependencies.classroomCache,
          refreshedAt: classroom.refreshedAt,
          cacheFreshSeconds: classroom.cacheFreshSeconds,
          backoffBaseSeconds: classroom.backoffBaseSeconds,
          backoffMaximumSeconds: classroom.backoffMaximumSeconds,
          maximumParallelCourses: classroom.maximumParallelCourses,
          signal,
        });
      } catch {
        classroomStatus = 'failed';
        if (classroom.expectedStatus !== 'failed')
          differences.push('classroom-outcome-difference');
        results.push(
          completedCaseResult({
            testCase,
            scheduleStatus,
            classroomStatus,
            meetingCount: schedule.plan.meetings.length,
            scopeIsolation,
            differences,
          }),
        );
        continue;
      }
      attemptedClassroomReads = batch.attemptedReads;
      classroomCacheWrites = batch.cacheWrites;
      classroomStatus = classifyClassroomBatch(batch.results);
      for (const mapping of classroom.mappings) {
        try {
          const entry = await dependencies.classroomCache.load(
            mapping.classId,
            testCase.date,
            classroom.refreshedAt,
          );
          if (entry?.enrichment?.freshness === 'fresh') freshCacheCount += 1;
          else if (entry?.enrichment?.freshness === 'stale')
            staleCacheCount += 1;
          else missingCacheCount += 1;
        } catch {
          missingCacheCount += 1;
        }
      }
      if (classroomStatus !== classroom.expectedStatus)
        differences.push('classroom-outcome-difference');
    }
    results.push(
      completedCaseResult({
        testCase,
        scheduleStatus,
        classroomStatus,
        meetingCount:
          schedule.status === 'planned' ? schedule.plan.meetings.length : 0,
        attemptedClassroomReads,
        classroomCacheWrites,
        freshCacheCount,
        staleCacheCount,
        missingCacheCount,
        scopeIsolation,
        differences,
      }),
    );
  }
  const differenceCount = results.reduce(
    (count, result) => count + result.differences.length,
    0,
  );
  return deepFreeze({
    status: differenceCount === 0 ? 'passed' : 'differences',
    permissionInventory: m10PermissionInventory,
    cases: results,
    plannedCaseCount: results.filter(
      (result) => result.scheduleStatus === 'planned',
    ).length,
    repairRequiredCaseCount: results.filter(
      (result) =>
        result.scheduleStatus === 'repair-required' ||
        result.classroomStatus === 'repair-required',
    ).length,
    differenceCount,
    attemptedSourceMutations: 0,
    completedSourceMutations: 0,
    eligibleCalendarIntents: 0,
    calendarCapabilityConstructed: false,
  });
}

function completedCaseResult(options: {
  readonly testCase: M10IntegrationCase;
  readonly scheduleStatus: M10ScheduleStatus;
  readonly classroomStatus: M10ClassroomStatus;
  readonly meetingCount: number;
  readonly attemptedClassroomReads?: number;
  readonly classroomCacheWrites?: number;
  readonly freshCacheCount?: number;
  readonly staleCacheCount?: number;
  readonly missingCacheCount?: number;
  readonly scopeIsolation: 'verified' | 'not-planned';
  readonly differences: readonly M10DifferenceCode[];
}): M10CaseResult {
  return deepFreeze({
    caseId: options.testCase.caseId,
    scheduleStatus: options.scheduleStatus,
    classroomStatus: options.classroomStatus,
    meetingCount: options.meetingCount,
    attemptedClassroomReads: options.attemptedClassroomReads ?? 0,
    classroomCacheWrites: options.classroomCacheWrites ?? 0,
    freshCacheCount: options.freshCacheCount ?? 0,
    staleCacheCount: options.staleCacheCount ?? 0,
    missingCacheCount: options.missingCacheCount ?? 0,
    scopeIsolation: options.scopeIsolation,
    differences: options.differences,
    attemptedSourceMutations: 0,
    completedSourceMutations: 0,
    eligibleCalendarIntents: 0,
  });
}

function failedScheduleResult(testCase: M10IntegrationCase): M10CaseResult {
  return completedCaseResult({
    testCase,
    scheduleStatus: 'failed',
    classroomStatus: 'not-run',
    meetingCount: 0,
    scopeIsolation: 'not-planned',
    differences:
      testCase.expectedScheduleStatus === 'failed'
        ? []
        : ['schedule-outcome-difference'],
  });
}

function classifyClassroomBatch(
  results: Awaited<ReturnType<typeof refreshGoogleClassroom>>['results'],
): M10ClassroomStatus {
  const refreshed = results.filter((result) => result.status === 'refreshed');
  const failed = results.filter((result) => result.status === 'failed');
  if (failed.length === 0)
    return refreshed.length > 0 ? 'refreshed' : 'retained';
  if (
    refreshed.length === 0 &&
    failed.some((result) => result.code === 'classroom-authentication-required')
  )
    return 'repair-required';
  return refreshed.length > 0 ? 'degraded' : 'failed';
}

function abortedResult(testCase: M10IntegrationCase): M10CaseResult {
  return deepFreeze({
    caseId: testCase.caseId,
    scheduleStatus: 'failed',
    classroomStatus: 'not-run',
    meetingCount: 0,
    attemptedClassroomReads: 0,
    classroomCacheWrites: 0,
    freshCacheCount: 0,
    staleCacheCount: 0,
    missingCacheCount: 0,
    scopeIsolation: 'not-planned',
    differences: ['integration-aborted'],
    attemptedSourceMutations: 0,
    completedSourceMutations: 0,
    eligibleCalendarIntents: 0,
  });
}

function assertManifest(manifest: M10IntegrationManifest): void {
  try {
    if (!validManifest(manifest))
      throw new Error('m10-integration-manifest-invalid');
  } catch {
    throw new Error('m10-integration-manifest-invalid');
  }
}

function validManifest(value: unknown): value is M10IntegrationManifest {
  if (!exactObject(value, ['version', 'cases'])) return false;
  const cases = exactArray(value.cases);
  return (
    value.version === 1 &&
    cases !== undefined &&
    cases.length >= 1 &&
    cases.length <= 12 &&
    cases.every(validCase) &&
    new Set(cases.map((entry) => (entry as M10IntegrationCase).caseId)).size ===
      cases.length
  );
}

function validCase(value: unknown): value is M10IntegrationCase {
  if (
    !exactObject(
      value,
      [
        'caseId',
        'date',
        'roomId',
        'scheduleMappings',
        'timing',
        'expectedScheduleStatus',
      ],
      ['classroom'],
    )
  )
    return false;
  const testCase = value as unknown as M10IntegrationCase;
  const scheduleMappings = exactArray(testCase.scheduleMappings);
  if (
    scheduleMappings === undefined ||
    !exactObject(testCase.timing, [
      'timeZone',
      'checkInOpenMinutesBefore',
      'dismissalWarningMinutesBefore',
    ]) ||
    !scheduleMappings.every((value) =>
      exactObject(value, ['classId', 'sectionCode', 'roomId'], ['periodId']),
    )
  )
    return false;
  const classroomClassIds = new Set(
    scheduleMappings.map(
      (mapping) => (mapping as unknown as CoursePlanMapping).classId,
    ),
  );
  return (
    typeof testCase.caseId === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u.test(testCase.caseId) &&
    isIsoDate(testCase.date) &&
    boundedId(testCase.roomId) &&
    scheduleMappings.length <= 64 &&
    new Set(
      scheduleMappings.map((value) => {
        const mapping = value as unknown as CoursePlanMapping;
        return `${mapping.roomId}\u0000${courseKeyFromSectionCode(mapping.sectionCode) ?? ''}\u0000${mapping.periodId ?? ''}`;
      }),
    ).size === scheduleMappings.length &&
    scheduleMappings.every((value) => {
      const mapping = value as unknown as CoursePlanMapping;
      return (
        mapping.roomId === testCase.roomId &&
        boundedId(mapping.classId) &&
        boundedSectionCode(mapping.sectionCode) &&
        (mapping.periodId === undefined || boundedId(mapping.periodId))
      );
    }) &&
    isIanaTimeZone(testCase.timing.timeZone) &&
    boundedMinutes(testCase.timing.checkInOpenMinutesBefore) &&
    boundedMinutes(testCase.timing.dismissalWarningMinutesBefore) &&
    ['planned', 'not-found', 'repair-required', 'failed'].includes(
      testCase.expectedScheduleStatus,
    ) &&
    (testCase.classroom === undefined ||
      validClassroomCase(testCase.classroom, classroomClassIds))
  );
}

function validClassroomCase(
  value: unknown,
  scheduleClassIds: ReadonlySet<string>,
): value is M10ClassroomCase {
  if (
    !exactObject(value, [
      'mappings',
      'refreshedAt',
      'cacheFreshSeconds',
      'backoffBaseSeconds',
      'backoffMaximumSeconds',
      'maximumParallelCourses',
      'expectedStatus',
    ])
  )
    return false;
  const classroom = value as unknown as M10ClassroomCase;
  const mappings = exactArray(classroom.mappings);
  return (
    mappings !== undefined &&
    mappings.length >= 1 &&
    mappings.length <= 12 &&
    mappings.every((value) =>
      exactObject(value, ['classId', 'providerCourseKey']),
    ) &&
    new Set(
      mappings.map((mapping) => (mapping as unknown as CourseMapping).classId),
    ).size === mappings.length &&
    new Set(
      mappings.map(
        (mapping) => (mapping as unknown as CourseMapping).providerCourseKey,
      ),
    ).size === mappings.length &&
    mappings.every((value) => {
      const mapping = value as unknown as CourseMapping;
      return (
        scheduleClassIds.has(mapping.classId) &&
        boundedId(mapping.classId) &&
        typeof mapping.providerCourseKey === 'string' &&
        /^\d{1,32}$/u.test(mapping.providerCourseKey)
      );
    }) &&
    isIsoInstant(classroom.refreshedAt) &&
    Number.isSafeInteger(classroom.cacheFreshSeconds) &&
    classroom.cacheFreshSeconds >= 60 &&
    classroom.cacheFreshSeconds <= 86_400 &&
    Number.isSafeInteger(classroom.backoffBaseSeconds) &&
    classroom.backoffBaseSeconds >= 10 &&
    classroom.backoffBaseSeconds <= 3_600 &&
    Number.isSafeInteger(classroom.backoffMaximumSeconds) &&
    classroom.backoffMaximumSeconds >= classroom.backoffBaseSeconds &&
    classroom.backoffMaximumSeconds <= 86_400 &&
    Number.isSafeInteger(classroom.maximumParallelCourses) &&
    classroom.maximumParallelCourses >= 1 &&
    classroom.maximumParallelCourses <= 4 &&
    ['refreshed', 'degraded', 'repair-required', 'retained', 'failed'].includes(
      classroom.expectedStatus,
    )
  );
}

function exactObject(
  value: unknown,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = [],
): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actual = Reflect.ownKeys(descriptors);
  return (
    requiredKeys.every((key) => Object.hasOwn(descriptors, key)) &&
    actual.length >= requiredKeys.length &&
    actual.length <= requiredKeys.length + optionalKeys.length &&
    actual.every(
      (key) =>
        typeof key === 'string' &&
        (requiredKeys.includes(key) || optionalKeys.includes(key)) &&
        descriptors[key]?.enumerable === true &&
        Object.hasOwn(descriptors[key]!, 'value'),
    )
  );
}

function exactArray(value: unknown): readonly unknown[] | undefined {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype)
    return undefined;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const length = Reflect.getOwnPropertyDescriptor(value, 'length')?.value;
  if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0)
    return undefined;
  if (Reflect.ownKeys(descriptors).length !== length + 1) return undefined;
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (
      descriptor === undefined ||
      descriptor.enumerable !== true ||
      !Object.hasOwn(descriptor, 'value')
    )
      return undefined;
  }
  return value;
}

function boundedId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)
  );
}

function boundedSectionCode(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= 64 &&
    value.trim() === value &&
    /^[A-Za-z0-9][A-Za-z0-9._ ()-]{0,63}$/u.test(value) &&
    courseKeyFromSectionCode(value) !== undefined
  );
}

function boundedMinutes(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= 180;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
