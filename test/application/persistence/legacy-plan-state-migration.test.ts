import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { contractVersion } from '../../../src/contracts/v1/common.js';
import type { RoomId, ScreenId } from '../../../src/domain/identities.js';
import type {
  CanonicalPlan,
  EffectiveDayPlan,
} from '../../../src/domain/plans.js';
import { stableSerialize } from '../../../src/domain/pure-values.js';
import type { ProductionServerConfig } from '../../../src/config/production.js';
import { importCurrentLegacyPlanState } from '../../../src/application/persistence/legacy-plan-state-migration.js';
import { SqliteDatabase } from '../../../src/infrastructure/sqlite/database.js';
import { SqliteApplicationStateRepository } from '../../../src/infrastructure/sqlite/repository.js';
import { buildMeeting } from '../../fixtures/builders.js';

const instant = '2035-04-13T07:00:00Z';
const roomId = 'room-c509' as RoomId;
const screenId = 'screen-c509-production' as ScreenId;

function production(databasePath: string): ProductionServerConfig {
  return {
    version: 1,
    instanceId: 'chalkwright-c509-production',
    roomId,
    screenId,
    screenLabel: 'Room C509',
    host: '127.0.0.1',
    port: 4317,
    timeZone: 'Asia/Ho_Chi_Minh',
    academicYearEnd: '2035-06-30',
    managedRoot: dirname(dirname(databasePath)),
    databasePath,
    backupDirectory: join(dirname(dirname(databasePath)), 'backups'),
    operatorTokenReference: join(
      dirname(dirname(databasePath)),
      'operator-token',
    ),
    courseMappings: [],
    checkInOpenMinutesBefore: 5,
    dismissalWarningMinutesBefore: 3,
  };
}

function canonical(overrides: Partial<CanonicalPlan> = {}): CanonicalPlan {
  return {
    contractVersion,
    planId: 'plan-alpha',
    date: '2035-04-13',
    timeZone: 'Asia/Ho_Chi_Minh',
    roomId,
    sourceObservationIds: ['observation-alpha'],
    verification: 'verified',
    meetings: [
      buildMeeting({
        id: 'meeting-alpha',
        courseKey: 'course-alpha',
        blockLabel: 'A',
        checkInOpensAt: '2035-04-13T07:55:00Z',
        officialStartsAt: '2035-04-13T08:00:00Z',
        checkInClosesAt: '2035-04-13T08:00:00Z',
        contentStartsAt: '2035-04-13T08:00:00Z',
        dismissalStartsAt: '2035-04-13T08:55:00Z',
        officialEndsAt: '2035-04-13T09:00:00Z',
      }),
    ],
    diagnostics: [],
    ...overrides,
  };
}

function effective(
  overrides: Partial<EffectiveDayPlan> = {},
): EffectiveDayPlan {
  const plan = canonical();
  return {
    contractVersion,
    effectivePlanId: 'effective-alpha',
    canonicalPlanId: plan.planId,
    date: plan.date,
    timeZone: plan.timeZone,
    roomId: plan.roomId,
    screenId,
    verification: plan.verification,
    meetings: plan.meetings,
    diagnostics: [],
    ...overrides,
  };
}

function semanticHash(value: unknown): string {
  return createHash('sha256').update(stableSerialize(value)).digest('hex');
}

function sourceOwnerOption(): { readonly sourceOwnerUid?: number } {
  const uid = process.getuid?.();
  return uid === undefined ? {} : { sourceOwnerUid: uid };
}

async function withDatabases(
  run: (context: {
    readonly sourcePath: string;
    readonly targetPath: string;
    readonly source: SqliteDatabase;
    readonly sourceRepository: SqliteApplicationStateRepository;
  }) => Promise<void>,
): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'chalkwright-plan-import-'));
  const sourcePath = join(directory, 'legacy.sqlite');
  const targetPath = join(directory, 'target.sqlite');
  const source = new SqliteDatabase(sourcePath, {
    migration: { appliedAt: instant },
  });
  let revision = 0;
  const sourceRepository = new SqliteApplicationStateRepository(source, {
    clock: { now: () => instant },
    nextRevision: () => `legacy-revision-${++revision}`,
    academicYearEndForDate: () => '2035-06-30',
  });
  try {
    await run({ sourcePath, targetPath, source, sourceRepository });
  } finally {
    source.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

test('imports current legacy canonical and effective plans idempotently', async () => {
  await withDatabases(async ({ sourcePath, targetPath, sourceRepository }) => {
    assert.equal(
      (await sourceRepository.storeCanonical(canonical())).status,
      'stored',
    );
    assert.equal(
      (await sourceRepository.storeEffective(effective())).status,
      'stored',
    );

    const first = await importCurrentLegacyPlanState({
      sourceDatabasePath: sourcePath,
      ...sourceOwnerOption(),
      production: production(targetPath),
      targetDatabasePath: targetPath,
      now: () => instant,
    });
    assert.deepEqual(first, {
      status: 'imported',
      acceptedCount: 2,
      unchangedCount: 0,
      rejectedCount: 0,
      sourceRowsScanned: 2,
    });

    const second = await importCurrentLegacyPlanState({
      sourceDatabasePath: sourcePath,
      ...sourceOwnerOption(),
      production: production(targetPath),
      targetDatabasePath: targetPath,
      now: () => instant,
    });
    assert.deepEqual(second, {
      status: 'unchanged',
      acceptedCount: 0,
      unchangedCount: 2,
      rejectedCount: 0,
      sourceRowsScanned: 2,
    });
  });
});

test('rejects corrupt legacy rows without writing target state', async () => {
  await withDatabases(
    async ({ sourcePath, targetPath, source, sourceRepository }) => {
      assert.equal(
        (await sourceRepository.storeCanonical(canonical())).status,
        'stored',
      );
      source.connection
        .prepare(
          `UPDATE plan_snapshots
            SET semantic_hash = 'sha256:bad'
          WHERE plan_kind = 'canonical'`,
        )
        .run();

      const result = await importCurrentLegacyPlanState({
        sourceDatabasePath: sourcePath,
        ...sourceOwnerOption(),
        production: production(targetPath),
        targetDatabasePath: targetPath,
        now: () => instant,
      });
      assert.equal(result.status, 'rejected');
      assert.equal(result.rejectedCount, 1);

      assert.equal(existsSync(targetPath), false);
    },
  );
});

test('rejects effective plans for a different production screen', async () => {
  await withDatabases(async ({ sourcePath, targetPath, source }) => {
    const wrongScreen = {
      ...effective({ screenId: 'legacy-screen' as ScreenId }),
    };
    source.connection
      .prepare(
        `INSERT INTO plan_snapshots(
           snapshot_id, plan_kind, plan_id, canonical_plan_id, date_scope,
           room_id, screen_id, contract_version, verification, payload_json,
           semantic_hash, revision, academic_year_end, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'legacy-effective',
        'effective',
        wrongScreen.effectivePlanId,
        wrongScreen.canonicalPlanId,
        wrongScreen.date,
        wrongScreen.roomId,
        wrongScreen.screenId,
        wrongScreen.contractVersion,
        wrongScreen.verification,
        stableSerialize(wrongScreen),
        semanticHash(wrongScreen),
        'legacy-revision-1',
        '2035-06-30',
        instant,
      );

    const result = await importCurrentLegacyPlanState({
      sourceDatabasePath: sourcePath,
      ...sourceOwnerOption(),
      production: production(targetPath),
      targetDatabasePath: targetPath,
      now: () => instant,
    });
    assert.equal(result.status, 'rejected');
    assert.equal(result.rejectedCount, 1);
  });
});
