import type { IsoDate } from '../contracts/v1/common.js';
import type { CanonicalPlan, EffectiveDayPlan } from '../domain/plans.js';
import type { RoomId, ScreenId } from '../domain/identities.js';

export interface CanonicalPlanQuery {
  readonly date: IsoDate;
  readonly roomId: RoomId;
}

export interface EffectivePlanQuery {
  readonly date: IsoDate;
  readonly screenId: ScreenId;
  /** Current screen assignment; history from another room is never eligible. */
  readonly roomId: RoomId;
}

/** Persistence read boundary contains no database, query-language, or transaction details. */
export interface PlanSnapshotReader {
  findCanonical(query: CanonicalPlanQuery): Promise<CanonicalPlan | undefined>;
  findEffective(
    query: EffectivePlanQuery,
  ): Promise<EffectiveDayPlan | undefined>;
}
