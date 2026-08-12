import type { IsoDate } from '../../contracts/v1/common.js';
import {
  normalizeBellScheduleCapture,
  type BellScheduleCapture,
} from '../../application/normalization/bell-schedule.js';
import type { Clock } from '../../domain/determinism.js';
import type { ActionableError } from '../../domain/errors.js';
import { isIsoDate } from '../../domain/runtime-validation.js';
import type {
  ObservationReadResult,
  ScheduleObservationRequest,
  ScheduleObservationSource,
} from '../../ports/read-sources.js';
import type { AuthenticationBlocker } from '../../ports/source-authentication.js';
import type { PowerSchoolAuthentication } from './auth.js';
import type {
  PassiveCapture,
  PassiveReadResult,
  PassiveReadTransport,
} from './contracts.js';

export interface PowerSchoolScheduleAdapterOptions {
  readonly authentication: PowerSchoolAuthentication;
  readonly http: PassiveReadTransport;
  readonly browser: PassiveReadTransport;
  readonly clock: Clock;
  /** Relative GET-only template containing exactly one `{date}` marker. */
  readonly schedulePathTemplate: string;
  /** Defaults to ISO; the M-07B tenant contract uses `MM/DD/YYYY`. */
  readonly scheduleDateFormat?: 'iso-date' | 'mm/dd/yyyy';
  /** Required with the tenant-specific MM/DD/YYYY format. */
  readonly scheduleExpectedDate?: IsoDate;
  readonly utcOffset: 'Z' | `${'+' | '-'}${string}`;
}

function redactedError(
  category: ActionableError['category'],
  code: string,
  message: string,
  retryable: boolean,
): ActionableError {
  return { category, code, message, retryable, diagnostics: [] };
}

function repairError(blocker: AuthenticationBlocker): ActionableError & {
  readonly category: 'authentication-repair-required';
} {
  return {
    category: 'authentication-repair-required',
    code: `powerschool-${blocker}`,
    message: 'The PowerSchool session requires explicit operator repair.',
    retryable: false,
    diagnostics: [],
  };
}

function blockerFromCode(code: string): AuthenticationBlocker {
  if (code === 'sso-required' || code === 'sso-approval-required') {
    return 'sso-approval-required';
  }
  if (code === 'manual-required' || code === 'manual-sign-in-required') {
    return 'manual-sign-in-required';
  }
  return 'session-expired';
}

function validatePathTemplate(template: string): void {
  if (
    template.length < 1 ||
    template.length > 512 ||
    !template.startsWith('/') ||
    template.startsWith('//') ||
    /[\\\u0000-\u001f]/u.test(template) ||
    template.split('{date}').length !== 2
  ) {
    throw new Error('powerschool-schedule-path-invalid');
  }
}

function schedulePath(
  template: string,
  date: IsoDate,
  format: 'iso-date' | 'mm/dd/yyyy',
): string {
  if (format === 'iso-date') return template.replace('{date}', date);
  const [year, month, day] = date.split('-');
  return template.replace('{date}', `${month}/${day}/${year}`);
}

/** Repository-owned, read-only bell adapter. Raw page data never escapes it. */
export class PowerSchoolScheduleAdapter implements ScheduleObservationSource {
  constructor(private readonly options: PowerSchoolScheduleAdapterOptions) {
    validatePathTemplate(options.schedulePathTemplate);
    if (
      options.scheduleExpectedDate !== undefined &&
      !isIsoDate(options.scheduleExpectedDate)
    ) {
      throw new Error('powerschool-schedule-expected-date-invalid');
    }
    if (
      options.scheduleDateFormat === 'mm/dd/yyyy' &&
      options.scheduleExpectedDate === undefined
    ) {
      throw new Error('powerschool-schedule-expected-date-required');
    }
  }

  async readSchedule(
    request: ScheduleObservationRequest,
  ): Promise<
    ObservationReadResult<
      import('../../contracts/v1/schedule.js').ScheduleObservation
    >
  > {
    if (!isIsoDate(request.date)) {
      return {
        status: 'failed',
        error: redactedError(
          'invalid-input',
          'powerschool-schedule-date-invalid',
          'The requested schedule date is invalid.',
          false,
        ),
      };
    }
    if (
      this.options.scheduleExpectedDate !== undefined &&
      request.date !== this.options.scheduleExpectedDate
    ) {
      return {
        status: 'failed',
        error: redactedError(
          'invalid-input',
          'powerschool-schedule-date-not-authorized',
          'The requested schedule date is outside the authorized surface.',
          false,
        ),
      };
    }

    const cached = await this.options.authentication.getStatus();
    if (
      cached.state === 'expired' ||
      cached.state === 'repair-required' ||
      cached.state === 'cooloff'
    ) {
      return {
        status: 'repair-required',
        error: repairError(cached.blocker ?? 'session-expired'),
      };
    }

    const path = schedulePath(
      this.options.schedulePathTemplate,
      request.date,
      this.options.scheduleDateFormat ?? 'iso-date',
    );
    try {
      const http = await this.options.http.read(path);
      if (http.status === 'browser-required') {
        return this.handleTransportResult(
          await this.options.browser.read(path),
          request,
          'browser-read',
        );
      }
      return this.handleTransportResult(http, request, 'session-http');
    } catch {
      return {
        status: 'failed',
        error: redactedError(
          'unavailable',
          'powerschool-schedule-read-failed',
          'The PowerSchool schedule read did not complete successfully.',
          true,
        ),
      };
    }
  }

  private handleTransportResult(
    result: PassiveReadResult,
    request: ScheduleObservationRequest,
    method: BellScheduleCapture['method'],
  ): ObservationReadResult<
    import('../../contracts/v1/schedule.js').ScheduleObservation
  > {
    if (result.status === 'repair-required') {
      const blocker = blockerFromCode(result.code);
      this.options.authentication.recordAuthenticationFailure(blocker);
      return { status: 'repair-required', error: repairError(blocker) };
    }
    if (result.status === 'browser-required') {
      return {
        status: 'failed',
        error: redactedError(
          'unavailable',
          'powerschool-dynamic-read-unavailable',
          'The dynamic schedule page could not be read.',
          true,
        ),
      };
    }
    if (result.status === 'failed') {
      const timeout = result.code.includes('timeout');
      return {
        status: 'failed',
        error: redactedError(
          timeout ? 'timeout' : 'unavailable',
          timeout
            ? 'powerschool-schedule-read-timeout'
            : 'powerschool-schedule-read-failed',
          'The PowerSchool schedule read did not complete successfully.',
          result.retryable,
        ),
      };
    }

    this.options.authentication.recordSuccess();
    return this.normalize(result.capture, request, method);
  }

  private normalize(
    capture: PassiveCapture,
    request: ScheduleObservationRequest,
    method: BellScheduleCapture['method'],
  ): ObservationReadResult<
    import('../../contracts/v1/schedule.js').ScheduleObservation
  > {
    const normalizedCapture: BellScheduleCapture = {
      title: capture.title,
      html: capture.html,
      text: capture.text,
      capturedAt: this.options.clock.now(),
      sourceReference: 'powerschool-bell-schedule',
      method,
    };
    const normalization = normalizeBellScheduleCapture({
      capture: normalizedCapture,
      requestedDate: request.date,
      utcOffset: this.options.utcOffset,
      freshness: 'fresh',
    });
    if (normalization.status === 'rejected') {
      return { status: 'not-found', diagnostics: normalization.diagnostics };
    }
    return { status: 'observed', observation: normalization.observation };
  }
}
