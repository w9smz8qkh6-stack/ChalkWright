import type { OpaqueId } from '../contracts/v1/common.js';
import type { ActionableError } from '../domain/errors.js';
import type { CanonicalPlan, EffectiveDayPlan } from '../domain/plans.js';

export type PersistenceWriteResult =
  | {
      readonly status: 'stored';
      readonly revision: OpaqueId;
    }
  | {
      readonly status: 'unchanged';
      readonly revision: OpaqueId;
    }
  | {
      readonly status: 'rejected';
      readonly error: ActionableError;
    };

/** Storage mutation capability is separate from PlanSnapshotReader. */
export interface PlanSnapshotWriter {
  storeCanonical(plan: CanonicalPlan): Promise<PersistenceWriteResult>;
  storeEffective(plan: EffectiveDayPlan): Promise<PersistenceWriteResult>;
}
