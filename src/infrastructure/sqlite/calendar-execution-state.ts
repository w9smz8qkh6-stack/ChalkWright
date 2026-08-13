import type {
  CalendarExecutionJournalRecord,
  CalendarExecutionStatePort,
  CalendarExecutionStepRecord,
  CalendarWriterLease,
  CalendarWriterLeaseAcquisition,
} from '../../ports/calendar-execution-state.js';
import { epoch } from '../../domain/pure-values.js';
import { isIsoInstant } from '../../domain/runtime-validation.js';
import type { SqliteDatabase } from './database.js';

interface LeaseRow {
  readonly scope_id: string;
  readonly lease_id: string;
  readonly owner_id: string;
  readonly acquired_at: string;
  readonly expires_at: string;
}

interface ExecutionRow {
  readonly execution_fingerprint: string;
  readonly manifest_fingerprint: string;
  readonly scope_id: string;
  readonly status: string;
  readonly started_at: string;
  readonly finished_at: string | null;
}

interface StepRow {
  readonly intent_id: string;
  readonly intent_kind: string;
  readonly status: string;
  readonly outcome: string | null;
  readonly provider_reference_hash: string | null;
  readonly error_code: string | null;
}

const sha256Pattern = /^sha256:[a-f0-9]{64}$/u;
const intentKinds = new Set(['no-op', 'create', 'replace', 'delete']);
const stepStatuses = new Set(['pending', 'attempted', 'succeeded', 'failed']);
const outcomes = new Set(['no-op', 'mutated', 'already-converged', 'refused']);

/** SQLite-backed M-14 lease and sanitized execution journal. */
export class SqliteCalendarExecutionState implements CalendarExecutionStatePort {
  constructor(private readonly database: SqliteDatabase) {}

  async acquireLease(request: {
    readonly scopeId: string;
    readonly leaseId: string;
    readonly ownerId: string;
    readonly now: string;
    readonly expiresAt: string;
  }): Promise<CalendarWriterLeaseAcquisition> {
    if (!validLeaseRequest(request)) throw stateError();
    return this.database.transaction(() => {
      this.database.connection
        .prepare(
          `DELETE FROM calendar_writer_leases
           WHERE scope_id = ? AND expires_at <= ?`,
        )
        .run(request.scopeId, request.now);
      const existing = this.database.connection
        .prepare(
          `SELECT scope_id, lease_id, owner_id, acquired_at, expires_at
           FROM calendar_writer_leases WHERE scope_id = ?`,
        )
        .get(request.scopeId) as unknown as LeaseRow | undefined;
      if (existing !== undefined) {
        const lease = leaseFromRow(existing);
        if (
          lease.leaseId !== request.leaseId ||
          lease.ownerId !== request.ownerId
        )
          return { status: 'conflict' };
        return { status: 'acquired', lease };
      }
      this.database.connection
        .prepare(
          `INSERT INTO calendar_writer_leases(
             scope_id, lease_id, owner_id, acquired_at, expires_at
           ) VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          request.scopeId,
          request.leaseId,
          request.ownerId,
          request.now,
          request.expiresAt,
        );
      return {
        status: 'acquired',
        lease: {
          scopeId: request.scopeId,
          leaseId: request.leaseId,
          ownerId: request.ownerId,
          acquiredAt: request.now,
          expiresAt: request.expiresAt,
        },
      };
    });
  }

  async releaseLease(request: {
    readonly scopeId: string;
    readonly leaseId: string;
    readonly ownerId: string;
  }): Promise<void> {
    if (
      !boundedId(request.scopeId) ||
      !boundedId(request.leaseId) ||
      !boundedId(request.ownerId)
    )
      throw stateError();
    this.database.connection
      .prepare(
        `DELETE FROM calendar_writer_leases
         WHERE scope_id = ? AND lease_id = ? AND owner_id = ?`,
      )
      .run(request.scopeId, request.leaseId, request.ownerId);
  }

  async loadExecution(
    executionFingerprint: string,
  ): Promise<CalendarExecutionJournalRecord | undefined> {
    if (!sha256Pattern.test(executionFingerprint)) throw stateError();
    const row = this.database.connection
      .prepare(
        `SELECT execution_fingerprint, manifest_fingerprint, scope_id, status,
                started_at, finished_at
         FROM calendar_execution_journal WHERE execution_fingerprint = ?`,
      )
      .get(executionFingerprint) as unknown as ExecutionRow | undefined;
    if (row === undefined) return undefined;
    const stepRows = this.database.connection
      .prepare(
        `SELECT intent_id, intent_kind, status, outcome,
                provider_reference_hash, error_code
         FROM calendar_execution_steps
         WHERE execution_fingerprint = ? ORDER BY intent_id`,
      )
      .all(executionFingerprint) as unknown as readonly StepRow[];
    return executionFromRows(row, stepRows);
  }

  async beginExecution(record: CalendarExecutionJournalRecord): Promise<void> {
    if (!validExecutionRecord(record) || record.steps.length !== 0)
      throw stateError();
    this.database.connection
      .prepare(
        `INSERT INTO calendar_execution_journal(
           execution_fingerprint, manifest_fingerprint, scope_id, status,
           started_at, finished_at
         ) VALUES (?, ?, ?, ?, ?, NULL)`,
      )
      .run(
        record.executionFingerprint,
        record.manifestFingerprint,
        record.scopeId,
        record.status,
        record.startedAt,
      );
  }

  async resumeExecution(request: {
    readonly executionFingerprint: string;
  }): Promise<void> {
    if (!sha256Pattern.test(request.executionFingerprint)) throw stateError();
    const result = this.database.connection
      .prepare(
        `UPDATE calendar_execution_journal
         SET status = 'running', finished_at = NULL
         WHERE execution_fingerprint = ? AND status = 'failed'`,
      )
      .run(request.executionFingerprint);
    if (Number(result.changes) !== 1) throw stateError();
  }

  async recordStep(request: {
    readonly executionFingerprint: string;
    readonly step: CalendarExecutionStepRecord;
  }): Promise<void> {
    if (
      !sha256Pattern.test(request.executionFingerprint) ||
      !validStep(request.step)
    )
      throw stateError();
    this.database.transaction(() => {
      const execution = this.database.connection
        .prepare(
          `SELECT status FROM calendar_execution_journal
           WHERE execution_fingerprint = ?`,
        )
        .get(request.executionFingerprint) as unknown as
        { readonly status: string } | undefined;
      if (execution?.status !== 'running') throw stateError();
      const existing = this.database.connection
        .prepare(
          `SELECT intent_kind, status FROM calendar_execution_steps
           WHERE execution_fingerprint = ? AND intent_id = ?`,
        )
        .get(request.executionFingerprint, request.step.intentId) as unknown as
        { readonly intent_kind: string; readonly status: string } | undefined;
      if (
        existing !== undefined &&
        (existing.intent_kind !== request.step.intentKind ||
          !validStepTransition(existing.status, request.step.status))
      )
        throw stateError();
      const result = this.database.connection
        .prepare(
          `INSERT INTO calendar_execution_steps(
             execution_fingerprint, intent_id, intent_kind, status, outcome,
             provider_reference_hash, error_code
           ) VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(execution_fingerprint, intent_id) DO UPDATE SET
             status = excluded.status,
             outcome = excluded.outcome,
             provider_reference_hash = excluded.provider_reference_hash,
             error_code = excluded.error_code`,
        )
        .run(
          request.executionFingerprint,
          request.step.intentId,
          request.step.intentKind,
          request.step.status,
          request.step.outcome ?? null,
          request.step.providerReferenceHash ?? null,
          request.step.errorCode ?? null,
        );
      if (Number(result.changes) !== 1) throw stateError();
    });
  }

  async finishExecution(request: {
    readonly executionFingerprint: string;
    readonly status: 'succeeded' | 'failed';
    readonly finishedAt: string;
  }): Promise<void> {
    if (
      !sha256Pattern.test(request.executionFingerprint) ||
      !isIsoInstant(request.finishedAt)
    )
      throw stateError();
    this.database.transaction(() => {
      const row = this.database.connection
        .prepare(
          `SELECT status, started_at FROM calendar_execution_journal
           WHERE execution_fingerprint = ?`,
        )
        .get(request.executionFingerprint) as unknown as
        { readonly status: string; readonly started_at: string } | undefined;
      if (
        row?.status !== 'running' ||
        !isIsoInstant(row.started_at) ||
        epoch(request.finishedAt)! < epoch(row.started_at)!
      )
        throw stateError();
      const result = this.database.connection
        .prepare(
          `UPDATE calendar_execution_journal
           SET status = ?, finished_at = ?
           WHERE execution_fingerprint = ? AND status = 'running'`,
        )
        .run(request.status, request.finishedAt, request.executionFingerprint);
      if (Number(result.changes) !== 1) throw stateError();
    });
  }
}

function leaseFromRow(row: LeaseRow): CalendarWriterLease {
  const lease: CalendarWriterLease = {
    scopeId: row.scope_id,
    leaseId: row.lease_id,
    ownerId: row.owner_id,
    acquiredAt: row.acquired_at,
    expiresAt: row.expires_at,
  };
  if (!validLease(lease)) throw stateError();
  return lease;
}

function executionFromRows(
  row: ExecutionRow,
  stepRows: readonly StepRow[],
): CalendarExecutionJournalRecord {
  if (
    !sha256Pattern.test(row.execution_fingerprint) ||
    !sha256Pattern.test(row.manifest_fingerprint) ||
    !boundedId(row.scope_id) ||
    !['running', 'succeeded', 'failed'].includes(row.status) ||
    !isIsoInstant(row.started_at) ||
    (row.finished_at !== null && !isIsoInstant(row.finished_at)) ||
    (row.status === 'running') !== (row.finished_at === null)
  )
    throw stateError();
  const steps = stepRows.map(stepFromRow);
  if (new Set(steps.map((step) => step.intentId)).size !== steps.length)
    throw stateError();
  return {
    executionFingerprint: row.execution_fingerprint,
    manifestFingerprint: row.manifest_fingerprint,
    scopeId: row.scope_id,
    status: row.status as CalendarExecutionJournalRecord['status'],
    startedAt: row.started_at,
    ...(row.finished_at === null ? {} : { finishedAt: row.finished_at }),
    steps,
  };
}

function stepFromRow(row: StepRow): CalendarExecutionStepRecord {
  const step: CalendarExecutionStepRecord = {
    intentId: row.intent_id,
    intentKind: row.intent_kind as CalendarExecutionStepRecord['intentKind'],
    status: row.status as CalendarExecutionStepRecord['status'],
    ...(row.outcome === null
      ? {}
      : {
          outcome: row.outcome as Exclude<
            CalendarExecutionStepRecord['outcome'],
            undefined
          >,
        }),
    ...(row.provider_reference_hash === null
      ? {}
      : { providerReferenceHash: row.provider_reference_hash }),
    ...(row.error_code === null ? {} : { errorCode: row.error_code }),
  };
  if (!validStep(step)) throw stateError();
  return step;
}

function validLeaseRequest(value: {
  readonly scopeId: string;
  readonly leaseId: string;
  readonly ownerId: string;
  readonly now: string;
  readonly expiresAt: string;
}): boolean {
  return validLease({
    scopeId: value.scopeId,
    leaseId: value.leaseId,
    ownerId: value.ownerId,
    acquiredAt: value.now,
    expiresAt: value.expiresAt,
  });
}

function validLease(value: CalendarWriterLease): boolean {
  const acquired = epoch(value.acquiredAt);
  const expires = epoch(value.expiresAt);
  return (
    boundedId(value.scopeId) &&
    boundedId(value.leaseId) &&
    boundedId(value.ownerId) &&
    isIsoInstant(value.acquiredAt) &&
    isIsoInstant(value.expiresAt) &&
    acquired !== undefined &&
    expires !== undefined &&
    acquired < expires
  );
}

function validExecutionRecord(value: CalendarExecutionJournalRecord): boolean {
  return (
    sha256Pattern.test(value.executionFingerprint) &&
    sha256Pattern.test(value.manifestFingerprint) &&
    boundedId(value.scopeId) &&
    value.status === 'running' &&
    isIsoInstant(value.startedAt) &&
    value.finishedAt === undefined &&
    Array.isArray(value.steps)
  );
}

function validStep(value: CalendarExecutionStepRecord): boolean {
  return (
    boundedIntentId(value.intentId) &&
    intentKinds.has(value.intentKind) &&
    stepStatuses.has(value.status) &&
    (value.outcome === undefined || outcomes.has(value.outcome)) &&
    (value.providerReferenceHash === undefined ||
      sha256Pattern.test(value.providerReferenceHash)) &&
    (value.errorCode === undefined || boundedId(value.errorCode)) &&
    (value.status === 'pending' || value.status === 'attempted'
      ? value.outcome === undefined && value.errorCode === undefined
      : value.outcome !== undefined) &&
    (value.status === 'failed'
      ? value.outcome === 'refused' && value.errorCode !== undefined
      : value.errorCode === undefined)
  );
}

function validStepTransition(previous: string, next: string): boolean {
  if (previous === 'pending') return next === 'pending' || next === 'attempted';
  if (previous === 'attempted')
    return next === 'attempted' || next === 'succeeded' || next === 'failed';
  if (previous === 'failed') return next === 'attempted' || next === 'failed';
  return previous === 'succeeded' && next === 'succeeded';
}

function boundedId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$/u.test(value)
  );
}

function boundedIntentId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,511}$/u.test(value)
  );
}

function stateError(): Error {
  return new Error('calendar-execution-state-invalid');
}
