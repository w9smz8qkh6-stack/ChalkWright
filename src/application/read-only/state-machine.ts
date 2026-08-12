import { contractVersion } from '../../contracts/v1/common.js';
import type { IsoDate, IsoInstant } from '../../contracts/v1/common.js';
import type { DisplayStateCase } from '../../contracts/v1/display.js';
import type { DayPlanMeeting } from '../../contracts/v1/day-plan.js';
import type { EffectiveDayPlan } from '../../domain/plans.js';
import { addDateDays, epoch, stableId } from '../../domain/pure-values.js';

export interface StateSelectionPolicy {
  readonly showCheckIn: boolean;
  readonly morningOverviewUntil?: string;
}

function localClockMinutes(instant: IsoInstant, timeZone: string): number {
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', {
        timeZone,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      })
        .formatToParts(new Date(instant))
        .map((part) => [part.type, part.value]),
    );
    return Number(parts.hour) * 60 + Number(parts.minute);
  } catch {
    return -1;
  }
}

function cutoffMinutes(value: string | undefined): number {
  const match = String(value ?? '07:30').match(/^(\d{1,2}):(\d{2})$/);
  if (match === null) return -1;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour <= 23 && minute <= 59 ? hour * 60 + minute : -1;
}

function stateCase(
  plan: EffectiveDayPlan,
  evaluatedAt: IsoInstant,
  state: DisplayStateCase['state'],
  current?: DayPlanMeeting,
  next?: DayPlanMeeting,
): DisplayStateCase {
  return {
    contractVersion,
    caseId: stableId('state', plan.effectivePlanId, evaluatedAt, state),
    screenId: plan.screenId,
    planId: plan.effectivePlanId,
    evaluatedAt,
    state,
    ...(current === undefined ? {} : { currentMeetingId: current.meetingId }),
    ...(next === undefined ? {} : { nextMeetingId: next.meetingId }),
  };
}

/** Select the frozen display state with exact boundary precedence. */
export function selectDisplayState(
  plan: EffectiveDayPlan,
  evaluatedAt: IsoInstant,
  policy: StateSelectionPolicy,
): DisplayStateCase {
  const now = epoch(evaluatedAt);
  if (now === undefined || plan.meetings.length === 0) {
    return stateCase(plan, evaluatedAt, 'no_classes');
  }
  const first = plan.meetings[0];
  if (first === undefined) return stateCase(plan, evaluatedAt, 'no_classes');
  const firstOpen = epoch(first.checkInOpensAt) ?? Number.POSITIVE_INFINITY;
  const cutoff = cutoffMinutes(policy.morningOverviewUntil);
  const localMinutes = localClockMinutes(evaluatedAt, plan.timeZone);
  if (
    now < firstOpen &&
    cutoff > 0 &&
    localMinutes >= 0 &&
    localMinutes < cutoff
  ) {
    return stateCase(plan, evaluatedAt, 'morning_overview', undefined, first);
  }

  let previous: DayPlanMeeting | undefined;
  for (const [index, meeting] of plan.meetings.entries()) {
    const checkInOpen = epoch(meeting.checkInOpensAt);
    const contentStart = epoch(meeting.contentStartsAt);
    const dismissalStart = epoch(meeting.dismissalStartsAt);
    const officialEnd = epoch(meeting.officialEndsAt);
    const next = plan.meetings[index + 1];
    if (
      checkInOpen === undefined ||
      contentStart === undefined ||
      dismissalStart === undefined ||
      officialEnd === undefined
    ) {
      return stateCase(plan, evaluatedAt, 'no_classes');
    }
    if (now < checkInOpen) {
      return stateCase(
        plan,
        evaluatedAt,
        previous === undefined ? 'idle' : 'post_end',
        previous,
        meeting,
      );
    }
    if (now < contentStart) {
      if (!policy.showCheckIn && previous !== undefined) {
        return stateCase(plan, evaluatedAt, 'post_end', previous, meeting);
      }
      return stateCase(
        plan,
        evaluatedAt,
        policy.showCheckIn ? 'pre_checkin' : 'in_class_content',
        meeting,
        next,
      );
    }
    if (now < dismissalStart) {
      return stateCase(plan, evaluatedAt, 'in_class_content', meeting, next);
    }
    if (now < officialEnd) {
      return stateCase(plan, evaluatedAt, 'dismissal_warning', meeting, next);
    }
    previous = meeting;
  }
  return stateCase(plan, evaluatedAt, 'day_complete', previous);
}

export interface NextClassDaySelection {
  readonly label: 'Tomorrow' | 'Next Week' | 'Next Class Day';
  readonly plan?: EffectiveDayPlan;
}

export function selectNextClassDay(
  currentDate: IsoDate,
  currentScreenId: EffectiveDayPlan['screenId'],
  candidates: readonly EffectiveDayPlan[],
): NextClassDaySelection {
  const plan = [...candidates]
    .filter(
      (candidate) =>
        candidate.screenId === currentScreenId && candidate.date > currentDate,
    )
    .sort((left, right) => left.date.localeCompare(right.date))[0];
  if (plan === undefined) return { label: 'Next Class Day' };
  const tomorrow = addDateDays(currentDate, 1);
  const day = new Date(`${currentDate}T12:00:00Z`).getUTCDay();
  return {
    label:
      plan.date === tomorrow
        ? 'Tomorrow'
        : day === 5
          ? 'Next Week'
          : 'Next Class Day',
    plan,
  };
}
