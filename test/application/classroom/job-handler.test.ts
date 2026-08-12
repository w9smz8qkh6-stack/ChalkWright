import assert from 'node:assert/strict';
import test from 'node:test';

import { createClassroomRefreshJobHandler } from '../../../src/application/classroom/job-handler.js';
import {
  contractVersion,
  type IsoDate,
  type IsoInstant,
} from '../../../src/contracts/v1/common.js';
import type { CourseworkEnrichment } from '../../../src/domain/coursework.js';
import type { ClassId } from '../../../src/domain/identities.js';
import type { ClassroomEnrichmentCache } from '../../../src/ports/classroom-cache.js';

const classId = 'class-a' as ClassId;
const date = '2035-04-13' as IsoDate;
const now = '2035-04-13T01:00:00.000Z' as IsoInstant;
const request = {
  jobName: 'classroom-refresh',
  runId: 'synthetic-classroom-refresh',
  scopeId: 'synthetic-scope',
  requestedAt: now,
  deadlineAt: '2035-04-13T01:01:00.000Z',
} as const;

class MemoryCache implements ClassroomEnrichmentCache {
  async load() {
    return undefined;
  }
  async storeSuccess() {
    return { status: 'stored' as const, revision: 'synthetic-success' };
  }
  async recordFailure() {
    return { status: 'stored' as const, revision: 'synthetic-failure' };
  }
}

test('Classroom job returns a redacted success with zero mutation counts', async () => {
  const handler = createClassroomRefreshJobHandler({
    ...policy(),
    source: {
      async readEnrichment(input) {
        return {
          status: 'observed' as const,
          observation: {
            contractVersion,
            observationId: 'synthetic-observation',
            observedForDate: input.date,
            classId: input.classId,
            value: enrichment(),
            provenance: {
              source: 'google-classroom' as const,
              method: 'api-read' as const,
              observedAt: now,
              verification: 'verified' as const,
              sourceReference: 'google-classroom:class-a',
            },
            freshness: { state: 'fresh' as const, observedAt: now },
            verification: 'verified' as const,
            diagnostics: [],
          },
        };
      },
    },
  });
  const result = await handler(request, new AbortController().signal);
  assert.equal(result.category, 'succeeded');
  assert.equal(result.attemptedExternalMutations, 0);
  assert.equal(result.completedExternalMutations, 0);
  assert.equal(JSON.stringify(result).includes('class-a'), false);
});

test('Classroom job isolates partial failure and sanitizes unknown error codes', async () => {
  const handler = createClassroomRefreshJobHandler({
    ...policy(),
    mappings: [
      { classId, providerCourseKey: '101' },
      { classId: 'class-b' as ClassId, providerCourseKey: '102' },
    ],
    source: {
      async readEnrichment(input) {
        if (input.classId === classId)
          return {
            status: 'observed' as const,
            observation: {
              contractVersion,
              observationId: 'synthetic-observation',
              observedForDate: input.date,
              classId: input.classId,
              value: enrichment(),
              provenance: {
                source: 'google-classroom' as const,
                method: 'api-read' as const,
                observedAt: now,
                verification: 'verified' as const,
                sourceReference: 'google-classroom:class-a',
              },
              freshness: { state: 'fresh' as const, observedAt: now },
              verification: 'verified' as const,
              diagnostics: [],
            },
          };
        return {
          status: 'failed' as const,
          error: {
            category: 'unavailable' as const,
            code: 'private-provider-detail',
            message: 'must not escape',
            retryable: true,
            diagnostics: [],
          },
        };
      },
    },
  });
  const result = await handler(request, new AbortController().signal);
  assert.equal(result.category, 'degraded');
  assert.equal(
    JSON.stringify(result).includes('private-provider-detail'),
    false,
  );
  assert.equal(JSON.stringify(result).includes('must not escape'), false);
  if (result.category === 'degraded')
    assert.equal(result.errors[0]?.code, 'classroom-read-unavailable');
});

test('Classroom authentication failure becomes repair-required without mutations', async () => {
  const handler = createClassroomRefreshJobHandler({
    ...policy(),
    source: {
      async readEnrichment() {
        return {
          status: 'failed' as const,
          error: {
            category: 'authentication-repair-required' as const,
            code: 'classroom-authentication-required',
            message: 'Sanitized failure.',
            retryable: false,
            diagnostics: [],
          },
        };
      },
    },
  });
  const result = await handler(request, new AbortController().signal);
  assert.equal(result.category, 'repair-required');
  assert.equal(result.attemptedExternalMutations, 0);
  assert.equal(result.completedExternalMutations, 0);
});

test('Classroom job aborts an in-flight read without writing cache state', async () => {
  let writes = 0;
  const controller = new AbortController();
  const handler = createClassroomRefreshJobHandler({
    ...policy(),
    cache: {
      async load() {
        return undefined;
      },
      async storeSuccess() {
        writes += 1;
        return { status: 'stored' as const, revision: 'unexpected-success' };
      },
      async recordFailure() {
        writes += 1;
        return { status: 'stored' as const, revision: 'unexpected-failure' };
      },
    },
    source: {
      async readEnrichment(input) {
        return await new Promise<never>((_, reject) => {
          input.signal?.addEventListener(
            'abort',
            () => reject(new Error('synthetic-abort')),
            { once: true },
          );
        });
      },
    },
  });
  const pending = handler(request, controller.signal);
  await new Promise<void>((resolve) => setImmediate(resolve));
  controller.abort('synthetic-job-deadline');
  const result = await pending;
  assert.equal(result.category, 'failed');
  if (result.category === 'failed')
    assert.equal(result.error.code, 'classroom-refresh-aborted');
  assert.equal(writes, 0);
});

function policy() {
  return {
    mappings: [{ classId, providerCourseKey: '101' }],
    cache: new MemoryCache(),
    timeZone: 'Asia/Ho_Chi_Minh',
    cacheFreshSeconds: 900,
    backoffBaseSeconds: 60,
    backoffMaximumSeconds: 3_600,
    maximumParallelCourses: 2,
  } as const;
}

function enrichment(): CourseworkEnrichment {
  return {
    observedForDate: date,
    classId,
    freshness: 'fresh',
    recent: [],
    upcoming: [],
    refreshedAt: now,
    provenanceReference: 'google-classroom:class-a',
  };
}
