import type {
  ContractDiagnostic,
  IsoInstant,
} from '../../contracts/v1/common.js';
import type { ScreenId } from '../../domain/identities.js';
import type { EffectiveDayPlan } from '../../domain/plans.js';
import type { ReadOnlyOrchestrationDependencies } from './dependencies.js';

export interface PlanComparisonRequest {
  readonly screenId: ScreenId;
  readonly evaluatedAt: IsoInstant;
  readonly candidate: EffectiveDayPlan;
  readonly reference: EffectiveDayPlan;
}

export interface PlanDifference {
  readonly code: string;
  readonly message: string;
}

export interface PlanComparisonResult {
  readonly equivalent: boolean;
  readonly differences: readonly PlanDifference[];
  readonly diagnostics: readonly ContractDiagnostic[];
}

/** Comparison returns evidence only and receives no mutation capability. */
export interface PlanComparisonUseCase {
  compare(request: PlanComparisonRequest): Promise<PlanComparisonResult>;
}

/** Construction can inject only the explicitly read-only capability set. */
export type PlanComparisonUseCaseFactory<EnrichmentValue> = (
  dependencies: ReadOnlyOrchestrationDependencies<EnrichmentValue>,
) => PlanComparisonUseCase;
