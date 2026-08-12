import type { IsoInstant, OpaqueId } from '../../contracts/v1/common.js';
import type { EffectiveDayPlan } from '../../domain/plans.js';
import { epoch } from '../../domain/pure-values.js';
import {
  isEffectivePlan,
  isIsoInstant,
} from '../../domain/runtime-validation.js';
import {
  desiredCalendarEvents,
  type DesiredCalendarEvent,
} from '../planning/calendar-intents.js';

export const calendarProjectionPolicyId =
  'powerschool-block-label-and-normalized-description-v1' as const;
export const calendarProjectionDescription =
  'Imported from PowerSchool Bell Schedule.' as const;

export type CalendarDayProjectionResult =
  | {
      readonly status: 'projected';
      readonly desired: readonly DesiredCalendarEvent[];
    }
  | { readonly status: 'invalid' };

/**
 * Defines M-13 desired semantics independently of observed Calendar text.
 * The caller may select only the exact local-day window for the verified plan.
 */
export function projectCalendarDay(options: {
  readonly plan: EffectiveDayPlan;
  readonly scopeId: OpaqueId;
  readonly timeMin: IsoInstant;
  readonly timeMax: IsoInstant;
}): CalendarDayProjectionResult {
  if (
    !isEffectivePlan(options.plan) ||
    options.plan.verification !== 'verified' ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(options.scopeId) ||
    !options.plan.meetings.every((meeting) =>
      validProjectionSummary(meeting.blockLabel),
    ) ||
    !isExactLocalDayWindow(
      options.plan.date,
      options.plan.timeZone,
      options.timeMin,
      options.timeMax,
    )
  )
    return { status: 'invalid' };

  const desired = desiredCalendarEvents({
    plan: options.plan,
    scopeId: options.scopeId,
    summaries: {},
    description: calendarProjectionDescription,
  });
  const minimum = epoch(options.timeMin);
  const maximum = epoch(options.timeMax);
  if (
    desired.length !== options.plan.meetings.length ||
    minimum === undefined ||
    maximum === undefined ||
    desired.some((event) => {
      const start = epoch(event.startsAt);
      const end = epoch(event.endsAt);
      return (
        start === undefined ||
        end === undefined ||
        start < minimum ||
        end > maximum
      );
    })
  )
    return { status: 'invalid' };
  return { status: 'projected', desired };
}

function validProjectionSummary(value: string): boolean {
  return (
    value.length >= 1 &&
    value.length <= 256 &&
    value.trim() === value &&
    value.normalize('NFC') === value &&
    !/[\p{Cc}\p{Cs}\p{Zl}\p{Zp}]/u.test(value)
  );
}

function isExactLocalDayWindow(
  date: string,
  timeZone: string,
  timeMin: string,
  timeMax: string,
): boolean {
  if (!isIsoInstant(timeMin) || !isIsoInstant(timeMax)) return false;
  const minimum = epoch(timeMin);
  const maximum = epoch(timeMax);
  if (
    minimum === undefined ||
    maximum === undefined ||
    minimum >= maximum ||
    new Date(minimum).getUTCMilliseconds() !== 0 ||
    new Date(maximum).getUTCMilliseconds() !== 0
  )
    return false;
  const nextDate = addUtcDate(date, 1);
  if (nextDate === undefined) return false;
  return (
    localDateTime(timeMin, timeZone) === `${date}T00:00:00` &&
    localDateTime(timeMax, timeZone) === `${nextDate}T00:00:00`
  );
}

function localDateTime(instant: string, timeZone: string): string | undefined {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(instant));
    const value = (type: Intl.DateTimeFormatPartTypes): string | undefined =>
      parts.find((part) => part.type === type)?.value;
    const year = value('year');
    const month = value('month');
    const day = value('day');
    const hour = value('hour');
    const minute = value('minute');
    const second = value('second');
    return [year, month, day, hour, minute, second].some(
      (part) => part === undefined,
    )
      ? undefined
      : `${year}-${month}-${day}T${hour}:${minute}:${second}`;
  } catch {
    return undefined;
  }
}

function addUtcDate(date: string, days: number): string | undefined {
  const parsed = Date.parse(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(parsed)) return undefined;
  return new Date(parsed + days * 86_400_000).toISOString().slice(0, 10);
}
