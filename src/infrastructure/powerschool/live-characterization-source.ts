import type {
  CharacterizationReadRequest,
  CharacterizationScheduleResult,
  CharacterizationSourceMetadata,
  CharacterizationStatusResult,
  PowerSchoolCharacterizationPolicy,
  PowerSchoolCharacterizationSource,
} from '../../application/read-only/powerschool-characterization.js';
import { normalizedScheduleFieldNames } from '../../application/read-only/powerschool-characterization.js';
import type { Clock } from '../../domain/determinism.js';
import type { RoomId } from '../../domain/identities.js';
import { PowerSchoolScheduleAdapter } from './adapter.js';
import { PowerSchoolAuthentication } from './auth.js';
import type { PassiveReadResult, PassiveReadTransport } from './contracts.js';

interface RecordedRead {
  readonly transport: 'session-http' | 'browser-read';
  readonly result: PassiveReadResult;
  readonly durationMs: number;
}

class RecordingTransport implements PassiveReadTransport {
  readonly reads: RecordedRead[] = [];

  constructor(
    private readonly transport: 'session-http' | 'browser-read',
    private readonly delegate: PassiveReadTransport,
    private readonly monotonicNow: () => number,
  ) {}

  async read(path: string): Promise<PassiveReadResult> {
    const started = this.monotonicNow();
    const result = await this.delegate.read(path);
    const completed = this.monotonicNow();
    const durationMs = completed - started;
    if (!Number.isFinite(durationMs) || durationMs < 0) {
      throw new Error('powerschool-characterization-duration-invalid');
    }
    this.reads.push({ transport: this.transport, result, durationMs });
    return result;
  }
}

export interface LivePowerSchoolCharacterizationSourceOptions {
  readonly policy: PowerSchoolCharacterizationPolicy;
  readonly clock: Clock;
  readonly monotonicNow: () => number;
  readonly http: PassiveReadTransport;
  readonly browser: PassiveReadTransport;
  readonly roomId: RoomId;
  readonly utcOffset: 'Z' | `${'+' | '-'}${string}`;
}

/** Fixed-policy bridge from passive captures to the sanitized M-07B source. */
export class LivePowerSchoolCharacterizationSource implements PowerSchoolCharacterizationSource {
  readonly #http: RecordingTransport;
  readonly #browser: RecordingTransport;
  readonly #authentication: PowerSchoolAuthentication;
  readonly #adapter: PowerSchoolScheduleAdapter;

  constructor(
    private readonly options: LivePowerSchoolCharacterizationSourceOptions,
  ) {
    this.#http = new RecordingTransport(
      'session-http',
      options.http,
      options.monotonicNow,
    );
    this.#browser = new RecordingTransport(
      'browser-read',
      options.browser,
      options.monotonicNow,
    );
    this.#authentication = new PowerSchoolAuthentication(
      options.clock,
      { probe: async () => ({ state: 'failed', reason: 'unavailable' }) },
      {
        failureThreshold: 1,
        cooloffMs: options.policy.authenticationCooloffMs,
        liveProbeTimeoutMs: options.policy.requestTimeoutMs,
      },
    );
    this.#adapter = new PowerSchoolScheduleAdapter({
      authentication: this.#authentication,
      http: this.#http,
      browser: this.#browser,
      clock: options.clock,
      schedulePathTemplate:
        '/teachers/aet_schedulebell.html?target_date={date}',
      scheduleDateFormat: 'mm/dd/yyyy',
      scheduleExpectedDate: options.policy.requestedDate,
      utcOffset: options.utcOffset,
    });
  }

  async readStatus(
    request: CharacterizationReadRequest,
    signal: AbortSignal,
  ): Promise<CharacterizationStatusResult> {
    if (!this.#validRequest(request, this.options.policy.statusPath)) {
      return this.#failedStatus('source-unavailable');
    }
    signal.throwIfAborted();
    const beforeHttp = this.#http.reads.length;
    const beforeBrowser = this.#browser.reads.length;
    let result = await this.#http.read(request.path);
    if (result.status === 'browser-required') {
      signal.throwIfAborted();
      result = await this.#browser.read(request.path);
    }
    const reads = [
      ...this.#http.reads.slice(beforeHttp),
      ...this.#browser.reads.slice(beforeBrowser),
    ];
    const metadata = metadataFor('auth', reads);
    if (result.status === 'captured') {
      this.#authentication.recordSuccess();
      return {
        status: 'authenticated',
        finalOrigin: this.options.policy.origin,
        topLevelRequests: reads.length,
        metadata,
      };
    }
    if (result.status === 'repair-required') {
      return {
        status: 'authentication-required',
        finalOrigin: this.options.policy.origin,
        topLevelRequests: reads.length,
        metadata: withCode(metadata, 'source-authentication-required'),
      };
    }
    return {
      status: 'failed',
      finalOrigin: this.options.policy.origin,
      topLevelRequests: reads.length,
      metadata,
    };
  }

  async readBellSchedule(
    request: CharacterizationReadRequest,
    signal: AbortSignal,
  ): Promise<CharacterizationScheduleResult> {
    if (!this.#validRequest(request, this.options.policy.bellPath)) {
      return this.#failedSchedule('source-unavailable');
    }
    signal.throwIfAborted();
    const beforeHttp = this.#http.reads.length;
    const beforeBrowser = this.#browser.reads.length;
    const result = await this.#adapter.readSchedule({
      date: this.options.policy.requestedDate,
      roomId: this.options.roomId,
    });
    const reads = [
      ...this.#http.reads.slice(beforeHttp),
      ...this.#browser.reads.slice(beforeBrowser),
    ];
    let metadata = metadataFor('bell', reads);
    if (result.status === 'repair-required') {
      metadata = withCode(metadata, 'source-authentication-required');
      return {
        status: 'authentication-required',
        finalOrigin: this.options.policy.origin,
        topLevelRequests: reads.length,
        metadata,
        normalizedSummary: emptySummary,
      };
    }
    if (result.status !== 'observed') {
      if (result.status === 'not-found') {
        metadata = withCode(metadata, 'source-normalization-warning');
      }
      return {
        status: 'failed',
        finalOrigin: this.options.policy.origin,
        topLevelRequests: reads.length,
        metadata,
        normalizedSummary: emptySummary,
      };
    }
    const observation = result.observation;
    const periods = observation.periods.map((period) => ({
      periodId: period.periodId,
      courseKey: period.courseKey,
      blockLabel: period.blockLabel,
      ...(period.roomKey === undefined ? {} : { roomKey: period.roomKey }),
      startsAt: new Date(period.startsAt).toISOString(),
      endsAt: new Date(period.endsAt).toISOString(),
    }));
    const hasRooms = periods.some((period) => period.roomKey !== undefined);
    return {
      status: 'observed',
      finalOrigin: this.options.policy.origin,
      topLevelRequests: reads.length,
      metadata: withCode(metadata, 'source-bell-observed'),
      observation: {
        requestedDate: this.options.policy.requestedDate,
        observedForDate: observation.observedForDate,
        kind: observation.kind,
        verification: observation.verification,
        periods,
        provenance: {
          source: 'powerschool',
          method: metadata.transport,
          observedAt: observation.provenance.observedAt,
          verification: observation.provenance.verification,
          sourceReference: 'powerschool-bell-schedule',
        },
        freshness: { ...observation.freshness },
        capturedAt: observation.provenance.observedAt,
        diagnosticCodes:
          observation.diagnostics.length === 0
            ? []
            : ['source-normalization-warning'],
      },
      normalizedSummary: {
        fieldNames: normalizedScheduleFieldNames.filter(
          (field) => field !== 'periods.roomKey' || hasRooms,
        ),
        periodCount: periods.length,
        roomKeyCount: periods.filter((period) => period.roomKey !== undefined)
          .length,
      },
    };
  }

  #validRequest(request: CharacterizationReadRequest, path: string): boolean {
    return (
      request.origin === this.options.policy.origin &&
      request.path === path &&
      request.method === 'GET' &&
      Number.isSafeInteger(request.timeoutMs) &&
      request.timeoutMs > 0 &&
      request.timeoutMs <= this.options.policy.requestTimeoutMs &&
      Number.isSafeInteger(request.maximumTopLevelRequests) &&
      request.maximumTopLevelRequests > 0 &&
      request.maximumTopLevelRequests <=
        this.options.policy.maximumTopLevelRequests
    );
  }

  #failedStatus(code: string): CharacterizationStatusResult {
    return {
      status: 'failed',
      finalOrigin: this.options.policy.origin,
      topLevelRequests: 0,
      metadata: emptyMetadata('auth', code),
    };
  }

  #failedSchedule(code: string): CharacterizationScheduleResult {
    return {
      status: 'failed',
      finalOrigin: this.options.policy.origin,
      topLevelRequests: 0,
      metadata: emptyMetadata('bell', code),
      normalizedSummary: emptySummary,
    };
  }
}

const emptySummary = {
  fieldNames: [],
  periodCount: 0,
  roomKeyCount: 0,
} as const;

function emptyMetadata(
  surface: 'auth' | 'bell',
  code: string,
): CharacterizationSourceMetadata {
  return {
    surface,
    transport: 'session-http',
    redirectClassification: 'not-applicable',
    responseBytes: 0,
    durationMs: 0,
    diagnosticCodes: [code],
  };
}

function metadataFor(
  surface: 'auth' | 'bell',
  reads: readonly RecordedRead[],
): CharacterizationSourceMetadata {
  const selected = reads.at(-1);
  const captured =
    selected?.result.status === 'captured'
      ? selected.result.capture
      : undefined;
  const code =
    selected?.result.status === 'failed' &&
    selected.result.code.includes('timeout')
      ? 'source-timeout'
      : selected?.result.status === 'failed'
        ? 'source-unavailable'
        : undefined;
  return {
    surface,
    transport: selected?.transport ?? 'session-http',
    redirectClassification:
      selected?.result.status === 'repair-required'
        ? 'authentication'
        : 'not-applicable',
    responseBytes:
      captured === undefined
        ? 0
        : new TextEncoder().encode(captured.html).byteLength,
    durationMs: reads.reduce((total, read) => total + read.durationMs, 0),
    diagnosticCodes: [
      ...(reads.some((read) => read.transport === 'browser-read')
        ? ['source-browser-fallback']
        : []),
      ...(code === undefined ? [] : [code]),
      ...(captured === undefined
        ? []
        : [
            surface === 'auth'
              ? 'source-status-observed'
              : 'source-bell-observed',
          ]),
    ],
  };
}

function withCode(
  metadata: CharacterizationSourceMetadata,
  code: string,
): CharacterizationSourceMetadata {
  return {
    ...metadata,
    diagnosticCodes: [...new Set([...metadata.diagnosticCodes, code])],
  };
}
