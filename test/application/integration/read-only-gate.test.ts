import assert from 'node:assert/strict';
import test from 'node:test';

import {
  m10PermissionInventory,
  runM10ReadOnlyIntegrationGate,
  type M10IntegrationCase,
  type M10IntegrationManifest,
} from '../../../src/application/integration/read-only-gate.js';
import {
  contractVersion,
  type IsoDate,
  type IsoInstant,
} from '../../../src/contracts/v1/common.js';
import type { ScheduleObservation } from '../../../src/contracts/v1/schedule.js';
import type { CourseworkEnrichment } from '../../../src/domain/coursework.js';
import type { ClassId, RoomId } from '../../../src/domain/identities.js';
import type {
  ClassroomCacheEntry,
  ClassroomEnrichmentCache,
} from '../../../src/ports/classroom-cache.js';
import type {
  EnrichmentObservationSource,
  ScheduleObservationSource,
} from '../../../src/ports/read-sources.js';

class MemoryCache implements ClassroomEnrichmentCache {
  readonly entries = new Map<string, ClassroomCacheEntry>();

  async load(classId: ClassId, date: IsoDate, _observedAt: IsoInstant) {
    return this.entries.get(`${classId}:${date}`);
  }

  async storeSuccess(options: {
    readonly enrichment: CourseworkEnrichment;
    readonly expiresAt: IsoInstant;
  }) {
    this.entries.set(
      `${options.enrichment.classId}:${options.enrichment.observedForDate}`,
      {
        classId: options.enrichment.classId,
        observedForDate: options.enrichment.observedForDate,
        enrichment: options.enrichment,
        refreshedAt: options.enrichment.refreshedAt,
        expiresAt: options.expiresAt,
        consecutiveFailures: 0,
        lastAttemptAt: options.enrichment.refreshedAt,
      },
    );
    return { status: 'stored' as const, revision: 'cache-success' };
  }

  async recordFailure(options: {
    readonly classId: ClassId;
    readonly observedForDate: IsoDate;
    readonly attemptedAt: IsoInstant;
    readonly nextAttemptAt: IsoInstant;
    readonly errorCode: string;
  }) {
    const key = `${options.classId}:${options.observedForDate}`;
    const prior = this.entries.get(key);
    this.entries.set(key, {
      classId: options.classId,
      observedForDate: options.observedForDate,
      ...(prior?.enrichment === undefined
        ? {}
        : { enrichment: prior.enrichment }),
      ...(prior?.refreshedAt === undefined
        ? {}
        : { refreshedAt: prior.refreshedAt }),
      ...(prior?.expiresAt === undefined ? {} : { expiresAt: prior.expiresAt }),
      consecutiveFailures: (prior?.consecutiveFailures ?? 0) + 1,
      lastAttemptAt: options.attemptedAt,
      nextAttemptAt: options.nextAttemptAt,
      lastErrorCode: options.errorCode,
    });
    return { status: 'stored' as const, revision: 'cache-failure' };
  }
}

const date = '2035-09-11' as IsoDate;
const refreshedAt = '2035-09-11T07:00:00.000Z' as IsoInstant;
const timing = {
  timeZone: 'Asia/Ho_Chi_Minh',
  checkInOpenMinutesBefore: 10,
  dismissalWarningMinutesBefore: 5,
} as const;
const activeSignal = new AbortController().signal;

function observation(
  roomId: RoomId,
  courseKey: string,
  periodId: string,
  kind: 'normal' | 'no-classes' = 'normal',
): ScheduleObservation {
  return {
    contractVersion,
    observationId: `observation-${periodId}`,
    observedForDate: date,
    kind,
    verification: 'verified',
    periods:
      kind === 'no-classes'
        ? []
        : [
            {
              periodId,
              courseKey,
              blockLabel: 'Synthetic block',
              roomKey: roomId,
              startsAt: '2035-09-11T08:00:00.000Z',
              endsAt: '2035-09-11T09:00:00.000Z',
            },
          ],
    provenance: {
      source: 'synthetic-fixture',
      method: 'fixture',
      observedAt: refreshedAt,
      verification: 'verified',
      sourceReference: 'fixture:m10-schedule',
    },
    freshness: { state: 'fresh', observedAt: refreshedAt },
    diagnostics: [],
  };
}

function plannedCase(
  caseId: string,
  roomId: RoomId,
  classId: ClassId,
  sectionCode: string,
  periodId: string,
  providerCourseKey: string,
): M10IntegrationCase {
  return {
    caseId,
    date,
    roomId,
    scheduleMappings: [{ classId, sectionCode, roomId, periodId }],
    timing,
    expectedScheduleStatus: 'planned',
    classroom: {
      mappings: [{ classId, providerCourseKey }],
      refreshedAt,
      cacheFreshSeconds: 900,
      backoffBaseSeconds: 60,
      backoffMaximumSeconds: 3_600,
      maximumParallelCourses: 2,
      expectedStatus: 'refreshed',
    },
  };
}

function enrichment(classId: ClassId): CourseworkEnrichment {
  return {
    observedForDate: date,
    classId,
    freshness: 'fresh',
    recent: [],
    upcoming: [],
    refreshedAt,
    provenanceReference: 'fixture:m10-classroom',
  };
}

function classroomObservedSource(): EnrichmentObservationSource<CourseworkEnrichment> {
  return {
    async readEnrichment(request) {
      const value = enrichment(request.classId);
      return {
        status: 'observed',
        observation: {
          contractVersion,
          observationId: 'classroom-observation',
          observedForDate: request.date,
          classId: request.classId,
          value,
          provenance: {
            source: 'synthetic-fixture',
            method: 'fixture',
            observedAt: refreshedAt,
            verification: 'verified',
            sourceReference: 'fixture:m10-classroom',
          },
          freshness: { state: 'fresh', observedAt: refreshedAt },
          verification: 'verified',
          diagnostics: [],
        },
      };
    },
  };
}

test('passes representative multi-room reads with redacted zero-mutation evidence', async () => {
  const roomAlpha = 'room-private-alpha' as RoomId;
  const roomBeta = 'room-private-beta' as RoomId;
  const classAlpha = 'class-private-alpha' as ClassId;
  const classBeta = 'class-private-beta' as ClassId;
  const manifest: M10IntegrationManifest = {
    version: 1,
    cases: [
      plannedCase(
        'representative-alpha',
        roomAlpha,
        classAlpha,
        'course-alpha',
        'period-alpha',
        '1001',
      ),
      plannedCase(
        'representative-beta',
        roomBeta,
        classBeta,
        'course-beta',
        'period-beta',
        '1002',
      ),
      {
        caseId: 'representative-no-classes',
        date,
        roomId: roomAlpha,
        scheduleMappings: [],
        timing,
        expectedScheduleStatus: 'planned',
      },
    ],
  };
  const observations = new Map<string, ScheduleObservation>([
    [
      'representative-alpha',
      observation(roomAlpha, 'course-alpha', 'period-alpha'),
    ],
    [
      'representative-beta',
      observation(roomBeta, 'course-beta', 'period-beta'),
    ],
    [
      'representative-no-classes',
      observation(roomAlpha, 'unused-course', 'unused-period', 'no-classes'),
    ],
  ]);
  const requestedRooms: string[] = [];
  const result = await runM10ReadOnlyIntegrationGate(manifest, {
    scheduleSourceForCase: (caseId): ScheduleObservationSource => ({
      async readSchedule(request) {
        requestedRooms.push(request.roomId);
        return { status: 'observed', observation: observations.get(caseId)! };
      },
    }),
    classroomSourceForCase: () => classroomObservedSource(),
    classroomCache: new MemoryCache(),
    signal: activeSignal,
  });

  assert.equal(result.status, 'passed');
  assert.deepEqual(requestedRooms, [roomAlpha, roomBeta, roomAlpha]);
  assert.deepEqual(
    result.cases.map((entry) => ({
      schedule: entry.scheduleStatus,
      classroom: entry.classroomStatus,
      meetings: entry.meetingCount,
      fresh: entry.freshCacheCount,
      scope: entry.scopeIsolation,
    })),
    [
      {
        schedule: 'planned',
        classroom: 'refreshed',
        meetings: 1,
        fresh: 1,
        scope: 'verified',
      },
      {
        schedule: 'planned',
        classroom: 'refreshed',
        meetings: 1,
        fresh: 1,
        scope: 'verified',
      },
      {
        schedule: 'planned',
        classroom: 'not-run',
        meetings: 0,
        fresh: 0,
        scope: 'verified',
      },
    ],
  );
  assert.deepEqual(result.permissionInventory, m10PermissionInventory);
  assert.equal(result.attemptedSourceMutations, 0);
  assert.equal(result.completedSourceMutations, 0);
  assert.equal(result.eligibleCalendarIntents, 0);
  assert.equal(result.calendarCapabilityConstructed, false);
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(
    serialized,
    /room-private|class-private|course-alpha|course-beta|1001|1002/u,
  );
});

test('classifies authentication, mapping gaps, and retained cache without downstream writes', async () => {
  const roomId = 'room-synthetic' as RoomId;
  const classId = 'class-synthetic' as ClassId;
  const cache = new MemoryCache();
  cache.entries.set(`${classId}:${date}`, {
    classId,
    observedForDate: date,
    enrichment: { ...enrichment(classId), freshness: 'stale' },
    refreshedAt,
    expiresAt: refreshedAt,
    consecutiveFailures: 0,
    lastAttemptAt: refreshedAt,
  });
  const retainedBase = plannedCase(
    'classroom-retained',
    roomId,
    classId,
    'course-alpha',
    'period-alpha',
    '1001',
  );
  const retained: M10IntegrationCase = {
    ...retainedBase,
    classroom: {
      ...retainedBase.classroom!,
      expectedStatus: 'failed',
    },
  };
  const classroomRepairBase = plannedCase(
    'classroom-repair',
    roomId,
    'class-auth' as ClassId,
    'course-auth',
    'period-auth',
    '1002',
  );
  const classroomRepair: M10IntegrationCase = {
    ...classroomRepairBase,
    classroom: {
      ...classroomRepairBase.classroom!,
      expectedStatus: 'repair-required',
    },
  };
  const manifest: M10IntegrationManifest = {
    version: 1,
    cases: [
      {
        caseId: 'powerschool-repair',
        date,
        roomId,
        scheduleMappings: [],
        timing,
        expectedScheduleStatus: 'repair-required',
      },
      {
        caseId: 'mapping-gap',
        date,
        roomId,
        scheduleMappings: [],
        timing,
        expectedScheduleStatus: 'not-found',
      },
      {
        caseId: 'stale-schedule',
        date,
        roomId,
        scheduleMappings: [
          {
            classId,
            sectionCode: 'course-alpha',
            roomId,
            periodId: 'period-alpha',
          },
        ],
        timing,
        expectedScheduleStatus: 'not-found',
      },
      classroomRepair,
      retained,
    ],
  };
  let classroomFactories = 0;
  const result = await runM10ReadOnlyIntegrationGate(manifest, {
    scheduleSourceForCase: (caseId) => ({
      async readSchedule() {
        if (caseId === 'powerschool-repair')
          return {
            status: 'repair-required',
            error: {
              category: 'authentication-repair-required',
              code: 'private-provider-detail-must-not-escape',
              message: 'Private provider detail.',
              retryable: false,
              diagnostics: [],
            },
          };
        const value = observation(
          roomId,
          caseId === 'classroom-repair' ? 'course-auth' : 'course-alpha',
          caseId === 'classroom-repair' ? 'period-auth' : 'period-alpha',
        );
        return {
          status: 'observed',
          observation:
            caseId === 'stale-schedule'
              ? { ...value, freshness: { ...value.freshness, state: 'stale' } }
              : value,
        };
      },
    }),
    classroomSourceForCase: (caseId) => {
      classroomFactories += 1;
      return {
        readEnrichment: async () => ({
          status: 'failed',
          error: {
            category:
              caseId === 'classroom-repair'
                ? 'authentication-repair-required'
                : 'unavailable',
            code:
              caseId === 'classroom-repair'
                ? 'classroom-authentication-required'
                : 'classroom-rate-limited',
            message: 'Sanitized.',
            retryable: true,
            diagnostics: [],
          },
        }),
      };
    },
    classroomCache: cache,
    signal: activeSignal,
  });

  assert.equal(result.status, 'passed');
  assert.equal(classroomFactories, 2);
  assert.deepEqual(
    result.cases.map((entry) => [
      entry.scheduleStatus,
      entry.classroomStatus,
      entry.staleCacheCount,
    ]),
    [
      ['repair-required', 'not-run', 0],
      ['not-found', 'not-run', 0],
      ['not-found', 'not-run', 0],
      ['planned', 'repair-required', 0],
      ['planned', 'failed', 1],
    ],
  );
  assert.doesNotMatch(JSON.stringify(result), /private-provider-detail/u);
  assert.equal(result.eligibleCalendarIntents, 0);
});

test('isolates a partial Classroom failure and retains successful normalized cache state', async () => {
  const roomId = 'room-synthetic' as RoomId;
  const classAlpha = 'class-alpha' as ClassId;
  const classBeta = 'class-beta' as ClassId;
  const base = plannedCase(
    'classroom-degraded',
    roomId,
    classAlpha,
    'course-alpha',
    'period-alpha',
    '1001',
  );
  const manifest: M10IntegrationManifest = {
    version: 1,
    cases: [
      {
        ...base,
        scheduleMappings: [
          ...base.scheduleMappings,
          {
            classId: classBeta,
            sectionCode: 'course-beta',
            roomId,
            periodId: 'period-beta',
          },
        ],
        classroom: {
          ...base.classroom!,
          mappings: [
            ...base.classroom!.mappings,
            { classId: classBeta, providerCourseKey: '1002' },
          ],
          expectedStatus: 'degraded',
        },
      },
    ],
  };
  const cache = new MemoryCache();
  const result = await runM10ReadOnlyIntegrationGate(manifest, {
    scheduleSourceForCase: () => ({
      readSchedule: async () => ({
        status: 'observed',
        observation: observation(roomId, 'course-alpha', 'period-alpha'),
      }),
    }),
    classroomSourceForCase: () => ({
      readEnrichment: async (request) =>
        request.classId === classAlpha
          ? classroomObservedSource().readEnrichment(request)
          : {
              status: 'failed',
              error: {
                category: 'unavailable',
                code: 'classroom-timeout',
                message: 'Sanitized.',
                retryable: true,
                diagnostics: [],
              },
            },
    }),
    classroomCache: cache,
    signal: activeSignal,
  });

  assert.equal(result.status, 'passed');
  assert.deepEqual(result.cases[0], {
    caseId: 'classroom-degraded',
    scheduleStatus: 'planned',
    classroomStatus: 'degraded',
    meetingCount: 1,
    attemptedClassroomReads: 2,
    classroomCacheWrites: 2,
    freshCacheCount: 1,
    staleCacheCount: 0,
    missingCacheCount: 1,
    scopeIsolation: 'verified',
    differences: [],
    attemptedSourceMutations: 0,
    completedSourceMutations: 0,
    eligibleCalendarIntents: 0,
  });
});

test('records named differences, aborts before source access, and sanitizes thrown sources', async () => {
  const roomId = 'room-synthetic' as RoomId;
  const manifest: M10IntegrationManifest = {
    version: 1,
    cases: [
      {
        caseId: 'unexpected-result',
        date,
        roomId,
        scheduleMappings: [],
        timing,
        expectedScheduleStatus: 'planned',
      },
      {
        caseId: 'throwing-source',
        date,
        roomId,
        scheduleMappings: [],
        timing,
        expectedScheduleStatus: 'failed',
      },
    ],
  };
  const result = await runM10ReadOnlyIntegrationGate(manifest, {
    scheduleSourceForCase: (caseId) => {
      if (caseId === 'throwing-source') throw new Error('private-value');
      return {
        readSchedule: async () => ({ status: 'not-found', diagnostics: [] }),
      };
    },
    classroomSourceForCase: () => classroomObservedSource(),
    classroomCache: new MemoryCache(),
    signal: activeSignal,
  });
  assert.equal(result.status, 'differences');
  assert.deepEqual(result.cases[0]?.differences, [
    'schedule-outcome-difference',
  ]);
  assert.deepEqual(result.cases[1]?.differences, []);
  assert.doesNotMatch(JSON.stringify(result), /private-value/u);

  const controller = new AbortController();
  controller.abort();
  let constructed = 0;
  const aborted = await runM10ReadOnlyIntegrationGate(
    { version: 1, cases: [manifest.cases[0]!] },
    {
      scheduleSourceForCase: () => {
        constructed += 1;
        return {
          readSchedule: async () => ({ status: 'not-found', diagnostics: [] }),
        };
      },
      classroomSourceForCase: () => classroomObservedSource(),
      classroomCache: new MemoryCache(),
      signal: controller.signal,
    },
  );
  assert.equal(constructed, 0);
  assert.deepEqual(aborted.cases[0]?.differences, ['integration-aborted']);
});

test('classifies a section or room join failure as one redacted mapping difference', async () => {
  const roomId = 'room-private-target' as RoomId;
  const manifest: M10IntegrationManifest = {
    version: 1,
    cases: [
      {
        caseId: 'section-join',
        date,
        roomId,
        scheduleMappings: [
          {
            classId: 'class-private-target' as ClassId,
            sectionCode: '811.2',
            roomId,
          },
        ],
        timing,
        expectedScheduleStatus: 'planned',
      },
    ],
  };
  const result = await runM10ReadOnlyIntegrationGate(manifest, {
    scheduleSourceForCase: () => ({
      readSchedule: async () => ({
        status: 'observed',
        observation: {
          ...observation(
            'room-private-other' as RoomId,
            '811-2',
            'period-private',
          ),
          periods: [
            {
              ...observation(
                'room-private-other' as RoomId,
                '811-2',
                'period-private',
              ).periods[0]!,
              roomKey: 'room-private-other',
            },
          ],
        },
      }),
    }),
    classroomSourceForCase: () => classroomObservedSource(),
    classroomCache: new MemoryCache(),
    signal: activeSignal,
  });

  assert.equal(result.status, 'differences');
  assert.deepEqual(result.cases[0]?.differences, [
    'schedule-mapping-difference',
  ]);
  assert.doesNotMatch(
    JSON.stringify(result),
    /private-target|private-other|811|period-private/u,
  );
});

test('rejects unsafe or unbounded manifests before constructing a source', async () => {
  let constructed = 0;
  let accessorReads = 0;
  const accessorCase = Object.defineProperty(
    {
      date,
      roomId: 'room-synthetic',
      scheduleMappings: [],
      timing,
      expectedScheduleStatus: 'not-found',
    },
    'caseId',
    {
      enumerable: true,
      get() {
        accessorReads += 1;
        return 'accessor-case';
      },
    },
  );
  const sparseCases = new Array<unknown>(1);
  const dependencies = {
    scheduleSourceForCase: () => {
      constructed += 1;
      return {
        readSchedule: async () => ({
          status: 'not-found' as const,
          diagnostics: [],
        }),
      };
    },
    classroomSourceForCase: () => classroomObservedSource(),
    classroomCache: new MemoryCache(),
    signal: activeSignal,
  };
  for (const manifest of [
    { version: 1, cases: [] },
    {
      version: 1,
      cases: Array.from({ length: 13 }, (_, index) => ({
        caseId: `case-${index}`,
        date,
        roomId: 'room-synthetic',
        scheduleMappings: [],
        timing,
        expectedScheduleStatus: 'not-found',
      })),
    },
    {
      version: 1,
      cases: [
        {
          caseId: 'unsafe case',
          date,
          roomId: 'room-synthetic',
          scheduleMappings: [],
          timing,
          expectedScheduleStatus: 'not-found',
        },
      ],
    },
    {
      version: 1,
      cases: [
        {
          caseId: 'extra-field',
          date,
          roomId: 'room-synthetic',
          scheduleMappings: [],
          timing,
          expectedScheduleStatus: 'not-found',
          privateProviderValue: 'must-not-be-accepted',
        },
      ],
    },
    { version: 1, cases: sparseCases },
    { version: 1, cases: [accessorCase] },
  ])
    await assert.rejects(
      () =>
        runM10ReadOnlyIntegrationGate(
          manifest as unknown as M10IntegrationManifest,
          dependencies,
        ),
      /m10-integration-manifest-invalid/u,
    );
  assert.equal(constructed, 0);
  assert.equal(accessorReads, 0);
});
