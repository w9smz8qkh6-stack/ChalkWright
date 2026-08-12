import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import { contractVersion } from '../../../src/contracts/v1/common.js';
import type { JobOutcome } from '../../../src/contracts/v1/operations.js';
import type {
  ClassId,
  RoomId,
  ScreenId,
} from '../../../src/domain/identities.js';
import type {
  CanonicalPlan,
  EffectiveDayPlan,
} from '../../../src/domain/plans.js';
import { stableSerialize } from '../../../src/domain/pure-values.js';
import type {
  SafeStateRecord,
  StateScope,
} from '../../../src/ports/application-state.js';
import { SqliteDatabase } from '../../../src/infrastructure/sqlite/database.js';
import {
  type RepositoryOptions,
  SqliteApplicationStateRepository,
} from '../../../src/infrastructure/sqlite/repository.js';
import {
  buildMeeting,
  buildPeriod,
  buildScheduleObservation,
} from '../../fixtures/builders.js';

const instant = '2035-04-13T07:00:00Z';
const roomAlpha = 'room-alpha' as RoomId;
const roomBeta = 'room-beta' as RoomId;
const screenA = 'screen-a' as ScreenId;
const classAlpha = 'class-alpha' as ClassId;

function semanticHash(value: unknown): string {
  return createHash('sha256').update(stableSerialize(value)).digest('hex');
}

function canonical(overrides: Partial<CanonicalPlan> = {}): CanonicalPlan {
  return {
    contractVersion,
    planId: 'plan-alpha',
    date: '2035-04-13',
    timeZone: 'Etc/UTC',
    roomId: roomAlpha,
    sourceObservationIds: ['observation-alpha'],
    verification: 'synthetic',
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
  screenId: ScreenId,
  roomId: RoomId = roomAlpha,
): EffectiveDayPlan {
  const plan = canonical({ roomId });
  return {
    contractVersion,
    effectivePlanId: `effective-${screenId}`,
    canonicalPlanId: plan.planId,
    date: plan.date,
    timeZone: plan.timeZone,
    roomId: plan.roomId,
    screenId,
    verification: plan.verification,
    meetings: plan.meetings,
    diagnostics: [],
  };
}

function withRepository(
  run: (context: {
    database: SqliteDatabase;
    repository: SqliteApplicationStateRepository;
  }) => Promise<void> | void,
  beforeCommit?: () => void,
  optionOverrides: Partial<RepositoryOptions> = {},
): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'classroom-hub-repository-'));
  const database = new SqliteDatabase(join(directory, 'state.sqlite'), {
    migration: { appliedAt: instant },
  });
  let revision = 0;
  const repository = new SqliteApplicationStateRepository(database, {
    clock: { now: () => instant },
    nextRevision: () => `revision-${++revision}`,
    academicYearEndForDate: () => '2035-06-30',
    ...(beforeCommit === undefined ? {} : { beforeCommit }),
    ...optionOverrides,
  });
  return Promise.resolve(run({ database, repository })).finally(() => {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });
}

test('plan snapshots preserve semantic no-ops, revisions, and scope isolation', async () => {
  await withRepository(async ({ repository }) => {
    const first = await repository.storeCanonical(canonical());
    const repeated = await repository.storeCanonical(
      structuredClone(canonical()),
    );
    assert.equal(first.status, 'stored');
    assert.deepEqual(repeated, {
      status: 'unchanged',
      revision: first.status === 'stored' ? first.revision : '',
    });

    assert.equal(
      (await repository.storeEffective(effective(screenA))).status,
      'stored',
    );
    assert.equal(
      (await repository.storeEffective(effective('screen-b' as ScreenId)))
        .status,
      'stored',
    );
    assert.equal(
      (
        await repository.findEffective({
          date: '2035-04-13',
          screenId: screenA,
          roomId: roomAlpha,
        })
      )?.screenId,
      'screen-a',
    );
    assert.equal(
      (
        await repository.findEffective({
          date: '2035-04-13',
          screenId: 'screen-b' as ScreenId,
          roomId: roomAlpha,
        })
      )?.screenId,
      'screen-b',
    );
    assert.equal(
      await repository.findEffective({
        date: '2035-04-13',
        screenId: 'screen-c' as ScreenId,
        roomId: roomAlpha,
      }),
      undefined,
    );
  });
});

test('effective-plan reassignment has one current screen row and room-safe fallback', async () => {
  await withRepository(async ({ database, repository }) => {
    await repository.storeEffective(effective(screenA, roomAlpha));
    await repository.storeEffective(effective(screenA, roomBeta));
    const current = database.connection
      .prepare(
        `SELECT count(*) AS count
           FROM plan_snapshots
          WHERE plan_kind = 'effective' AND date_scope = ? AND screen_id = ?
                AND superseded_at IS NULL`,
      )
      .get('2035-04-13', screenA) as unknown as { readonly count: number };
    assert.equal(Number(current.count), 1);
    assert.equal(
      (
        await repository.findEffective({
          date: '2035-04-13',
          screenId: screenA,
          roomId: roomBeta,
        })
      )?.roomId,
      roomBeta,
    );

    database.connection
      .prepare(
        `UPDATE plan_snapshots SET semantic_hash = 'invalid'
          WHERE plan_kind = 'effective' AND date_scope = ? AND screen_id = ?
                AND room_id = ? AND superseded_at IS NULL`,
      )
      .run('2035-04-13', screenA, roomBeta);
    assert.equal(
      await repository.findEffective({
        date: '2035-04-13',
        screenId: screenA,
        roomId: roomBeta,
      }),
      undefined,
    );
  });
});

test('invalid current plan falls back only to prior valid state and then recovers', async () => {
  await withRepository(async ({ database, repository }) => {
    const original = canonical();
    await repository.storeCanonical(original);
    await repository.storeCanonical(canonical({ planId: 'plan-new' }));
    database.connection
      .prepare(
        `UPDATE plan_snapshots SET semantic_hash = 'invalid'
          WHERE plan_id = 'plan-new'`,
      )
      .run();
    assert.equal(
      (
        await repository.findCanonical({
          date: original.date,
          roomId: original.roomId,
        })
      )?.planId,
      original.planId,
    );
    await repository.storeCanonical(canonical({ planId: 'plan-recovered' }));
    assert.equal(
      (
        await repository.findCanonical({
          date: original.date,
          roomId: original.roomId,
        })
      )?.planId,
      'plan-recovered',
    );
    assert.equal(
      await repository.findCanonical({
        date: original.date,
        roomId: 'room-other' as RoomId,
      }),
      undefined,
    );
  });
});

test('semantic no-op writes repair payload corruption instead of trusting stored hashes', async () => {
  await withRepository(async ({ database, repository }) => {
    const plan = canonical();
    assert.equal((await repository.storeCanonical(plan)).status, 'stored');
    database.connection
      .prepare(
        `UPDATE plan_snapshots
            SET payload_json = json_set(payload_json, '$.planId', 'tampered')
          WHERE plan_kind = 'canonical' AND superseded_at IS NULL`,
      )
      .run();
    assert.equal((await repository.storeCanonical(plan)).status, 'stored');
    assert.equal(
      (await repository.findCanonical({ date: plan.date, roomId: plan.roomId }))
        ?.planId,
      plan.planId,
    );

    const configuration = records().find(
      (record) => record.kind === 'configuration',
    );
    assert.ok(configuration?.kind === 'configuration');
    assert.equal(
      (await repository.storeRecord(configuration)).status,
      'stored',
    );
    database.connection
      .prepare(
        `UPDATE application_records
            SET payload_json = json_set(
              payload_json, '$.data.configurationVersion', 'tampered'
            )
          WHERE record_kind = 'configuration' AND superseded_at IS NULL`,
      )
      .run();
    assert.equal(
      (await repository.storeRecord(configuration)).status,
      'stored',
    );
    assert.deepEqual(
      await repository.findRecord({
        kind: configuration.kind,
        recordKey: configuration.recordKey,
        ...configuration.scope,
      }),
      configuration,
    );
  });
});

test('safe-state recovery binds payload identity and complete scope to row metadata', async () => {
  await withRepository(async ({ database, repository }) => {
    const content = records().find((record) => record.kind === 'content');
    assert.ok(content?.kind === 'content');
    assert.equal((await repository.storeRecord(content)).status, 'stored');
    const mismatched = {
      ...content,
      recordKey: 'content-other',
      scope: { ...content.scope, classId: 'class-other' as ClassId },
      data: {
        ...content.data,
        classId: 'class-other' as ClassId,
      },
    } satisfies SafeStateRecord;
    database.connection
      .prepare(
        `UPDATE application_records SET payload_json = ?, semantic_hash = ?
          WHERE record_kind = 'content' AND superseded_at IS NULL`,
      )
      .run(stableSerialize(mismatched), semanticHash(mismatched));
    assert.equal(
      await repository.findRecord({
        kind: content.kind,
        recordKey: content.recordKey,
        ...content.scope,
      }),
      undefined,
    );
  });
});

function jobOutcome(category: JobOutcome['category']): JobOutcome {
  return {
    contractVersion,
    category,
    runId: `run-${category}`,
    jobName: 'synthetic-reconciliation',
    startedAt: instant,
    finishedAt: instant,
    attemptedExternalMutations: category === 'repair-required' ? 0 : 1,
    completedExternalMutations: category === 'succeeded' ? 1 : 0,
    diagnostics: [],
  } as JobOutcome;
}

function records(): readonly SafeStateRecord[] {
  const scope: StateScope = {
    date: '2035-04-13',
    screenId: screenA,
    roomId: roomAlpha,
    classId: classAlpha,
    meetingId: 'meeting-alpha',
    planId: 'effective-screen-a',
  };
  return [
    {
      kind: 'schedule-observation',
      recordKey: 'observation-alpha',
      scope: { date: '2035-04-13', roomId: roomAlpha },
      data: {
        observation: buildScheduleObservation({
          id: 'observation-alpha',
          date: '2035-04-13',
          kind: 'normal',
          verification: 'verified',
          periods: [
            buildPeriod(
              'period-alpha',
              'course-alpha',
              'A',
              '2035-04-13T08:00:00Z',
              '2035-04-13T09:00:00Z',
              roomAlpha,
            ),
          ],
        }),
      },
    },
    {
      kind: 'configuration',
      recordKey: 'config-alpha',
      scope: {},
      data: {
        configurationVersion: '1',
        effectiveAt: instant,
        timeZone: 'Etc/UTC',
        morningCutoff: '07:30',
        showCheckIn: true,
        checkInOpenMinutesBefore: 5,
        dismissalWarningMinutesBefore: 5,
      },
    },
    {
      kind: 'mapping',
      recordKey: 'mapping-alpha',
      scope,
      data: {
        classId: classAlpha,
        courseKey: 'course-alpha',
        roomId: roomAlpha,
        screenId: screenA,
        periodId: 'period-alpha',
      },
    },
    {
      kind: 'content',
      recordKey: 'content-alpha',
      scope,
      data: {
        classId: classAlpha,
        content: {
          items: [
            { type: 'agenda', title: 'Synthetic agenda', lines: ['One'] },
          ],
        },
      },
    },
    {
      kind: 'vocabulary-selection',
      recordKey: 'vocabulary-alpha',
      scope,
      data: { selection: { diagnostics: [] } },
    },
    {
      kind: 'vocabulary-history',
      recordKey: 'vocabulary-history-alpha',
      scope,
      data: {
        entries: [
          {
            classId: classAlpha,
            meetingKey: 'meeting-alpha',
            date: '2035-04-13',
            term: 'synthetic',
          },
        ],
      },
    },
    {
      kind: 'attendance',
      recordKey: 'attendance-alpha',
      scope,
      data: {
        links: { quick: 'https://fixture.example.invalid/check-in' },
        summary: { responseCount: 3 },
      },
      expiresAt: '2035-04-14T00:00:00Z',
    },
    {
      kind: 'override',
      recordKey: 'override-alpha',
      scope,
      data: {
        override: {
          screenId: screenA,
          date: '2035-04-13',
          announcement: 'Synthetic notice',
        },
      },
    },
    {
      kind: 'hold',
      recordKey: 'hold-alpha',
      scope,
      data: { status: 'held', heldAt: instant, reasonCode: 'operator-request' },
    },
    {
      kind: 'calendar-ownership-candidate',
      recordKey: 'ownership-alpha',
      scope,
      data: {
        scopeId: 'scope-alpha',
        ownershipMarker: 'marker-alpha',
        evidenceReference: 'evidence-alpha',
        status: 'candidate',
      },
    },
    {
      kind: 'calendar-reconciliation-state',
      recordKey: 'calendar-state-alpha',
      scope,
      data: {
        scopeId: 'scope-alpha',
        lastSuccessfulFingerprint: 'fingerprint-alpha',
        completedAt: instant,
      },
    },
    {
      kind: 'job-run',
      recordKey: 'job-alpha',
      scope,
      data: {
        outcome: jobOutcome('succeeded'),
        errorCodes: [],
        incidentCodes: [],
        requestedDates: ['2035-04-13'],
        provenanceReferences: ['observation-alpha'],
        inputFingerprint: 'input-synthetic',
        outputFingerprint: 'fingerprint-alpha',
        latestStateReference: 'calendar-state-alpha',
      },
    },
    {
      kind: 'alert-state',
      recordKey: 'operations-alert-checkpoint',
      scope: {},
      data: {
        activeIssueFingerprints: ['fnv1a64:1111111111111111'],
        lastSuccessfulIssueFingerprints: ['fnv1a64:1111111111111111'],
        lastDecision: 'new',
        decidedAt: instant,
        lastSuccessfulDeliveryAt: instant,
        deliveryMode: 'fake',
        deliveryState: 'delivered',
      },
    },
    {
      kind: 'comparison-evidence',
      recordKey: 'comparison-alpha',
      scope,
      data: {
        comparedAt: instant,
        equal: true,
        differenceCodes: [],
        diagnostics: [],
      },
    },
    {
      kind: 'temporary-operational-state',
      recordKey: 'temporary-alpha',
      scope,
      data: { state: 'ready', code: 'synthetic-ready', observedAt: instant },
      expiresAt: '2035-04-14T00:00:00Z',
    },
  ];
}

test('finite safe state kinds round-trip atomically without cross-scope leakage', async () => {
  await withRepository(async ({ repository }) => {
    const states = records();
    assert.equal(
      repository.storeRecordsAtomically(states).length,
      states.length,
    );
    for (const state of states) {
      assert.deepEqual(
        await repository.findRecord({
          kind: state.kind,
          recordKey: state.recordKey,
          ...state.scope,
        }),
        state,
      );
    }
    const hold = states.find((record) => record.kind === 'hold');
    assert.ok(hold);
    assert.equal(
      await repository.findRecord({
        kind: 'hold',
        recordKey: hold.recordKey,
        date: '2035-04-13',
        screenId: 'screen-other' as ScreenId,
        roomId: roomAlpha,
        classId: classAlpha,
        meetingId: 'meeting-alpha',
      }),
      undefined,
    );
    const content = states.find((record) => record.kind === 'content');
    assert.ok(content);
    for (const mismatchedScope of [
      { ...content.scope, date: '2035-04-14' },
      { ...content.scope, screenId: 'screen-other' as ScreenId },
      { ...content.scope, roomId: 'room-other' as RoomId },
      { ...content.scope, classId: 'class-other' as ClassId },
    ]) {
      assert.equal(
        await repository.findRecord({
          kind: content.kind,
          recordKey: content.recordKey,
          ...mismatchedScope,
        }),
        undefined,
      );
    }
  });
});

test('holds are plan-bound, revision-safe, auditable on release and expiry, and never resurrect history', async () => {
  await withRepository(async ({ database, repository }) => {
    const held = records().find((record) => record.kind === 'hold');
    assert.ok(held);
    const stored = await repository.storeRecord(held);
    assert.equal(stored.status, 'stored');
    assert.equal((await repository.storeRecord(held)).status, 'unchanged');
    const released: Extract<SafeStateRecord, { kind: 'hold' }> = {
      ...held,
      data: { ...held.data, status: 'released', releasedAt: instant },
    };
    const releaseResult = repository.storeHoldTransition(
      released,
      stored.status === 'stored' ? stored.revision : '',
    );
    assert.equal(releaseResult.status, 'stored');
    assert.equal(
      (
        await repository.storeRecord({
          ...released,
          data: { ...released.data, reasonCode: 'generic-bypass' },
        })
      ).status,
      'rejected',
    );
    assert.equal(
      repository.storeHoldTransition(
        {
          ...held,
          data: { ...held.data, status: 'expired', expiredAt: instant },
        },
        releaseResult.status === 'stored' ? releaseResult.revision : '',
      ).status,
      'rejected',
    );
    assert.equal(
      repository.storeHoldTransition(
        {
          ...held,
          data: {
            ...held.data,
            status: 'expired',
            expiredAt: instant,
          },
        },
        stored.status === 'stored' ? stored.revision : '',
      ).status,
      'rejected',
    );
    const loaded = await repository.findRecord({
      kind: 'hold',
      recordKey: held.recordKey,
      ...held.scope,
    });
    assert.equal(loaded?.kind, 'hold');
    assert.equal(
      loaded?.kind === 'hold' ? loaded.data.status : undefined,
      'released',
    );

    const expiring: Extract<SafeStateRecord, { kind: 'hold' }> = {
      ...held,
      recordKey: 'hold-expiring',
      scope: { ...held.scope, planId: 'effective-expiring' },
      data: {
        ...held.data,
        expiresAt: '2035-04-14T00:00:00Z',
      },
      expiresAt: '2035-04-14T00:00:00Z',
    };
    assert.equal((await repository.storeRecord(expiring)).status, 'stored');
    assert.throws(
      () => repository.pruneExpired('z'),
      /state-prune-instant-invalid/u,
    );
    assert.equal(repository.pruneExpired('2035-04-15T00:00:00Z'), 1);
    const expired = await repository.findRecord({
      kind: 'hold',
      recordKey: expiring.recordKey,
      ...expiring.scope,
    });
    assert.equal(expired?.kind, 'hold');
    assert.equal(
      expired?.kind === 'hold' ? expired.data.status : undefined,
      'expired',
    );
    assert.equal(
      Number(
        database.connection
          .prepare(
            `SELECT count(*) AS count FROM application_records
              WHERE record_kind = 'hold' AND record_key = ?`,
          )
          .get(expiring.recordKey)?.count,
      ),
      2,
    );
  });
});

test('retention policy derives cutoffs from the repository clock and rejects caller drift', async () => {
  await withRepository(async ({ database, repository }) => {
    const configuration = records().find(
      (record) => record.kind === 'configuration',
    );
    assert.ok(configuration);
    assert.equal(
      (await repository.storeRecord(configuration)).status,
      'stored',
    );
    assert.throws(
      () => repository.pruneRetentionPolicy('2036-04-13T07:00:00Z'),
      /retention-policy-clock-mismatch/,
    );
    assert.equal(
      Number(
        database.connection
          .prepare(
            "SELECT count(*) AS count FROM application_records WHERE record_kind = 'configuration'",
          )
          .get()?.count,
      ),
      1,
    );
  });
});

test('retention applies every assigned category, preserves boundaries/current state, and rolls back atomically', async () => {
  const insertFixtureRows = (database: SqliteDatabase): void => {
    const insertRecord = database.connection.prepare(
      `INSERT INTO application_records (
         record_id, record_kind, record_key, payload_json, semantic_hash,
         revision, academic_year_end, created_at, superseded_at
       ) VALUES (?, ?, ?, '{}', 'synthetic-hash', 'synthetic-revision', ?, ?, ?)`,
    );
    const rows = [
      ['old-job', 'job-run', 'old-job', null, '2034-01-01T00:00:00Z', null],
      [
        'boundary-job',
        'job-run',
        'boundary-job',
        null,
        '2035-01-13T07:00:00Z',
        null,
      ],
      [
        'old-comparison',
        'comparison-evidence',
        'old-comparison',
        null,
        '2034-01-01T00:00:00Z',
        null,
      ],
      [
        'old-alert',
        'alert-state',
        'operations-alert-checkpoint',
        null,
        '2034-01-01T00:00:00Z',
        '2034-01-02T00:00:00Z',
      ],
      [
        'current-alert',
        'alert-state',
        'operations-alert-checkpoint',
        null,
        instant,
        null,
      ],
      [
        'old-attendance',
        'attendance',
        'old-attendance',
        null,
        '2034-01-01T00:00:00Z',
        null,
      ],
      [
        'old-temporary',
        'temporary-operational-state',
        'old-temporary',
        null,
        '2034-01-01T00:00:00Z',
        null,
      ],
      ['old-content', 'content', 'old-content', '2034-12-31', instant, null],
      [
        'old-vocabulary',
        'vocabulary-history',
        'old-vocabulary',
        '2034-12-31',
        instant,
        null,
      ],
      [
        'old-config',
        'configuration',
        'old-config',
        null,
        instant,
        '2034-01-01T00:00:00Z',
      ],
      [
        'old-mapping',
        'mapping',
        'old-mapping',
        null,
        instant,
        '2034-01-01T00:00:00Z',
      ],
      [
        'old-calendar',
        'calendar-reconciliation-state',
        'old-calendar',
        null,
        instant,
        '2034-01-01T00:00:00Z',
      ],
      [
        'preserved-schedule',
        'schedule-observation',
        'preserved-schedule',
        null,
        '2030-01-01T00:00:00Z',
        '2030-01-02T00:00:00Z',
      ],
      [
        'preserved-override',
        'override',
        'preserved-override',
        null,
        '2030-01-01T00:00:00Z',
        '2030-01-02T00:00:00Z',
      ],
      [
        'preserved-hold',
        'hold',
        'preserved-hold',
        null,
        '2030-01-01T00:00:00Z',
        '2030-01-02T00:00:00Z',
      ],
    ] as const;
    for (const row of rows) insertRecord.run(...row);
    database.connection
      .prepare(
        `INSERT INTO plan_snapshots (
           snapshot_id, plan_kind, plan_id, date_scope, room_id,
           contract_version, verification, payload_json, semantic_hash,
           revision, academic_year_end, created_at
         ) VALUES (
           'old-plan', 'canonical', 'old-plan', '2034-01-01', 'room-old',
           '1.0.0', 'synthetic', '{}', 'synthetic-hash',
           'synthetic-revision', '2034-12-31', ?
         )`,
      )
      .run(instant);
  };

  await withRepository(async ({ database, repository }) => {
    insertFixtureRows(database);
    assert.equal(repository.pruneRetentionPolicy(instant), 11);
    const remaining = database.connection
      .prepare(`SELECT record_id FROM application_records ORDER BY record_id`)
      .all()
      .map((row) => String(row.record_id));
    assert.deepEqual(remaining, [
      'boundary-job',
      'current-alert',
      'preserved-hold',
      'preserved-override',
      'preserved-schedule',
    ]);
    assert.equal(
      Number(
        database.connection
          .prepare('SELECT count(*) AS count FROM plan_snapshots')
          .get()?.count,
      ),
      0,
    );
  });

  await withRepository(
    async ({ database, repository }) => {
      insertFixtureRows(database);
      assert.throws(
        () => repository.pruneRetentionPolicy(instant),
        /synthetic-retention-rollback/,
      );
      assert.equal(
        Number(
          database.connection
            .prepare('SELECT count(*) AS count FROM application_records')
            .get()?.count,
        ),
        15,
      );
      assert.equal(
        Number(
          database.connection
            .prepare('SELECT count(*) AS count FROM plan_snapshots')
            .get()?.count,
        ),
        1,
      );
    },
    () => {
      throw new Error('synthetic-retention-rollback');
    },
  );
});

test('meeting and plan changes invalidate holds audibly while concurrent creations cannot both become current', async () => {
  await withRepository(async ({ database, repository }) => {
    const held = records().find((record) => record.kind === 'hold');
    assert.ok(held?.kind === 'hold');
    assert.equal((await repository.storeRecord(held)).status, 'stored');
    assert.equal(
      repository.invalidateStaleHolds({
        date: held.scope.date!,
        screenId: held.scope.screenId!,
        meetingId: held.scope.meetingId!,
        planId: 'effective-replacement',
        at: '2035-04-13T07:05:00Z',
      }),
      1,
    );
    const stalePlan = await repository.findRecord({
      kind: held.kind,
      recordKey: held.recordKey,
      ...held.scope,
    });
    assert.equal(stalePlan?.kind, 'hold');
    assert.equal(
      stalePlan?.kind === 'hold' ? stalePlan.data.reasonCode : undefined,
      'stale-plan',
    );

    const replacement: Extract<SafeStateRecord, { kind: 'hold' }> = {
      ...held,
      recordKey: 'hold-replacement',
      scope: { ...held.scope, planId: 'effective-replacement' },
      data: { ...held.data, heldAt: '2035-04-13T07:05:00Z' },
    };
    assert.equal((await repository.storeRecord(replacement)).status, 'stored');
    const concurrent = {
      ...replacement,
      recordKey: 'hold-concurrent',
    } satisfies SafeStateRecord;
    assert.equal((await repository.storeRecord(concurrent)).status, 'rejected');
    assert.equal(
      Number(
        database.connection
          .prepare(
            `SELECT count(*) AS count FROM application_records
              WHERE record_kind = 'hold' AND date_scope = ? AND screen_id = ?
                    AND meeting_id = ? AND plan_id = ?
                    AND superseded_at IS NULL`,
          )
          .get(
            replacement.scope.date!,
            replacement.scope.screenId!,
            replacement.scope.meetingId!,
            replacement.scope.planId!,
          )?.count,
      ),
      1,
    );
    assert.equal(
      repository.invalidateStaleHolds({
        date: replacement.scope.date!,
        screenId: replacement.scope.screenId!,
        meetingId: 'meeting-next',
        planId: replacement.scope.planId!,
        at: '2035-04-13T07:10:00Z',
      }),
      1,
    );
    const changedMeeting = await repository.findRecord({
      kind: replacement.kind,
      recordKey: replacement.recordKey,
      ...replacement.scope,
    });
    assert.equal(changedMeeting?.kind, 'hold');
    assert.equal(
      changedMeeting?.kind === 'hold'
        ? changedMeeting.data.reasonCode
        : undefined,
      'meeting-changed',
    );
  });
});

test('released and expired holds can begin a new revision-checked lifecycle', async () => {
  await withRepository(async ({ database, repository }) => {
    const fixture = records().find((record) => record.kind === 'hold');
    assert.ok(fixture?.kind === 'hold');

    const first = await repository.storeRecord(fixture);
    assert.equal(first.status, 'stored');
    const released: Extract<SafeStateRecord, { kind: 'hold' }> = {
      ...fixture,
      data: {
        ...fixture.data,
        status: 'released',
        releasedAt: '2035-04-13T07:05:00Z',
      },
    };
    const release = repository.storeHoldTransition(
      released,
      first.status === 'stored' ? first.revision : '',
    );
    assert.equal(release.status, 'stored');

    const heldAgain: Extract<SafeStateRecord, { kind: 'hold' }> = {
      ...fixture,
      data: {
        status: 'held',
        heldAt: '2035-04-13T07:06:00Z',
        reasonCode: 'operator-requested-again',
      },
    };
    assert.equal((await repository.storeRecord(heldAgain)).status, 'rejected');
    assert.equal(
      repository.storeHoldTransition(
        {
          ...heldAgain,
          data: { ...heldAgain.data, heldAt: '2035-04-13T07:04:00Z' },
        },
        release.status === 'stored' ? release.revision : '',
      ).status,
      'rejected',
    );
    assert.equal(
      repository.storeHoldTransition(
        heldAgain,
        first.status === 'stored' ? first.revision : '',
      ).status,
      'rejected',
    );
    assert.equal(
      repository.storeHoldTransition(
        heldAgain,
        release.status === 'stored' ? release.revision : '',
      ).status,
      'stored',
    );

    const expiring: Extract<SafeStateRecord, { kind: 'hold' }> = {
      ...fixture,
      recordKey: 'hold-repeat-after-expiry',
      scope: { ...fixture.scope, planId: 'effective-repeat-after-expiry' },
      data: {
        status: 'held',
        heldAt: '2035-04-13T08:00:00Z',
        expiresAt: '2035-04-13T08:05:00Z',
        reasonCode: 'timed-hold',
      },
      expiresAt: '2035-04-13T08:05:00Z',
    };
    assert.equal((await repository.storeRecord(expiring)).status, 'stored');
    assert.equal(repository.pruneExpired('2035-04-13T08:05:00Z'), 1);
    const expired = await repository.findRecord({
      kind: expiring.kind,
      recordKey: expiring.recordKey,
      ...expiring.scope,
    });
    assert.ok(expired?.kind === 'hold');

    const currentExpiryRevision = String(
      database.connection
        .prepare(
          `SELECT revision FROM application_records
            WHERE record_kind = 'hold' AND record_key = ?
                  AND superseded_at IS NULL`,
        )
        .get(expiring.recordKey)?.revision ?? '',
    );
    const { expiresAt: _expiry, ...expiringWithoutExpiry } = expiring;
    const heldAfterExpiry: Extract<SafeStateRecord, { kind: 'hold' }> = {
      ...expiringWithoutExpiry,
      data: {
        status: 'held',
        heldAt: '2035-04-13T08:06:00Z',
        reasonCode: 'operator-renewed',
      },
    };
    assert.equal(
      repository.storeHoldTransition(heldAfterExpiry, currentExpiryRevision)
        .status,
      'stored',
    );
  });
});

test('stale-hold invalidation rejects chronology that predates the held instant without changing state', async () => {
  await withRepository(async ({ database, repository }) => {
    const fixture = records().find((record) => record.kind === 'hold');
    assert.ok(fixture?.kind === 'hold');
    const held: Extract<SafeStateRecord, { kind: 'hold' }> = {
      ...fixture,
      data: { ...fixture.data, heldAt: '2035-04-13T08:00:00Z' },
    };
    assert.equal((await repository.storeRecord(held)).status, 'stored');
    assert.throws(
      () =>
        repository.invalidateStaleHolds({
          date: held.scope.date!,
          screenId: held.scope.screenId!,
          meetingId: held.scope.meetingId!,
          planId: 'effective-replacement',
          at: '2035-04-13T07:00:00Z',
        }),
      /hold-invalidation-chronology-invalid/u,
    );
    const loaded = await repository.findRecord({
      kind: held.kind,
      recordKey: held.recordKey,
      ...held.scope,
    });
    assert.equal(loaded?.kind, 'hold');
    assert.equal(
      loaded?.kind === 'hold' ? loaded.data.status : undefined,
      'held',
    );
    assert.equal(
      Number(
        database.connection
          .prepare(
            `SELECT count(*) AS count FROM application_records
              WHERE record_kind = 'hold' AND record_key = ?`,
          )
          .get(held.recordKey)?.count,
      ),
      1,
    );
  });
});

test('hold chronology compares canonical instants rather than their optional-millisecond spelling', async () => {
  await withRepository(async ({ repository }) => {
    const fixture = records().find((record) => record.kind === 'hold');
    assert.ok(fixture?.kind === 'hold');
    const held: Extract<SafeStateRecord, { kind: 'hold' }> = {
      ...fixture,
      data: { ...fixture.data, heldAt: '2035-04-13T08:00:00.500Z' },
    };
    assert.equal((await repository.storeRecord(held)).status, 'stored');
    assert.throws(
      () =>
        repository.invalidateStaleHolds({
          date: held.scope.date!,
          screenId: held.scope.screenId!,
          meetingId: held.scope.meetingId!,
          planId: 'effective-replacement',
          at: '2035-04-13T08:00:00Z',
        }),
      /hold-invalidation-chronology-invalid/u,
    );
    assert.equal(
      (
        await repository.findRecord({
          kind: held.kind,
          recordKey: held.recordKey,
          ...held.scope,
        })
      )?.kind,
      'hold',
    );
  });
});

test('failed state transactions preserve the prior database', async () => {
  let fail = true;
  await withRepository(
    async ({ database, repository }) => {
      const results = repository.storeRecordsAtomically(records().slice(0, 2));
      assert.ok(results.every((result) => result.status === 'rejected'));
      assert.equal(
        Number(
          database.connection
            .prepare('SELECT count(*) AS count FROM application_records')
            .get()?.count,
        ),
        0,
      );
      fail = false;
      assert.ok(
        repository
          .storeRecordsAtomically(records().slice(0, 2))
          .every((result) => result.status === 'stored'),
      );
    },
    () => {
      if (fail) throw new Error('synthetic-before-commit-failure');
    },
  );
});

test('generated persistence metadata fails closed before durable writes', async () => {
  await withRepository(
    async ({ database, repository }) => {
      assert.equal(
        (await repository.storeCanonical(canonical())).status,
        'rejected',
      );
      assert.equal(
        (await repository.storeRecord(records()[0]!)).status,
        'rejected',
      );
      assert.equal(
        Number(
          database.connection
            .prepare('SELECT count(*) AS count FROM plan_snapshots')
            .get()?.count,
        ),
        0,
      );
      assert.equal(
        Number(
          database.connection
            .prepare('SELECT count(*) AS count FROM application_records')
            .get()?.count,
        ),
        0,
      );
    },
    undefined,
    { clock: { now: () => 'a' } },
  );

  await withRepository(
    async ({ database, repository }) => {
      assert.equal(
        (await repository.storeCanonical(canonical())).status,
        'rejected',
      );
      assert.equal(
        Number(
          database.connection
            .prepare('SELECT count(*) AS count FROM plan_snapshots')
            .get()?.count,
        ),
        0,
      );
    },
    undefined,
    { academicYearEndForDate: () => '2035-02-30' },
  );

  let revisions = 0;
  await withRepository(
    async ({ database, repository }) => {
      const results = repository.storeRecordsAtomically(records().slice(0, 2));
      assert.ok(results.every((result) => result.status === 'rejected'));
      assert.equal(
        Number(
          database.connection
            .prepare('SELECT count(*) AS count FROM application_records')
            .get()?.count,
        ),
        0,
      );
    },
    undefined,
    { nextRevision: () => (++revisions === 1 ? 'revision-valid' : '') },
  );
});

test('Calendar fingerprints advance only with successful job results', async () => {
  await withRepository(async ({ repository }) => {
    const state = records().find(
      (record) => record.kind === 'calendar-reconciliation-state',
    );
    assert.ok(state?.kind === 'calendar-reconciliation-state');
    for (const category of [
      'degraded',
      'skipped',
      'repair-required',
      'failed',
    ] as const) {
      const jobRun: Extract<SafeStateRecord, { kind: 'job-run' }> = {
        kind: 'job-run',
        recordKey: `job-${category}`,
        scope: state.scope,
        data: {
          outcome: jobOutcome(category),
          errorCodes: [`${category}-synthetic`],
          incidentCodes: [`incident-${category}`],
          requestedDates: ['2035-04-13'],
          provenanceReferences: ['observation-alpha'],
          inputFingerprint: 'input-synthetic',
        },
      };
      assert.equal(
        repository.storeJobRunAndCalendarState({ jobRun })[0]?.status,
        'stored',
      );
      assert.equal(
        repository.storeJobRunAndCalendarState({
          jobRun,
          calendarState: state,
        })[0]?.status,
        'rejected',
      );
    }
    const jobRun: Extract<SafeStateRecord, { kind: 'job-run' }> = {
      kind: 'job-run',
      recordKey: 'job-succeeded',
      scope: state.scope,
      data: {
        outcome: jobOutcome('succeeded'),
        errorCodes: [],
        incidentCodes: [],
        requestedDates: ['2035-04-13'],
        provenanceReferences: ['observation-alpha'],
        inputFingerprint: 'input-synthetic',
        outputFingerprint: state.data.lastSuccessfulFingerprint,
        latestStateReference: state.recordKey,
      },
    };
    assert.ok(
      repository
        .storeJobRunAndCalendarState({ jobRun, calendarState: state })
        .every((result) => result.status === 'stored'),
    );

    for (const mismatch of [
      {
        ...jobRun,
        scope: { ...jobRun.scope, screenId: 'screen-other' as ScreenId },
      },
      {
        ...jobRun,
        data: { ...jobRun.data, outputFingerprint: 'fingerprint-other' },
      },
      {
        ...jobRun,
        data: { ...jobRun.data, latestStateReference: 'state-other' },
      },
      {
        ...jobRun,
        data: {
          ...jobRun.data,
          outcome: {
            ...jobRun.data.outcome,
            finishedAt: '2035-04-13T07:00:01Z',
          },
        },
      },
      {
        ...jobRun,
        data: { ...jobRun.data, requestedDates: ['2035-04-14'] },
      },
    ] as const)
      assert.equal(
        repository.storeJobRunAndCalendarState({
          jobRun: mismatch,
          calendarState: state,
        })[0]?.status,
        'rejected',
      );

    const unscopedState = {
      ...state,
      recordKey: 'calendar-state-unscoped',
      scope: {},
    } satisfies SafeStateRecord;
    const unscopedRun = {
      ...jobRun,
      recordKey: 'job-unscoped',
      scope: {},
      data: {
        ...jobRun.data,
        requestedDates: [],
        latestStateReference: unscopedState.recordKey,
      },
    } satisfies SafeStateRecord;
    assert.equal(
      repository.storeJobRunAndCalendarState({
        jobRun: unscopedRun,
        calendarState: unscopedState,
      })[0]?.status,
      'rejected',
    );

    type JobRunRecord = Extract<SafeStateRecord, { readonly kind: 'job-run' }>;
    const dirtyRunDataCases: readonly JobRunRecord['data'][] = [
      {
        ...jobRun.data,
        outcome: {
          ...jobRun.data.outcome,
          category: 'succeeded',
          attemptedExternalMutations: 2,
          completedExternalMutations: 1,
        } satisfies JobOutcome,
      },
      { ...jobRun.data, errorCodes: ['write-incomplete'] },
      { ...jobRun.data, incidentCodes: ['incident-write'] },
    ];
    for (const dirtyRunData of dirtyRunDataCases) {
      const dirtyRun = {
        ...jobRun,
        recordKey: `job-dirty-${dirtyRunData.outcome.completedExternalMutations}-${dirtyRunData.errorCodes.length}-${dirtyRunData.incidentCodes.length}`,
        data: dirtyRunData,
      } satisfies SafeStateRecord;
      assert.equal(
        repository.storeJobRunAndCalendarState({
          jobRun: dirtyRun,
          calendarState: state,
        })[0]?.status,
        'rejected',
      );
    }
  });
});

test('runtime-invalid and forbidden record shapes fail closed', async () => {
  await withRepository(async ({ repository }) => {
    const hostilePlan = new Proxy(canonical(), {
      get() {
        throw new Error('synthetic-hostile-plan');
      },
    });
    assert.equal(
      (await repository.storeCanonical(hostilePlan)).status,
      'rejected',
    );
    const sparseRecords = new Array<SafeStateRecord>(1);
    assert.doesNotThrow(() => repository.storeRecordsAtomically(sparseRecords));
    assert.equal(
      repository.storeRecordsAtomically(sparseRecords)[0]?.status,
      'rejected',
    );
    const hostileRecord = new Proxy(records()[0]!, {
      get() {
        throw new Error('synthetic-hostile-record');
      },
    });
    assert.equal(
      (await repository.storeRecord(hostileRecord)).status,
      'rejected',
    );
    const invalid = {
      ...records()[0],
      data: { configurationVersion: '1', unexpected: true },
    } as unknown as SafeStateRecord;
    assert.equal((await repository.storeRecord(invalid)).status, 'rejected');
    for (const forbiddenValue of [
      'Authorization: synthetic-value',
      '/unmanaged/synthetic-state',
    ]) {
      const forbidden = {
        ...records()[1],
        data: {
          ...(records()[1]?.data ?? {}),
          configurationVersion: forbiddenValue,
        },
      } as unknown as SafeStateRecord;
      assert.equal(
        (await repository.storeRecord(forbidden)).status,
        'rejected',
      );
    }
    const invalidPlan = {
      ...canonical(),
      meetings: [
        {
          ...canonical().meetings[0],
          checkInClosesAt: '2035-04-13T08:01:00Z',
        },
      ],
    } as CanonicalPlan;
    assert.equal(
      (await repository.storeCanonical(invalidPlan)).status,
      'rejected',
    );

    for (const plan of [
      canonical({ date: '2035-02-30' }),
      canonical({ date: '2035-99-99' }),
      canonical({ timeZone: 'Invalid/Synthetic_Zone' }),
      canonical({
        meetings: [
          {
            ...canonical().meetings[0]!,
            checkInOpensAt: 'a',
            officialStartsAt: 'b',
            checkInClosesAt: 'b',
            contentStartsAt: 'b',
            dismissalStartsAt: 'c',
            officialEndsAt: 'd',
          },
        ],
      }),
      canonical({
        meetings: [
          {
            ...canonical().meetings[0]!,
            officialStartsAt: '2035-02-30T08:00:00Z',
            checkInClosesAt: '2035-02-30T08:00:00Z',
            contentStartsAt: '2035-02-30T08:00:00Z',
          },
        ],
      }),
    ])
      assert.equal((await repository.storeCanonical(plan)).status, 'rejected');
  });
});

test('every safe-state variant requires its complete data contract', async () => {
  await withRepository(async ({ repository }) => {
    const requiredFieldByKind = {
      'schedule-observation': 'observation',
      configuration: 'configurationVersion',
      mapping: 'classId',
      content: 'content',
      'vocabulary-selection': 'selection',
      'vocabulary-history': 'entries',
      attendance: 'links',
      override: 'override',
      hold: 'status',
      'calendar-ownership-candidate': 'scopeId',
      'calendar-reconciliation-state': 'completedAt',
      'alert-state': 'activeIssueFingerprints',
      'job-run': 'outcome',
      'comparison-evidence': 'comparedAt',
      'temporary-operational-state': 'observedAt',
    } as const;
    assert.equal(records().length, Object.keys(requiredFieldByKind).length);

    for (const record of records()) {
      for (const rootField of ['kind', 'recordKey', 'scope', 'data']) {
        const missingRoot = structuredClone(record) as unknown as Record<
          string,
          unknown
        >;
        delete missingRoot[rootField];
        assert.equal(
          (
            await repository.storeRecord(
              missingRoot as unknown as SafeStateRecord,
            )
          ).status,
          'rejected',
          `${record.kind}.${rootField}`,
        );
      }
      const malformed = structuredClone(record) as unknown as Record<
        string,
        unknown
      >;
      const data = malformed.data as Record<string, unknown>;
      delete data[requiredFieldByKind[record.kind]];
      assert.equal(
        (await repository.storeRecord(malformed as unknown as SafeStateRecord))
          .status,
        'rejected',
        record.kind,
      );
    }
  });
});

test('safe-state validation rejects empty, undefined, non-finite, and malformed nested data', async () => {
  await withRepository(async ({ repository }) => {
    const configuration = records().find(
      (record) => record.kind === 'configuration',
    );
    const content = records().find((record) => record.kind === 'content');
    const observation = records().find(
      (record) => record.kind === 'schedule-observation',
    );
    assert.ok(configuration?.kind === 'configuration');
    assert.ok(content?.kind === 'content');
    assert.ok(observation?.kind === 'schedule-observation');

    const invalidRecords: readonly SafeStateRecord[] = [
      { ...configuration, data: {} } as unknown as SafeStateRecord,
      {
        ...configuration,
        data: { ...configuration.data, timeZone: 'Invalid/Synthetic_Zone' },
      },
      {
        ...configuration,
        data: { ...configuration.data, effectiveAt: 'a' },
      },
      {
        ...configuration,
        data: {
          ...configuration.data,
          checkInOpenMinutesBefore: Number.NaN,
        },
      },
      {
        ...configuration,
        data: {
          ...configuration.data,
          dismissalWarningMinutesBefore: Number.POSITIVE_INFINITY,
        },
      },
      {
        ...configuration,
        data: { ...configuration.data, timeZone: undefined },
      } as unknown as SafeStateRecord,
      {
        ...content,
        data: { ...content.data, content: { items: 'wrong-type' } },
      } as unknown as SafeStateRecord,
      {
        ...content,
        data: {
          ...content.data,
          content: {
            items: [
              {
                type: 'agenda',
                title: 'Synthetic agenda',
                lines: ['One'],
                unexpected: true,
              },
            ],
          },
        },
      } as unknown as SafeStateRecord,
      {
        ...observation,
        data: {
          observation: {
            ...observation.data.observation,
            observedForDate: '2035-02-30',
          },
        },
      },
      {
        ...observation,
        data: {
          observation: {
            ...observation.data.observation,
            provenance: {
              ...observation.data.observation.provenance,
              unexpected: true,
            },
          },
        },
      } as unknown as SafeStateRecord,
    ];

    for (const record of invalidRecords)
      assert.equal((await repository.storeRecord(record)).status, 'rejected');
  });
});

test('variant-specific scope requirements fail closed', async () => {
  await withRepository(async ({ repository }) => {
    const requiredScopeByKind = {
      'schedule-observation': 'date',
      mapping: 'classId',
      content: 'classId',
      'vocabulary-selection': 'meetingId',
      'vocabulary-history': 'classId',
      attendance: 'meetingId',
      override: 'screenId',
      hold: 'planId',
      'comparison-evidence': 'screenId',
    } as const;
    for (const record of records()) {
      const scopeField =
        requiredScopeByKind[record.kind as keyof typeof requiredScopeByKind];
      if (scopeField === undefined) continue;
      const malformed = structuredClone(record) as unknown as Record<
        string,
        unknown
      >;
      delete (malformed.scope as Record<string, unknown>)[scopeField];
      assert.equal(
        (await repository.storeRecord(malformed as unknown as SafeStateRecord))
          .status,
        'rejected',
        record.kind,
      );
    }
  });
});
