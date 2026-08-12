import type { IsoInstant } from '../../contracts/v1/common.js';
import type { Clock } from '../../domain/determinism.js';
import { isIsoInstant } from '../../domain/runtime-validation.js';
import type {
  AuthenticationBlocker,
  SourceAuthenticationPort,
  SourceAuthenticationStatus,
  SourceAuthenticationStatusRequest,
} from '../../ports/source-authentication.js';
import type {
  LiveAuthenticationProbe,
  LiveAuthenticationProbeResult,
} from './contracts.js';
import { isBoundedOperationTimeout, withBoundedSettlement } from './timeout.js';

export interface PowerSchoolAuthenticationPolicy {
  readonly failureThreshold: number;
  readonly cooloffMs: number;
  readonly liveProbeTimeoutMs: number;
}

function requireBoundedInteger(
  value: number,
  name: string,
  maximum: number,
): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`Invalid ${name}.`);
  }
}

function addMilliseconds(now: IsoInstant, milliseconds: number): IsoInstant {
  if (!isIsoInstant(now)) throw new Error('The injected clock is invalid.');
  const epoch = Date.parse(now);
  return new Date(epoch + milliseconds).toISOString();
}

function requireClockInstant(value: IsoInstant): IsoInstant {
  if (!isIsoInstant(value)) throw new Error('The injected clock is invalid.');
  return value;
}

function diagnostic(code: string, message: string) {
  return { code, severity: 'warning' as const, message };
}

/**
 * Maintains sanitized authentication metadata only. Session material remains
 * owned by the passive/interactive transports and never enters this object.
 */
export class PowerSchoolAuthentication implements SourceAuthenticationPort {
  private state: Exclude<SourceAuthenticationStatus['state'], 'cooloff'> =
    'unavailable';
  private blocker: AuthenticationBlocker | undefined;
  private checkedAt: IsoInstant;
  private lastSuccessfulAt: IsoInstant | undefined;
  private consecutiveAuthenticationFailures = 0;
  private cooloffUntil: IsoInstant | undefined;

  constructor(
    private readonly clock: Clock,
    private readonly liveProbe: LiveAuthenticationProbe,
    private readonly policy: PowerSchoolAuthenticationPolicy,
  ) {
    requireBoundedInteger(policy.failureThreshold, 'failure threshold', 100);
    requireBoundedInteger(policy.cooloffMs, 'cooloff duration', 86_400_000);
    requireBoundedInteger(
      policy.liveProbeTimeoutMs,
      'live probe timeout',
      120_000,
    );
    this.checkedAt = requireClockInstant(clock.now());
  }

  async getStatus(
    request: SourceAuthenticationStatusRequest = {},
  ): Promise<SourceAuthenticationStatus> {
    const now = requireClockInstant(this.clock.now());
    const inCooloff = this.refreshCooloff(now);
    if (request.probe !== true || inCooloff)
      return this.snapshot('cached', now);

    let result: LiveAuthenticationProbeResult;
    try {
      result = await withBoundedSettlement(
        this.policy.liveProbeTimeoutMs,
        (signal) =>
          this.liveProbe.probe(this.policy.liveProbeTimeoutMs, signal),
      );
    } catch (error: unknown) {
      this.state = 'unavailable';
      this.blocker = undefined;
      this.checkedAt = requireClockInstant(this.clock.now());
      return this.snapshot('live-probe', this.checkedAt, [
        diagnostic(
          isBoundedOperationTimeout(error)
            ? 'powerschool-auth-probe-timeout'
            : 'powerschool-auth-probe-unavailable',
          'The authentication probe did not complete successfully.',
        ),
      ]);
    }
    if (result.state === 'authenticated') {
      return this.recordSuccess('live-probe');
    }
    if (result.state === 'authentication-required') {
      return this.recordAuthenticationFailure(result.blocker, 'live-probe');
    }

    this.state = 'unavailable';
    this.blocker = undefined;
    this.checkedAt = requireClockInstant(this.clock.now());
    return this.snapshot('live-probe', this.checkedAt, [
      diagnostic(
        result.reason === 'timeout'
          ? 'powerschool-auth-probe-timeout'
          : 'powerschool-auth-probe-unavailable',
        'The authentication probe did not complete successfully.',
      ),
    ]);
  }

  recordSuccess(
    provenance: SourceAuthenticationStatus['provenance'] = 'cached',
  ): SourceAuthenticationStatus {
    const now = requireClockInstant(this.clock.now());
    this.state = 'authenticated';
    this.blocker = undefined;
    this.checkedAt = now;
    this.lastSuccessfulAt = now;
    this.consecutiveAuthenticationFailures = 0;
    this.cooloffUntil = undefined;
    return this.snapshot(provenance, now);
  }

  recordAuthenticationFailure(
    blocker: AuthenticationBlocker,
    provenance: SourceAuthenticationStatus['provenance'] = 'cached',
  ): SourceAuthenticationStatus {
    const now = requireClockInstant(this.clock.now());
    this.checkedAt = now;
    this.blocker = blocker;
    this.state = blocker === 'session-expired' ? 'expired' : 'repair-required';
    this.consecutiveAuthenticationFailures += 1;
    if (
      this.consecutiveAuthenticationFailures >= this.policy.failureThreshold
    ) {
      this.cooloffUntil = addMilliseconds(now, this.policy.cooloffMs);
    }
    return this.snapshot(provenance, now);
  }

  private refreshCooloff(now: IsoInstant): boolean {
    if (this.cooloffUntil === undefined) return false;
    const current = Date.parse(now);
    const until = Date.parse(this.cooloffUntil);
    if (!Number.isFinite(current) || !Number.isFinite(until)) {
      throw new Error('Authentication state contains an invalid instant.');
    }
    if (current < until) return true;
    this.cooloffUntil = undefined;
    this.consecutiveAuthenticationFailures = 0;
    return false;
  }

  private snapshot(
    provenance: SourceAuthenticationStatus['provenance'],
    now: IsoInstant,
    diagnostics: SourceAuthenticationStatus['diagnostics'] = [],
  ): SourceAuthenticationStatus {
    const state = this.refreshCooloff(now) ? 'cooloff' : this.state;
    return {
      state,
      provenance,
      checkedAt: this.checkedAt,
      ...(this.lastSuccessfulAt === undefined
        ? {}
        : { lastSuccessfulAt: this.lastSuccessfulAt }),
      ...(state !== 'cooloff' || this.cooloffUntil === undefined
        ? {}
        : { cooloffUntil: this.cooloffUntil }),
      ...(this.blocker === undefined ? {} : { blocker: this.blocker }),
      diagnostics,
    };
  }
}
