import type { ContractDiagnostic, IsoDate } from '../contracts/v1/common.js';
import type { ScheduleObservation } from '../contracts/v1/schedule.js';
import type { ActionableError } from '../domain/errors.js';
import type { ClassId, RoomId } from '../domain/identities.js';
import type { EnrichmentObservation } from '../domain/observations.js';

export type ObservationReadResult<Observation> =
  | {
      readonly status: 'observed';
      readonly observation: Observation;
    }
  | {
      readonly status: 'not-found';
      readonly diagnostics: readonly ContractDiagnostic[];
    }
  | {
      readonly status: 'repair-required';
      readonly error: ActionableError & {
        readonly category: 'authentication-repair-required';
      };
    }
  | {
      readonly status: 'failed';
      readonly error: ActionableError;
    };

export interface ScheduleObservationRequest {
  readonly date: IsoDate;
  readonly roomId: RoomId;
}

/** Read-only acquisition capability; no source mutation method is exposed. */
export interface ScheduleObservationSource {
  readSchedule(
    request: ScheduleObservationRequest,
  ): Promise<ObservationReadResult<ScheduleObservation>>;
}

export interface EnrichmentObservationRequest {
  readonly date: IsoDate;
  readonly classId: ClassId;
  readonly signal?: AbortSignal;
}

/** Read-only, provider-neutral enrichment capability. */
export interface EnrichmentObservationSource<Value> {
  readEnrichment(
    request: EnrichmentObservationRequest,
  ): Promise<ObservationReadResult<EnrichmentObservation<Value>>>;
}
