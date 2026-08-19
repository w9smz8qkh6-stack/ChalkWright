import { contractVersion } from '../contracts/v1/common.js';
import type {
  ContractDiagnostic,
  IanaTimeZone,
  OpaqueId,
} from '../contracts/v1/common.js';
import type { ScreenAssignment } from '../contracts/v1/day-plan.js';
import type {
  ScheduleObservation,
  SchedulePeriodObservation,
} from '../contracts/v1/schedule.js';
import {
  sectionCodeContainsCourseKey,
  type ClassId,
  type RoomId,
  type ScreenId,
} from './identities.js';
import type { CanonicalPlan, EffectiveDayPlan } from './plans.js';
import { addMinutes, diagnostic, epoch, stableId } from './pure-values.js';

export interface CoursePlanMapping {
  readonly classId: ClassId;
  /** Classroom section text containing the exact PowerSchool code token. */
  readonly sectionCode: string;
  readonly roomId: RoomId;
  readonly periodId?: OpaqueId;
}

export interface PlanTimingPolicy {
  readonly timeZone: IanaTimeZone;
  readonly checkInOpenMinutesBefore: number;
  readonly dismissalWarningMinutesBefore: number;
}

export type PlanDerivationResult =
  | {
      readonly status: 'planned';
      readonly plan: CanonicalPlan;
      readonly diagnostics: readonly ContractDiagnostic[];
    }
  | {
      readonly status: 'rejected';
      readonly diagnostics: readonly ContractDiagnostic[];
    };

type PeriodMappingResolution =
  | { readonly status: 'matched'; readonly mapping: CoursePlanMapping }
  | { readonly status: 'missing' | 'ambiguous' };

function mappingForPeriod(
  period: SchedulePeriodObservation,
  mappings: readonly CoursePlanMapping[],
  roomId: RoomId,
): PeriodMappingResolution {
  const candidates = mappings.filter(
    (mapping) =>
      mapping.roomId === roomId &&
      sectionCodeContainsCourseKey(mapping.sectionCode, period.courseKey) &&
      (mapping.periodId === undefined || mapping.periodId === period.periodId),
  );
  if (candidates.length === 1)
    return { status: 'matched', mapping: candidates[0]! };
  return { status: candidates.length === 0 ? 'missing' : 'ambiguous' };
}

function meetingFromPeriod(
  period: SchedulePeriodObservation,
  mapping: CoursePlanMapping,
  observation: ScheduleObservation,
  policy: PlanTimingPolicy,
) {
  const start = epoch(period.startsAt);
  const end = epoch(period.endsAt);
  if (start === undefined || end === undefined || start >= end)
    return undefined;
  const checkInOpensAt = addMinutes(
    period.startsAt,
    -policy.checkInOpenMinutesBefore,
  );
  const nominalDismissalStartsAt = addMinutes(
    period.endsAt,
    -policy.dismissalWarningMinutesBefore,
  );
  const nominalDismissalStart = epoch(nominalDismissalStartsAt);
  const dismissalStartsAt =
    nominalDismissalStart !== undefined && nominalDismissalStart > start
      ? nominalDismissalStartsAt
      : adjustedDismissalStartsAt(start, end);
  if (
    checkInOpensAt === undefined ||
    dismissalStartsAt === undefined ||
    (epoch(dismissalStartsAt) ?? end) <= start
  ) {
    return undefined;
  }
  return {
    meeting: {
      meetingId: stableId(
        'meeting',
        observation.observedForDate,
        mapping.roomId,
        period.periodId,
      ),
      courseKey: period.courseKey,
      blockLabel: period.blockLabel,
      checkInOpensAt,
      officialStartsAt: period.startsAt,
      checkInClosesAt: period.startsAt,
      contentStartsAt: period.startsAt,
      dismissalStartsAt,
      officialEndsAt: period.endsAt,
    },
    dismissalWindowAdjusted:
      nominalDismissalStart === undefined || nominalDismissalStart <= start,
  } as const;
}

function adjustedDismissalStartsAt(
  start: number,
  end: number,
): string | undefined {
  if (end - start < 2) return undefined;
  return new Date(start + Math.floor((end - start) / 2)).toISOString();
}

/** Derive one room-scoped canonical plan without silently reassigning periods. */
export function deriveCanonicalPlan(
  observation: ScheduleObservation,
  roomId: RoomId,
  mappings: readonly CoursePlanMapping[],
  policy: PlanTimingPolicy,
): PlanDerivationResult {
  const diagnostics: ContractDiagnostic[] = [...observation.diagnostics];
  if (
    observation.freshness.state !== 'fresh' ||
    observation.verification !== 'verified'
  ) {
    diagnostics.push(
      diagnostic(
        'schedule-not-authoritative',
        'error',
        'Only a fresh, verified schedule observation may produce an authoritative canonical plan.',
      ),
    );
    return { status: 'rejected', diagnostics };
  }

  if (
    (observation.kind === 'no-classes' && observation.periods.length !== 0) ||
    (observation.kind !== 'no-classes' && observation.periods.length === 0)
  ) {
    diagnostics.push(
      diagnostic(
        'schedule-kind-periods-mismatch',
        'error',
        'The schedule kind contradicts whether class periods are present.',
      ),
    );
    return { status: 'rejected', diagnostics };
  }

  const meetings = observation.periods.flatMap((period) => {
    if (period.roomKey !== undefined && period.roomKey !== roomId) {
      diagnostics.push(
        diagnostic(
          'schedule-room-mismatch',
          'error',
          'A schedule period belongs to a different canonical room.',
        ),
      );
      return [];
    }
    const resolution = mappingForPeriod(period, mappings, roomId);
    if (resolution.status !== 'matched') {
      diagnostics.push(
        diagnostic(
          resolution.status === 'ambiguous'
            ? 'course-mapping-ambiguous'
            : 'course-mapping-missing',
          'error',
          resolution.status === 'ambiguous'
            ? 'More than one Classroom section contains the same PowerSchool code token.'
            : 'No Classroom section contains the exact PowerSchool code token for a schedule period.',
        ),
      );
      return [];
    }
    const mapping = resolution.mapping;
    const result = meetingFromPeriod(period, mapping, observation, policy);
    if (result === undefined) {
      diagnostics.push(
        diagnostic(
          'period-interval-invalid',
          'error',
          `Period ${period.periodId} has an invalid or unordered interval.`,
        ),
      );
      return [];
    }
    if (result.dismissalWindowAdjusted)
      diagnostics.push(
        diagnostic(
          'period-dismissal-window-adjusted',
          'warning',
          'A PowerSchool period was preserved exactly while its display dismissal-warning threshold was adjusted to fit inside the official interval.',
        ),
      );
    return [result.meeting];
  });

  meetings.sort(
    (left, right) =>
      (epoch(left.officialStartsAt) ?? 0) -
        (epoch(right.officialStartsAt) ?? 0) ||
      left.meetingId.localeCompare(right.meetingId),
  );

  if (observation.kind !== 'no-classes' && meetings.length === 0) {
    diagnostics.push(
      diagnostic(
        'plan-has-no-valid-meetings',
        'error',
        'No valid mapped meetings remain for the requested room.',
      ),
    );
    return { status: 'rejected', diagnostics };
  }

  const plan: CanonicalPlan = {
    contractVersion,
    planId: stableId('plan', observation.observedForDate, roomId),
    date: observation.observedForDate,
    timeZone: policy.timeZone,
    roomId,
    sourceObservationIds: [observation.observationId],
    verification: 'verified',
    meetings,
    diagnostics,
  };
  return { status: 'planned', plan, diagnostics };
}

/** Project a canonical plan only when the screen assignment owns its room. */
export function projectEffectivePlan(
  plan: CanonicalPlan,
  assignment: ScreenAssignment,
): EffectiveDayPlan | undefined {
  if (assignment.roomId !== plan.roomId) return undefined;
  return {
    contractVersion,
    effectivePlanId: stableId('effective', plan.planId, assignment.screenId),
    canonicalPlanId: plan.planId,
    date: plan.date,
    timeZone: plan.timeZone,
    roomId: plan.roomId,
    screenId: assignment.screenId as ScreenId,
    verification: plan.verification,
    meetings: plan.meetings,
    diagnostics: plan.diagnostics,
  };
}
