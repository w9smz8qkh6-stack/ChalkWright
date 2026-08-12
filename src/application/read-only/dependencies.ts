import type { Clock, IdentifierFactory } from '../../domain/determinism.js';
import type { EnrichmentObservationSource } from '../../ports/read-sources.js';
import type { PlanSnapshotReader } from '../../ports/persistence-read.js';
import type { ScheduleObservationSource } from '../../ports/read-sources.js';

/** Capability set available to preview and comparison orchestration. */
export interface ReadOnlyOrchestrationDependencies<EnrichmentValue> {
  readonly clock: Clock;
  readonly identifiers: IdentifierFactory;
  readonly schedules: ScheduleObservationSource;
  readonly enrichment: EnrichmentObservationSource<EnrichmentValue>;
  readonly plans: PlanSnapshotReader;
}
