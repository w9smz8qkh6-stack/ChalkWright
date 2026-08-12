import type { ContractDiagnostic, IsoInstant } from '../contracts/v1/common.js';

export type SourceAuthenticationState =
  'authenticated' | 'expired' | 'repair-required' | 'cooloff' | 'unavailable';

export type AuthenticationBlocker =
  'session-expired' | 'manual-sign-in-required' | 'sso-approval-required';

/** Sanitized authentication status; cookies and profile details never cross this port. */
export interface SourceAuthenticationStatus {
  readonly state: SourceAuthenticationState;
  readonly provenance: 'cached' | 'live-probe';
  readonly checkedAt: IsoInstant;
  readonly lastSuccessfulAt?: IsoInstant;
  readonly cooloffUntil?: IsoInstant;
  readonly blocker?: AuthenticationBlocker;
  readonly diagnostics: readonly ContractDiagnostic[];
}

export interface SourceAuthenticationStatusRequest {
  /** Cached status is the network-free default. */
  readonly probe?: boolean;
}

export interface SourceAuthenticationPort {
  getStatus(
    request?: SourceAuthenticationStatusRequest,
  ): Promise<SourceAuthenticationStatus>;
}
