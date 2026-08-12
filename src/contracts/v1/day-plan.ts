import type {
  ContractDiagnostic,
  ContractEnvelope,
  IanaTimeZone,
  IsoDate,
  IsoInstant,
  OpaqueId,
  VerificationState,
} from './common.js';

export interface DayPlanMeeting {
  readonly meetingId: OpaqueId;
  readonly courseKey: OpaqueId;
  readonly blockLabel: string;
  readonly checkInOpensAt: IsoInstant;
  readonly officialStartsAt: IsoInstant;
  readonly checkInClosesAt: IsoInstant;
  readonly contentStartsAt: IsoInstant;
  readonly dismissalStartsAt: IsoInstant;
  readonly officialEndsAt: IsoInstant;
}

/** Calendar and display contracts consume this plan; neither defines it. */
export interface CanonicalDayPlan extends ContractEnvelope {
  readonly planId: OpaqueId;
  readonly date: IsoDate;
  readonly timeZone: IanaTimeZone;
  readonly roomId: OpaqueId;
  readonly sourceObservationIds: readonly OpaqueId[];
  readonly verification: VerificationState;
  readonly meetings: readonly DayPlanMeeting[];
  readonly diagnostics: readonly ContractDiagnostic[];
}

export interface ScreenAssignment extends ContractEnvelope {
  readonly screenId: OpaqueId;
  readonly roomId: OpaqueId;
  readonly routeKey: OpaqueId;
}
