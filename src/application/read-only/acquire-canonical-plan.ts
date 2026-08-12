import type { ContractDiagnostic } from '../../contracts/v1/common.js';
import type { ActionableError } from '../../domain/errors.js';
import type {
  CoursePlanMapping,
  PlanTimingPolicy,
} from '../../domain/plan-derivation.js';
import { deriveCanonicalPlan } from '../../domain/plan-derivation.js';
import type { RoomId } from '../../domain/identities.js';
import type { CanonicalPlan } from '../../domain/plans.js';
import { isScheduleObservation } from '../../domain/runtime-validation.js';
import type {
  ScheduleObservationRequest,
  ScheduleObservationSource,
} from '../../ports/read-sources.js';

export interface AcquireCanonicalPlanRequest extends ScheduleObservationRequest {
  readonly mappings: readonly CoursePlanMapping[];
  readonly timing: PlanTimingPolicy;
}

export type AcquireCanonicalPlanResult =
  | {
      readonly status: 'planned';
      readonly plan: CanonicalPlan;
      readonly diagnostics: readonly ContractDiagnostic[];
    }
  | {
      readonly status: 'not-found';
      readonly diagnostics: readonly ContractDiagnostic[];
    }
  | {
      readonly status: 'repair-required' | 'failed';
      readonly error: ActionableError;
    };

/**
 * Acquisition composes a read source with pure plan derivation. It accepts no
 * persistence, Calendar, command, or provider-repair capability.
 */
export async function acquireCanonicalPlan(
  source: ScheduleObservationSource,
  request: AcquireCanonicalPlanRequest,
): Promise<AcquireCanonicalPlanResult> {
  const observed = await source.readSchedule({
    date: request.date,
    roomId: request.roomId,
  });
  if (observed.status === 'not-found') return observed;
  if (observed.status === 'repair-required' || observed.status === 'failed') {
    return observed;
  }
  if (!isScheduleObservation(observed.observation)) {
    return {
      status: 'not-found',
      diagnostics: [
        {
          code: 'schedule-observation-invalid',
          severity: 'error',
          message: 'The source returned an invalid schedule observation.',
        },
      ],
    };
  }
  if (observed.observation.observedForDate !== request.date) {
    return {
      status: 'not-found',
      diagnostics: [
        {
          code: 'schedule-observation-date-mismatch',
          severity: 'error',
          message: 'The source observation does not match the requested date.',
        },
      ],
    };
  }
  if (
    observed.observation.verification !==
    observed.observation.provenance.verification
  ) {
    return {
      status: 'not-found',
      diagnostics: [
        {
          code: 'schedule-observation-verification-mismatch',
          severity: 'error',
          message:
            'The source observation has contradictory verification metadata.',
        },
      ],
    };
  }

  const derived = deriveCanonicalPlan(
    observed.observation,
    request.roomId as RoomId,
    request.mappings,
    request.timing,
  );
  if (derived.status === 'rejected') {
    return { status: 'not-found', diagnostics: derived.diagnostics };
  }
  return {
    status: 'planned',
    plan: derived.plan,
    diagnostics: derived.diagnostics,
  };
}
