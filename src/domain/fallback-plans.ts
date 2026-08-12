import type { ContractDiagnostic, IsoDate } from '../contracts/v1/common.js';
import type { RoomId } from './identities.js';
import type { CanonicalPlan } from './plans.js';
import { diagnostic } from './pure-values.js';

export interface FallbackPlanPolicy {
  readonly allowCalendarFallback: boolean;
  readonly allowLatestLocalFallback: boolean;
}

export interface FallbackPlanCandidate {
  readonly source: 'calendar' | 'latest-local';
  readonly plan: CanonicalPlan;
}

export interface PlanSourceDecision {
  readonly plan?: CanonicalPlan;
  readonly source: 'primary' | 'calendar' | 'latest-local' | 'none';
  readonly diagnostics: readonly ContractDiagnostic[];
}

function explicitlyUnverified(candidate: FallbackPlanCandidate): CanonicalPlan {
  return {
    ...candidate.plan,
    verification: 'unverified',
    diagnostics: [
      ...candidate.plan.diagnostics,
      diagnostic(
        'fallback-plan-unverified',
        'warning',
        `The ${candidate.source} fallback is transitional and is not verified schedule data.`,
      ),
    ],
  };
}

/** Fallbacks are disabled by policy unless explicitly enabled for transition. */
export function selectPlanSource(options: {
  readonly requestedDate: IsoDate;
  readonly roomId: RoomId;
  readonly primary?: CanonicalPlan;
  readonly calendar?: FallbackPlanCandidate;
  readonly latestLocal?: FallbackPlanCandidate;
  readonly policy: FallbackPlanPolicy;
}): PlanSourceDecision {
  if (
    options.primary !== undefined &&
    options.primary.verification === 'verified' &&
    options.primary.date === options.requestedDate &&
    options.primary.roomId === options.roomId
  ) {
    return { source: 'primary', plan: options.primary, diagnostics: [] };
  }
  if (
    options.policy.allowCalendarFallback &&
    options.calendar?.source === 'calendar' &&
    options.calendar.plan.date === options.requestedDate &&
    options.calendar.plan.roomId === options.roomId
  ) {
    const plan = explicitlyUnverified(options.calendar);
    return { source: 'calendar', plan, diagnostics: plan.diagnostics };
  }
  if (
    options.policy.allowLatestLocalFallback &&
    options.latestLocal?.source === 'latest-local' &&
    options.latestLocal.plan.date === options.requestedDate &&
    options.latestLocal.plan.roomId === options.roomId
  ) {
    const plan = explicitlyUnverified(options.latestLocal);
    return { source: 'latest-local', plan, diagnostics: plan.diagnostics };
  }
  return {
    source: 'none',
    diagnostics: [
      diagnostic(
        'fallback-plan-disabled-or-unavailable',
        'warning',
        'No verified primary plan is available and fallback policy did not select a plan.',
      ),
    ],
  };
}
