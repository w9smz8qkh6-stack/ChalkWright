import type { IsoDate, IsoInstant } from '../../contracts/v1/common.js';
import type {
  CourseMapping,
  CourseworkEnrichment,
} from '../../domain/coursework.js';
import type { ClassId } from '../../domain/identities.js';
import { isIsoDate, isIsoInstant } from '../../domain/runtime-validation.js';
import type { ClassroomEnrichmentCache } from '../../ports/classroom-cache.js';
import type { EnrichmentObservationSource } from '../../ports/read-sources.js';

export type ClassroomRefreshItemResult =
  | { readonly classId: ClassId; readonly status: 'refreshed' }
  | {
      readonly classId: ClassId;
      readonly status: 'skipped';
      readonly code: 'backoff-active' | 'batch-aborted';
    }
  | {
      readonly classId: ClassId;
      readonly status: 'failed';
      readonly code: string;
      readonly retryable: boolean;
    };

export interface ClassroomRefreshBatchResult {
  readonly results: readonly ClassroomRefreshItemResult[];
  readonly attemptedReads: number;
  readonly cacheWrites: number;
  readonly attemptedExternalMutations: 0;
  readonly completedExternalMutations: 0;
}

/**
 * Runs outside the TV request path. Results retain input order while reads use
 * bounded parallelism; one course failure never erases or blocks another.
 */
export async function refreshGoogleClassroom(options: {
  readonly date: IsoDate;
  readonly mappings: readonly CourseMapping[];
  readonly source: EnrichmentObservationSource<CourseworkEnrichment>;
  readonly cache: ClassroomEnrichmentCache;
  readonly refreshedAt: IsoInstant;
  readonly cacheFreshSeconds: number;
  readonly backoffBaseSeconds: number;
  readonly backoffMaximumSeconds: number;
  readonly maximumParallelCourses: number;
  readonly signal?: AbortSignal;
}): Promise<ClassroomRefreshBatchResult> {
  assertRefreshPolicy(options);
  const results: (ClassroomRefreshItemResult | undefined)[] = Array.from({
    length: options.mappings.length,
  });
  let nextIndex = 0;
  let attemptedReads = 0;
  let cacheWrites = 0;
  const worker = async (): Promise<void> => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      const mapping = options.mappings[index];
      if (mapping === undefined) return;
      if (isAborted(options.signal)) {
        results[index] = abortedResult(mapping.classId);
        continue;
      }
      let cached;
      try {
        cached = await options.cache.load(
          mapping.classId,
          options.date,
          options.refreshedAt,
        );
      } catch {
        results[index] = {
          classId: mapping.classId,
          status: 'failed',
          code: 'classroom-cache-read-failed',
          retryable: false,
        };
        continue;
      }
      if (isAborted(options.signal)) {
        results[index] = abortedResult(mapping.classId);
        continue;
      }
      if (
        cached?.nextAttemptAt !== undefined &&
        Date.parse(cached.nextAttemptAt) > Date.parse(options.refreshedAt)
      ) {
        results[index] = {
          classId: mapping.classId,
          status: 'skipped',
          code: 'backoff-active',
        };
        continue;
      }
      attemptedReads += 1;
      let read;
      try {
        read = await options.source.readEnrichment({
          date: options.date,
          classId: mapping.classId,
          ...(options.signal === undefined ? {} : { signal: options.signal }),
        });
      } catch {
        read = undefined;
      }
      if (isAborted(options.signal)) {
        results[index] = abortedResult(mapping.classId);
        continue;
      }
      if (read?.status === 'observed') {
        const enrichment = read.observation.value;
        if (
          read.observation.classId !== mapping.classId ||
          read.observation.observedForDate !== options.date ||
          read.observation.verification !== 'verified' ||
          enrichment.classId !== mapping.classId ||
          enrichment.observedForDate !== options.date ||
          enrichment.freshness !== 'fresh' ||
          !isIsoInstant(enrichment.refreshedAt)
        ) {
          read = undefined;
        } else {
          const expiresAt = new Date(
            Date.parse(enrichment.refreshedAt) +
              options.cacheFreshSeconds * 1_000,
          ).toISOString();
          let stored;
          if (isAborted(options.signal)) {
            results[index] = abortedResult(mapping.classId);
            continue;
          }
          try {
            stored = await options.cache.storeSuccess({
              enrichment,
              expiresAt,
            });
          } catch {
            stored = undefined;
          }
          if (stored === undefined) {
            results[index] = {
              classId: mapping.classId,
              status: 'failed',
              code: 'classroom-cache-write-failed',
              retryable: true,
            };
            continue;
          }
          if (stored.status === 'rejected') {
            results[index] = {
              classId: mapping.classId,
              status: 'failed',
              code: 'classroom-cache-write-failed',
              retryable: true,
            };
          } else {
            cacheWrites += stored.status === 'stored' ? 1 : 0;
            results[index] = { classId: mapping.classId, status: 'refreshed' };
          }
          continue;
        }
      }
      const error = readFailure(read);
      const failureNumber = Math.min(
        32,
        (cached?.consecutiveFailures ?? 0) + 1,
      );
      const backoffSeconds = Math.min(
        options.backoffMaximumSeconds,
        options.backoffBaseSeconds * 2 ** Math.min(20, failureNumber - 1),
      );
      let stored;
      if (isAborted(options.signal)) {
        results[index] = abortedResult(mapping.classId);
        continue;
      }
      try {
        stored = await options.cache.recordFailure({
          classId: mapping.classId,
          observedForDate: options.date,
          attemptedAt: options.refreshedAt,
          nextAttemptAt: new Date(
            Date.parse(options.refreshedAt) + backoffSeconds * 1_000,
          ).toISOString(),
          errorCode: error.code,
        });
      } catch {
        stored = undefined;
      }
      if (stored === undefined) {
        results[index] = {
          classId: mapping.classId,
          status: 'failed',
          code: 'classroom-cache-write-failed',
          retryable: true,
        };
        continue;
      }
      if (stored.status !== 'rejected') cacheWrites += 1;
      results[index] = {
        classId: mapping.classId,
        status: 'failed',
        code:
          stored.status === 'rejected'
            ? 'classroom-cache-write-failed'
            : error.code,
        retryable: error.retryable,
      };
    }
  };
  await Promise.all(
    Array.from(
      {
        length: Math.min(
          options.maximumParallelCourses,
          options.mappings.length,
        ),
      },
      worker,
    ),
  );
  return {
    results: results.map(
      (result, index) =>
        result ?? {
          classId: options.mappings[index]!.classId,
          status: 'skipped' as const,
          code: 'batch-aborted' as const,
        },
    ),
    attemptedReads,
    cacheWrites,
    attemptedExternalMutations: 0,
    completedExternalMutations: 0,
  };
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function abortedResult(classId: ClassId): ClassroomRefreshItemResult {
  return { classId, status: 'skipped', code: 'batch-aborted' };
}

function assertRefreshPolicy(options: {
  readonly date: string;
  readonly mappings: readonly CourseMapping[];
  readonly refreshedAt: string;
  readonly cacheFreshSeconds: number;
  readonly backoffBaseSeconds: number;
  readonly backoffMaximumSeconds: number;
  readonly maximumParallelCourses: number;
}): void {
  if (
    !isIsoDate(options.date) ||
    !isIsoInstant(options.refreshedAt) ||
    !Array.isArray(options.mappings) ||
    options.mappings.length < 1 ||
    options.mappings.length > 12 ||
    new Set(options.mappings.map((mapping) => mapping.classId)).size !==
      options.mappings.length ||
    new Set(options.mappings.map((mapping) => mapping.providerCourseKey))
      .size !== options.mappings.length ||
    !options.mappings.every(
      (mapping) =>
        /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(mapping.classId) &&
        /^\d{1,32}$/u.test(mapping.providerCourseKey),
    ) ||
    !Number.isSafeInteger(options.cacheFreshSeconds) ||
    options.cacheFreshSeconds < 60 ||
    options.cacheFreshSeconds > 86_400 ||
    !Number.isSafeInteger(options.backoffBaseSeconds) ||
    options.backoffBaseSeconds < 10 ||
    !Number.isSafeInteger(options.backoffMaximumSeconds) ||
    options.backoffMaximumSeconds < options.backoffBaseSeconds ||
    options.backoffMaximumSeconds > 86_400 ||
    !Number.isSafeInteger(options.maximumParallelCourses) ||
    options.maximumParallelCourses < 1 ||
    options.maximumParallelCourses > 4
  )
    throw new Error('classroom-refresh-policy-invalid');
}

function readFailure(
  result:
    | Awaited<
        ReturnType<
          EnrichmentObservationSource<CourseworkEnrichment>['readEnrichment']
        >
      >
    | undefined,
): { readonly code: string; readonly retryable: boolean } {
  if (result === undefined)
    return { code: 'classroom-read-unavailable', retryable: true };
  if (result.status === 'not-found')
    return {
      code: safeFailureCode(
        result.diagnostics[0]?.code ?? 'classroom-course-not-found',
      ),
      retryable: false,
    };
  if (result.status === 'observed')
    return { code: 'classroom-read-unavailable', retryable: true };
  return {
    code: safeFailureCode(result.error.code),
    retryable: result.error.retryable,
  };
}

const safeFailureCodes = new Set([
  'classroom-authentication-required',
  'classroom-authorization-denied',
  'classroom-course-not-found',
  'classroom-rate-limited',
  'classroom-request-timeout',
  'classroom-read-unavailable',
  'classroom-read-request-invalid',
  'classroom-course-mapping-invalid',
  'classroom-read-policy-invalid',
  'classroom-item-budget-exceeded',
  'classroom-pagination-invalid',
  'classroom-page-budget-exceeded',
  'classroom-clock-invalid',
]);

function safeFailureCode(value: string): string {
  return safeFailureCodes.has(value) ? value : 'classroom-read-unavailable';
}
