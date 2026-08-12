import {
  contractVersion,
  type CanonicalDayPlan,
  type DayPlanMeeting,
  type FreshnessState,
  type IanaTimeZone,
  type ScheduleKind,
  type ScheduleObservation,
  type SchedulePeriodObservation,
  type ScreenAssignment,
} from '../../src/contracts/v1/index.js';

export type FixtureScenario =
  | 'normal'
  | 'special-schedule'
  | 'empty'
  | 'stale'
  | 'malformed'
  | 'gap-day'
  | 'multi-screen';

export interface SyntheticFixture<T> {
  readonly fixtureVersion: 1;
  readonly fixtureId: string;
  readonly scenario: FixtureScenario;
  readonly synthetic: true;
  readonly input: T;
  readonly expectation: {
    readonly acceptedByContract: boolean;
    readonly laterBehaviorGate: string;
  };
}

export function buildPeriod(
  id: string,
  courseKey: string,
  blockLabel: string,
  startsAt: string,
  endsAt: string,
  roomKey = 'room-alpha',
): SchedulePeriodObservation {
  return {
    periodId: id,
    courseKey,
    blockLabel,
    roomKey,
    startsAt,
    endsAt,
  };
}

export function buildScheduleObservation(options: {
  readonly id: string;
  readonly date: string;
  readonly kind: ScheduleKind;
  readonly periods: readonly SchedulePeriodObservation[];
  readonly freshness?: FreshnessState;
  readonly verification?: 'verified' | 'unverified' | 'synthetic';
}): ScheduleObservation {
  const freshness = options.freshness ?? 'fresh';

  return {
    contractVersion,
    observationId: options.id,
    observedForDate: options.date,
    kind: options.kind,
    verification: options.verification ?? 'synthetic',
    periods: options.periods,
    provenance: {
      source: 'synthetic-fixture',
      method: 'fixture',
      observedAt: `${options.date}T05:00:00Z`,
      verification: 'synthetic',
      sourceReference: `synthetic-source-${options.id}`,
    },
    freshness: {
      state: freshness,
      observedAt: `${options.date}T05:00:00Z`,
      ...(freshness === 'stale'
        ? {
            expiresAt: `${options.date}T05:30:00Z`,
            lastSuccessfulAt: `${options.date}T05:00:00Z`,
          }
        : {}),
    },
    diagnostics:
      freshness === 'stale'
        ? [
            {
              code: 'fixture-stale-observation',
              severity: 'warning',
              message: 'Synthetic observation is intentionally stale.',
            },
          ]
        : [],
  };
}

export function buildMeeting(options: {
  readonly id: string;
  readonly courseKey: string;
  readonly blockLabel: string;
  readonly checkInOpensAt: string;
  readonly officialStartsAt: string;
  readonly checkInClosesAt: string;
  readonly contentStartsAt: string;
  readonly dismissalStartsAt: string;
  readonly officialEndsAt: string;
}): DayPlanMeeting {
  return {
    meetingId: options.id,
    courseKey: options.courseKey,
    blockLabel: options.blockLabel,
    checkInOpensAt: options.checkInOpensAt,
    officialStartsAt: options.officialStartsAt,
    checkInClosesAt: options.checkInClosesAt,
    contentStartsAt: options.contentStartsAt,
    dismissalStartsAt: options.dismissalStartsAt,
    officialEndsAt: options.officialEndsAt,
  };
}

export function buildDayPlan(options: {
  readonly id: string;
  readonly date: string;
  readonly timeZone: IanaTimeZone;
  readonly roomId: string;
  readonly sourceObservationIds: readonly string[];
  readonly meetings: readonly DayPlanMeeting[];
}): CanonicalDayPlan {
  return {
    contractVersion,
    planId: options.id,
    date: options.date,
    timeZone: options.timeZone,
    roomId: options.roomId,
    sourceObservationIds: options.sourceObservationIds,
    verification: 'synthetic',
    meetings: options.meetings,
    diagnostics: [],
  };
}

export function buildScreen(
  screenId: string,
  roomId: string,
): ScreenAssignment {
  return {
    contractVersion,
    screenId,
    roomId,
    routeKey: `route-${screenId}`,
  };
}

export function fixture<T>(
  fixtureId: string,
  scenario: FixtureScenario,
  input: T,
  acceptedByContract: boolean,
  laterBehaviorGate: string,
): SyntheticFixture<T> {
  return {
    fixtureVersion: 1,
    fixtureId,
    scenario,
    synthetic: true,
    input,
    expectation: {
      acceptedByContract,
      laterBehaviorGate,
    },
  };
}
