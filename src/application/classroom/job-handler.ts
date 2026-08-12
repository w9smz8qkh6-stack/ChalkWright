import { contractVersion, type IsoDate } from '../../contracts/v1/common.js';
import type {
  CourseworkEnrichment,
  CourseMapping,
} from '../../domain/coursework.js';
import type { ActionableErrorCategory } from '../../domain/errors.js';
import type { TypedJobResult } from '../../domain/job-results.js';
import { isIsoDate } from '../../domain/runtime-validation.js';
import type { ClassroomEnrichmentCache } from '../../ports/classroom-cache.js';
import type { EnrichmentObservationSource } from '../../ports/read-sources.js';
import type {
  OperationsJobHandler,
  OperationsJobRequest,
} from '../operations/registry.js';
import { refreshGoogleClassroom } from './refresh.js';

export interface ClassroomRefreshJobOptions {
  readonly mappings: readonly CourseMapping[];
  readonly source: EnrichmentObservationSource<CourseworkEnrichment>;
  readonly cache: ClassroomEnrichmentCache;
  readonly timeZone: string;
  readonly cacheFreshSeconds: number;
  readonly backoffBaseSeconds: number;
  readonly backoffMaximumSeconds: number;
  readonly maximumParallelCourses: number;
}

/** Typed M-08 job wrapper; operational registration remains a separate gate. */
export function createClassroomRefreshJobHandler(
  options: ClassroomRefreshJobOptions,
): OperationsJobHandler {
  return async (request, signal) => {
    if (request.jobName !== 'classroom-refresh')
      return failed(request, 'classroom-refresh-job-invalid', false);
    if (signal.aborted)
      return failed(request, 'classroom-refresh-aborted', true);
    const date = localDate(request.requestedAt, options.timeZone);
    if (!isIsoDate(date))
      return failed(request, 'classroom-refresh-date-invalid', false);
    try {
      const batch = await refreshGoogleClassroom({
        date: date as IsoDate,
        mappings: options.mappings,
        source: options.source,
        cache: options.cache,
        refreshedAt: request.requestedAt,
        cacheFreshSeconds: options.cacheFreshSeconds,
        backoffBaseSeconds: options.backoffBaseSeconds,
        backoffMaximumSeconds: options.backoffMaximumSeconds,
        maximumParallelCourses: options.maximumParallelCourses,
        signal,
      });
      if (signal.aborted)
        return failed(request, 'classroom-refresh-aborted', true);
      const refreshed = batch.results.filter(
        (result) => result.status === 'refreshed',
      ).length;
      const failedResults = batch.results.filter(
        (result) => result.status === 'failed',
      );
      const skipped = batch.results.length - refreshed - failedResults.length;
      if (failedResults.length === 0 && refreshed > 0)
        return succeeded(request, refreshed, skipped);
      if (failedResults.length === 0)
        return skippedResult(request, 'classroom-refresh-backoff-active');

      const errors = uniqueErrors(failedResults.map((result) => result.code));
      if (
        refreshed === 0 &&
        errors.some(
          (error) => error.code === 'classroom-authentication-required',
        )
      )
        return repairRequired(request);
      if (refreshed > 0)
        return {
          ...base(request),
          category: 'degraded',
          attemptedExternalMutations: 0,
          completedExternalMutations: 0,
          errors,
        };
      return failed(
        request,
        errors[0]?.code ?? 'classroom-read-unavailable',
        errors.some((error) => error.retryable),
      );
    } catch {
      return failed(request, 'classroom-refresh-failed', true);
    }
  };
}

function base(request: OperationsJobRequest) {
  return {
    contractVersion,
    runId: request.runId,
    jobName: request.jobName,
    startedAt: request.requestedAt,
    finishedAt: request.requestedAt,
    diagnostics: [],
  } as const;
}

function succeeded(
  request: OperationsJobRequest,
  refreshed: number,
  skipped: number,
): TypedJobResult {
  return {
    ...base(request),
    diagnostics: [
      {
        code: 'classroom-refresh-completed',
        severity: 'info',
        message: `${refreshed} course cache(s) refreshed; ${skipped} skipped.`,
      },
    ],
    category: 'succeeded',
    attemptedExternalMutations: 0,
    completedExternalMutations: 0,
    errors: [],
  };
}

function skippedResult(
  request: OperationsJobRequest,
  code: string,
): TypedJobResult {
  return {
    ...base(request),
    category: 'skipped',
    attemptedExternalMutations: 0,
    completedExternalMutations: 0,
    reason: 'not-required',
    errors: [error(code, false)],
  };
}

function repairRequired(request: OperationsJobRequest): TypedJobResult {
  return {
    ...base(request),
    category: 'repair-required',
    attemptedExternalMutations: 0,
    completedExternalMutations: 0,
    error: {
      ...error('classroom-authentication-required', false),
      category: 'authentication-repair-required',
    },
  };
}

function failed(
  request: OperationsJobRequest,
  code: string,
  retryable: boolean,
): TypedJobResult {
  return {
    ...base(request),
    category: 'failed',
    attemptedExternalMutations: 0,
    completedExternalMutations: 0,
    error: error(sanitizedCode(code), retryable),
  };
}

function uniqueErrors(codes: readonly string[]) {
  return [...new Set(codes.map(sanitizedCode))].map((code) =>
    error(code, retryableCode(code)),
  );
}

function error(
  code: string,
  retryable: boolean,
  category: ActionableErrorCategory = categoryFor(code),
) {
  return {
    category,
    code,
    message: 'Google Classroom refresh completed with a sanitized issue.',
    retryable,
    diagnostics: [],
  } as const;
}

const safeCodes = new Set([
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
  'classroom-cache-read-failed',
  'classroom-cache-write-failed',
  'classroom-refresh-aborted',
]);

function sanitizedCode(value: string): string {
  return safeCodes.has(value) ? value : 'classroom-read-unavailable';
}

function categoryFor(code: string): ActionableErrorCategory {
  if (code === 'classroom-authorization-denied') return 'authorization-denied';
  if (code === 'classroom-course-not-found') return 'not-found';
  if (code === 'classroom-request-timeout') return 'timeout';
  if (
    code === 'classroom-read-request-invalid' ||
    code === 'classroom-course-mapping-invalid'
  )
    return 'invalid-input';
  if (code === 'classroom-read-policy-invalid') return 'unsafe-configuration';
  return 'unavailable';
}

function retryableCode(code: string): boolean {
  return (
    code === 'classroom-rate-limited' ||
    code === 'classroom-request-timeout' ||
    code === 'classroom-read-unavailable' ||
    code === 'classroom-cache-write-failed' ||
    code === 'classroom-refresh-aborted'
  );
}

function localDate(instant: string, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(instant));
    const value = (type: Intl.DateTimeFormatPartTypes): string =>
      parts.find((part) => part.type === type)?.value ?? '';
    return `${value('year')}-${value('month')}-${value('day')}`;
  } catch {
    return '';
  }
}
