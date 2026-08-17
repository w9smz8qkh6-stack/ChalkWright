import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import { startShadowApplication } from '../../src/app/shadow-server.js';
import { planAttendanceContinuityExport } from '../../src/application/persistence/attendance-continuity.js';
import {
  contractVersion,
  type IsoDate,
  type IsoInstant,
} from '../../src/contracts/v1/common.js';
import type { ShadowConfig } from '../../src/config/shadow.js';
import type { CourseworkEnrichment } from '../../src/domain/coursework.js';
import type { ClassId, RoomId, ScreenId } from '../../src/domain/identities.js';
import type { EffectiveDayPlan } from '../../src/domain/plans.js';
import { stableSerialize } from '../../src/domain/pure-values.js';
import { SqliteClassroomEnrichmentCache } from '../../src/infrastructure/sqlite/classroom-cache.js';
import { applyContinuityImport } from '../../src/infrastructure/sqlite/continuity-import.js';
import { SqliteDatabase } from '../../src/infrastructure/sqlite/database.js';
import { SqliteApplicationStateRepository } from '../../src/infrastructure/sqlite/repository.js';

test('starts, restarts, and persists the isolated mutation-disabled shadow reader', async () => {
  const managedRoot = mkdtempSync(join(tmpdir(), 'classroom-hub-m11-shadow-'));
  const stateDirectory = join(managedRoot, 'state');
  const backupDirectory = join(managedRoot, 'backups');
  const databasePath = join(stateDirectory, 'classroom-hub.sqlite');
  mkdirSync(stateDirectory, { mode: 0o700 });
  mkdirSync(backupDirectory, { mode: 0o700 });
  const config: ShadowConfig = {
    instanceId: 'classroom-hub-m11-test-shadow',
    roomId: 'room-c509' as RoomId,
    screenId: 'screen-c509-shadow' as ScreenId,
    screenLabel: 'C509 Shadow Display',
    host: '127.0.0.1',
    port: 0,
    productionPort: 20_790,
    timeZone: 'Asia/Ho_Chi_Minh',
    academicYearEnd: '2027-06-30',
    managedRoot,
    databasePath,
    backupDirectory,
    courseMappings: [
      {
        classId: 'class-c509-a' as ClassId,
        sectionCode: 'Synthetic CODE-A',
        providerCourseKey: '123456789',
        roomId: 'room-c509' as RoomId,
        attendanceClassCode: 'C509-A',
        attendanceCheckInUrl:
          'https://attendance.example.invalid/check-in/C509-A',
      },
    ],
    checkInOpenMinutesBefore: 5,
    dismissalWarningMinutesBefore: 5,
  };
  const date = '2035-04-13' as IsoDate;
  let runtimeInstant = '2035-04-13T01:30:00.000Z' as IsoInstant;
  const plan: EffectiveDayPlan = {
    contractVersion,
    effectivePlanId: 'effective-shadow-test',
    canonicalPlanId: 'canonical-shadow-test',
    date,
    timeZone: config.timeZone,
    roomId: config.roomId,
    screenId: config.screenId,
    verification: 'synthetic',
    meetings: [
      {
        meetingId: 'meeting-shadow-a',
        courseKey: 'CODE-A',
        blockLabel: 'A',
        checkInOpensAt: '2035-04-13T00:55:00.000Z',
        officialStartsAt: '2035-04-13T01:00:00.000Z',
        checkInClosesAt: '2035-04-13T01:00:00.000Z',
        contentStartsAt: '2035-04-13T01:00:00.000Z',
        dismissalStartsAt: '2035-04-13T05:55:00.000Z',
        officialEndsAt: '2035-04-13T06:00:00.000Z',
      },
    ],
    diagnostics: [],
  };
  const database = new SqliteDatabase(databasePath, {
    migration: { appliedAt: new Date().toISOString() },
  });
  let repositoryRevision = 0;
  const repository = new SqliteApplicationStateRepository(database, {
    clock: { now: () => new Date().toISOString() },
    nextRevision: () => `shadow-test-revision-${++repositoryRevision}`,
    academicYearEndForDate: () => config.academicYearEnd,
  });
  assert.equal((await repository.storeEffective(plan)).status, 'stored');
  assert.equal(
    (
      await repository.storeEffective({
        ...plan,
        effectivePlanId: 'effective-shadow-next-day',
        canonicalPlanId: 'canonical-shadow-next-day',
        date: '2035-04-14' as IsoDate,
        meetings: plan.meetings.map((meeting) => ({
          ...meeting,
          meetingId: 'meeting-shadow-next-a',
          checkInOpensAt: '2035-04-14T00:55:00.000Z',
          officialStartsAt: '2035-04-14T01:00:00.000Z',
          checkInClosesAt: '2035-04-14T01:00:00.000Z',
          contentStartsAt: '2035-04-14T01:00:00.000Z',
          dismissalStartsAt: '2035-04-14T05:55:00.000Z',
          officialEndsAt: '2035-04-14T06:00:00.000Z',
        })),
      })
    ).status,
    'stored',
  );
  const attendance = planAttendanceContinuityExport({
    formatVersion: 1,
    exportedAt: '2035-04-13T00:56:00.000Z',
    records: [
      {
        attendanceId: 'attendance-shadow-a',
        classId: 'class-c509-a',
        meetingId: 'meeting-shadow-a',
        date,
        refreshedAt: '2035-04-13T00:56:00.000Z',
        links: {},
        summary: {
          rosterCount: 20,
          presentCount: 16,
          tardyCount: 1,
          absentCount: 3,
          responseCount: 17,
        },
        provenance: {
          source: 'synthetic-fixture',
          method: 'fixture',
          observedAt: '2035-04-13T00:56:00.000Z',
          verification: 'synthetic',
          sourceReference: 'fixture:attendance-shadow-a',
        },
      },
    ],
  });
  assert.equal(attendance.status, 'accepted');
  if (attendance.status !== 'accepted') return;
  assert.equal(
    applyContinuityImport({
      database,
      plan: attendance.plan,
      sourceReference: 'fixture:m12-shadow-attendance',
      clock: { now: () => '2035-04-13T00:57:00.000Z' },
      nextImportId: () => 'shadow-attendance-import',
    }).status,
    'imported',
  );
  const enrichment: CourseworkEnrichment = {
    observedForDate: date,
    classId: 'class-c509-a' as ClassId,
    freshness: 'fresh',
    recent: [],
    upcoming: [
      {
        itemId: 'coursework-shadow-a',
        providerCourseKey: '123456789',
        providerItemKey: 'item-shadow-a',
        classId: 'class-c509-a' as ClassId,
        title: 'Synthetic Unit 1 project',
        description: 'Synthetic display-only coursework.',
        materials: [],
        workType: 'ASSIGNMENT',
        state: 'PUBLISHED',
        assignedCount: 0,
        submittedCount: 0,
        updateTime: '2035-04-13T01:15:00.000Z',
        dueDate: '2035-04-14',
        dueLabel: 'Saturday, April 14',
        bucket: 'upcoming',
      },
    ],
    refreshedAt: '2035-04-13T01:15:00.000Z',
    provenanceReference: 'google-classroom:synthetic-shadow-a',
  };
  const cache = new SqliteClassroomEnrichmentCache(database);
  assert.equal(
    (
      await cache.storeSuccess({
        enrichment,
        expiresAt: '2035-04-13T03:00:00.000Z',
      })
    ).status,
    'stored',
  );
  const contentSnapshot = {
    snapshotId: 'content-shadow-a',
    classId: 'class-c509-a',
    screenId: config.screenId,
    roomId: config.roomId,
    date,
    refreshedAt: '2035-04-13T01:16:00.000Z',
    items: [
      {
        type: 'bellringer',
        title: 'Bellringer: Inspect the synthetic reference',
        lines: ['Compare the mechanism with the lesson diagram.'],
      },
    ],
    diagnostics: [],
  };
  const vocabularySelection = {
    selectionId: 'vocabulary-shadow-a',
    classId: 'class-c509-a',
    meetingKey: 'meeting-shadow-a',
    date,
    term: 'iteration',
    definition: 'A repeated design process.',
    source: 'subject',
    partOfSpeech: 'noun',
    vietnamese: {
      term: 'sự lặp lại',
      definition: 'Một quá trình thiết kế được lặp lại.',
    },
    selectionContext: {
      assignmentRefs: [],
      classroomCourseId: '123456789',
      meetingDate: date,
      vocabularyPolicy: 'unused_focused',
      vocabularyReuse: 'new',
      candidateCount: 1,
      usedCandidateCount: 0,
      unusedCandidateCount: 1,
    },
  };
  const insertContinuity = database.connection.prepare(
    `INSERT INTO continuity_records(
       collection, identity, checksum, record_json, source_reference, imported_at
     ) VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const [collection, identity, value] of [
    ['contentSnapshots', contentSnapshot.snapshotId, contentSnapshot],
    [
      'vocabularySelections',
      vocabularySelection.selectionId,
      vocabularySelection,
    ],
  ] as const) {
    const payload = stableSerialize(value);
    insertContinuity.run(
      collection,
      identity,
      createHash('sha256').update(payload).digest('hex'),
      payload,
      `fixture:${collection}`,
      '2035-04-13T01:17:00.000Z',
    );
  }
  database.close();

  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const application = await startShadowApplication(config, process.cwd(), {
        clock: { now: () => runtimeInstant },
      });
      try {
        assert.notEqual(application.port, config.productionPort);
        assert.match(application.origin, /^http:\/\/127\.0\.0\.1:/u);
        assert.equal((await fetch(`${application.origin}/health`)).status, 200);
        assert.equal((await fetch(`${application.origin}/ready`)).status, 200);
        assert.equal((await fetch(`${application.origin}/tv`)).status, 404);
        const target = (await (
          await fetch(`${application.origin}/target/${config.screenId}`)
        ).json()) as {
          readonly content?: {
            readonly cards?: readonly {
              readonly title?: string;
              readonly lines?: readonly string[];
            }[];
          };
        };
        const objective = target.content?.cards?.find(
          (card) => card.title === "Today's objective",
        );
        assert.ok(objective);
        assert.ok(
          objective.lines?.includes('Synthetic Unit 1 project'),
          'fresh normalized Classroom cache must project into shadow display content',
        );
        assert.equal(
          target.content?.cards?.some(
            (card) =>
              card.title === 'Bellringer: Inspect the synthetic reference',
          ),
          true,
          'copied static lesson content must project independently of the legacy runtime',
        );
        assert.equal(
          target.content?.cards?.some(
            (card) => card.title === 'Word of the day',
          ),
          true,
          'meeting-scoped vocabulary must project from Chalkwright-owned SQLite',
        );

        runtimeInstant = '2035-04-13T00:57:00.000Z' as IsoInstant;
        const preCheckIn = (await (
          await fetch(`${application.origin}/target/${config.screenId}`)
        ).json()) as {
          readonly state?: string;
          readonly qrTarget?: string;
          readonly attendanceClassCode?: string;
          readonly attendance?: { readonly presentCount?: number };
        };
        assert.equal(preCheckIn.state, 'pre_checkin');
        assert.equal(
          preCheckIn.qrTarget,
          'https://attendance.example.invalid/check-in/C509-A',
        );
        assert.equal(preCheckIn.attendanceClassCode, 'C509-A');
        assert.equal(preCheckIn.attendance?.presentCount, 16);
        const preCheckInDisplay = await (
          await fetch(
            `${application.origin}/preview/${config.screenId}?view=display&now=2035-04-13T00%3A57%3A00.000Z`,
          )
        ).text();
        assert.match(preCheckInDisplay, />C509-A</u);
        assert.match(preCheckInDisplay, />Present<\/span><strong[^>]*>16</u);
        assert.match(preCheckInDisplay, /Attendance check-in QR code/u);
        assert.equal(
          (
            await fetch(
              `${application.origin}/qr/${config.screenId}/meeting-shadow-a.png?date=${date}`,
            )
          ).status,
          200,
        );

        runtimeInstant = '2035-04-13T06:01:00.000Z' as IsoInstant;
        const dayComplete = (await (
          await fetch(`${application.origin}/target/${config.screenId}`)
        ).json()) as {
          readonly state?: string;
          readonly nextClassDayLabel?: string;
          readonly nextClassDayPlan?: {
            readonly date?: string;
            readonly meetings?: readonly unknown[];
          };
        };
        assert.equal(dayComplete.state, 'day_complete');
        assert.equal(dayComplete.nextClassDayLabel, 'Tomorrow');
        assert.equal(dayComplete.nextClassDayPlan?.date, '2035-04-14');
        assert.equal(dayComplete.nextClassDayPlan?.meetings?.length, 1);

        runtimeInstant = '2035-04-13T03:30:00.000Z' as IsoInstant;
        const staleTarget = (await (
          await fetch(`${application.origin}/target/${config.screenId}`)
        ).json()) as {
          readonly content?: {
            readonly cards?: readonly { readonly title?: string }[];
          };
        };
        assert.equal(
          staleTarget.content?.cards?.some(
            (card) => card.title === "Today's objective",
          ),
          false,
          'stale Classroom cache must not generate display objectives',
        );
        assert.equal(
          (
            await fetch(`${application.origin}/overrides/${config.screenId}`, {
              method: 'PUT',
              headers: { 'content-type': 'application/json' },
              body: '{}',
            })
          ).status,
          503,
        );
      } finally {
        await application.close();
      }
      runtimeInstant = '2035-04-13T01:30:00.000Z' as IsoInstant;
    }

    const compatibilityApplication = await startShadowApplication(
      config,
      process.cwd(),
      {
        clock: { now: () => runtimeInstant },
        legacyRouteCompatibility: true,
      },
    );
    try {
      const display = await fetch(
        `${compatibilityApplication.origin}/classroom-screen/b407`,
      );
      assert.equal(display.status, 200);
      const displayHtml = await display.text();
      assert.match(
        displayHtml,
        /href="\/classroom-screen\/assets\/display\.css"/u,
      );
      assert.match(
        displayHtml,
        /data-target-url="\/classroom-screen\/target\/screen-c509-shadow"/u,
      );
      for (const route of [
        '/classroom-screen/api/displays',
        '/classroom-screen/api/day-plan/b407?date=2035-04-13',
        '/classroom-screen/api/target/b407',
        '/classroom-screen/api/preview/b407?date=2035-04-13',
        '/classroom-screen/manifest.json',
        '/classroom-screen/icon.svg',
        '/classroom-screen/health',
        '/classroom-screen/ready',
      ]) {
        assert.equal(
          (await fetch(`${compatibilityApplication.origin}${route}`)).status,
          200,
          route,
        );
      }
      assert.equal(
        (await fetch(`${compatibilityApplication.origin}/ready`)).status,
        404,
      );
    } finally {
      await compatibilityApplication.close();
    }

    const emptyDatabase = new SqliteDatabase(databasePath, {
      migration: { appliedAt: new Date().toISOString() },
    });
    const emptyRepository = new SqliteApplicationStateRepository(
      emptyDatabase,
      {
        clock: { now: () => new Date().toISOString() },
        nextRevision: () => 'shadow-empty-plan-revision',
        academicYearEndForDate: () => config.academicYearEnd,
      },
    );
    assert.equal(
      (
        await emptyRepository.storeEffective({
          ...plan,
          effectivePlanId: 'effective-shadow-empty',
          canonicalPlanId: 'canonical-shadow-empty',
          verification: 'verified',
          meetings: [],
          diagnostics: [
            {
              code: 'schedule-no-classes',
              severity: 'info',
              message:
                'The verified schedule contains no classes for the requested date.',
            },
          ],
        })
      ).status,
      'stored',
    );
    emptyDatabase.close();

    const emptyApplication = await startShadowApplication(
      config,
      process.cwd(),
      { clock: { now: () => runtimeInstant } },
    );
    try {
      assert.equal(
        (await fetch(`${emptyApplication.origin}/ready`)).status,
        200,
      );
      const emptyDayPlan = (await (
        await fetch(
          `${emptyApplication.origin}/day-plan/${config.screenId}?date=${date}`,
        )
      ).json()) as {
        readonly plan?: { readonly meetings?: readonly unknown[] };
      };
      assert.deepEqual(emptyDayPlan.plan?.meetings, []);
      const emptyTarget = (await (
        await fetch(`${emptyApplication.origin}/target/${config.screenId}`)
      ).json()) as { readonly state?: string };
      assert.equal(emptyTarget.state, 'no_classes');
    } finally {
      await emptyApplication.close();
    }
    assert.equal(existsSync(databasePath), true);
  } finally {
    rmSync(managedRoot, { recursive: true, force: true });
  }
});
