import assert from 'node:assert/strict';
import test from 'node:test';

import type { ClassId } from '../../../src/domain/identities.js';
import { GoogleClassroomCourseworkSource } from '../../../src/infrastructure/google-classroom/adapter.js';
import {
  GoogleClassroomTransportError,
  type ClassroomCourseWorkListRequest,
  type ClassroomCourseWorkListTransport,
} from '../../../src/infrastructure/google-classroom/contracts.js';

const classId = 'class-synthetic' as ClassId;
const mapping = { classId, providerCourseKey: '123456789' };

function source(
  transport: ClassroomCourseWorkListTransport,
  overrides: Partial<{
    requestTimeoutMs: number;
    maximumPagesPerCourse: number;
    maximumItemsPerCourse: number;
  }> = {},
): GoogleClassroomCourseworkSource {
  return new GoogleClassroomCourseworkSource({
    mappings: [mapping],
    requestTimeoutMs: overrides.requestTimeoutMs ?? 5_000,
    maximumPagesPerCourse: overrides.maximumPagesPerCourse ?? 5,
    maximumItemsPerCourse: overrides.maximumItemsPerCourse ?? 500,
    transport,
    now: () => '2035-04-13T01:00:00.000Z',
  });
}

test('paginates published coursework and normalizes through the approved domain contract', async () => {
  const requests: ClassroomCourseWorkListRequest[] = [];
  const transport: ClassroomCourseWorkListTransport = {
    async listPublishedCourseWork(request) {
      requests.push(request);
      return request.pageToken === undefined
        ? {
            items: [
              {
                id: 'work-recent',
                courseId: '123456789',
                title: ' Recent assignment ',
                description: 'Complete the synthetic exercise.',
                dueDate: { year: 2035, month: 4, day: 12 },
                dueTime: { hours: 9, minutes: 30 },
                alternateLink:
                  'https://classroom.google.com/c/synthetic/a/recent',
                state: 'PUBLISHED',
                workType: 'ASSIGNMENT',
                updateTime: '2035-04-11T02:00:00.000Z',
                materials: [
                  {
                    link: {
                      title: 'Reference',
                      url: 'https://example.test/reference',
                    },
                  },
                ],
              },
              { id: 'draft', title: 'Draft', state: 'DRAFT' },
            ],
            nextPageToken: 'page-2',
          }
        : {
            items: [
              {
                id: 'work-upcoming',
                title: 'Upcoming assignment',
                dueDate: { year: 2035, month: 4, day: 14 },
                state: 'PUBLISHED',
                workType: 'SHORT_ANSWER_QUESTION',
                updateTime: '2035-04-12T03:00:00.000Z',
              },
            ],
          };
    },
  };
  const result = await source(transport).readEnrichment({
    date: '2035-04-13',
    classId,
  });
  assert.equal(result.status, 'observed', JSON.stringify(result));
  if (result.status !== 'observed') return;
  assert.equal(result.observation.value.recent.length, 1);
  assert.equal(result.observation.value.upcoming.length, 1);
  assert.equal(result.observation.value.recent[0]?.title, 'Recent assignment');
  assert.equal(
    result.observation.value.recent[0]?.dueAt,
    '2035-04-12T09:30:00.000Z',
  );
  assert.equal(result.observation.value.upcoming[0]?.bucket, 'upcoming');
  assert.equal(result.observation.provenance.method, 'api-read');
  assert.equal(result.observation.verification, 'verified');
  assert.equal(requests.length, 2);
  assert.equal(requests[0]?.providerCourseKey, '123456789');
  assert.equal(requests[1]?.pageToken, 'page-2');
});

test('missing mappings and page budgets fail independently without widening transport', async () => {
  let calls = 0;
  const missing = new GoogleClassroomCourseworkSource({
    mappings: [mapping],
    requestTimeoutMs: 5_000,
    maximumPagesPerCourse: 1,
    maximumItemsPerCourse: 10,
    transport: {
      async listPublishedCourseWork() {
        calls += 1;
        return { items: [] };
      },
    },
  });
  const missingResult = await missing.readEnrichment({
    date: '2035-04-13',
    classId: 'unmapped' as ClassId,
  });
  assert.equal(missingResult.status, 'failed');
  assert.equal(calls, 0);

  const budget = source(
    {
      async listPublishedCourseWork() {
        return { items: [], nextPageToken: 'still-more' };
      },
    },
    { maximumPagesPerCourse: 1 },
  );
  const budgetResult = await budget.readEnrichment({
    date: '2035-04-13',
    classId,
  });
  assert.equal(budgetResult.status, 'failed');
  if (budgetResult.status === 'failed')
    assert.equal(budgetResult.error.code, 'classroom-page-budget-exceeded');
});

test('authentication and authorization failures are sanitized and mutation-free', async () => {
  for (const [transportCode, expectedStatus] of [
    ['classroom-authentication-required', 'repair-required'],
    ['classroom-authorization-denied', 'failed'],
    ['classroom-course-not-found', 'not-found'],
  ] as const) {
    const result = await source({
      async listPublishedCourseWork() {
        throw new GoogleClassroomTransportError(transportCode);
      },
    }).readEnrichment({ date: '2035-04-13', classId });
    assert.equal(result.status, expectedStatus);
    assert.equal(JSON.stringify(result).includes('private'), false);
  }
});

test('item, repeated-token, and timeout limits fail with finite sanitized codes', async () => {
  const itemBudget = await source(
    {
      async listPublishedCourseWork() {
        return {
          items: [
            { id: 'one', title: 'One', state: 'PUBLISHED' },
            { id: 'two', title: 'Two', state: 'PUBLISHED' },
          ],
        };
      },
    },
    { maximumItemsPerCourse: 1 },
  ).readEnrichment({ date: '2035-04-13', classId });
  assert.equal(itemBudget.status, 'failed');
  if (itemBudget.status === 'failed')
    assert.equal(itemBudget.error.code, 'classroom-item-budget-exceeded');

  const malformedItemBudget = await source(
    {
      async listPublishedCourseWork() {
        return { items: [{}, {}] };
      },
    },
    { maximumItemsPerCourse: 1 },
  ).readEnrichment({ date: '2035-04-13', classId });
  assert.equal(malformedItemBudget.status, 'failed');
  if (malformedItemBudget.status === 'failed')
    assert.equal(
      malformedItemBudget.error.code,
      'classroom-item-budget-exceeded',
    );

  const repeatedToken = await source({
    async listPublishedCourseWork() {
      return { items: [], nextPageToken: 'repeated' };
    },
  }).readEnrichment({ date: '2035-04-13', classId });
  assert.equal(repeatedToken.status, 'failed');
  if (repeatedToken.status === 'failed')
    assert.equal(repeatedToken.error.code, 'classroom-pagination-invalid');

  const timed = await source(
    {
      async listPublishedCourseWork(request) {
        return await new Promise<never>((_, reject) => {
          request.signal.addEventListener(
            'abort',
            () => reject(new Error('private-timeout-detail')),
            { once: true },
          );
        });
      },
    },
    { requestTimeoutMs: 20 },
  ).readEnrichment({ date: '2035-04-13', classId });
  assert.equal(timed.status, 'failed');
  if (timed.status === 'failed') {
    assert.equal(timed.error.code, 'classroom-request-timeout');
    assert.equal(
      JSON.stringify(timed).includes('private-timeout-detail'),
      false,
    );
  }
});

test('per-read abort reaches a stalled official transport', async () => {
  const controller = new AbortController();
  let transportSignal: AbortSignal | undefined;
  const pending = source({
    async listPublishedCourseWork(request) {
      transportSignal = request.signal;
      return await new Promise<never>((_, reject) => {
        request.signal.addEventListener(
          'abort',
          () => reject(new Error('private-abort-detail')),
          { once: true },
        );
      });
    },
  }).readEnrichment({
    date: '2035-04-13',
    classId,
    signal: controller.signal,
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  controller.abort('synthetic-job-deadline');
  const result = await pending;
  assert.equal(transportSignal?.aborted, true);
  assert.equal(result.status, 'failed');
  if (result.status === 'failed') {
    assert.equal(result.error.code, 'classroom-request-timeout');
    assert.equal(
      JSON.stringify(result).includes('private-abort-detail'),
      false,
    );
  }
});
