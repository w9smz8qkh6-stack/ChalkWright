import type {
  ContractDiagnostic,
  ContractEnvelope,
  Freshness,
  IsoDate,
  OpaqueId,
  Provenance,
  VerificationState,
} from '../contracts/v1/common.js';
import type { ClassId } from './identities.js';

/** Metadata every normalized source observation carries across an adapter boundary. */
export interface ObservationMetadata {
  readonly provenance: Provenance;
  readonly freshness: Freshness;
  readonly verification: VerificationState;
  readonly diagnostics: readonly ContractDiagnostic[];
}

/**
 * Provider-neutral enrichment envelope. M-03 owns each normalized value type;
 * raw provider responses must never be used as TValue.
 */
export interface EnrichmentObservation<TValue>
  extends ContractEnvelope, ObservationMetadata {
  readonly observationId: OpaqueId;
  readonly observedForDate: IsoDate;
  readonly classId: ClassId;
  readonly value: TValue;
}
