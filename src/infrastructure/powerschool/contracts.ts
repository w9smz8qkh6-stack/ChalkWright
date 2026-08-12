import type { AuthenticationBlocker } from '../../ports/source-authentication.js';

export interface PassiveCapture {
  readonly title: string;
  readonly html: string;
  readonly text: string;
  /** Same-origin relative path only; it is sanitized before provenance use. */
  readonly path: string;
}

export type PassiveReadResult =
  | {
      readonly status: 'captured';
      readonly capture: PassiveCapture;
    }
  | { readonly status: 'browser-required' }
  | {
      readonly status: 'repair-required';
      readonly code: string;
    }
  | {
      readonly status: 'failed';
      readonly code: string;
      readonly retryable: boolean;
    };

/** No form, method, body, or credential input exists on this passive surface. */
export interface PassiveReadTransport {
  read(path: string): Promise<PassiveReadResult>;
}

export type LiveAuthenticationProbeResult =
  | { readonly state: 'authenticated' }
  | {
      readonly state: 'authentication-required';
      readonly blocker: AuthenticationBlocker;
    }
  | { readonly state: 'failed'; readonly reason: 'timeout' | 'unavailable' };

export interface LiveAuthenticationProbe {
  probe(
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<LiveAuthenticationProbeResult>;
}

export type InteractiveAuthenticationRepairResult =
  | { readonly state: 'authenticated' }
  | {
      readonly state: 'blocked';
      readonly blocker: Exclude<AuthenticationBlocker, 'session-expired'>;
    }
  | { readonly state: 'failed'; readonly reason: 'timeout' | 'unavailable' };

/** The only infrastructure capability permitted to interact with sign-in UI. */
export interface InteractiveAuthenticationRepair {
  repair(
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<InteractiveAuthenticationRepairResult>;
}
