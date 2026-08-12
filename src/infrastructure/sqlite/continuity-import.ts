import { createHash } from 'node:crypto';

import type {
  ContinuityImportBatch,
  ContinuityImportCollection,
  ContinuityImportRejection,
  ContinuityImportResult,
  ContinuityImportValue,
} from '../../application/persistence/continuity-importer.js';
import { isContinuityImportRecord } from '../../application/persistence/continuity-importer.js';
import type { Clock } from '../../domain/determinism.js';
import { stableSerialize } from '../../domain/pure-values.js';
import { isIsoInstant } from '../../domain/runtime-validation.js';
import type { SqliteDatabase } from './database.js';

export interface ContinuityImportApplyOptions {
  readonly database: SqliteDatabase;
  readonly plan: ContinuityImportResult;
  /** Opaque provenance label only; paths and free-form source content are rejected. */
  readonly sourceReference: string;
  readonly clock: Clock;
  readonly nextImportId: () => string;
  readonly beforeCommit?: () => void;
}

export interface ContinuityImportApplyResult {
  readonly status: 'imported' | 'unchanged' | 'rejected';
  readonly importId: string;
  readonly semanticHash: string;
  readonly acceptedCount: number;
  readonly insertedCount: number;
  readonly unchangedCount: number;
  readonly rejectedCount: number;
  readonly rejections: readonly ContinuityImportRejection[];
}

export class ContinuityImportApplyError extends Error {
  constructor(
    readonly code:
      | 'unsafe-source-reference'
      | 'invalid-clock'
      | 'invalid-import-id'
      | 'storage-failed',
  ) {
    super(`Continuity import failed safely: ${code}`);
    this.name = 'ContinuityImportApplyError';
  }
}

interface ImportRunRow {
  readonly import_id: string;
  readonly status: 'imported' | 'unchanged' | 'rejected';
  readonly accepted_count: number;
  readonly rejected_count: number;
}

interface ContinuityRecordRow {
  readonly checksum: string;
  readonly record_json: string;
}

interface RejectionRow {
  readonly category: ContinuityImportRejection['category'];
  readonly code: string;
  readonly field_path: string;
}

const safeReference = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const unsafeReferenceContent =
  /(?:oauth|token|secret|password|credential|cookie|browser.?profile|raw.?capture|student|(?:^|[.:_-])path(?:$|[.:_-])|(?:^|[.:_-])logs?(?:$|[.:_-]))/iu;

function isSafeReference(value: string): boolean {
  return safeReference.test(value) && !unsafeReferenceContent.test(value);
}

function semanticHash(plan: ContinuityImportResult): string {
  if (plan.status === 'accepted') return `accepted:${plan.batch.batchId}`;
  return `rejected:${createHash('sha256')
    .update(stableSerialize(plan.rejections))
    .digest('hex')}`;
}

function rejectionRows(
  database: SqliteDatabase,
  importId: string,
): readonly ContinuityImportRejection[] {
  return (
    database.connection
      .prepare(
        `SELECT category, code, field_path
           FROM import_rejections
          WHERE import_id = ?
          ORDER BY ordinal`,
      )
      .all(importId) as unknown as readonly RejectionRow[]
  ).map((row) => ({
    category: row.category,
    code: row.code,
    path: row.field_path,
  }));
}

function resultForExisting(
  database: SqliteDatabase,
  row: ImportRunRow,
  plan: ContinuityImportResult,
  hash: string,
): ContinuityImportApplyResult {
  if (row.status === 'rejected') {
    const rejections = rejectionRows(database, row.import_id);
    return {
      status: 'rejected',
      importId: row.import_id,
      semanticHash: hash,
      acceptedCount: row.accepted_count,
      insertedCount: 0,
      unchangedCount: 0,
      rejectedCount: row.rejected_count,
      rejections,
    };
  }
  if (plan.status === 'accepted') {
    const conflicts = conflictsForBatch(database, plan.batch);
    if (conflicts.length > 0)
      return {
        status: 'rejected',
        importId: row.import_id,
        semanticHash: hash,
        acceptedCount: 0,
        insertedCount: 0,
        unchangedCount: 0,
        rejectedCount: conflicts.length,
        rejections: conflicts,
      };
  }
  return {
    status: 'unchanged',
    importId: row.import_id,
    semanticHash: hash,
    acceptedCount: row.accepted_count,
    insertedCount: 0,
    unchangedCount:
      plan.status === 'accepted' ? plan.batch.operations.length : 0,
    rejectedCount: 0,
    rejections: [],
  };
}

function existingRun(
  database: SqliteDatabase,
  sourceReference: string,
  hash: string,
): ImportRunRow | undefined {
  return database.connection
    .prepare(
      `SELECT import_id, status, accepted_count, rejected_count
         FROM import_runs
        WHERE source_reference = ? AND semantic_hash = ?`,
    )
    .get(sourceReference, hash) as unknown as ImportRunRow | undefined;
}

function insertRun(options: {
  readonly database: SqliteDatabase;
  readonly importId: string;
  readonly sourceReference: string;
  readonly hash: string;
  readonly status: ContinuityImportApplyResult['status'];
  readonly acceptedCount: number;
  readonly rejectedCount: number;
  readonly now: string;
}): void {
  options.database.connection
    .prepare(
      `INSERT INTO import_runs(
         import_id, source_reference, semantic_hash, status, accepted_count,
         rejected_count, started_at, finished_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      options.importId,
      options.sourceReference,
      options.hash,
      options.status,
      options.acceptedCount,
      options.rejectedCount,
      options.now,
      options.now,
    );
}

function insertRejections(
  database: SqliteDatabase,
  importId: string,
  rejections: readonly ContinuityImportRejection[],
): void {
  const insert = database.connection.prepare(
    `INSERT INTO import_rejections(
       import_id, ordinal, category, code, field_path
     ) VALUES (?, ?, ?, ?, ?)`,
  );
  rejections.forEach((rejection, ordinal) =>
    insert.run(
      importId,
      ordinal,
      rejection.category,
      rejection.code,
      rejection.path,
    ),
  );
}

// This must remain byte-for-byte equivalent to the planner's checksum encoding.
function canonicalJson(value: ContinuityImportValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${canonicalJson(
          (value as Record<string, ContinuityImportValue>)[key] ?? null,
        )}`,
    )
    .join(',')}}`;
}

function checksumStoredRecord(
  collection: ContinuityImportCollection,
  identity: string,
  recordJson: string,
): string | undefined {
  try {
    const record: unknown = JSON.parse(recordJson);
    if (!isContinuityImportRecord(collection, identity, record))
      return undefined;
    return createHash('sha256').update(canonicalJson(record)).digest('hex');
  } catch {
    return undefined;
  }
}

function conflictsForBatch(
  database: SqliteDatabase,
  batch: ContinuityImportBatch,
): readonly ContinuityImportRejection[] {
  const select = database.connection.prepare(
    `SELECT checksum, record_json FROM continuity_records
      WHERE collection = ? AND identity = ?`,
  );
  return batch.operations.flatMap((operation, index) => {
    const row = select.get(
      operation.collection,
      operation.identity,
    ) as unknown as ContinuityRecordRow | undefined;
    if (row === undefined) return [];
    const actualChecksum = checksumStoredRecord(
      operation.collection,
      operation.identity,
      row.record_json,
    );
    if (actualChecksum === undefined || actualChecksum !== row.checksum)
      return [
        {
          category: 'corrupt-record' as const,
          code: 'existing-record-corrupt',
          path: `$.operations[${index}]`,
        },
      ];
    if (row.checksum !== operation.checksum)
      return [
        {
          category: 'corrupt-record' as const,
          code: 'existing-record-conflict',
          path: `$.operations[${index}]`,
        },
      ];
    return [];
  });
}

function insertBatch(
  database: SqliteDatabase,
  batch: ContinuityImportBatch,
  sourceReference: string,
  importedAt: string,
): { readonly inserted: number; readonly unchanged: number } {
  const select = database.connection.prepare(
    `SELECT checksum FROM continuity_records
      WHERE collection = ? AND identity = ?`,
  );
  const insert = database.connection.prepare(
    `INSERT INTO continuity_records(
       collection, identity, checksum, record_json, source_reference, imported_at
     ) VALUES (?, ?, ?, ?, ?, ?)`,
  );
  let inserted = 0;
  let unchanged = 0;
  for (const operation of batch.operations) {
    const row = select.get(
      operation.collection,
      operation.identity,
    ) as unknown as ContinuityRecordRow | undefined;
    if (row !== undefined) {
      unchanged += 1;
      continue;
    }
    insert.run(
      operation.collection,
      operation.identity,
      operation.checksum,
      canonicalJson(operation.record),
      sourceReference,
      importedAt,
    );
    inserted += 1;
  }
  return { inserted, unchanged };
}

function applyContinuityImportUnchecked(
  options: ContinuityImportApplyOptions,
): ContinuityImportApplyResult {
  if (!isSafeReference(options.sourceReference))
    throw new ContinuityImportApplyError('unsafe-source-reference');
  const hash = semanticHash(options.plan);
  const prior = existingRun(options.database, options.sourceReference, hash);
  if (prior !== undefined)
    return resultForExisting(options.database, prior, options.plan, hash);

  const now = options.clock.now();
  if (!isIsoInstant(now)) throw new ContinuityImportApplyError('invalid-clock');
  const importId = options.nextImportId();
  if (!isSafeReference(importId))
    throw new ContinuityImportApplyError('invalid-import-id');

  try {
    return options.database.transaction(() => {
      // Recheck within the write transaction so idempotency survives contention.
      const concurrent = existingRun(
        options.database,
        options.sourceReference,
        hash,
      );
      if (concurrent !== undefined)
        return resultForExisting(
          options.database,
          concurrent,
          options.plan,
          hash,
        );

      if (options.plan.status === 'rejected') {
        insertRun({
          database: options.database,
          importId,
          sourceReference: options.sourceReference,
          hash,
          status: 'rejected',
          acceptedCount: 0,
          rejectedCount: options.plan.rejections.length,
          now,
        });
        insertRejections(options.database, importId, options.plan.rejections);
        options.beforeCommit?.();
        return {
          status: 'rejected',
          importId,
          semanticHash: hash,
          acceptedCount: 0,
          insertedCount: 0,
          unchangedCount: 0,
          rejectedCount: options.plan.rejections.length,
          rejections: options.plan.rejections,
        };
      }

      const conflicts = conflictsForBatch(options.database, options.plan.batch);
      if (conflicts.length > 0) {
        insertRun({
          database: options.database,
          importId,
          sourceReference: options.sourceReference,
          hash,
          status: 'rejected',
          acceptedCount: 0,
          rejectedCount: conflicts.length,
          now,
        });
        insertRejections(options.database, importId, conflicts);
        options.beforeCommit?.();
        return {
          status: 'rejected',
          importId,
          semanticHash: hash,
          acceptedCount: 0,
          insertedCount: 0,
          unchangedCount: 0,
          rejectedCount: conflicts.length,
          rejections: conflicts,
        };
      }

      const changes = insertBatch(
        options.database,
        options.plan.batch,
        options.sourceReference,
        now,
      );
      const status = changes.inserted > 0 ? 'imported' : 'unchanged';
      insertRun({
        database: options.database,
        importId,
        sourceReference: options.sourceReference,
        hash,
        status,
        acceptedCount: options.plan.batch.operations.length,
        rejectedCount: 0,
        now,
      });
      options.beforeCommit?.();
      return {
        status,
        importId,
        semanticHash: hash,
        acceptedCount: options.plan.batch.operations.length,
        insertedCount: changes.inserted,
        unchangedCount: changes.unchanged,
        rejectedCount: 0,
        rejections: [],
      };
    });
  } catch (error) {
    if (error instanceof ContinuityImportApplyError) throw error;
    throw new ContinuityImportApplyError('storage-failed');
  }
}

/**
 * Applies one already validated continuity plan atomically. Rejected plans
 * retain only their redacted structural report; input values never reach SQL.
 */
export function applyContinuityImport(
  options: ContinuityImportApplyOptions,
): ContinuityImportApplyResult {
  try {
    return applyContinuityImportUnchecked(options);
  } catch (error) {
    if (error instanceof ContinuityImportApplyError) throw error;
    throw new ContinuityImportApplyError('storage-failed');
  }
}
