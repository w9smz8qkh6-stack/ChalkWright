import { createHash, randomUUID } from 'node:crypto';
import { lstatSync, realpathSync, chownSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { ProductionServerConfig } from '../../config/production.js';
import type { CanonicalPlan, EffectiveDayPlan } from '../../domain/plans.js';
import { stableSerialize } from '../../domain/pure-values.js';
import {
  isCanonicalPlan,
  isEffectivePlan,
  isIsoInstant,
} from '../../domain/runtime-validation.js';
import { SqliteDatabase } from '../../infrastructure/sqlite/database.js';
import { SqliteApplicationStateRepository } from '../../infrastructure/sqlite/repository.js';

export type LegacyPlanStateMigrationStatus =
  'imported' | 'unchanged' | 'rejected';

export interface LegacyPlanStateMigrationResult {
  readonly status: LegacyPlanStateMigrationStatus;
  readonly acceptedCount: number;
  readonly unchangedCount: number;
  readonly rejectedCount: number;
  readonly sourceRowsScanned: number;
}

interface LegacyPlanRow {
  readonly payload_json: string;
  readonly semantic_hash: string;
  readonly plan_kind: 'canonical' | 'effective';
  readonly date_scope: string;
  readonly room_id: string;
  readonly screen_id: string;
  readonly created_at: string;
}

type AcceptedLegacyPlan =
  | { readonly kind: 'canonical'; readonly plan: CanonicalPlan }
  | { readonly kind: 'effective'; readonly plan: EffectiveDayPlan };

const maximumLegacyPlanRows = 64;
const maximumLegacyDatabaseBytes = 64 * 1024 * 1024;

export async function importCurrentLegacyPlanState(options: {
  readonly sourceDatabasePath: string;
  readonly sourceOwnerUid?: number;
  readonly production: ProductionServerConfig;
  readonly targetDatabasePath: string;
  readonly now: () => string;
  readonly nextRevision?: () => string;
  readonly targetOwner?: { readonly uid: number; readonly gid: number };
}): Promise<LegacyPlanStateMigrationResult> {
  assertSourceDatabase(options.sourceDatabasePath, options.sourceOwnerUid);
  const observedAt = options.now();
  if (!isIsoInstant(observedAt))
    return {
      status: 'rejected',
      acceptedCount: 0,
      unchangedCount: 0,
      rejectedCount: 1,
      sourceRowsScanned: 0,
    };

  const source = new DatabaseSync(options.sourceDatabasePath, {
    readOnly: true,
    allowExtension: false,
    defensive: true,
    enableDoubleQuotedStringLiterals: false,
    enableForeignKeyConstraints: true,
    timeout: 2_000,
  });
  let target: SqliteDatabase | undefined;
  try {
    source.exec('PRAGMA foreign_keys = ON');
    source.exec('PRAGMA trusted_schema = OFF');
    const integrity = source
      .prepare('PRAGMA integrity_check')
      .all() as unknown as readonly { readonly integrity_check: string }[];
    if (
      integrity.length !== 1 ||
      String(integrity[0]?.integrity_check) !== 'ok'
    )
      return rejectedResult(0, 1);

    const rows = source
      .prepare(
        `SELECT payload_json, semantic_hash, plan_kind, date_scope, room_id,
                screen_id, created_at
           FROM plan_snapshots
          WHERE superseded_at IS NULL
            AND plan_kind IN ('canonical', 'effective')
          ORDER BY date_scope ASC, plan_kind ASC, created_at DESC, rowid DESC
          LIMIT ?`,
      )
      .all(maximumLegacyPlanRows + 1) as unknown as readonly LegacyPlanRow[];
    if (rows.length === 0 || rows.length > maximumLegacyPlanRows)
      return rejectedResult(rows.length, 1);

    const accepted: AcceptedLegacyPlan[] = [];
    let rejectedCount = 0;
    for (const row of rows) {
      const plan = parseLegacyPlanRow(row, options.production);
      if (plan === undefined) rejectedCount += 1;
      else accepted.push(plan);
    }
    if (rejectedCount > 0 || accepted.length === 0)
      return rejectedResult(rows.length, rejectedCount || 1);

    target = new SqliteDatabase(options.targetDatabasePath, {
      migration: { appliedAt: observedAt },
    });
    let revision = 0;
    const repository = new SqliteApplicationStateRepository(target, {
      clock: { now: () => observedAt },
      nextRevision:
        options.nextRevision ??
        (() => `legacy-plan-migration-${++revision}-${randomUUID()}`),
      academicYearEndForDate: () => options.production.academicYearEnd,
    });

    let acceptedCount = 0;
    let unchangedCount = 0;
    const ordered = [
      ...accepted.filter((entry) => entry.kind === 'canonical'),
      ...accepted.filter((entry) => entry.kind === 'effective'),
    ];
    for (const entry of ordered) {
      const result =
        entry.kind === 'canonical'
          ? await repository.storeCanonical(entry.plan)
          : await repository.storeEffective(entry.plan);
      const resolved = result;
      if (resolved.status === 'stored') acceptedCount += 1;
      else if (resolved.status === 'unchanged') unchangedCount += 1;
      else rejectedCount += 1;
    }
    if (rejectedCount > 0) return rejectedResult(rows.length, rejectedCount);
    return {
      status: acceptedCount > 0 ? 'imported' : 'unchanged',
      acceptedCount,
      unchangedCount,
      rejectedCount,
      sourceRowsScanned: rows.length,
    };
  } catch {
    return rejectedResult(0, 1);
  } finally {
    try {
      source.close();
    } catch {
      // Close failure does not alter the already redacted result.
    }
    target?.close();
    if (options.targetOwner !== undefined)
      restoreTargetOwnership(options.targetDatabasePath, options.targetOwner);
  }
}

function parseLegacyPlanRow(
  row: LegacyPlanRow,
  production: ProductionServerConfig,
): AcceptedLegacyPlan | undefined {
  try {
    const value: unknown = JSON.parse(row.payload_json);
    if (hash(value) !== row.semantic_hash) return undefined;
    if (row.plan_kind === 'canonical') {
      if (
        !isCanonicalPlan(value) ||
        row.date_scope !== value.date ||
        row.room_id !== value.roomId ||
        row.screen_id !== '' ||
        value.roomId !== production.roomId ||
        value.timeZone !== production.timeZone
      )
        return undefined;
      return { kind: 'canonical', plan: value };
    }
    if (
      !isEffectivePlan(value) ||
      row.date_scope !== value.date ||
      row.room_id !== value.roomId ||
      row.screen_id !== value.screenId ||
      value.roomId !== production.roomId ||
      value.timeZone !== production.timeZone
    )
      return undefined;
    return {
      kind: 'effective',
      plan: { ...value, screenId: production.screenId },
    };
  } catch {
    return undefined;
  }
}

function assertSourceDatabase(
  path: string,
  ownerUid: number | undefined,
): void {
  if (!isAbsolute(path) || resolve(path) !== path || path === '/')
    throw new Error('legacy-plan-migration-source-unsafe');
  const before = lstatSync(path);
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.nlink !== 1 ||
    (ownerUid !== undefined && before.uid !== ownerUid) ||
    (before.mode & 0o077) !== 0 ||
    before.size < 1 ||
    before.size > maximumLegacyDatabaseBytes ||
    realpathSync(path) !== path
  )
    throw new Error('legacy-plan-migration-source-unsafe');
}

function restoreTargetOwnership(
  databasePath: string,
  owner: { readonly uid: number; readonly gid: number },
): void {
  for (const path of [
    databasePath,
    `${databasePath}-wal`,
    `${databasePath}-shm`,
    dirname(databasePath),
  ]) {
    try {
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) continue;
      chownSync(path, owner.uid, owner.gid);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}

function hash(value: unknown): string {
  return createHash('sha256').update(stableSerialize(value)).digest('hex');
}

function rejectedResult(
  sourceRowsScanned: number,
  rejectedCount: number,
): LegacyPlanStateMigrationResult {
  return {
    status: 'rejected',
    acceptedCount: 0,
    unchangedCount: 0,
    rejectedCount,
    sourceRowsScanned,
  };
}
