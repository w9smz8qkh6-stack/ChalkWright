import assert from 'node:assert/strict';
import test from 'node:test';

import { refreshGoogleClassroom } from '../../../src/application/classroom/refresh.js';
import {
  contractVersion,
  type IsoDate,
  type IsoInstant,
} from '../../../src/contracts/v1/common.js';
import type { CourseworkEnrichment } from '../../../src/domain/coursework.js';
import type { ClassId } from '../../../src/domain/identities.js';
import type {
  ClassroomCacheEntry,
  ClassroomEnrichmentCache,
} from '../../../src/ports/classroom-cache.js';
import type { EnrichmentObservationSource } from '../../../src/ports/read-sources.js';

const date = '2035-04-13' as IsoDate;
const now = '2035-04-13T01:00:00.000Z' as IsoInstant;
const mappings = ['a', 'b', 'c', 'd'].map((suffix, index) => ({
  classId: `class-${suffix}` as ClassId,
  providerCourseKey: String(100 + index),
}));

class MemoryCache implements ClassroomEnrichmentCache {
  readonly entries = new Map<string, ClassroomCacheEntry>();
  writes = 0;

  async load(
    classId: ClassId,
    observedForDate: IsoDate,
    _observedAt: IsoInstant,
  ) {
    return this.entries.get(`${classId}:${observedForDate}`);
  }

  async storeSuccess(options: {
    readonly enrichment: CourseworkEnrichment;
    readonly expiresAt: IsoInstant;
  }) {
    this.writes += 1;
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
    return { status: 'stored' as const, revision: `success-${this.writes}` };
  }

  async recordFailure(options: {
    readonly classId: ClassId;
    readonly observedForDate: IsoDate;
    readonly attemptedAt: IsoInstant;
    readonly nextAttemptAt: IsoInstant;
    readonly errorCode: string;
  }) {
    this.writes += 1;
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
    return { status: 'stored' as const, revision: `failure-${this.writes}` };
  }
}

test('refresh is ordered, bounded, partial-failure tolerant, and mutation-free', async () => {
  const cache = new MemoryCache();
  let active = 0;
  let maximumActive = 0;
  const source: EnrichmentObservationSource<CourseworkEnrichment> = {
    async readEnrichment(request) {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      active -= 1;
      if (request.classId === 'class-c') {
        return {
          status: 'failed',
          error: {
            category: 'unavailable',
            code: 'classroom-rate-limited',
            message: 'Sanitized failure.',
            retryable: true,
            diagnostics: [],
          },
        };
      }
      const enrichment = emptyEnrichment(request.classId, request.date);
      return {
        status: 'observed',
        observation: {
          contractVersion,
          observationId: `observation-${request.classId}`,
          observedForDate: request.date,
          classId: request.classId,
          value: enrichment,
          provenance: {
            source: 'google-classroom',
            method: 'api-read',
            observedAt: now,
            verification: 'verified',
            sourceReference: `google-classroom:${request.classId}`,
          },
          freshness: { state: 'fresh', observedAt: now },
          verification: 'verified',
          diagnostics: [],
        },
      };
    },
  };
  const result = await refreshGoogleClassroom({
    date,
    mappings,
    source,
    cache,
    refreshedAt: now,
    cacheFreshSeconds: 900,
    backoffBaseSeconds: 60,
    backoffMaximumSeconds: 3_600,
    maximumParallelCourses: 2,
  });
  assert.equal(maximumActive, 2);
  assert.deepEqual(
    result.results.map((entry) => [entry.classId, entry.status]),
    [
      ['class-a', 'refreshed'],
      ['class-b', 'refreshed'],
      ['class-c', 'failed'],
      ['class-d', 'refreshed'],
    ],
  );
  assert.equal(result.attemptedReads, 4);
  assert.equal(result.cacheWrites, 4);
  assert.equal(result.attemptedExternalMutations, 0);
  assert.equal(result.completedExternalMutations, 0);
  assert.equal(
    cache.entries.get(`class-c:${date}`)?.nextAttemptAt,
    '2035-04-13T01:01:00.000Z',
  );
});

test('active backoff skips provider access and preserves last-known-good cache', async () => {
  const cache = new MemoryCache();
  const enrichment = emptyEnrichment(mappings[0]!.classId, date);
  cache.entries.set(`${mappings[0]!.classId}:${date}`, {
    classId: mappings[0]!.classId,
    observedForDate: date,
    enrichment,
    refreshedAt: now,
    expiresAt: '2035-04-13T02:00:00.000Z',
    consecutiveFailures: 2,
    lastAttemptAt: now,
    nextAttemptAt: '2035-04-13T01:02:00.000Z',
    lastErrorCode: 'classroom-rate-limited',
  });
  let reads = 0;
  const result = await refreshGoogleClassroom({
    date,
    mappings: [mappings[0]!],
    source: {
      async readEnrichment() {
        reads += 1;
        throw new Error('must-not-run');
      },
    },
    cache,
    refreshedAt: '2035-04-13T01:01:00.000Z',
    cacheFreshSeconds: 900,
    backoffBaseSeconds: 60,
    backoffMaximumSeconds: 3_600,
    maximumParallelCourses: 1,
  });
  assert.equal(reads, 0);
  assert.deepEqual(result.results, [
    { classId: 'class-a', status: 'skipped', code: 'backoff-active' },
  ]);
  assert.equal(cache.entries.get(`class-a:${date}`)?.enrichment, enrichment);
});

test('cache exceptions remain per-course and untrusted source codes are sanitized before persistence', async () => {
  class SelectiveCache extends MemoryCache {
    recordedCode = '';

    override async storeSuccess(options: {
      readonly enrichment: CourseworkEnrichment;
      readonly expiresAt: IsoInstant;
    }) {
      if (options.enrichment.classId === mappings[0]!.classId)
        throw new Error('private-cache-detail');
      return super.storeSuccess(options);
    }

    override async recordFailure(options: {
      readonly classId: ClassId;
      readonly observedForDate: IsoDate;
      readonly attemptedAt: IsoInstant;
      readonly nextAttemptAt: IsoInstant;
      readonly errorCode: string;
    }) {
      this.recordedCode = options.errorCode;
      return super.recordFailure(options);
    }
  }

  const cache = new SelectiveCache();
  const result = await refreshGoogleClassroom({
    date,
    mappings: mappings.slice(0, 3),
    source: {
      async readEnrichment(request) {
        if (request.classId === mappings[2]!.classId)
          return {
            status: 'failed' as const,
            error: {
              category: 'unavailable' as const,
              code: 'private-provider-detail',
              message: 'must-not-be-retained',
              retryable: true,
              diagnostics: [],
            },
          };
        return {
          status: 'observed' as const,
          observation: {
            contractVersion,
            observationId: `observation-${request.classId}`,
            observedForDate: request.date,
            classId: request.classId,
            value: emptyEnrichment(request.classId, request.date),
            provenance: {
              source: 'google-classroom' as const,
              method: 'api-read' as const,
              observedAt: now,
              verification: 'verified' as const,
              sourceReference: `google-classroom:${request.classId}`,
            },
            freshness: { state: 'fresh' as const, observedAt: now },
            verification: 'verified' as const,
            diagnostics: [],
          },
        };
      },
    },
    cache,
    refreshedAt: now,
    cacheFreshSeconds: 900,
    backoffBaseSeconds: 60,
    backoffMaximumSeconds: 3_600,
    maximumParallelCourses: 2,
  });
  assert.deepEqual(
    result.results.map((entry) => [
      entry.classId,
      entry.status,
      entry.status === 'refreshed' ? undefined : entry.code,
    ]),
    [
      ['class-a', 'failed', 'classroom-cache-write-failed'],
      ['class-b', 'refreshed', undefined],
      ['class-c', 'failed', 'classroom-read-unavailable'],
    ],
  );
  assert.equal(cache.recordedCode, 'classroom-read-unavailable');
  assert.equal(JSON.stringify(result).includes('private'), false);
});

test('caller abort reaches a stalled read and prevents post-abort cache writes', async () => {
  const cache = new MemoryCache();
  const controller = new AbortController();
  let receivedSignal: AbortSignal | undefined;
  const pending = refreshGoogleClassroom({
    date,
    mappings: [mappings[0]!],
    source: {
      async readEnrichment(request) {
        receivedSignal = request.signal;
        return await new Promise<never>((_, reject) => {
          request.signal?.addEventListener(
            'abort',
            () => reject(new Error('synthetic-abort')),
            { once: true },
          );
        });
      },
    },
    cache,
    refreshedAt: now,
    cacheFreshSeconds: 900,
    backoffBaseSeconds: 60,
    backoffMaximumSeconds: 3_600,
    maximumParallelCourses: 1,
    signal: controller.signal,
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  controller.abort('synthetic-job-deadline');
  const result = await pending;
  assert.equal(receivedSignal, controller.signal);
  assert.deepEqual(result.results, [
    { classId: 'class-a', status: 'skipped', code: 'batch-aborted' },
  ]);
  assert.equal(result.cacheWrites, 0);
  assert.equal(cache.writes, 0);
});

function emptyEnrichment(
  classId: ClassId,
  observedForDate: IsoDate,
): CourseworkEnrichment {
  return {
    observedForDate,
    classId,
    freshness: 'fresh',
    recent: [],
    upcoming: [],
    refreshedAt: now,
    provenanceReference: `google-classroom:${classId}`,
  };
}
