import assert from 'node:assert/strict';
import test from 'node:test';

import {
  characterizePowerSchoolOnce,
  isPowerSchoolCharacterizationEvidence,
  normalizedScheduleFieldNames,
  validateCharacterizationPolicy,
  type CharacterizationScheduleResult,
  type CharacterizationStatusResult,
  type CharacterizationObservation,
  type CharacterizedSchedule,
  type PowerSchoolCharacterizationSource,
} from '../../../src/application/read-only/powerschool-characterization.js';
import type { Clock } from '../../../src/domain/determinism.js';
import { powerSchoolM07bCharacterizationPolicy as policy } from '../../../src/infrastructure/powerschool/characterization-policy.js';

const now = '2026-08-09T04:30:00.000Z';
const clock: Clock = { now: () => now };

function observation(
  overrides: Partial<CharacterizationObservation> = {},
): CharacterizationObservation {
  return {
    requestedDate: '2026-08-10',
    observedForDate: '2026-08-10',
    kind: 'normal',
    verification: 'verified',
    periods: [
      {
        periodId: 'period-1',
        courseKey: 'course-1',
        blockLabel: 'Period 1',
        roomKey: 'room-b407',
        startsAt: '2026-08-10T13:00:00.000Z',
        endsAt: '2026-08-10T14:00:00.000Z',
      },
    ],
    provenance: {
      source: 'powerschool',
      method: 'session-http',
      observedAt: '2026-08-09T04:10:00.000Z',
      verification: 'verified',
      sourceReference: 'synthetic-characterization',
    },
    freshness: {
      state: 'fresh',
      observedAt: '2026-08-09T04:10:00.000Z',
      expiresAt: '2026-08-10T18:00:00.000Z',
    },
    capturedAt: '2026-08-09T04:10:00.000Z',
    diagnosticCodes: [],
    ...overrides,
  };
}

function metadata(
  surface: 'auth' | 'bell',
  overrides: Record<string, unknown> = {},
) {
  return {
    surface,
    transport: 'session-http' as const,
    httpStatus: 200,
    redirectClassification: 'none' as const,
    responseBytes: surface === 'auth' ? 512 : 4_096,
    durationMs: surface === 'auth' ? 25 : 75,
    diagnosticCodes: [] as readonly string[],
    ...overrides,
  };
}

function normalizedSummary(value: CharacterizationObservation) {
  const roomKeyCount = value.periods.filter(
    (period) => period.roomKey !== undefined,
  ).length;
  return {
    fieldNames: normalizedScheduleFieldNames.filter(
      (field) => field !== 'periods.roomKey' || roomKeyCount > 0,
    ),
    periodCount: value.periods.length,
    roomKeyCount,
  };
}

function observedResult(value = observation()): CharacterizationScheduleResult {
  return {
    status: 'observed',
    finalOrigin: policy.origin,
    topLevelRequests: 1,
    observation: value,
    metadata: metadata('bell'),
    normalizedSummary: normalizedSummary(value),
  };
}

class SyntheticSource implements PowerSchoolCharacterizationSource {
  readonly calls: Array<{ operation: 'status' | 'bell'; request: unknown }> =
    [];
  active = 0;
  maximumActive = 0;

  constructor(
    private readonly statusResult: CharacterizationStatusResult,
    private readonly scheduleResult: CharacterizationScheduleResult,
    private readonly afterStatus?: () => void,
  ) {}

  async readStatus(request: unknown): Promise<CharacterizationStatusResult> {
    this.active += 1;
    this.maximumActive = Math.max(this.maximumActive, this.active);
    this.calls.push({ operation: 'status', request });
    this.afterStatus?.();
    this.active -= 1;
    return this.statusResult;
  }

  async readBellSchedule(
    request: unknown,
  ): Promise<CharacterizationScheduleResult> {
    this.active += 1;
    this.maximumActive = Math.max(this.maximumActive, this.active);
    this.calls.push({ operation: 'bell', request });
    this.active -= 1;
    return this.scheduleResult;
  }
}

function source(
  options: {
    status?: CharacterizationStatusResult;
    schedule?: CharacterizationScheduleResult;
    afterStatus?: () => void;
  } = {},
): SyntheticSource {
  return new SyntheticSource(
    options.status ?? {
      status: 'authenticated',
      finalOrigin: policy.origin,
      topLevelRequests: 1,
      metadata: metadata('auth'),
    },
    options.schedule ?? observedResult(),
    options.afterStatus,
  );
}

async function run(
  synthetic: PowerSchoolCharacterizationSource,
  options: {
    lastKnownGood?: CharacterizedSchedule;
    monotonicNow?: () => number;
  } = {},
) {
  return characterizePowerSchoolOnce({
    policy,
    dependencies: {
      clock,
      monotonicNow: options.monotonicNow ?? (() => 0),
      source: synthetic,
    },
    ...(options.lastKnownGood === undefined
      ? {}
      : { lastKnownGood: options.lastKnownGood }),
  });
}

test('freezes exact M-07B policy and performs two sequential GET-only reads', async () => {
  validateCharacterizationPolicy(policy);
  assert.deepEqual(policy, {
    origin: 'https://tasv.powerschool.com',
    requestedDate: '2026-08-10',
    windowStartsAt: '2026-08-09T04:24:00.000Z',
    windowEndsAt: '2026-08-09T05:24:00.000Z',
    statusPath: '/teachers/home.html',
    bellPath: '/teachers/aet_schedulebell.html?target_date=08/10/2026',
    allowedMethods: ['GET', 'HEAD'],
    maximumTopLevelRequests: 8,
    maximumConcurrency: 1,
    requestTimeoutMs: 10_000,
    totalTimeoutMs: 120_000,
    maximumResponseBytesPerRequest: 2 * 1024 * 1024,
    maximumEvidenceRetentionMs: 604_800_000,
    authenticationCooloffMs: 1_800_000,
    repairAllowed: false,
  });

  const synthetic = source();
  const result = await run(synthetic);
  assert.equal(result.status, 'changed', JSON.stringify(result.evidence));
  assert.equal(synthetic.maximumActive, 1);
  assert.equal(synthetic.calls.length, 2);
  assert.deepEqual(synthetic.calls, [
    {
      operation: 'status',
      request: {
        origin: policy.origin,
        path: '/teachers/home.html',
        method: 'GET',
        timeoutMs: 10_000,
        maximumTopLevelRequests: 8,
      },
    },
    {
      operation: 'bell',
      request: {
        origin: policy.origin,
        path: '/teachers/aet_schedulebell.html?target_date=08/10/2026',
        method: 'GET',
        timeoutMs: 10_000,
        maximumTopLevelRequests: 7,
      },
    },
  ]);
  assert.deepEqual(Object.keys(result.candidate ?? {}).sort(), [
    'date',
    'kind',
    'periods',
  ]);
  assert.deepEqual(Object.keys(result.candidate?.periods[0] ?? {}).sort(), [
    'blockLabel',
    'courseKey',
    'endsAt',
    'periodId',
    'roomKey',
    'startsAt',
  ]);
  assert.equal(result.evidence.authenticationClassification, 'authenticated');
  assert.equal(result.evidence.aggregateResponseBytes, 4_608);
  assert.equal(result.evidence.aggregateDurationMs, 100);
  assert.deepEqual(result.evidence.selectedTransports, ['session-http']);
  assert.deepEqual(
    result.evidence.surfaces.map((surface) => ({
      surface: surface.surface,
      method: surface.method,
      classification: surface.classification,
    })),
    [
      { surface: 'auth', method: 'GET', classification: 'authenticated' },
      { surface: 'bell', method: 'GET', classification: 'observed' },
    ],
  );
  assert.deepEqual(
    result.evidence.normalizedSummary,
    normalizedSummary(observation()),
  );
  assert.deepEqual(Object.keys(result.evidence).sort(), [
    'aggregateDurationMs',
    'aggregateResponseBytes',
    'authenticationClassification',
    'codes',
    'completedAt',
    'deleteAfter',
    'evidenceVersion',
    'fingerprint',
    'lastKnownGoodPreserved',
    'normalizedSummary',
    'outcome',
    'requestedDate',
    'selectedTransports',
    'startedAt',
    'surfaces',
    'topLevelRequests',
  ]);
  assert.equal(isPowerSchoolCharacterizationEvidence(result.evidence), true);
  assert.equal(
    isPowerSchoolCharacterizationEvidence({
      ...result.evidence,
      completedAt: '2026-08-09T05:24:00.000Z',
      deleteAfter: '2026-08-16T05:24:00.000Z',
    }),
    false,
  );
  assert.equal(
    isPowerSchoolCharacterizationEvidence({
      ...result.evidence,
      rawContent: 'forbidden',
    }),
    false,
  );
  const evidence = JSON.stringify(result.evidence);
  for (const forbidden of [
    policy.origin,
    '/teachers/',
    'sourceReference',
    'cookie',
    'profile',
    'html',
  ]) {
    assert.equal(
      evidence.toLowerCase().includes(forbidden.toLowerCase()),
      false,
    );
  }
});

test('fingerprints deterministically and classifies a semantic no-op', async () => {
  const first = await run(source());
  assert.ok(first.candidate);
  const second = await run(source(), { lastKnownGood: first.candidate });
  assert.equal(second.status, 'no-op');
  assert.equal(second.evidence.outcome, 'no-op');
  assert.equal(second.evidence.fingerprint, first.evidence.fingerprint);
  assert.deepEqual(second.effective, first.candidate);
});

test('retains validation for the superseded zero-request preflight only', () => {
  const historicalPreflight = {
    evidenceVersion: '1.0.0',
    requestedDate: '2026-08-10',
    startedAt: '2026-08-09T04:16:21.721Z',
    completedAt: '2026-08-09T04:16:21.721Z',
    deleteAfter: '2026-08-16T04:16:21.721Z',
    outcome: 'failed',
    authenticationClassification: 'not-checked',
    topLevelRequests: 0,
    aggregateResponseBytes: 0,
    aggregateDurationMs: 0,
    selectedTransports: [],
    surfaces: [],
    normalizedSummary: {
      fieldNames: [],
      periodCount: 0,
      roomKeyCount: 0,
    },
    codes: ['profile-write-not-authorized'],
    lastKnownGoodPreserved: false,
    fingerprint: null,
    failureCode: 'profile-write-not-authorized',
  };
  assert.equal(
    isPowerSchoolCharacterizationEvidence(historicalPreflight),
    true,
  );
  assert.equal(
    isPowerSchoolCharacterizationEvidence({
      ...historicalPreflight,
      topLevelRequests: 1,
    }),
    false,
  );
  assert.equal(
    isPowerSchoolCharacterizationEvidence({
      ...historicalPreflight,
      outcome: 'changed',
    }),
    false,
  );
});

test('authentication failure stops immediately, applies cooloff, and preserves LKG', async () => {
  const baseline = (await run(source())).candidate;
  assert.ok(baseline);
  const synthetic = source({
    status: {
      status: 'authentication-required',
      finalOrigin: policy.origin,
      topLevelRequests: 1,
      metadata: {
        ...metadata('auth'),
        redirectClassification: 'authentication',
      },
    },
  });
  const result = await run(synthetic, { lastKnownGood: baseline });
  assert.equal(result.status, 'failed');
  assert.equal(result.evidence.failureCode, 'authentication-required');
  assert.equal(result.evidence.cooloffUntil, '2026-08-09T05:00:00.000Z');
  assert.equal(result.evidence.lastKnownGoodPreserved, true);
  assert.deepEqual(result.effective, baseline);
  assert.equal(synthetic.calls.length, 1);
  assert.equal('repair' in synthetic, false);
});

test('wrong-date, invalid, stale, forbidden, and off-origin results preserve LKG', async () => {
  const baseline = (await run(source())).candidate;
  assert.ok(baseline);
  const cases: Array<{
    expected: string;
    source: SyntheticSource;
  }> = [
    {
      expected: 'observation-wrong-date',
      source: source({
        schedule: observedResult(
          observation({
            observedForDate: '2026-08-11',
            periods: [
              {
                ...observation().periods[0]!,
                startsAt: '2026-08-11T13:00:00.000Z',
                endsAt: '2026-08-11T14:00:00.000Z',
              },
            ],
          }),
        ),
      }),
    },
    {
      expected: 'response-invalid',
      source: source({
        schedule: observedResult({
          ...observation(),
          rawHtml: '<main>forbidden</main>',
        } as CharacterizationObservation),
      }),
    },
    {
      expected: 'observation-stale',
      source: source({
        schedule: observedResult(
          observation({
            freshness: {
              state: 'stale',
              observedAt: '2026-08-10T11:00:00.000Z',
            },
          }),
        ),
      }),
    },
    {
      expected: 'response-invalid',
      source: source({
        schedule: observedResult(
          observation({
            periods: [
              {
                ...observation().periods[0]!,
                blockLabel: 'https://forbidden.example/raw',
              },
            ],
          }),
        ),
      }),
    },
    {
      expected: 'off-origin',
      source: source({
        status: {
          status: 'authenticated',
          finalOrigin: 'https://off-origin.invalid',
          topLevelRequests: 1,
          metadata: {
            ...metadata('auth'),
            redirectClassification: 'off-origin',
          },
        },
      }),
    },
  ];

  for (const scenario of cases) {
    const result = await run(scenario.source, { lastKnownGood: baseline });
    assert.equal(result.evidence.failureCode, scenario.expected);
    assert.equal(result.evidence.lastKnownGoodPreserved, true);
    assert.deepEqual(result.effective, baseline);
    assert.equal(result.candidate, undefined);
  }
});

test('request-count and wall budgets fail closed before another read', async () => {
  const baseline = (await run(source())).candidate;
  assert.ok(baseline);
  const requestBudget = source({
    status: {
      status: 'authenticated',
      finalOrigin: policy.origin,
      topLevelRequests: 8,
      metadata: metadata('auth'),
    },
  });
  const countResult = await run(requestBudget, { lastKnownGood: baseline });
  assert.equal(countResult.evidence.failureCode, 'budget-exceeded');
  assert.equal(requestBudget.calls.length, 1);
  assert.deepEqual(countResult.effective, baseline);

  let elapsed = 0;
  const timeBudget = source({ afterStatus: () => (elapsed = 120_001) });
  const timeResult = await run(timeBudget, {
    lastKnownGood: baseline,
    monotonicNow: () => elapsed,
  });
  assert.equal(timeResult.evidence.failureCode, 'budget-exceeded');
  assert.equal(timeBudget.calls.length, 1);
  assert.deepEqual(timeResult.effective, baseline);
});

test('refuses pre-window and post-window starts without calling the source', async () => {
  for (const startedAt of [
    '2026-08-09T04:23:59.999Z',
    '2026-08-09T05:24:00.000Z',
  ]) {
    const synthetic = source();
    const result = await characterizePowerSchoolOnce({
      policy,
      dependencies: {
        clock: { now: () => startedAt },
        monotonicNow: () => 0,
        source: synthetic,
      },
    });
    assert.equal(result.evidence.failureCode, 'outside-window');
    assert.equal(isPowerSchoolCharacterizationEvidence(result.evidence), true);
    assert.equal(result.evidence.authenticationClassification, 'not-checked');
    assert.equal(result.evidence.topLevelRequests, 0);
    assert.deepEqual(result.evidence.surfaces, []);
    assert.equal(synthetic.calls.length, 0);
  }
});

test('clamps each read to the remaining authorization window and never starts after it', async () => {
  let wallNow = '2026-08-09T05:23:59.500Z';
  const synthetic = source({
    afterStatus: () => {
      wallNow = '2026-08-09T05:23:59.900Z';
    },
  });
  const result = await characterizePowerSchoolOnce({
    policy,
    dependencies: {
      clock: { now: () => wallNow },
      monotonicNow: () => 0,
      source: synthetic,
    },
  });
  assert.equal(result.status, 'changed', JSON.stringify(result.evidence));
  assert.equal(
    (synthetic.calls[0]?.request as { timeoutMs: number }).timeoutMs,
    500,
  );
  assert.equal(
    (synthetic.calls[1]?.request as { timeoutMs: number }).timeoutMs,
    100,
  );

  wallNow = '2026-08-09T05:23:59.500Z';
  const ended = source({
    afterStatus: () => {
      wallNow = '2026-08-09T05:24:00.000Z';
    },
  });
  const stopped = await characterizePowerSchoolOnce({
    policy,
    dependencies: {
      clock: { now: () => wallNow },
      monotonicNow: () => 0,
      source: ended,
    },
  });
  assert.equal(stopped.evidence.failureCode, 'window-ended');
  assert.equal(isPowerSchoolCharacterizationEvidence(stopped.evidence), true);
  assert.equal(
    isPowerSchoolCharacterizationEvidence({
      ...stopped.evidence,
      completedAt: '2026-08-09T05:23:59.999Z',
      deleteAfter: '2026-08-16T05:23:59.999Z',
    }),
    false,
  );
  assert.equal(ended.calls.length, 1);
});

test('rejects cross-date and semantically invalid LKG before source access', async () => {
  const valid = (await run(source())).candidate;
  assert.ok(valid);
  const invalidBaselines: readonly CharacterizedSchedule[] = [
    { ...valid, date: '2026-08-09' },
    {
      ...valid,
      periods: [
        {
          ...valid.periods[0]!,
          startsAt: '2026-08-10T14:00:00.000Z',
          endsAt: '2026-08-10T13:00:00.000Z',
        },
      ],
    },
    { ...valid, periods: [] },
    { ...valid, kind: 'no-classes' },
  ];
  for (const lastKnownGood of invalidBaselines) {
    const synthetic = source();
    await assert.rejects(
      characterizePowerSchoolOnce({
        policy,
        dependencies: { clock, monotonicNow: () => 0, source: synthetic },
        lastKnownGood,
      }),
      /powerschool-characterization-baseline-invalid/,
    );
    assert.equal(synthetic.calls.length, 0);
  }
});

test('persistable evidence enforces retention and zero-request preflight invariants', async () => {
  const result = await characterizePowerSchoolOnce({
    policy,
    dependencies: {
      clock: { now: () => '2026-08-10T00:10:00.000Z' },
      monotonicNow: () => 0,
      source: source(),
    },
  });
  const evidence = result.evidence;
  assert.equal(evidence.failureCode, 'outside-window');
  assert.equal(isPowerSchoolCharacterizationEvidence(evidence), true);
  assert.equal(
    isPowerSchoolCharacterizationEvidence({
      ...evidence,
      deleteAfter: '2026-08-17T00:10:00.001Z',
    }),
    false,
  );
  assert.equal(
    isPowerSchoolCharacterizationEvidence({
      ...evidence,
      authenticationClassification: 'authenticated',
      topLevelRequests: 1,
      aggregateResponseBytes: 512,
      aggregateDurationMs: 25,
      selectedTransports: ['session-http'],
      surfaces: [
        {
          surface: 'auth',
          method: 'GET',
          classification: 'authenticated',
          transport: 'session-http',
          httpStatus: 200,
          redirectClassification: 'none',
          responseBytes: 512,
          durationMs: 25,
          diagnosticCodes: [],
        },
      ],
    }),
    false,
  );
});

test('rejects forbidden and unknown metadata without retaining it in evidence', async () => {
  const cases: CharacterizationStatusResult[] = [
    {
      status: 'authenticated',
      finalOrigin: policy.origin,
      topLevelRequests: 1,
      metadata: metadata('auth', {
        diagnosticCodes: ['https://raw-source.invalid'],
      }),
    },
    {
      status: 'authenticated',
      finalOrigin: policy.origin,
      topLevelRequests: 1,
      metadata: metadata('auth', {
        rawContent: 'synthetic forbidden content',
      }),
    } as CharacterizationStatusResult,
  ];
  for (const status of cases) {
    const result = await run(source({ status }));
    assert.equal(result.evidence.failureCode, 'response-invalid');
    assert.deepEqual(result.evidence.surfaces, []);
    const evidence = JSON.stringify(result.evidence);
    assert.equal(evidence.includes('raw-source'), false);
    assert.equal(evidence.includes('forbidden content'), false);
  }
});

test('rejects unknown or contradictory normalized field summaries', async () => {
  const valid = observedResult();
  const cases: CharacterizationScheduleResult[] = [
    {
      ...valid,
      normalizedSummary: {
        ...valid.normalizedSummary,
        periodCount: 2,
      },
    },
    {
      ...valid,
      normalizedSummary: {
        ...valid.normalizedSummary,
        rawFieldNames: ['rawHtml'],
      },
    } as unknown as CharacterizationScheduleResult,
  ];
  for (const schedule of cases) {
    const result = await run(source({ schedule }));
    assert.equal(result.evidence.failureCode, 'response-invalid');
    assert.equal(JSON.stringify(result.evidence).includes('rawHtml'), false);
  }
});

test('rejects full ScheduleObservation extras and diagnostic messages before retention', async () => {
  const cases: CharacterizationObservation[] = [
    {
      ...observation(),
      contractVersion: '1.0.0',
      observationId: 'forbidden-observation-id',
    } as unknown as CharacterizationObservation,
    {
      ...observation(),
      diagnostics: [
        {
          code: 'forbidden-message',
          severity: 'warning',
          message: 'forbidden diagnostic detail',
        },
      ],
    } as unknown as CharacterizationObservation,
  ];
  for (const value of cases) {
    const result = await run(source({ schedule: observedResult(value) }));
    assert.equal(result.evidence.failureCode, 'response-invalid');
    const evidence = JSON.stringify(result.evidence);
    assert.equal(evidence.includes('forbidden-observation-id'), false);
    assert.equal(evidence.includes('forbidden diagnostic detail'), false);
    assert.equal(evidence.includes('message'), false);
  }
});

test('rejects response-byte and duration overages while preserving LKG', async () => {
  const baseline = (await run(source())).candidate;
  assert.ok(baseline);
  const cases: CharacterizationStatusResult[] = [
    {
      status: 'authenticated',
      finalOrigin: policy.origin,
      topLevelRequests: 1,
      metadata: metadata('auth', {
        responseBytes: policy.maximumResponseBytesPerRequest + 1,
      }),
    },
    {
      status: 'authenticated',
      finalOrigin: policy.origin,
      topLevelRequests: 1,
      metadata: metadata('auth', {
        durationMs: policy.requestTimeoutMs + 1,
      }),
    },
  ];
  for (const status of cases) {
    const synthetic = source({ status });
    const result = await run(synthetic, { lastKnownGood: baseline });
    assert.equal(result.evidence.failureCode, 'response-over-budget');
    assert.equal(result.evidence.lastKnownGoodPreserved, true);
    assert.equal(result.evidence.topLevelRequests, 1);
    assert.equal(isPowerSchoolCharacterizationEvidence(result.evidence), true);
    assert.deepEqual(result.effective, baseline);
    assert.equal(synthetic.calls.length, 1);
  }
});

test('retains redacted diagnostic codes but no diagnostic messages', async () => {
  const synthetic = source({
    status: {
      status: 'authenticated',
      finalOrigin: policy.origin,
      topLevelRequests: 1,
      metadata: metadata('auth', {
        diagnosticCodes: ['source-status-observed'],
      }),
    },
    schedule: {
      ...observedResult(
        observation({ diagnosticCodes: ['source-normalization-warning'] }),
      ),
      metadata: metadata('bell', {
        transport: 'browser-read',
        diagnosticCodes: ['source-browser-fallback'],
      }),
    },
  });
  const result = await run(synthetic);
  assert.equal(result.status, 'changed', JSON.stringify(result.evidence));
  assert.deepEqual(result.evidence.selectedTransports, [
    'session-http',
    'browser-read',
  ]);
  assert.deepEqual(result.evidence.codes, [
    'source-status-observed',
    'source-browser-fallback',
    'source-normalization-warning',
  ]);
  assert.equal('diagnosticMessage' in result.evidence.surfaces[0]!, false);

  const unapproved = await run(
    source({
      schedule: observedResult(
        observation({ diagnosticCodes: ['provider-invented-code'] }),
      ),
    }),
  );
  assert.equal(unapproved.evidence.failureCode, 'response-invalid');
  assert.equal(
    JSON.stringify(unapproved.evidence).includes('provider-invented-code'),
    false,
  );
});

test('rejects policy drift before invoking the source', async () => {
  const synthetic = source();
  await assert.rejects(
    characterizePowerSchoolOnce({
      policy: { ...policy, maximumConcurrency: 2 as 1 },
      dependencies: { clock, monotonicNow: () => 0, source: synthetic },
    }),
    /powerschool-characterization-policy-invalid/,
  );
  assert.equal(synthetic.calls.length, 0);
});
