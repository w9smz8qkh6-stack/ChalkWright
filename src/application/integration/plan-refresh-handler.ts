import { contractVersion, type IsoDate } from '../../contracts/v1/common.js';
import type { TypedJobResult } from '../../domain/job-results.js';
import type { RoomId, ScreenId } from '../../domain/identities.js';
import { projectEffectivePlan } from '../../domain/plan-derivation.js';
import type { CoursePlanMapping } from '../../domain/plan-derivation.js';
import type { PlanSnapshotWriter } from '../../ports/persistence-write.js';
import type { ScheduleObservationSource } from '../../ports/read-sources.js';
import { acquireCanonicalPlan } from '../read-only/acquire-canonical-plan.js';
import type {
  OperationsJobHandler,
  OperationsJobRequest,
} from '../operations/registry.js';

export interface PlanRefreshRuntimeConfig {
  readonly roomId: RoomId;
  readonly screenId: ScreenId;
  readonly timeZone: string;
  readonly courseMappings: readonly CoursePlanMapping[];
  readonly checkInOpenMinutesBefore: number;
  readonly dismissalWarningMinutesBefore: number;
}

/** Provider-neutral plan refresh shared by shadow and production compositions. */
export function createPlanRefreshJobHandler(options: {
  readonly config: PlanRefreshRuntimeConfig;
  readonly sourceForRun: (signal: AbortSignal) => ScheduleObservationSource;
  readonly plans: PlanSnapshotWriter;
  readonly evidencePrefix: 'shadow' | 'production';
}): OperationsJobHandler {
  return async (request, signal) => {
    const prefix = options.evidencePrefix;
    if (request.jobName !== 'source-auth-preflight')
      return failed(request, `${prefix}-job-invalid`, false);
    if (signal.aborted)
      return failed(request, `${prefix}-source-aborted`, true);
    const date = localDate(request.requestedAt, options.config.timeZone);
    const acquired = await acquireCanonicalPlan(options.sourceForRun(signal), {
      date,
      roomId: options.config.roomId,
      mappings: options.config.courseMappings,
      timing: {
        timeZone: options.config.timeZone,
        checkInOpenMinutesBefore: options.config.checkInOpenMinutesBefore,
        dismissalWarningMinutesBefore:
          options.config.dismissalWarningMinutesBefore,
      },
    });
    if (signal.aborted)
      return failed(request, `${prefix}-source-aborted`, true);
    if (acquired.status === 'not-found')
      return failed(request, `${prefix}-plan-not-found`, false);
    if (acquired.status !== 'planned') {
      if (acquired.status === 'repair-required')
        return repairRequired(request, prefix, acquired.error.code);
      return failed(
        request,
        `${prefix}-source-unavailable`,
        acquired.error.retryable,
      );
    }
    const effective = projectEffectivePlan(acquired.plan, {
      contractVersion,
      screenId: options.config.screenId,
      roomId: options.config.roomId,
      routeKey: options.config.screenId,
    });
    if (effective === undefined)
      return failed(request, `${prefix}-plan-scope-invalid`, false);
    const canonical = await options.plans.storeCanonical(acquired.plan);
    if (signal.aborted)
      return failed(request, `${prefix}-source-aborted`, true);
    if (canonical.status === 'rejected')
      return failed(request, `${prefix}-plan-store-failed`, true);
    const projected = await options.plans.storeEffective(effective);
    if (projected.status === 'rejected')
      return failed(request, `${prefix}-plan-store-failed`, true);
    return {
      ...base(request),
      diagnostics: [
        {
          code: `${prefix}-plan-refreshed`,
          severity: 'info',
          message: `${effective.meetings.length} meeting(s) stored in the isolated ${prefix} database.`,
        },
      ],
      category: 'succeeded',
      attemptedExternalMutations: 0,
      completedExternalMutations: 0,
      errors: [],
    };
  };
}

function localDate(instant: string, timeZone: string): IsoDate {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(instant));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}` as IsoDate;
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
      category: 'unavailable',
      code,
      message: 'The isolated source plan refresh failed safely.',
      retryable,
      diagnostics: [],
    },
  };
}

const sourceRepairCodes = new Set([
  'bell-marker-missing',
  'bell-session-forbidden',
  'bell-session-redirect-authentication',
  'bell-session-redirect-cross-origin',
  'bell-session-redirect-invalid',
  'bell-session-redirect-same-origin',
  'bell-session-redirect-teacher',
  'bell-session-redirected',
  'bell-session-state-rejected',
  'bell-session-unauthorized',
  'session-state-missing',
  'session-state-rejected',
  'status-session-forbidden',
  'status-session-redirect-authentication',
  'status-session-redirect-cross-origin',
  'status-session-redirect-invalid',
  'status-session-redirect-same-origin',
  'status-session-redirect-teacher',
  'status-session-redirected',
  'status-session-state-rejected',
  'status-session-unauthorized',
  'status-marker-missing',
]);

function repairRequired(
  request: OperationsJobRequest,
  prefix: 'shadow' | 'production',
  sourceCode: string,
): TypedJobResult {
  const code = sourceRepairCodes.has(sourceCode)
    ? `${prefix}-powerschool-${sourceCode}`
    : `${prefix}-powerschool-repair-required`;
  return {
    ...base(request),
    category: 'repair-required',
    attemptedExternalMutations: 0,
    completedExternalMutations: 0,
    error: {
      category: 'authentication-repair-required',
      code,
      message:
        'PowerSchool requires the separate operator-present repair workflow.',
      retryable: false,
      diagnostics: [],
    },
  };
}
