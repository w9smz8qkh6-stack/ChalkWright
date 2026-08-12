import type { ShadowConfig } from '../../config/shadow.js';
import type { PlanSnapshotWriter } from '../../ports/persistence-write.js';
import type { ScheduleObservationSource } from '../../ports/read-sources.js';
import type { OperationsJobHandler } from '../operations/registry.js';
import { createPlanRefreshJobHandler } from '../integration/plan-refresh-handler.js';

/** Shadow-specific wrapper over the provider-neutral plan refresh contract. */
export function createShadowSourceAuthHandler(options: {
  readonly config: ShadowConfig;
  readonly sourceForRun: (signal: AbortSignal) => ScheduleObservationSource;
  readonly plans: PlanSnapshotWriter;
}): OperationsJobHandler {
  return createPlanRefreshJobHandler({
    ...options,
    evidencePrefix: 'shadow',
  });
}
