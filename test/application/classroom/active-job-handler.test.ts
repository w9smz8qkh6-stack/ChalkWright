import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createActiveClassroomRefreshJobHandler,
  isClassroomRefreshTriggerTarget,
  projectClassroomRefreshTriggerTarget,
} from '../../../src/application/classroom/active-job-handler.js';
import {
  contractVersion,
  type IsoDate,
  type IsoInstant,
} from '../../../src/contracts/v1/common.js';
import type { CourseworkEnrichment } from '../../../src/domain/coursework.js';
import type {
  ClassId,
  RoomId,
  ScreenId,
} from '../../../src/domain/identities.js';
import type { ClassroomEnrichmentCache } from '../../../src/ports/classroom-cache.js';

const classA = 'class-a' as ClassId;
const classB = 'class-b' as ClassId;
const date = '2035-04-13' as IsoDate;
const now = '2035-04-13T01:00:00.000Z' as IsoInstant;
const request = {
  jobName: 'classroom-refresh',
  runId: 'synthetic-active-classroom-refresh',
  scopeId: 'synthetic-screen',
  requestedAt: now,
  deadlineAt: '2035-04-13T01:01:00.000Z',
} as const;

class MemoryCache implements ClassroomEnrichmentCache {
  readonly loaded: ClassId[] = [];

  async load(classId: ClassId) {
    this.loaded.push(classId);
    return undefined;
  }
  async storeSuccess() {
    return { status: 'stored' as const, revision: 'synthetic-success' };
  }
  async recordFailure() {
    return { status: 'stored' as const, revision: 'synthetic-failure' };
  }
}

test('refreshes only the exact active mapped class after local target selection', async () => {
  const cache = new MemoryCache();
  const reads: ClassId[] = [];
  let sourceConstructions = 0;
  const handler = createActiveClassroomRefreshJobHandler({
    ...policy(cache),
    targetForRun: () => ({
      state: 'pre_checkin',
      date,
      meetingId: 'meeting-a',
      classId: classA,
    }),
    sourceForRun: () => {
      sourceConstructions += 1;
      return {
        async readEnrichment(input) {
          reads.push(input.classId);
          return observed(input.classId);
        },
      };
    },
  });
  const result = await handler(request, new AbortController().signal);
  assert.equal(result.category, 'succeeded');
  assert.deepEqual(reads, [classA]);
  assert.deepEqual(cache.loaded, [classA]);
  assert.equal(sourceConstructions, 1);
  assert.equal(result.attemptedExternalMutations, 0);
  assert.equal(result.completedExternalMutations, 0);
});

test('inactive states never construct source authority or touch cache', async () => {
  for (const state of [
    'no_classes',
    'morning_overview',
    'idle',
    'dismissal_warning',
    'post_end',
    'day_complete',
  ] as const) {
    const cache = new MemoryCache();
    let sourceConstructions = 0;
    const handler = createActiveClassroomRefreshJobHandler({
      ...policy(cache),
      targetForRun: () => ({ state, date }),
      sourceForRun: () => {
        sourceConstructions += 1;
        throw new Error('must-not-construct');
      },
    });
    const result = await handler(request, new AbortController().signal);
    assert.equal(result.category, 'skipped', state);
    assert.equal(sourceConstructions, 0, state);
    assert.deepEqual(cache.loaded, [], state);
  }
});

test('missing local display target skips without source authority', async () => {
  const cache = new MemoryCache();
  let sourceConstructions = 0;
  const handler = createActiveClassroomRefreshJobHandler({
    ...policy(cache),
    targetForRun: () => undefined,
    sourceForRun: () => {
      sourceConstructions += 1;
      throw new Error('must-not-construct');
    },
  });
  const result = await handler(request, new AbortController().signal);
  assert.equal(result.category, 'skipped');
  assert.equal(sourceConstructions, 0);
  assert.deepEqual(cache.loaded, []);
});

test('invalid, wrong-date, and unmapped active targets fail before source construction', async () => {
  for (const target of [
    {
      state: 'pre_checkin',
      date,
      meetingId: 'meeting-a',
    },
    {
      state: 'in_class_content',
      date: '2035-04-14',
      meetingId: 'meeting-a',
      classId: classA,
    },
    {
      state: 'in_class_content',
      date,
      meetingId: 'meeting-foreign',
      classId: 'class-foreign',
    },
    {
      state: 'idle',
      date,
      unexpected: true,
    },
  ]) {
    let sourceConstructions = 0;
    const handler = createActiveClassroomRefreshJobHandler({
      ...policy(new MemoryCache()),
      targetForRun: () => target,
      sourceForRun: () => {
        sourceConstructions += 1;
        throw new Error('must-not-construct');
      },
    });
    const result = await handler(request, new AbortController().signal);
    assert.equal(result.category, 'failed');
    assert.equal(sourceConstructions, 0);
  }
});

test('abort during local selection prevents source construction', async () => {
  const controller = new AbortController();
  let sourceConstructions = 0;
  const handler = createActiveClassroomRefreshJobHandler({
    ...policy(new MemoryCache()),
    targetForRun: async (_request, signal) =>
      await new Promise((resolve) => {
        signal.addEventListener(
          'abort',
          () =>
            resolve({
              state: 'in_class_content',
              date,
              meetingId: 'meeting-a',
              classId: classA,
            }),
          { once: true },
        );
      }),
    sourceForRun: () => {
      sourceConstructions += 1;
      throw new Error('must-not-construct');
    },
  });
  const pending = handler(request, controller.signal);
  controller.abort('synthetic-abort');
  const result = await pending;
  assert.equal(result.category, 'failed');
  if (result.category === 'failed')
    assert.equal(result.error.code, 'classroom-refresh-aborted');
  assert.equal(sourceConstructions, 0);
});

test('invalid policy fails before local target or provider authority', async () => {
  let targetReads = 0;
  let sourceConstructions = 0;
  const handler = createActiveClassroomRefreshJobHandler({
    ...policy(new MemoryCache()),
    mappings: [
      { classId: classA, providerCourseKey: '101' },
      { classId: classA, providerCourseKey: '102' },
    ],
    targetForRun: () => {
      targetReads += 1;
      return {
        state: 'in_class_content',
        date,
        meetingId: 'meeting-a',
        classId: classA,
      };
    },
    sourceForRun: () => {
      sourceConstructions += 1;
      throw new Error('must-not-construct');
    },
  });
  const result = await handler(request, new AbortController().signal);
  assert.equal(result.category, 'failed');
  assert.equal(targetReads, 0);
  assert.equal(sourceConstructions, 0);
});

test('projects only the finite local trigger contract and rejects hostile shapes', () => {
  const projected = projectClassroomRefreshTriggerTarget({
    plan: {
      contractVersion,
      effectivePlanId: 'plan-a',
      canonicalPlanId: 'canonical-a',
      date,
      roomId: 'room-a' as RoomId,
      screenId: 'screen-a' as ScreenId,
      timeZone: 'Asia/Ho_Chi_Minh',
      verification: 'verified',
      meetings: [],
      diagnostics: [],
    },
    source: 'current',
    degraded: false,
    diagnostics: [],
    evaluatedAt: now,
    state: {
      contractVersion,
      caseId: 'case-a',
      screenId: 'screen-a',
      planId: 'plan-a',
      evaluatedAt: now,
      state: 'in_class_content',
      currentMeetingId: 'meeting-a',
    },
    meetingId: 'meeting-a',
    classId: classA,
    content: { cards: [], assignmentsVisible: true },
  });
  assert.deepEqual(projected, {
    state: 'in_class_content',
    date,
    meetingId: 'meeting-a',
    classId: classA,
  });
  assert.equal(isClassroomRefreshTriggerTarget(projected), true);
  assert.equal(
    isClassroomRefreshTriggerTarget({ ...projected, credential: 'forbidden' }),
    false,
  );
  assert.equal(
    isClassroomRefreshTriggerTarget({ state: 'pre_checkin', date }),
    false,
  );
  assert.equal(
    isClassroomRefreshTriggerTarget({
      state: 'idle',
      date,
      meetingId: 'meeting-a',
      classId: classA,
    }),
    false,
  );
});

test('projects malformed active targets as invalid active shapes, not absence', () => {
  const projected = projectClassroomRefreshTriggerTarget({
    plan: {
      contractVersion,
      effectivePlanId: 'plan-a',
      canonicalPlanId: 'canonical-a',
      date,
      roomId: 'room-a' as RoomId,
      screenId: 'screen-a' as ScreenId,
      timeZone: 'Asia/Ho_Chi_Minh',
      verification: 'verified',
      meetings: [],
      diagnostics: [],
    },
    source: 'current',
    degraded: false,
    diagnostics: [],
    evaluatedAt: now,
    state: {
      contractVersion,
      caseId: 'case-a',
      screenId: 'screen-a',
      planId: 'plan-a',
      evaluatedAt: now,
      state: 'pre_checkin',
    },
    content: { cards: [], assignmentsVisible: true },
  });
  assert.deepEqual(projected, { state: 'pre_checkin', date });
  assert.equal(isClassroomRefreshTriggerTarget(projected), false);
});

function policy(cache: ClassroomEnrichmentCache) {
  return {
    mappings: [
      { classId: classA, providerCourseKey: '101' },
      { classId: classB, providerCourseKey: '102' },
    ],
    cache,
    timeZone: 'Asia/Ho_Chi_Minh',
    cacheFreshSeconds: 900,
    backoffBaseSeconds: 60,
    backoffMaximumSeconds: 900,
    maximumParallelCourses: 2,
    evaluationIntervalSeconds: 30,
  } as const;
}

function observed(classId: ClassId) {
  const value: CourseworkEnrichment = {
    observedForDate: date,
    classId,
    freshness: 'fresh',
    recent: [],
    upcoming: [],
    refreshedAt: now,
    provenanceReference: `google-classroom:${classId}`,
  };
  return {
    status: 'observed' as const,
    observation: {
      contractVersion,
      observationId: 'synthetic-observation',
      observedForDate: date,
      classId,
      value,
      provenance: {
        source: 'google-classroom' as const,
        method: 'api-read' as const,
        observedAt: now,
        verification: 'verified' as const,
        sourceReference: `google-classroom:${classId}`,
      },
      freshness: { state: 'fresh' as const, observedAt: now },
      verification: 'verified' as const,
      diagnostics: [],
    },
  };
}
