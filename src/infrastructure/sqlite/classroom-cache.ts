import { createHash } from 'node:crypto';

import type { IsoDate, IsoInstant } from '../../contracts/v1/common.js';
import type {
  CourseworkEnrichment,
  NormalizedCourseworkItem,
  NormalizedCourseworkMaterial,
} from '../../domain/coursework.js';
import type { ClassId } from '../../domain/identities.js';
import { stableSerialize } from '../../domain/pure-values.js';
import { isIsoDate, isIsoInstant } from '../../domain/runtime-validation.js';
import type {
  ClassroomCacheEntry,
  ClassroomEnrichmentCache,
} from '../../ports/classroom-cache.js';
import type { PersistenceWriteResult } from '../../ports/persistence-write.js';
import type { SqliteDatabase } from './database.js';

interface CacheRow {
  readonly class_id: string;
  readonly observed_for_date: string;
  readonly payload_json: string | null;
  readonly semantic_hash: string | null;
  readonly refreshed_at: string | null;
  readonly expires_at: string | null;
  readonly consecutive_failures: number;
  readonly last_attempt_at: string;
  readonly next_attempt_at: string | null;
  readonly last_error_code: string | null;
}

export class SqliteClassroomEnrichmentCache implements ClassroomEnrichmentCache {
  constructor(private readonly database: SqliteDatabase) {}

  async load(
    classId: ClassId,
    date: IsoDate,
    observedAt: IsoInstant,
  ): Promise<ClassroomCacheEntry | undefined> {
    if (!boundedId(classId) || !isIsoDate(date) || !isIsoInstant(observedAt))
      throw new Error('classroom-cache-query-invalid');
    const row = this.database.connection
      .prepare(
        `SELECT class_id, observed_for_date, payload_json, semantic_hash,
                refreshed_at, expires_at, consecutive_failures,
                last_attempt_at, next_attempt_at, last_error_code
           FROM classroom_enrichment_cache
          WHERE class_id = ? AND observed_for_date = ?`,
      )
      .get(classId, date) as unknown as CacheRow | undefined;
    if (row === undefined) return undefined;
    const entry = parseRow(row, classId, date);
    if (entry.enrichment === undefined || entry.expiresAt === undefined)
      return entry;
    return {
      ...entry,
      enrichment: {
        ...entry.enrichment,
        freshness:
          Date.parse(observedAt) <= Date.parse(entry.expiresAt)
            ? 'fresh'
            : 'stale',
      },
    };
  }

  async storeSuccess(options: {
    readonly enrichment: CourseworkEnrichment;
    readonly expiresAt: IsoInstant;
  }): Promise<PersistenceWriteResult> {
    try {
      const enrichment = options.enrichment;
      if (
        !isCourseworkEnrichment(enrichment) ||
        enrichment.freshness !== 'fresh' ||
        !isIsoInstant(options.expiresAt) ||
        Date.parse(options.expiresAt) < Date.parse(enrichment.refreshedAt)
      )
        return rejected('classroom-cache-success-invalid');
      const payload = stableSerialize(enrichment);
      if (Buffer.byteLength(payload, 'utf8') > 1_000_000)
        return rejected('classroom-cache-payload-too-large');
      const semanticHash = hash(payload);
      const current = this.database.connection
        .prepare(
          `SELECT class_id, observed_for_date, payload_json, semantic_hash,
                  refreshed_at, expires_at, consecutive_failures,
                  last_attempt_at, next_attempt_at, last_error_code
             FROM classroom_enrichment_cache
            WHERE class_id = ? AND observed_for_date = ?`,
        )
        .get(enrichment.classId, enrichment.observedForDate) as unknown as
        CacheRow | undefined;
      if (current !== undefined)
        parseRow(current, enrichment.classId, enrichment.observedForDate);
      if (
        current?.semantic_hash === semanticHash &&
        current.expires_at === options.expiresAt &&
        current.consecutive_failures === 0
      )
        return {
          status: 'unchanged',
          revision: `classroom:${semanticHash.slice(0, 24)}`,
        };
      this.database.connection
        .prepare(
          `INSERT INTO classroom_enrichment_cache(
             class_id, observed_for_date, payload_json, semantic_hash,
             refreshed_at, expires_at, consecutive_failures, last_attempt_at,
             next_attempt_at, last_error_code
           ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, NULL, NULL)
           ON CONFLICT(class_id, observed_for_date) DO UPDATE SET
             payload_json = excluded.payload_json,
             semantic_hash = excluded.semantic_hash,
             refreshed_at = excluded.refreshed_at,
             expires_at = excluded.expires_at,
             consecutive_failures = 0,
             last_attempt_at = excluded.last_attempt_at,
             next_attempt_at = NULL,
             last_error_code = NULL`,
        )
        .run(
          enrichment.classId,
          enrichment.observedForDate,
          payload,
          semanticHash,
          enrichment.refreshedAt,
          options.expiresAt,
          enrichment.refreshedAt,
        );
      return {
        status: 'stored',
        revision: `classroom:${semanticHash.slice(0, 24)}`,
      };
    } catch {
      return rejected('classroom-cache-storage-failed');
    }
  }

  async recordFailure(options: {
    readonly classId: ClassId;
    readonly observedForDate: IsoDate;
    readonly attemptedAt: IsoInstant;
    readonly nextAttemptAt: IsoInstant;
    readonly errorCode: string;
  }): Promise<PersistenceWriteResult> {
    if (
      !boundedId(options.classId) ||
      !isIsoDate(options.observedForDate) ||
      !isIsoInstant(options.attemptedAt) ||
      !isIsoInstant(options.nextAttemptAt) ||
      Date.parse(options.nextAttemptAt) <= Date.parse(options.attemptedAt) ||
      !/^[a-z0-9](?:[a-z0-9-]{0,127})$/u.test(options.errorCode)
    )
      return rejected('classroom-cache-failure-invalid');
    try {
      const current = this.database.connection
        .prepare(
          `SELECT class_id, observed_for_date, payload_json, semantic_hash,
                  refreshed_at, expires_at, consecutive_failures,
                  last_attempt_at, next_attempt_at, last_error_code
             FROM classroom_enrichment_cache
            WHERE class_id = ? AND observed_for_date = ?`,
        )
        .get(options.classId, options.observedForDate) as unknown as
        CacheRow | undefined;
      if (current !== undefined)
        parseRow(current, options.classId, options.observedForDate);
      const failureCount = Math.min(
        32,
        (current?.consecutive_failures ?? 0) + 1,
      );
      this.database.connection
        .prepare(
          `INSERT INTO classroom_enrichment_cache(
             class_id, observed_for_date, payload_json, semantic_hash,
             refreshed_at, expires_at, consecutive_failures, last_attempt_at,
             next_attempt_at, last_error_code
           ) VALUES (?, ?, NULL, NULL, NULL, NULL, 1, ?, ?, ?)
           ON CONFLICT(class_id, observed_for_date) DO UPDATE SET
             consecutive_failures = ?,
             last_attempt_at = excluded.last_attempt_at,
             next_attempt_at = excluded.next_attempt_at,
             last_error_code = excluded.last_error_code`,
        )
        .run(
          options.classId,
          options.observedForDate,
          options.attemptedAt,
          options.nextAttemptAt,
          options.errorCode,
          failureCount,
        );
      return {
        status: 'stored',
        revision: `classroom-failure:${failureCount}:${Date.parse(options.attemptedAt)}`,
      };
    } catch {
      return rejected('classroom-cache-storage-failed');
    }
  }
}

function parseRow(
  row: CacheRow,
  expectedClassId: ClassId,
  expectedDate: IsoDate,
): ClassroomCacheEntry {
  if (
    row.class_id !== expectedClassId ||
    row.observed_for_date !== expectedDate ||
    !Number.isSafeInteger(row.consecutive_failures) ||
    row.consecutive_failures < 0 ||
    row.consecutive_failures > 32 ||
    !isIsoInstant(row.last_attempt_at) ||
    (row.next_attempt_at !== null && !isIsoInstant(row.next_attempt_at)) ||
    (row.last_error_code !== null &&
      !/^[a-z0-9](?:[a-z0-9-]{0,127})$/u.test(row.last_error_code)) ||
    (row.payload_json === null) !== (row.semantic_hash === null) ||
    (row.payload_json === null) !== (row.refreshed_at === null) ||
    (row.payload_json === null) !== (row.expires_at === null)
  )
    throw new Error('classroom-cache-row-invalid');
  let enrichment: CourseworkEnrichment | undefined;
  if (row.payload_json !== null) {
    if (
      typeof row.payload_json !== 'string' ||
      Buffer.byteLength(row.payload_json, 'utf8') > 1_000_000
    )
      throw new Error('classroom-cache-row-invalid');
    const value: unknown = JSON.parse(row.payload_json);
    if (
      hash(row.payload_json) !== row.semantic_hash ||
      !isCourseworkEnrichment(value) ||
      value.classId !== expectedClassId ||
      value.observedForDate !== expectedDate ||
      value.refreshedAt !== row.refreshed_at ||
      row.expires_at === null ||
      Date.parse(row.expires_at) < Date.parse(value.refreshedAt)
    )
      throw new Error('classroom-cache-row-invalid');
    enrichment = value;
  }
  return {
    classId: expectedClassId,
    observedForDate: expectedDate,
    ...(enrichment === undefined ? {} : { enrichment }),
    ...(row.refreshed_at === null ? {} : { refreshedAt: row.refreshed_at }),
    ...(row.expires_at === null ? {} : { expiresAt: row.expires_at }),
    consecutiveFailures: row.consecutive_failures,
    lastAttemptAt: row.last_attempt_at,
    ...(row.next_attempt_at === null
      ? {}
      : { nextAttemptAt: row.next_attempt_at }),
    ...(row.last_error_code === null
      ? {}
      : { lastErrorCode: row.last_error_code }),
  };
}

export function isCourseworkEnrichment(
  value: unknown,
): value is CourseworkEnrichment {
  if (!plain(value)) return false;
  const record = value as Record<string, unknown>;
  if (
    !keys(
      record,
      [
        'classId',
        'freshness',
        'observedForDate',
        'recent',
        'refreshedAt',
        'upcoming',
      ],
      ['provenanceReference'],
    ) ||
    !boundedId(record.classId) ||
    !isIsoDate(record.observedForDate) ||
    (record.freshness !== 'fresh' &&
      record.freshness !== 'stale' &&
      record.freshness !== 'unknown') ||
    !isIsoInstant(record.refreshedAt) ||
    (record.provenanceReference !== undefined &&
      !boundedId(record.provenanceReference)) ||
    !Array.isArray(record.recent) ||
    !Array.isArray(record.upcoming) ||
    record.recent.length > 36 ||
    record.upcoming.length > 36
  )
    return false;
  return (
    record.recent.every((item) =>
      courseworkItem(item, record.classId as string, 'recent'),
    ) &&
    record.upcoming.every((item) =>
      courseworkItem(item, record.classId as string, 'upcoming'),
    )
  );
}

function courseworkItem(
  value: unknown,
  classId: string,
  bucket: 'recent' | 'upcoming',
): value is NormalizedCourseworkItem {
  if (!plain(value)) return false;
  const item = value as Record<string, unknown>;
  if (
    !keys(
      item,
      [
        'assignedCount',
        'bucket',
        'classId',
        'description',
        'itemId',
        'materials',
        'providerCourseKey',
        'providerItemKey',
        'state',
        'submittedCount',
        'title',
        'updateTime',
        'workType',
      ],
      ['alternateLink', 'dueAt', 'dueDate', 'dueLabel'],
    ) ||
    item.classId !== classId ||
    item.bucket !== bucket ||
    !boundedId(item.itemId) ||
    !boundedId(item.providerCourseKey) ||
    !boundedId(item.providerItemKey) ||
    typeof item.title !== 'string' ||
    item.title.length < 1 ||
    item.title.length > 3_000 ||
    typeof item.description !== 'string' ||
    item.description.length > 30_000 ||
    typeof item.workType !== 'string' ||
    item.workType.length > 64 ||
    item.state !== 'PUBLISHED' ||
    !Number.isSafeInteger(item.assignedCount) ||
    Number(item.assignedCount) < 0 ||
    !Number.isSafeInteger(item.submittedCount) ||
    Number(item.submittedCount) < 0 ||
    (item.updateTime !== '' && !isIsoInstant(item.updateTime)) ||
    (item.dueDate !== undefined && !isIsoDate(item.dueDate)) ||
    (item.dueAt !== undefined && !isIsoInstant(item.dueAt)) ||
    (item.dueLabel !== undefined && typeof item.dueLabel !== 'string') ||
    (item.alternateLink !== undefined && !safeUrl(item.alternateLink)) ||
    !Array.isArray(item.materials) ||
    item.materials.length > 20 ||
    !item.materials.every(courseworkMaterial)
  )
    return false;
  return true;
}

function courseworkMaterial(
  value: unknown,
): value is NormalizedCourseworkMaterial {
  return (
    plain(value) &&
    keys(value as Record<string, unknown>, ['title'], ['url']) &&
    typeof (value as Record<string, unknown>).title === 'string' &&
    String((value as Record<string, unknown>).title).length <= 1_000 &&
    ((value as Record<string, unknown>).url === undefined ||
      safeUrl((value as Record<string, unknown>).url))
  );
}

function safeUrl(value: unknown): boolean {
  if (typeof value !== 'string' || value.length > 2_048) return false;
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'https:' || url.protocol === 'http:') &&
      url.username === '' &&
      url.password === ''
    );
  } catch {
    return false;
  }
}

function plain(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function keys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    actual.every((key) => required.includes(key) || optional.includes(key))
  );
}

function boundedId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)
  );
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function rejected(code: string): PersistenceWriteResult {
  return {
    status: 'rejected',
    error: {
      category: 'invalid-input',
      code,
      message: 'Classroom cache rejected unsafe state.',
      retryable: false,
      diagnostics: [],
    },
  };
}
