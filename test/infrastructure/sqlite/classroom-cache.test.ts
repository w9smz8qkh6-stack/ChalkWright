import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';

import type { IsoDate, IsoInstant } from '../../../src/contracts/v1/common.js';
import type { CourseworkEnrichment } from '../../../src/domain/coursework.js';
import type { ClassId } from '../../../src/domain/identities.js';
import { SqliteClassroomEnrichmentCache } from '../../../src/infrastructure/sqlite/classroom-cache.js';
import { SqliteDatabase } from '../../../src/infrastructure/sqlite/database.js';

const temporaryRoots: string[] = [];
const date = '2035-04-13' as IsoDate;
const refreshedAt = '2035-04-13T01:00:00.000Z' as IsoInstant;
const expiresAt = '2035-04-13T02:00:00.000Z' as IsoInstant;
const classId = 'class-a' as ClassId;

afterEach(() => {
  for (const root of temporaryRoots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

test('normalized Classroom cache marks freshness at read time and preserves last-known-good on failure', async () => {
  const root = temporaryRoot();
  using database = new SqliteDatabase(join(root, 'state.sqlite'), {
    migration: { appliedAt: refreshedAt },
  });
  const cache = new SqliteClassroomEnrichmentCache(database);
  const enrichment = sampleEnrichment();

  assert.equal(
    (await cache.storeSuccess({ enrichment, expiresAt })).status,
    'stored',
  );
  assert.equal(
    (await cache.load(classId, date, refreshedAt))?.enrichment?.freshness,
    'fresh',
  );
  assert.equal(
    (await cache.load(classId, date, '2035-04-13T02:00:00.001Z' as IsoInstant))
      ?.enrichment?.freshness,
    'stale',
  );

  assert.equal(
    (
      await cache.recordFailure({
        classId,
        observedForDate: date,
        attemptedAt: '2035-04-13T02:01:00.000Z' as IsoInstant,
        nextAttemptAt: '2035-04-13T02:02:00.000Z' as IsoInstant,
        errorCode: 'classroom-rate-limited',
      })
    ).status,
    'stored',
  );
  const afterFailure = await cache.load(
    classId,
    date,
    '2035-04-13T02:01:00.000Z' as IsoInstant,
  );
  assert.equal(afterFailure?.consecutiveFailures, 1);
  assert.equal(afterFailure?.lastErrorCode, 'classroom-rate-limited');
  assert.equal(afterFailure?.enrichment?.recent[0]?.title, 'Synthetic task');

  const nextSuccess = {
    ...enrichment,
    refreshedAt: '2035-04-13T02:03:00.000Z' as IsoInstant,
  };
  assert.equal(
    (
      await cache.storeSuccess({
        enrichment: nextSuccess,
        expiresAt: '2035-04-13T03:03:00.000Z' as IsoInstant,
      })
    ).status,
    'stored',
  );
  const recovered = await cache.load(
    classId,
    date,
    '2035-04-13T02:03:00.000Z' as IsoInstant,
  );
  assert.equal(recovered?.consecutiveFailures, 0);
  assert.equal(recovered?.lastErrorCode, undefined);
  assert.equal(recovered?.nextAttemptAt, undefined);
});

test('cache rejects unsafe normalized data and detects semantic corruption', async () => {
  const root = temporaryRoot();
  using database = new SqliteDatabase(join(root, 'state.sqlite'), {
    migration: { appliedAt: refreshedAt },
  });
  const cache = new SqliteClassroomEnrichmentCache(database);
  const hostile = new Proxy(
    {},
    {
      getPrototypeOf() {
        throw new Error('private-proxy-detail');
      },
    },
  ) as CourseworkEnrichment;
  assert.equal(
    (await cache.storeSuccess({ enrichment: hostile, expiresAt })).status,
    'rejected',
  );
  const unsafe = {
    ...sampleEnrichment(),
    recent: [
      {
        ...sampleEnrichment().recent[0]!,
        alternateLink: 'file:///private/provider-data',
      },
    ],
  };
  assert.equal(
    (await cache.storeSuccess({ enrichment: unsafe, expiresAt })).status,
    'rejected',
  );

  assert.equal(
    (
      await cache.storeSuccess({
        enrichment: sampleEnrichment(),
        expiresAt,
      })
    ).status,
    'stored',
  );
  database.connection
    .prepare(
      `UPDATE classroom_enrichment_cache
          SET semantic_hash = ?
        WHERE class_id = ? AND observed_for_date = ?`,
    )
    .run('0'.repeat(64), classId, date);
  await assert.rejects(
    cache.load(classId, date, refreshedAt),
    /classroom-cache-row-invalid/,
  );
});

function sampleEnrichment(): CourseworkEnrichment {
  return {
    observedForDate: date,
    classId,
    freshness: 'fresh',
    recent: [
      {
        itemId: 'coursework-item-a',
        providerCourseKey: '101',
        providerItemKey: 'item-a',
        classId,
        title: 'Synthetic task',
        description: 'Synthetic description.',
        materials: [
          { title: 'Synthetic material', url: 'https://example.test/item' },
        ],
        workType: 'ASSIGNMENT',
        state: 'PUBLISHED',
        assignedCount: 0,
        submittedCount: 0,
        updateTime: refreshedAt,
        dueDate: date,
        dueLabel: 'Fri, April 13',
        alternateLink: 'https://classroom.google.com/c/synthetic/a/synthetic',
        bucket: 'recent',
      },
    ],
    upcoming: [],
    refreshedAt,
    provenanceReference: 'google-classroom:class-a',
  };
}

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'classroom-hub-m08-cache-'));
  temporaryRoots.push(root);
  return root;
}
