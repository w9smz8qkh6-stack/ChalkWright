import { createHash } from 'node:crypto';

import type { OpaqueId } from '../../contracts/v1/common.js';
import type { Clock } from '../../domain/determinism.js';
import type { ScreenId } from '../../domain/identities.js';
import { isOperationsJobName } from '../../domain/operations/jobs.js';
import type { CanonicalPlan, EffectiveDayPlan } from '../../domain/plans.js';
import { stableSerialize } from '../../domain/pure-values.js';
import {
  containsUndefined,
  isCanonicalPlan,
  isEffectivePlan,
  isIsoDate,
  isIsoInstant,
  hasExactKeys,
  isNonEmptyString,
  isPlainObject,
} from '../../domain/runtime-validation.js';
import type {
  AlertCheckpoint,
  OperationsJobRunRecord,
  OperationsRunLedgerQuery,
  OperationsStateReader,
  OperationsStateWriter,
} from '../../ports/operations.js';
import type {
  ApplicationStateReader,
  ApplicationStateWriter,
  SafeStateRecord,
  SafeStateRecordKind,
  StateRecordQuery,
  StateScope,
} from '../../ports/application-state.js';
import type {
  CanonicalPlanQuery,
  EffectivePlanQuery,
  PlanSnapshotReader,
} from '../../ports/persistence-read.js';
import type {
  PersistenceWriteResult,
  PlanSnapshotWriter,
} from '../../ports/persistence-write.js';
import type { SqliteDatabase } from './database.js';
import { isAlertCheckpoint, isSafeStateRecord } from './state-validation.js';

export interface RepositoryOptions {
  readonly clock: Clock;
  readonly nextRevision: () => OpaqueId;
  readonly academicYearEndForDate?: (date: string) => string | undefined;
  readonly beforeCommit?: () => void;
}

interface PlanRow {
  readonly payload_json: string;
  readonly semantic_hash: string;
  readonly revision: string;
  readonly plan_kind: 'canonical' | 'effective';
  readonly date_scope: string;
  readonly room_id: string;
  readonly screen_id: string;
}

interface StateRow {
  readonly payload_json: string;
  readonly semantic_hash: string;
  readonly revision: string;
  readonly record_kind: SafeStateRecordKind;
  readonly record_key: string;
  readonly date_scope: string;
  readonly screen_id: string;
  readonly room_id: string;
  readonly class_id: string;
  readonly meeting_id: string;
  readonly plan_id: string;
}

const forbiddenKey =
  /(?:secret|password|oauth|access.?token|refresh.?token|cookie|authorization|browser.?profile|raw.?html|raw.?capture|student(?:id|name|email|record|row)?|first.?name|last.?name|unrestricted.?log|file.?path|database.?path|profile.?path)/i;

function containsForbiddenMaterial(value: unknown): boolean {
  if (typeof value === 'string') {
    return (
      /^(?:\/|file:\/\/|[A-Za-z]:[\\/])/u.test(value) ||
      /^\s*Bearer\s+\S+/iu.test(value) ||
      /\b(?:authorization|cookie)\s*:\s*\S+/iu.test(value) ||
      /\b(?:access_token|refresh_token|client_secret|id_token)=/iu.test(
        value,
      ) ||
      /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/u.test(value)
    );
  }
  if (Array.isArray(value)) return value.some(containsForbiddenMaterial);
  if (!isPlainObject(value)) return false;
  return Object.entries(value).some(
    ([key, entry]) =>
      forbiddenKey.test(key) || containsForbiddenMaterial(entry),
  );
}

function hash(value: unknown): string {
  return createHash('sha256').update(stableSerialize(value)).digest('hex');
}

function isSafeToPersist<Value>(
  value: unknown,
  validate: (candidate: unknown) => candidate is Value,
): value is Value {
  try {
    if (!validate(value) || containsForbiddenMaterial(value)) return false;
    return stableSerialize(value).length <= 1_000_000;
  } catch {
    return false;
  }
}

function rejected(code: string, message: string): PersistenceWriteResult {
  return {
    status: 'rejected',
    error: {
      category: 'invalid-input',
      code,
      message,
      retryable: false,
      diagnostics: [],
    },
  };
}

function scopeValues(scope: StateScope) {
  return {
    date: scope.date ?? '',
    screenId: scope.screenId ?? '',
    roomId: scope.roomId ?? '',
    classId: scope.classId ?? '',
    meetingId: scope.meetingId ?? '',
    planId: scope.planId ?? '',
  };
}

function hasDenseEntries(values: readonly unknown[]): boolean {
  try {
    if (containsUndefined(values)) return false;
    for (let index = 0; index < values.length; index += 1)
      if (!Object.hasOwn(values, index)) return false;
    return true;
  } catch {
    return false;
  }
}

function rejectedRecords(
  records: readonly unknown[],
  code: string,
  message: string,
): readonly PersistenceWriteResult[] {
  try {
    return Array.from({ length: records.length }, () =>
      rejected(code, message),
    );
  } catch {
    return [rejected(code, message)];
  }
}

function planMatchesRow(
  row: PlanRow,
  plan: CanonicalPlan | EffectiveDayPlan,
): boolean {
  return row.plan_kind === 'canonical'
    ? isCanonicalPlan(plan) &&
        row.date_scope === plan.date &&
        row.room_id === plan.roomId &&
        row.screen_id === ''
    : isEffectivePlan(plan) &&
        row.date_scope === plan.date &&
        row.room_id === plan.roomId &&
        row.screen_id === plan.screenId;
}

function recordMatchesRow(row: StateRow, record: SafeStateRecord): boolean {
  const scope = scopeValues(record.scope);
  return (
    row.record_kind === record.kind &&
    row.record_key === record.recordKey &&
    row.date_scope === scope.date &&
    row.screen_id === scope.screenId &&
    row.room_id === scope.roomId &&
    row.class_id === scope.classId &&
    row.meeting_id === scope.meetingId &&
    row.plan_id === scope.planId
  );
}

function queryMatchesRecord(
  query: StateRecordQuery,
  record: SafeStateRecord,
): boolean {
  const expected = scopeValues(query);
  const actual = scopeValues(record.scope);
  return (
    record.kind === query.kind &&
    record.recordKey === query.recordKey &&
    expected.date === actual.date &&
    expected.screenId === actual.screenId &&
    expected.roomId === actual.roomId &&
    expected.classId === actual.classId &&
    expected.meetingId === actual.meetingId &&
    expected.planId === actual.planId
  );
}

function scopesEqual(left: StateScope, right: StateScope): boolean {
  const a = scopeValues(left);
  const b = scopeValues(right);
  return (
    a.date === b.date &&
    a.screenId === b.screenId &&
    a.roomId === b.roomId &&
    a.classId === b.classId &&
    a.meetingId === b.meetingId &&
    a.planId === b.planId
  );
}

function safeParse<Row extends PlanRow | StateRow, Value>(
  row: Row,
  validate: (value: unknown) => value is Value,
): Value | undefined {
  try {
    const value: unknown = JSON.parse(row.payload_json);
    return hash(value) === row.semantic_hash && isSafeToPersist(value, validate)
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}

export class SqliteApplicationStateRepository
  implements
    PlanSnapshotReader,
    PlanSnapshotWriter,
    ApplicationStateReader,
    ApplicationStateWriter,
    OperationsStateReader,
    OperationsStateWriter
{
  constructor(
    private readonly database: SqliteDatabase,
    private readonly options: RepositoryOptions,
  ) {}

  async findCanonical(
    query: CanonicalPlanQuery,
  ): Promise<CanonicalPlan | undefined> {
    const rows = this.database.connection
      .prepare(
        `SELECT payload_json, semantic_hash, revision, plan_kind, date_scope,
                room_id, screen_id
           FROM plan_snapshots
          WHERE plan_kind = 'canonical' AND date_scope = ? AND room_id = ?
                AND screen_id = ''
          ORDER BY created_at DESC, rowid DESC`,
      )
      .all(query.date, query.roomId) as unknown as PlanRow[];
    for (const row of rows) {
      const plan = safeParse(row, isCanonicalPlan);
      if (
        plan !== undefined &&
        planMatchesRow(row, plan) &&
        plan.date === query.date &&
        plan.roomId === query.roomId
      )
        return plan;
    }
    return undefined;
  }

  async findEffective(
    query: EffectivePlanQuery,
  ): Promise<EffectiveDayPlan | undefined> {
    const rows = this.database.connection
      .prepare(
        `SELECT payload_json, semantic_hash, revision, plan_kind, date_scope,
                room_id, screen_id
          FROM plan_snapshots
          WHERE plan_kind = 'effective' AND date_scope = ? AND screen_id = ?
                AND room_id = ?
          ORDER BY created_at DESC, rowid DESC`,
      )
      .all(query.date, query.screenId, query.roomId) as unknown as PlanRow[];
    for (const row of rows) {
      const plan = safeParse(row, isEffectivePlan);
      if (
        plan !== undefined &&
        planMatchesRow(row, plan) &&
        plan.date === query.date &&
        plan.screenId === query.screenId &&
        plan.roomId === query.roomId
      )
        return plan;
    }
    return undefined;
  }

  /** Return the earliest valid current effective plan after an exact date. */
  async findNextEffective(query: {
    readonly screenId: ScreenId;
    readonly roomId: string;
    readonly afterDate: string;
  }): Promise<EffectiveDayPlan | undefined> {
    if (!isIsoDate(query.afterDate)) return undefined;
    const rows = this.database.connection
      .prepare(
        `SELECT payload_json, semantic_hash, revision, plan_kind, date_scope,
                room_id, screen_id
           FROM plan_snapshots
          WHERE plan_kind = 'effective' AND date_scope > ? AND screen_id = ?
                AND room_id = ? AND superseded_at IS NULL
          ORDER BY date_scope ASC, created_at DESC, rowid DESC
          LIMIT 400`,
      )
      .all(
        query.afterDate,
        query.screenId,
        query.roomId,
      ) as unknown as PlanRow[];
    for (const row of rows) {
      const plan = safeParse(row, isEffectivePlan);
      if (
        plan !== undefined &&
        planMatchesRow(row, plan) &&
        plan.date > query.afterDate &&
        plan.screenId === query.screenId &&
        plan.roomId === query.roomId
      )
        return plan;
    }
    return undefined;
  }

  async storeCanonical(plan: CanonicalPlan): Promise<PersistenceWriteResult> {
    if (!isSafeToPersist(plan, isCanonicalPlan))
      return rejected('canonical-plan-invalid', 'Canonical plan is invalid.');
    return this.storePlan('canonical', plan, plan.planId, '', plan.roomId);
  }

  async storeEffective(
    plan: EffectiveDayPlan,
  ): Promise<PersistenceWriteResult> {
    if (!isSafeToPersist(plan, isEffectivePlan))
      return rejected('effective-plan-invalid', 'Effective plan is invalid.');
    return this.storePlan(
      'effective',
      plan,
      plan.effectivePlanId,
      plan.screenId,
      plan.roomId,
    );
  }

  private storePlan(
    kind: 'canonical' | 'effective',
    plan: CanonicalPlan | EffectiveDayPlan,
    planId: string,
    screenId: string,
    roomId: string,
  ): PersistenceWriteResult {
    try {
      const payload = stableSerialize(plan);
      const semanticHash = hash(plan);
      const current = this.database.connection
        .prepare(
          kind === 'canonical'
            ? `SELECT payload_json, semantic_hash, revision, plan_kind,
                      date_scope, room_id, screen_id
                 FROM plan_snapshots
                WHERE plan_kind = 'canonical' AND date_scope = ?
                      AND room_id = ? AND superseded_at IS NULL`
            : `SELECT payload_json, semantic_hash, revision, plan_kind,
                      date_scope, room_id, screen_id
                 FROM plan_snapshots
                WHERE plan_kind = 'effective' AND date_scope = ?
                      AND screen_id = ? AND superseded_at IS NULL`,
        )
        .get(plan.date, kind === 'canonical' ? roomId : screenId) as unknown as
        PlanRow | undefined;
      const currentPlan =
        current === undefined
          ? undefined
          : kind === 'canonical'
            ? safeParse(current, isCanonicalPlan)
            : safeParse(current, isEffectivePlan);
      if (
        current?.semantic_hash === semanticHash &&
        currentPlan !== undefined &&
        planMatchesRow(current, currentPlan)
      )
        return { status: 'unchanged', revision: current.revision };
      const revision = this.requireRevision();
      const now = this.requireWriteInstant();
      const academicYearEnd =
        this.options.academicYearEndForDate?.(plan.date) ?? null;
      if (academicYearEnd !== null && !isIsoDate(academicYearEnd))
        throw new Error('persistence-academic-year-end-invalid');
      this.database.transaction(() => {
        this.database.connection
          .prepare(
            kind === 'canonical'
              ? `UPDATE plan_snapshots SET superseded_at = ?
                  WHERE plan_kind = 'canonical' AND date_scope = ?
                        AND room_id = ? AND superseded_at IS NULL`
              : `UPDATE plan_snapshots SET superseded_at = ?
                  WHERE plan_kind = 'effective' AND date_scope = ?
                        AND screen_id = ? AND superseded_at IS NULL`,
          )
          .run(now, plan.date, kind === 'canonical' ? roomId : screenId);
        this.database.connection
          .prepare(
            `INSERT INTO plan_snapshots(
               snapshot_id, plan_kind, plan_id, canonical_plan_id, date_scope,
               room_id, screen_id, contract_version, verification, payload_json,
               semantic_hash, revision, academic_year_end, created_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            `plan:${revision}`,
            kind,
            planId,
            kind === 'effective'
              ? (plan as EffectiveDayPlan).canonicalPlanId
              : '',
            plan.date,
            roomId,
            screenId,
            plan.contractVersion,
            plan.verification,
            payload,
            semanticHash,
            revision,
            academicYearEnd,
            now,
          );
        this.options.beforeCommit?.();
      });
      return { status: 'stored', revision };
    } catch {
      return rejected('plan-storage-failed', 'Plan storage failed safely.');
    }
  }

  async findRecord(
    query: StateRecordQuery,
  ): Promise<SafeStateRecord | undefined> {
    const scope = scopeValues(query);
    const rows = this.database.connection
      .prepare(
        `SELECT payload_json, semantic_hash, revision, record_kind, record_key,
                date_scope, screen_id, room_id, class_id, meeting_id, plan_id
           FROM application_records
          WHERE record_kind = ? AND record_key = ? AND date_scope = ?
                AND screen_id = ? AND room_id = ? AND class_id = ?
                AND meeting_id = ? AND plan_id = ?
                ${query.kind === 'hold' ? 'AND superseded_at IS NULL' : ''}
          ORDER BY created_at DESC, rowid DESC`,
      )
      .all(
        query.kind,
        query.recordKey,
        scope.date,
        scope.screenId,
        scope.roomId,
        scope.classId,
        scope.meetingId,
        scope.planId,
      ) as unknown as StateRow[];
    for (const row of rows) {
      const record = safeParse(row, isSafeStateRecord);
      if (
        record !== undefined &&
        recordMatchesRow(row, record) &&
        queryMatchesRecord(query, record)
      )
        return record;
    }
    return undefined;
  }

  async storeRecord(record: SafeStateRecord): Promise<PersistenceWriteResult> {
    const results = this.storeRecordsAtomically([record]);
    return results[0] ?? rejected('state-record-invalid', 'State is invalid.');
  }

  async loadAlertCheckpoint(): Promise<AlertCheckpoint | undefined> {
    const record = await this.findRecord({
      kind: 'alert-state',
      recordKey: 'operations-alert-checkpoint',
    });
    return record?.kind === 'alert-state' ? record.data : undefined;
  }

  async storeAlertCheckpoint(
    checkpoint: AlertCheckpoint,
  ): Promise<PersistenceWriteResult> {
    if (!isAlertCheckpoint(checkpoint))
      return rejected(
        'alert-checkpoint-invalid',
        'Alert checkpoint is invalid.',
      );
    try {
      const captured = JSON.parse(
        stableSerialize(checkpoint),
      ) as AlertCheckpoint;
      return this.storeRecord({
        kind: 'alert-state',
        recordKey: 'operations-alert-checkpoint',
        scope: {},
        data: captured,
      });
    } catch {
      return rejected(
        'alert-checkpoint-invalid',
        'Alert checkpoint is invalid.',
      );
    }
  }

  async storeJobRun(
    record: OperationsJobRunRecord,
  ): Promise<PersistenceWriteResult> {
    if (
      !isSafeToPersist(record, isSafeStateRecord) ||
      record.kind !== 'job-run' ||
      record.recordKey !== record.data.outcome.runId ||
      !isOperationsJobName(record.data.outcome.jobName) ||
      Object.keys(record.scope).length !== 0 ||
      record.active !== undefined ||
      record.academicYearEnd !== undefined ||
      record.expiresAt !== undefined
    )
      return rejected('job-run-invalid', 'Job run is invalid.');
    return this.storeRecord(record);
  }

  async listJobRuns(
    query: OperationsRunLedgerQuery,
  ): Promise<readonly OperationsJobRunRecord[]> {
    if (
      !isPlainObject(query) ||
      !hasExactKeys(query, ['limit'], ['jobName', 'startedAtOrAfter']) ||
      !Number.isInteger(query.limit) ||
      query.limit < 1 ||
      query.limit > 100 ||
      (query.jobName !== undefined &&
        (!isNonEmptyString(query.jobName) || query.jobName.length > 128)) ||
      (query.startedAtOrAfter !== undefined &&
        !isIsoInstant(query.startedAtOrAfter))
    )
      throw new Error('operations-run-query-invalid');

    const rows = this.database.connection
      .prepare(
        `SELECT payload_json, semantic_hash, revision, record_kind, record_key,
                date_scope, screen_id, room_id, class_id, meeting_id, plan_id
           FROM application_records
          WHERE record_kind = 'job-run' AND superseded_at IS NULL
                AND (? IS NULL OR json_extract(payload_json, '$.data.outcome.jobName') = ?)
                AND (? IS NULL OR json_extract(payload_json, '$.data.outcome.startedAt') >= ?)
          ORDER BY json_extract(payload_json, '$.data.outcome.startedAt') DESC,
                   rowid DESC
          LIMIT ?`,
      )
      .all(
        query.jobName ?? null,
        query.jobName ?? null,
        query.startedAtOrAfter ?? null,
        query.startedAtOrAfter ?? null,
        query.limit,
      ) as unknown as StateRow[];
    return rows.flatMap((row) => {
      const record = safeParse(row, isSafeStateRecord);
      return record !== undefined &&
        record.kind === 'job-run' &&
        record.recordKey === record.data.outcome.runId &&
        isOperationsJobName(record.data.outcome.jobName) &&
        Object.keys(record.scope).length === 0 &&
        record.active === undefined &&
        record.academicYearEnd === undefined &&
        record.expiresAt === undefined &&
        recordMatchesRow(row, record)
        ? [record]
        : [];
    });
  }

  storeHoldTransition(
    record: Extract<SafeStateRecord, { readonly kind: 'hold' }>,
    expectedRevision: OpaqueId,
  ): PersistenceWriteResult {
    if (
      !isSafeToPersist(record, isSafeStateRecord) ||
      record.kind !== 'hold' ||
      !isNonEmptyString(expectedRevision)
    )
      return rejected('hold-transition-invalid', 'Hold transition is invalid.');
    const scope = scopeValues(record.scope);
    try {
      const now = this.requireWriteInstant();
      return this.database.transaction(() => {
        const current = this.database.connection
          .prepare(
            `SELECT payload_json, semantic_hash, revision, record_kind,
                    record_key, date_scope, screen_id, room_id, class_id,
                    meeting_id, plan_id
               FROM application_records
              WHERE record_kind = 'hold' AND record_key = ?
                    AND date_scope = ? AND screen_id = ? AND room_id = ?
                    AND class_id = ? AND meeting_id = ? AND plan_id = ?
                    AND superseded_at IS NULL`,
          )
          .get(
            record.recordKey,
            scope.date,
            scope.screenId,
            scope.roomId,
            scope.classId,
            scope.meetingId,
            scope.planId,
          ) as unknown as StateRow | undefined;
        const currentRecord =
          current === undefined
            ? undefined
            : safeParse(current, isSafeStateRecord);
        if (
          current?.revision !== expectedRevision ||
          currentRecord === undefined ||
          currentRecord.kind !== 'hold' ||
          !recordMatchesRow(current, currentRecord)
        )
          return rejected(
            'hold-revision-conflict',
            'The hold changed before this transition was applied.',
          );
        const closesHeldLifecycle =
          currentRecord.data.status === 'held' &&
          record.data.status !== 'held' &&
          record.data.heldAt === currentRecord.data.heldAt &&
          record.data.expiresAt === currentRecord.data.expiresAt;
        const priorTerminalAt =
          currentRecord.data.status === 'released'
            ? currentRecord.data.releasedAt
            : currentRecord.data.status === 'expired'
              ? currentRecord.data.expiredAt
              : undefined;
        const startsNewLifecycle =
          priorTerminalAt !== undefined &&
          record.data.status === 'held' &&
          Date.parse(record.data.heldAt) >= Date.parse(priorTerminalAt);
        if (!closesHeldLifecycle && !startsNewLifecycle)
          return rejected(
            'hold-transition-not-allowed',
            'The requested hold lifecycle transition is not allowed.',
          );
        const result = this.storeRecordInTransaction(record, now);
        this.options.beforeCommit?.();
        return result;
      });
    } catch {
      return rejected('hold-storage-failed', 'Hold transition failed safely.');
    }
  }

  invalidateStaleHolds(options: {
    readonly date: string;
    readonly screenId: ScreenId;
    readonly meetingId: OpaqueId;
    readonly planId: OpaqueId;
    readonly at: string;
  }): number {
    let valid = false;
    try {
      valid =
        isIsoDate(options.date) &&
        isNonEmptyString(options.screenId) &&
        isNonEmptyString(options.meetingId) &&
        isNonEmptyString(options.planId) &&
        isIsoInstant(options.at);
    } catch {
      valid = false;
    }
    if (!valid) throw new Error('hold-invalidation-input-invalid');
    const now = this.requireWriteInstant();
    return this.database.transaction(() => {
      const rows = this.database.connection
        .prepare(
          `SELECT payload_json, semantic_hash, revision, record_kind,
                  record_key, date_scope, screen_id, room_id, class_id,
                  meeting_id, plan_id
             FROM application_records
            WHERE record_kind = 'hold' AND date_scope = ? AND screen_id = ?
                  AND superseded_at IS NULL
            ORDER BY created_at, rowid`,
        )
        .all(options.date, options.screenId) as unknown as StateRow[];
      const stale = rows.flatMap((row) => {
        const record = safeParse(row, isSafeStateRecord);
        if (
          record === undefined ||
          record.kind !== 'hold' ||
          !recordMatchesRow(row, record)
        )
          throw new Error('hold-current-record-invalid');
        if (
          record.data.status !== 'held' ||
          (record.scope.meetingId === options.meetingId &&
            record.scope.planId === options.planId)
        )
          return [];
        if (Date.parse(options.at) < Date.parse(record.data.heldAt))
          throw new Error('hold-invalidation-chronology-invalid');
        return [record];
      });
      for (const record of stale) {
        const { expiresAt: _retentionExpiry, ...retained } = record;
        const meetingChanged = record.scope.meetingId !== options.meetingId;
        const transition: Extract<SafeStateRecord, { readonly kind: 'hold' }> =
          {
            ...retained,
            data: {
              ...record.data,
              status: 'released',
              releasedAt: options.at,
              reasonCode: meetingChanged ? 'meeting-changed' : 'stale-plan',
            },
          };
        if (this.storeRecordInTransaction(transition, now).status !== 'stored')
          throw new Error('hold-invalidation-failed');
      }
      this.options.beforeCommit?.();
      return stale.length;
    });
  }

  storeRecordsAtomically(
    records: readonly SafeStateRecord[],
  ): readonly PersistenceWriteResult[] {
    if (
      !hasDenseEntries(records) ||
      !records.every((record) => isSafeToPersist(record, isSafeStateRecord))
    ) {
      return rejectedRecords(
        records,
        'state-record-invalid',
        'State record is invalid.',
      );
    }
    try {
      const now = this.requireWriteInstant();
      return this.database.transaction(() => {
        const invalidHoldWrite = records.some((record) => {
          if (record.kind !== 'hold') return false;
          if (record.data.status !== 'held') return true;
          const scope = scopeValues(record.scope);
          const current = this.database.connection
            .prepare(
              `SELECT payload_json, semantic_hash, revision, record_kind,
                      record_key, date_scope, screen_id, room_id, class_id,
                      meeting_id, plan_id
                 FROM application_records
                WHERE record_kind = 'hold' AND record_key = ?
                      AND date_scope = ? AND screen_id = ? AND room_id = ?
                      AND class_id = ? AND meeting_id = ? AND plan_id = ?
                      AND superseded_at IS NULL`,
            )
            .get(
              record.recordKey,
              scope.date,
              scope.screenId,
              scope.roomId,
              scope.classId,
              scope.meetingId,
              scope.planId,
            ) as unknown as StateRow | undefined;
          if (current === undefined) return false;
          const currentRecord = safeParse(current, isSafeStateRecord);
          return !(
            current.semantic_hash === hash(record) &&
            currentRecord !== undefined &&
            recordMatchesRow(current, currentRecord)
          );
        });
        if (invalidHoldWrite)
          return rejectedRecords(
            records,
            'hold-transition-revision-required',
            'Existing holds require a revision-checked transition.',
          );
        const results = records.map((record) =>
          this.storeRecordInTransaction(record, now),
        );
        this.options.beforeCommit?.();
        return results;
      });
    } catch {
      return rejectedRecords(
        records,
        'state-storage-failed',
        'State storage failed safely.',
      );
    }
  }

  private storeRecordInTransaction(
    record: SafeStateRecord,
    now: string,
  ): PersistenceWriteResult {
    if (!isSafeToPersist(record, isSafeStateRecord))
      return rejected(
        'state-record-invalid',
        'State record is invalid inside the transaction.',
      );
    const scope = scopeValues(record.scope);
    const semanticHash = hash(record);
    const current = this.database.connection
      .prepare(
        `SELECT payload_json, semantic_hash, revision, record_kind, record_key,
                date_scope, screen_id, room_id, class_id, meeting_id, plan_id
           FROM application_records
          WHERE record_kind = ? AND record_key = ? AND date_scope = ?
                AND screen_id = ? AND room_id = ? AND class_id = ?
                AND meeting_id = ? AND plan_id = ?
                AND superseded_at IS NULL`,
      )
      .get(
        record.kind,
        record.recordKey,
        scope.date,
        scope.screenId,
        scope.roomId,
        scope.classId,
        scope.meetingId,
        scope.planId,
      ) as unknown as StateRow | undefined;
    const currentRecord =
      current === undefined ? undefined : safeParse(current, isSafeStateRecord);
    if (
      current?.semantic_hash === semanticHash &&
      currentRecord !== undefined &&
      recordMatchesRow(current, currentRecord)
    )
      return { status: 'unchanged', revision: current.revision };
    const revision = this.requireRevision();
    this.database.connection
      .prepare(
        `UPDATE application_records SET superseded_at = ?
          WHERE record_kind = ? AND record_key = ? AND date_scope = ?
                AND screen_id = ? AND room_id = ? AND class_id = ?
                AND meeting_id = ? AND plan_id = ?
                AND superseded_at IS NULL`,
      )
      .run(
        now,
        record.kind,
        record.recordKey,
        scope.date,
        scope.screenId,
        scope.roomId,
        scope.classId,
        scope.meetingId,
        scope.planId,
      );
    this.database.connection
      .prepare(
        `INSERT INTO application_records(
           record_id, record_kind, record_key, date_scope, screen_id, room_id,
           class_id, meeting_id, plan_id, payload_json, semantic_hash, revision,
           academic_year_end, active, created_at, expires_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        `state:${revision}`,
        record.kind,
        record.recordKey,
        scope.date,
        scope.screenId,
        scope.roomId,
        scope.classId,
        scope.meetingId,
        scope.planId,
        stableSerialize(record),
        semanticHash,
        revision,
        record.academicYearEnd ?? null,
        record.active === false ? 0 : 1,
        now,
        record.expiresAt ?? null,
      );
    return { status: 'stored', revision };
  }

  private requireWriteInstant(): string {
    const now = this.options.clock.now();
    if (!isIsoInstant(now)) throw new Error('persistence-clock-invalid');
    return now;
  }

  private requireRevision(): OpaqueId {
    const revision = this.options.nextRevision();
    if (!isNonEmptyString(revision))
      throw new Error('persistence-revision-invalid');
    return revision;
  }

  storeJobRunAndCalendarState(options: {
    readonly jobRun: Extract<SafeStateRecord, { readonly kind: 'job-run' }>;
    readonly calendarState?: Extract<
      SafeStateRecord,
      { readonly kind: 'calendar-reconciliation-state' }
    >;
  }): readonly PersistenceWriteResult[] {
    let run: typeof options.jobRun;
    let state: typeof options.calendarState;
    try {
      run = options.jobRun;
      state = options.calendarState;
    } catch {
      return [
        rejected(
          'calendar-state-correlation-invalid',
          'The Calendar job or state contract is invalid.',
        ),
      ];
    }
    if (
      !isSafeToPersist(run, isSafeStateRecord) ||
      run.kind !== 'job-run' ||
      (state !== undefined &&
        (!isSafeToPersist(state, isSafeStateRecord) ||
          state.kind !== 'calendar-reconciliation-state'))
    )
      return [
        rejected(
          'calendar-state-correlation-invalid',
          'The Calendar job or state contract is invalid.',
        ),
      ];
    if (state !== undefined) {
      if (run.data.outcome.category !== 'succeeded')
        return [
          rejected(
            'calendar-fingerprint-not-successful',
            'Only a successful job may advance the Calendar fingerprint.',
          ),
        ];
      if (
        !scopesEqual(run.scope, state.scope) ||
        state.scope.date === undefined ||
        run.data.outputFingerprint !== state.data.lastSuccessfulFingerprint ||
        run.data.latestStateReference !== state.recordKey ||
        run.data.outcome.finishedAt !== state.data.completedAt ||
        run.data.outcome.completedExternalMutations !==
          run.data.outcome.attemptedExternalMutations ||
        run.data.errorCodes.length !== 0 ||
        run.data.incidentCodes.length !== 0 ||
        !run.data.requestedDates.includes(state.scope.date)
      )
        return [
          rejected(
            'calendar-fingerprint-not-correlated',
            'The Calendar state does not match its successful job result.',
          ),
        ];
    }
    return this.storeRecordsAtomically([
      run,
      ...(state === undefined ? [] : [state]),
    ]);
  }

  pruneExpired(at: string): number {
    if (!isIsoInstant(at)) throw new Error('state-prune-instant-invalid');
    const now = this.requireWriteInstant();
    return this.database.transaction(() => {
      const holdRows = this.database.connection
        .prepare(
          `SELECT payload_json, semantic_hash, revision, record_kind,
                  record_key, date_scope, screen_id, room_id, class_id,
                  meeting_id, plan_id
             FROM application_records
            WHERE record_kind = 'hold' AND superseded_at IS NULL
                  AND expires_at IS NOT NULL AND expires_at <= ?
            ORDER BY created_at, rowid`,
        )
        .all(at) as unknown as StateRow[];
      const holds = holdRows.map((row) => {
        const record = safeParse(row, isSafeStateRecord);
        if (
          record === undefined ||
          record.kind !== 'hold' ||
          record.data.status !== 'held' ||
          !recordMatchesRow(row, record)
        )
          throw new Error('hold-expiry-record-invalid');
        return record;
      });
      for (const record of holds) {
        const { expiresAt: _retentionExpiry, ...retained } = record;
        const expired: Extract<SafeStateRecord, { readonly kind: 'hold' }> = {
          ...retained,
          data: {
            ...record.data,
            status: 'expired',
            expiredAt: at,
            reasonCode: 'safety-expired',
          },
        };
        if (this.storeRecordInTransaction(expired, now).status !== 'stored')
          throw new Error('hold-expiry-transition-failed');
      }
      const deleted = Number(
        this.database.connection
          .prepare(
            `DELETE FROM application_records
                WHERE record_kind <> 'hold' AND expires_at IS NOT NULL
                      AND expires_at <= ?`,
          )
          .run(at).changes,
      );
      this.options.beforeCommit?.();
      return holds.length + deleted;
    });
  }

  pruneRetentionPolicy(now: string): number {
    if (!isIsoInstant(now)) throw new Error('retention-policy-input-invalid');
    const writeInstant = this.requireWriteInstant();
    if (Date.parse(writeInstant) !== Date.parse(now))
      throw new Error('retention-policy-clock-mismatch');
    const day = 24 * 60 * 60 * 1_000;
    const jobAndComparisonDeleteBefore = new Date(
      Date.parse(now) - 90 * day,
    ).toISOString();
    const attendanceAndTemporaryDeleteBefore = new Date(
      Date.parse(now) - 30 * day,
    ).toISOString();
    const academicStateDeleteBefore = new Date(Date.parse(now) - 90 * day)
      .toISOString()
      .slice(0, 10);
    const configurationCutoff = new Date(now);
    configurationCutoff.setUTCFullYear(
      configurationCutoff.getUTCFullYear() - 1,
    );
    const configurationDeleteBefore = configurationCutoff.toISOString();
    return this.database.transaction(() => {
      let deleted = 0;
      deleted += Number(
        this.database.connection
          .prepare(
            `DELETE FROM application_records
              WHERE record_kind IN ('job-run', 'comparison-evidence')
                    AND created_at < ?`,
          )
          .run(jobAndComparisonDeleteBefore).changes,
      );
      deleted += Number(
        this.database.connection
          .prepare(
            `DELETE FROM application_records
              WHERE record_kind = 'alert-state'
                    AND superseded_at IS NOT NULL
                    AND superseded_at < ?`,
          )
          .run(jobAndComparisonDeleteBefore).changes,
      );
      deleted += Number(
        this.database.connection
          .prepare(
            `DELETE FROM application_records
              WHERE record_kind IN ('attendance', 'temporary-operational-state')
                    AND created_at < ?`,
          )
          .run(attendanceAndTemporaryDeleteBefore).changes,
      );
      deleted += Number(
        this.database.connection
          .prepare(
            `DELETE FROM application_records
              WHERE record_kind IN ('content', 'vocabulary-selection', 'vocabulary-history')
                    AND academic_year_end IS NOT NULL
                    AND academic_year_end < ?`,
          )
          .run(academicStateDeleteBefore).changes,
      );
      deleted += Number(
        this.database.connection
          .prepare(
            `DELETE FROM plan_snapshots
              WHERE academic_year_end IS NOT NULL
                    AND academic_year_end < ?`,
          )
          .run(academicStateDeleteBefore).changes,
      );
      deleted += Number(
        this.database.connection
          .prepare(
            `DELETE FROM application_records
              WHERE record_kind IN (
                      'configuration', 'mapping',
                      'calendar-ownership-candidate',
                      'calendar-reconciliation-state'
                    )
                    AND superseded_at IS NOT NULL
                    AND superseded_at < ?`,
          )
          .run(configurationDeleteBefore).changes,
      );
      this.options.beforeCommit?.();
      return deleted;
    });
  }
}
