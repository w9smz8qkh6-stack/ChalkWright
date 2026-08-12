import type { ContractDiagnostic } from '../contracts/v1/common.js';
import type {
  AuthenticationBlocker,
  SourceAuthenticationStatus,
} from './source-authentication.js';

export interface AuthenticationRepairRequest {
  readonly consent: boolean;
  readonly timeoutMs: number;
}

export type AuthenticationRepairResult =
  | {
      readonly status: 'repaired';
      readonly authentication: SourceAuthenticationStatus;
    }
  | {
      readonly status: 'blocked';
      readonly blocker: AuthenticationBlocker;
      readonly diagnostics: readonly ContractDiagnostic[];
    }
  | {
      readonly status: 'rejected' | 'failed';
      readonly code: string;
      readonly diagnostics: readonly ContractDiagnostic[];
    };

/** Interactive repair is deliberately separate from every passive read port. */
export interface AuthenticationRepairPort {
  repair(
    request: AuthenticationRepairRequest,
  ): Promise<AuthenticationRepairResult>;
}
