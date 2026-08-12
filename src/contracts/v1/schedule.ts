import type {
  ContractDiagnostic,
  ContractEnvelope,
  Freshness,
  IsoDate,
  IsoInstant,
  OpaqueId,
  Provenance,
  VerificationState,
} from './common.js';

export type ScheduleKind = 'normal' | 'special' | 'no-classes';

export interface SchedulePeriodObservation {
  readonly periodId: OpaqueId;
  readonly courseKey: OpaqueId;
  readonly blockLabel: string;
  readonly roomKey?: OpaqueId;
  readonly startsAt: IsoInstant;
  readonly endsAt: IsoInstant;
}

/** A normalized, read-only schedule observation; raw pages never cross this boundary. */
export interface ScheduleObservation extends ContractEnvelope {
  readonly observationId: OpaqueId;
  readonly observedForDate: IsoDate;
  readonly kind: ScheduleKind;
  readonly verification: VerificationState;
  readonly periods: readonly SchedulePeriodObservation[];
  readonly provenance: Provenance;
  readonly freshness: Freshness;
  readonly diagnostics: readonly ContractDiagnostic[];
}
