import type {
  AuthenticationRepairPort,
  AuthenticationRepairRequest,
  AuthenticationRepairResult,
} from '../../ports/authentication-repair.js';
import type {
  InteractiveAuthenticationRepair,
  InteractiveAuthenticationRepairResult,
} from './contracts.js';
import type { PowerSchoolAuthentication } from './auth.js';
import { isBoundedOperationTimeout, withBoundedSettlement } from './timeout.js';

function warning(code: string, message: string) {
  return [{ code, severity: 'warning' as const, message }];
}

/** Explicit-consent repair surface; passive acquisition never receives this capability. */
export class PowerSchoolAuthenticationRepair implements AuthenticationRepairPort {
  constructor(
    private readonly transport: InteractiveAuthenticationRepair,
    private readonly authentication: PowerSchoolAuthentication,
  ) {}

  async repair(
    request: AuthenticationRepairRequest,
  ): Promise<AuthenticationRepairResult> {
    if (request.consent !== true) {
      return {
        status: 'rejected',
        code: 'authentication-repair-consent-required',
        diagnostics: warning(
          'authentication-repair-consent-required',
          'Authentication repair requires explicit operator consent.',
        ),
      };
    }
    if (
      !Number.isSafeInteger(request.timeoutMs) ||
      request.timeoutMs < 1 ||
      request.timeoutMs > 300_000
    ) {
      return {
        status: 'rejected',
        code: 'authentication-repair-timeout-invalid',
        diagnostics: warning(
          'authentication-repair-timeout-invalid',
          'Authentication repair requires a bounded timeout.',
        ),
      };
    }

    let result: InteractiveAuthenticationRepairResult;
    try {
      result = await withBoundedSettlement(request.timeoutMs, (signal) =>
        this.transport.repair(request.timeoutMs, signal),
      );
    } catch (error: unknown) {
      const timeout = isBoundedOperationTimeout(error);
      return {
        status: 'failed',
        code: timeout
          ? 'authentication-repair-timeout'
          : 'authentication-repair-unavailable',
        diagnostics: warning(
          timeout
            ? 'authentication-repair-timeout'
            : 'authentication-repair-unavailable',
          'Authentication repair did not complete successfully.',
        ),
      };
    }
    if (result.state === 'authenticated') {
      return {
        status: 'repaired',
        authentication: this.authentication.recordSuccess('live-probe'),
      };
    }
    if (result.state === 'blocked') {
      this.authentication.recordAuthenticationFailure(
        result.blocker,
        'live-probe',
      );
      return {
        status: 'blocked',
        blocker: result.blocker,
        diagnostics: warning(
          `powerschool-${result.blocker}`,
          'Authentication repair requires an operator action.',
        ),
      };
    }
    return {
      status: 'failed',
      code:
        result.reason === 'timeout'
          ? 'authentication-repair-timeout'
          : 'authentication-repair-unavailable',
      diagnostics: warning(
        result.reason === 'timeout'
          ? 'authentication-repair-timeout'
          : 'authentication-repair-unavailable',
        'Authentication repair did not complete successfully.',
      ),
    };
  }
}
