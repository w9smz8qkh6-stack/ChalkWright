import { normalizeBellScheduleCapture } from '../../application/normalization/bell-schedule.js';
import type { PowerSchoolCompatibilityConfig } from '../../config/powerschool-session.js';
import type { ScheduleObservation } from '../../contracts/v1/schedule.js';
import type { ActionableError } from '../../domain/errors.js';
import type {
  ObservationReadResult,
  ScheduleObservationRequest,
  ScheduleObservationSource,
} from '../../ports/read-sources.js';
import {
  collectPersistentPowerSchoolBell,
  type PersistentPowerSchoolCompatibilityResult,
} from './persistent-compatibility-collector.js';

export class PersistentCompatibilityPowerSchoolBellScheduleSource implements ScheduleObservationSource {
  constructor(
    private readonly config: PowerSchoolCompatibilityConfig,
    private readonly options: {
      readonly signal?: AbortSignal;
      readonly environment?: NodeJS.ProcessEnv;
      readonly collect?: typeof collectPersistentPowerSchoolBell;
    } = {},
  ) {}

  async readSchedule(
    request: ScheduleObservationRequest,
  ): Promise<ObservationReadResult<ScheduleObservation>> {
    const result = await (
      this.options.collect ?? collectPersistentPowerSchoolBell
    )({
      config: this.config,
      requestedDate: request.date,
      ...(this.options.signal === undefined
        ? {}
        : { signal: this.options.signal }),
      ...(this.options.environment === undefined
        ? {}
        : { browserEnvironment: this.options.environment }),
    });
    if (result.status === 'repair-required') {
      return {
        status: 'repair-required',
        error: {
          category: 'authentication-repair-required',
          code: result.code,
          message:
            'The persistent PowerSchool compatibility profile requires its isolated repair action.',
          retryable: false,
          diagnostics: [],
        },
      };
    }
    if (result.status === 'failed') {
      return { status: 'failed', error: browserFailure(result) };
    }
    const normalized = normalizeBellScheduleCapture({
      capture: result.capture,
      requestedDate: request.date,
      utcOffset: this.config.utcOffset,
      freshness: 'fresh',
      verifiedEmptyScheduleIsNoClasses: true,
    });
    return normalized.status === 'normalized'
      ? { status: 'observed', observation: normalized.observation }
      : { status: 'not-found', diagnostics: normalized.diagnostics };
  }
}

function browserFailure(
  result: Extract<
    PersistentPowerSchoolCompatibilityResult,
    { status: 'failed' }
  >,
): ActionableError {
  const category =
    result.code === 'timeout'
      ? 'timeout'
      : result.code === 'request-policy-violation' ||
          result.code === 'session-state-unsafe'
        ? 'unsafe-configuration'
        : 'unavailable';
  return {
    category,
    code: result.code,
    message:
      'PowerSchool collection failed at the sanitized persistent compatibility boundary.',
    retryable: result.retryable,
    diagnostics: [],
  };
}
