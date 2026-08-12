/** Version shared by every M-01 contract. Breaking shape changes require v2. */
export const contractVersion = '1.0.0' as const;

export type ContractVersion = typeof contractVersion;
export type IsoDate = string;
export type IsoInstant = string;
/** Effective IANA timezone name, validated when configuration behavior is implemented. */
export type IanaTimeZone = string;
export type OpaqueId = string;

export interface ContractEnvelope {
  readonly contractVersion: ContractVersion;
}

export type VerificationState = 'verified' | 'unverified' | 'synthetic';
export type FreshnessState = 'fresh' | 'stale' | 'unknown';

/** Provenance records what was observed without retaining raw source payloads. */
export interface Provenance {
  readonly source:
    | 'synthetic-fixture'
    | 'powerschool'
    | 'google-classroom'
    | 'local-configuration'
    | 'legacy-transition';
  readonly method:
    'fixture' | 'session-http' | 'browser-read' | 'api-read' | 'local-import';
  readonly observedAt: IsoInstant;
  readonly verification: VerificationState;
  readonly sourceReference: OpaqueId;
}

/** Freshness is explicit so stale input can never masquerade as current data. */
export interface Freshness {
  readonly state: FreshnessState;
  readonly observedAt: IsoInstant;
  readonly expiresAt?: IsoInstant;
  readonly lastSuccessfulAt?: IsoInstant;
}

export interface ContractDiagnostic {
  readonly code: string;
  readonly severity: 'info' | 'warning' | 'error';
  readonly message: string;
}
