import { contractVersion, type IsoDate } from '../../contracts/v1/common.js';
import {
  displayStates,
  type DisplayState,
} from '../../contracts/v1/display.js';
import type { TypedJobResult } from '../../domain/job-results.js';
import type { CourseMapping } from '../../domain/coursework.js';
import type { ClassId } from '../../domain/identities.js';
import {
  hasExactKeys,
  isIsoDate,
  isNonEmptyString,
  isPlainObject,
} from '../../domain/runtime-validation.js';
import type { DisplayTargetResult } from '../display/contracts.js';
import type {
  OperationsJobHandler,
  OperationsJobRequest,
} from '../operations/registry.js';
import {
  createClassroomRefreshJobHandler,
  type ClassroomRefreshJobOptions,
} from './job-handler.js';

const eligibleStates = new Set<DisplayState>([
  'pre_checkin',
  'in_class_content',
]);

export interface ClassroomRefreshTriggerTarget {
  readonly state: DisplayState;
  readonly date: IsoDate;
  readonly meetingId?: string;
  readonly classId?: ClassId;
}

export interface ActiveClassroomRefreshJobOptions extends Omit<
  ClassroomRefreshJobOptions,
  'source'
> {
  readonly evaluationIntervalSeconds: 30;
  /** Reads only local plan/display state; it must not contact a provider. */
  readonly targetForRun: (
    request: OperationsJobRequest,
    signal: AbortSignal,
  ) => Promise<unknown> | unknown;
  /** Constructed only after an exact active-class target passes validation. */
  readonly sourceForRun: (
    signal: AbortSignal,
  ) => ClassroomRefreshJobOptions['source'];
}

/**
 * Production trigger boundary for the legacy active-class policy. It selects
 * exactly one mapped class during pre-check-in/content, then delegates to the
 * existing bounded refresh job. It remains unwired until M-16 target approval.
 */
export function createActiveClassroomRefreshJobHandler(
  options: ActiveClassroomRefreshJobOptions,
): OperationsJobHandler {
  return async (request, signal) => {
    if (request.jobName !== 'classroom-refresh')
      return failed(request, 'classroom-active-trigger-invalid', false);
    if (!validPolicy(options))
      return failed(request, 'classroom-active-policy-invalid', false);
    if (signal.aborted)
      return failed(request, 'classroom-refresh-aborted', true);

    let untrustedTarget: unknown;
    try {
      untrustedTarget = await options.targetForRun(request, signal);
    } catch {
      return failed(request, 'classroom-active-target-unavailable', true);
    }
    if (signal.aborted)
      return failed(request, 'classroom-refresh-aborted', true);
    if (!isClassroomRefreshTriggerTarget(untrustedTarget))
      return failed(request, 'classroom-active-target-invalid', false);
    if (!eligibleStates.has(untrustedTarget.state))
      return skipped(request, 'classroom-refresh-no-active-class');
    if (
      untrustedTarget.meetingId === undefined ||
      untrustedTarget.classId === undefined
    )
      return failed(request, 'classroom-active-target-invalid', false);

    const requestDate = localDate(request.requestedAt, options.timeZone);
    if (untrustedTarget.date !== requestDate)
      return failed(request, 'classroom-active-target-date-mismatch', false);
    const mapping = options.mappings.find(
      (candidate) => candidate.classId === untrustedTarget.classId,
    );
    if (mapping === undefined)
      return failed(request, 'classroom-active-mapping-unavailable', false);

    let source: ClassroomRefreshJobOptions['source'];
    try {
      source = options.sourceForRun(signal);
    } catch {
      return failed(request, 'classroom-source-unavailable', true);
    }
    if (signal.aborted)
      return failed(request, 'classroom-refresh-aborted', true);
    return createClassroomRefreshJobHandler({
      ...options,
      mappings: [mapping],
      source,
    })(request, signal);
  };
}

/** Projects only local display state into the finite trigger contract. */
export function projectClassroomRefreshTriggerTarget(
  result: DisplayTargetResult,
): ClassroomRefreshTriggerTarget | undefined {
  if (result.plan === undefined || result.state === undefined) return undefined;
  const state = result.state.state;
  const base = { state, date: result.plan.date };
  if (!eligibleStates.has(state)) return base;
  if (
    result.meetingId === undefined ||
    result.classId === undefined ||
    !isNonEmptyString(result.meetingId) ||
    !isNonEmptyString(result.classId) ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(result.meetingId) ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(result.classId)
  )
    return undefined;
  return {
    ...base,
    meetingId: result.meetingId,
    classId: result.classId as ClassId,
  };
}

function validPolicy(options: {
  readonly mappings: readonly CourseMapping[];
  readonly cacheFreshSeconds: number;
  readonly backoffBaseSeconds: number;
  readonly backoffMaximumSeconds: number;
  readonly maximumParallelCourses: number;
  readonly evaluationIntervalSeconds: number;
}): boolean {
  try {
    return (
      Array.isArray(options.mappings) &&
      options.mappings.length >= 1 &&
      options.mappings.length <= 12 &&
      options.mappings.every(
        (mapping) =>
          /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(mapping.classId) &&
          /^\d{1,32}$/u.test(mapping.providerCourseKey),
      ) &&
      new Set(options.mappings.map((mapping) => mapping.classId)).size ===
        options.mappings.length &&
      new Set(options.mappings.map((mapping) => mapping.providerCourseKey))
        .size === options.mappings.length &&
      Number.isSafeInteger(options.cacheFreshSeconds) &&
      options.cacheFreshSeconds >= 60 &&
      options.cacheFreshSeconds <= 86_400 &&
      Number.isSafeInteger(options.backoffBaseSeconds) &&
      options.backoffBaseSeconds === 60 &&
      Number.isSafeInteger(options.backoffMaximumSeconds) &&
      options.backoffMaximumSeconds === 900 &&
      options.evaluationIntervalSeconds === 30 &&
      Number.isSafeInteger(options.maximumParallelCourses) &&
      options.maximumParallelCourses >= 1 &&
      options.maximumParallelCourses <= 4
    );
  } catch {
    return false;
  }
}

export function isClassroomRefreshTriggerTarget(
  value: unknown,
): value is ClassroomRefreshTriggerTarget {
  try {
    if (!isPlainObject(value)) return false;
    const keys = Object.keys(value).sort();
    const base = hasExactKeys(value, ['state', 'date']);
    const active = hasExactKeys(value, [
      'state',
      'date',
      'meetingId',
      'classId',
    ]);
    if (!base && !active) return false;
    if (
      typeof value.state !== 'string' ||
      !displayStates.includes(value.state as DisplayState) ||
      !isIsoDate(value.date)
    )
      return false;
    if (active)
      return (
        eligibleStates.has(value.state as DisplayState) &&
        keys.join(',') === 'classId,date,meetingId,state' &&
        isNonEmptyString(value.meetingId) &&
        /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value.meetingId) &&
        isNonEmptyString(value.classId) &&
        /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value.classId)
      );
    return (
      keys.join(',') === 'date,state' &&
      !eligibleStates.has(value.state as DisplayState)
    );
  } catch {
    return false;
  }
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
    error: {
      category: retryable ? 'unavailable' : 'unsafe-configuration',
      code,
      message: 'The active-class refresh trigger failed safely.',
      retryable,
      diagnostics: [],
    },
  };
}

function skipped(request: OperationsJobRequest, code: string): TypedJobResult {
  return {
    ...base(request),
    category: 'skipped',
    attemptedExternalMutations: 0,
    completedExternalMutations: 0,
    reason: 'not-required',
    errors: [
      {
        category: 'unavailable',
        code,
        message: 'No active class requires Classroom refresh.',
        retryable: false,
        diagnostics: [],
      },
    ],
  };
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
