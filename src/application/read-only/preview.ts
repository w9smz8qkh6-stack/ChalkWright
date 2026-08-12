import type {
  ContractDiagnostic,
  IsoInstant,
} from '../../contracts/v1/common.js';
import type { ScreenId } from '../../domain/identities.js';
import type { EffectiveDayPlan } from '../../domain/plans.js';
import type { ReadOnlyOrchestrationDependencies } from './dependencies.js';

export interface PreviewRequest {
  readonly screenId: ScreenId;
  readonly targetAt: IsoInstant;
}

export interface PreviewResult {
  readonly evaluatedAt: IsoInstant;
  readonly plan?: EffectiveDayPlan;
  readonly diagnostics: readonly ContractDiagnostic[];
}

/** Preview is a read-only use case and receives no writer capability. */
export interface PreviewUseCase {
  preview(request: PreviewRequest): Promise<PreviewResult>;
}

/** Construction can inject only the explicitly read-only capability set. */
export type PreviewUseCaseFactory<EnrichmentValue> = (
  dependencies: ReadOnlyOrchestrationDependencies<EnrichmentValue>,
) => PreviewUseCase;
