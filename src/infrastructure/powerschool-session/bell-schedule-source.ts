import { normalizeBellScheduleCapture } from '../../application/normalization/bell-schedule.js';
import type { PowerSchoolRoutineConfig } from '../../config/powerschool-session.js';
import type { ScheduleObservation } from '../../contracts/v1/schedule.js';
import type { ActionableError } from '../../domain/errors.js';
import type {
  ObservationReadResult,
  ScheduleObservationRequest,
  ScheduleObservationSource,
} from '../../ports/read-sources.js';
import {
  collectPassivePowerSchoolBell,
  type PassivePowerSchoolResult,
} from './passive-collector.js';

export type PassivePowerSchoolCollector = typeof collectPassivePowerSchoolBell;

export class PassivePowerSchoolBellScheduleSource implements ScheduleObservationSource {
  constructor(
    private readonly config: PowerSchoolRoutineConfig,
    private readonly options: {
      readonly signal?: AbortSignal;
      readonly environment?: NodeJS.ProcessEnv;
      readonly collect?: PassivePowerSchoolCollector;
    } = {},
  ) {}

  async readSchedule(
    request: ScheduleObservationRequest,
  ): Promise<ObservationReadResult<ScheduleObservation>> {
    const browserResult = await (
      this.options.collect ?? collectPassivePowerSchoolBell
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
    if (browserResult.status === 'repair-required') {
      return {
        status: 'repair-required',
        error: {
          category: 'authentication-repair-required',
          code: browserResult.code,
          message:
            'The PowerSchool session requires an explicit operator-present bootstrap.',
          retryable: false,
          diagnostics: [],
        },
      };
    }
    if (browserResult.status === 'failed') {
      return { status: 'failed', error: browserFailure(browserResult) };
    }

    const normalized = normalizeBellScheduleCapture({
      capture: browserResult.capture,
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
  result: Extract<PassivePowerSchoolResult, { status: 'failed' }>,
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
      'PowerSchool collection failed at a sanitized passive browser boundary.',
    retryable: result.retryable,
    diagnostics: [],
  };
}
