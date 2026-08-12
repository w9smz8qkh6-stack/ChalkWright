import type {
  ContractDiagnostic,
  ContractEnvelope,
  IanaTimeZone,
  IsoDate,
  OpaqueId,
  VerificationState,
} from '../contracts/v1/common.js';
import type {
  CanonicalDayPlan,
  DayPlanMeeting,
} from '../contracts/v1/day-plan.js';
import type { RoomId, ScreenId } from './identities.js';

/** The frozen v1 canonical plan remains the provider- and presentation-neutral source of truth. */
export type CanonicalPlan = Omit<CanonicalDayPlan, 'roomId'> & {
  readonly roomId: RoomId;
};

/** A screen-scoped projection derived from, but never written back into, a canonical plan. */
export interface EffectiveDayPlan extends ContractEnvelope {
  readonly effectivePlanId: OpaqueId;
  readonly canonicalPlanId: OpaqueId;
  readonly date: IsoDate;
  readonly timeZone: IanaTimeZone;
  readonly roomId: RoomId;
  readonly screenId: ScreenId;
  readonly verification: VerificationState;
  readonly meetings: readonly DayPlanMeeting[];
  readonly diagnostics: readonly ContractDiagnostic[];
}
