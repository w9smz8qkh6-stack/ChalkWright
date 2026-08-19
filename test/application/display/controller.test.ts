import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import { FixtureBackedDisplayController } from '../../../src/application/display/controller.js';
import type { DisplayState } from '../../../src/contracts/v1/display.js';
import { SqliteDatabase } from '../../../src/infrastructure/sqlite/database.js';
import { SqliteApplicationStateRepository } from '../../../src/infrastructure/sqlite/repository.js';
import {
  b407Date,
  b407ClassA,
  b407FixtureData,
  b407NoClassesPlan,
  b407Plan,
  b407Room,
  b407Screen,
  b407SecondaryPlan,
  b407SecondaryScreen,
  b407StateInstants,
  MutableFixturePlanSource,
  SqliteFixtureDisplayStore,
  SqliteFixtureOverrideStore,
} from '../../../src/infrastructure/fixture/b407.js';

const fixtureNow = '2035-04-13T07:00:00Z';

function fixture(
  data = b407FixtureData,
  dateForInstant?: (instant: string) => string,
) {
  const directory = mkdtempSync(join(tmpdir(), 'classroom-hub-display-'));
  const database = new SqliteDatabase(join(directory, 'state.sqlite'), {
    migration: { appliedAt: fixtureNow },
  });
  let revision = 0;
  const repository = new SqliteApplicationStateRepository(database, {
    clock: { now: () => fixtureNow },
    nextRevision: () => `display-revision-${++revision}`,
    academicYearEndForDate: () => '2035-06-30',
  });
  const source = new MutableFixturePlanSource([
    b407Plan,
    b407SecondaryPlan,
    b407NoClassesPlan,
  ]);
  const persistence = new SqliteFixtureDisplayStore(database, repository);
  const overrides = new SqliteFixtureOverrideStore(repository);
  const controller = new FixtureBackedDisplayController({
    data,
    plans: source,
    planStore: persistence,
    overrides,
    holds: persistence,
    ...(dateForInstant === undefined ? {} : { dateForInstant }),
  });
  return {
    controller,
    database,
    source,
    persistence,
    overrides,
    close: () => {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

test('selects all eight display states from deterministic B407 instants', async () => {
  const item = fixture();
  try {
    for (const [expected, instant] of Object.entries(b407StateInstants) as [
      DisplayState,
      string,
    ][]) {
      const target = await item.controller.getTarget(b407Screen, instant);
      assert.equal(target.state?.state, expected, `${expected} at ${instant}`);
    }
  } finally {
    item.close();
  }
});

test('composes synthetic objectives, coursework, vocabulary, attendance, and QR scope', async () => {
  const item = fixture();
  try {
    const target = await item.controller.getTarget(
      b407Screen,
      b407StateInstants.in_class_content,
    );
    assert.deepEqual(
      target.content.cards.map((card) => card.type),
      ['objective', 'coursework', 'vocabulary'],
    );
    assert.equal(target.attendance?.presentCount, 20);
    assert.equal(target.attendanceClassCode, 'WD-A');
    assert.equal(target.nextClassDayLabel, 'Next Week');
    assert.equal(target.nextClassDayPlan?.date, '2035-04-16');
    assert.equal(target.nextClassDayPlan?.meetings.length, 2);
    assert.equal(
      target.qrTarget,
      'https://fixture.example.invalid/attendance/b407-a',
    );
    assert.equal(
      await item.controller.qrTarget(b407Screen, b407Date, 'meeting-b407-a'),
      target.qrTarget,
    );
    await assert.rejects(
      () =>
        item.controller.qrTarget(b407Screen, '2035-04-14', 'meeting-b407-a'),
      /qr-scope-mismatch/u,
    );
    await assert.rejects(
      () => item.controller.qrTarget(b407Screen, b407Date, 'meeting-unrelated'),
      /qr-scope-mismatch/u,
    );
    assert.equal(item.controller.listAssets().length, 2);
    assert.equal(item.controller.listMedia()[0]?.acceptsRanges, true);
  } finally {
    item.close();
  }
});

test('uses validated attendance-link precedence for display and QR targets', async () => {
  const data = {
    ...structuredClone(b407FixtureData),
    attendanceLinksByMeeting: {
      ...b407FixtureData.attendanceLinksByMeeting,
      'meeting-b407-a': {
        directPrefilled: 'javascript:alert(1)',
        directResponder:
          'https://user:password@fixture.example.invalid/private',
        wrapper: 'https://fixture.example.invalid/attendance/validated-wrapper',
        quick: 'https://fixture.example.invalid/attendance/quick',
      },
    },
  };
  const item = fixture(data);
  try {
    const target = await item.controller.getTarget(
      b407Screen,
      b407StateInstants.in_class_content,
    );
    assert.equal(
      target.qrTarget,
      'https://fixture.example.invalid/attendance/validated-wrapper',
    );
    assert.equal(
      await item.controller.qrTarget(b407Screen, b407Date, 'meeting-b407-a'),
      target.qrTarget,
    );
  } finally {
    item.close();
  }
});

test('preview applies a proposed override without persisting or mutating it', async () => {
  const item = fixture();
  try {
    const proposed = {
      screenId: b407Screen,
      date: b407Date,
      announcement: 'Synthetic preview announcement',
      classes: {
        'meeting-b407-a': {
          hideAssignments: true,
          cards: [
            {
              cardId: 'preview-card',
              title: 'Preview only',
              lines: ['This card must not be persisted.'],
            },
          ],
        },
      },
    } as const;
    const before = structuredClone(proposed);
    const storedBefore = item.database.connection
      .prepare('SELECT COUNT(*) AS count FROM plan_snapshots')
      .get() as { count: number };
    const preview = await item.controller.getPreview(
      b407Screen,
      b407StateInstants.in_class_content,
      proposed,
    );
    assert.equal(preview.content.announcement?.title, 'Announcement');
    assert.equal(preview.content.assignmentsVisible, false);
    assert.ok(preview.timeline.length > 0);
    assert.deepEqual(proposed, before);
    const storedAfter = item.database.connection
      .prepare('SELECT COUNT(*) AS count FROM plan_snapshots')
      .get() as { count: number };
    assert.equal(storedAfter.count, storedBefore.count);
    assert.equal(
      await item.controller.getOverride(b407Screen, b407Date),
      undefined,
    );
  } finally {
    item.close();
  }
});

test('validates, scopes, reads, writes, and deletes overrides', async () => {
  const item = fixture();
  try {
    const override = {
      screenId: b407Screen,
      date: b407Date,
      simulator: {
        forcedState: 'dismissal_warning',
        forcedMeetingId: 'meeting-b407-a',
      },
      classes: {
        'class-b407-a': {
          dismissalMessage: 'Synthetic dismissal',
        },
      },
    } as const;
    await item.controller.putOverride(override);
    const reloaded = new FixtureBackedDisplayController({
      data: b407FixtureData,
      plans: item.source,
      planStore: item.persistence,
      overrides: item.overrides,
      holds: item.persistence,
    });
    assert.deepEqual(
      await reloaded.getOverride(b407Screen, b407Date),
      override,
    );
    const target = await item.controller.getTarget(
      b407Screen,
      b407StateInstants.in_class_content,
    );
    assert.equal(target.state?.state, 'dismissal_warning');
    assert.equal(target.content.dismissalMessage, 'Synthetic dismissal');
    assert.equal(
      await item.controller.getOverride(b407SecondaryScreen, b407Date),
      undefined,
    );
    assert.equal(
      await item.controller.deleteOverride(b407Screen, b407Date),
      true,
    );
    assert.equal(
      await item.controller.getOverride(b407Screen, b407Date),
      undefined,
    );
  } finally {
    item.close();
  }
});

test('forced meetings select matching content, attendance, QR, and preview scope', async () => {
  const item = fixture();
  try {
    const forced = {
      screenId: b407Screen,
      date: b407Date,
      simulator: {
        forcedState: 'in_class_content',
        forcedMeetingId: 'meeting-b407-b',
      },
    } as const;
    await item.controller.putOverride(forced);
    const target = await item.controller.getTarget(
      b407Screen,
      b407StateInstants.in_class_content,
    );
    assert.equal(target.meetingId, 'meeting-b407-b');
    assert.equal(target.classId, 'class-b407-b');
    assert.deepEqual(
      target.content.cards.map((card) => card.cardId),
      ['objective-b407-b'],
    );
    assert.equal(target.attendance?.responseCount, 0);
    assert.equal(target.attendanceClassCode, 'RB-B');
    assert.equal(
      target.qrTarget,
      'https://fixture.example.invalid/attendance/b407-b',
    );
    const preview = await item.controller.getPreview(
      b407Screen,
      b407StateInstants.in_class_content,
    );
    assert.equal(preview.meetingId, 'meeting-b407-b');
    assert.equal(preview.attendanceClassCode, 'RB-B');
    assert.equal(preview.nextClassDayPlan?.date, '2035-04-16');
    assert.deepEqual(
      preview.content.cards.map((card) => card.cardId),
      ['objective-b407-b'],
    );
    assert.ok(preview.originalPlan);
    assert.ok(preview.effectivePlan);
    assert.equal(preview.forcedTarget?.currentMeetingId, 'meeting-b407-b');

    await item.controller.putOverride({
      ...forced,
      simulator: { ...forced.simulator, forcedMeetingId: 'meeting-unknown' },
    });
    await assert.rejects(
      () =>
        item.controller.getTarget(
          b407Screen,
          b407StateInstants.in_class_content,
        ),
      /override-forced-meeting-invalid/u,
    );
    await assert.rejects(
      () =>
        item.controller.getPreview(
          b407Screen,
          b407StateInstants.in_class_content,
        ),
      /override-forced-meeting-invalid/u,
    );
  } finally {
    item.close();
  }
});

test('serves scoped last-known-good state during failure and recovers', async () => {
  const item = fixture();
  try {
    const initial = await item.controller.getPlan(b407Screen, b407Date);
    assert.equal(initial.source, 'current');
    await item.controller.getPlan(b407SecondaryScreen, b407Date);
    item.source.setAvailable(false);
    const degraded = await item.controller.getPlan(b407Screen, b407Date);
    assert.equal(degraded.source, 'last-known-good');
    assert.equal(degraded.degraded, true);
    assert.equal(item.controller.health(fixtureNow).status, 'degraded');
    const other = await item.controller.getPlan(b407SecondaryScreen, b407Date);
    assert.equal(other.source, 'last-known-good');
    const unready = await item.controller.readiness(fixtureNow);
    assert.equal(unready.ready, false);
    assert.deepEqual([...unready.degradedScreens].sort(), [
      b407Screen,
      b407SecondaryScreen,
    ]);

    item.source.setAvailable(true);
    const recoveredPlan = {
      ...b407Plan,
      effectivePlanId: 'effective-b407-recovered',
    };
    item.source.setPlan(recoveredPlan);
    const recovered = await item.controller.getPlan(b407Screen, b407Date);
    assert.equal(recovered.plan?.effectivePlanId, 'effective-b407-recovered');
    assert.equal(recovered.degraded, false);
    assert.equal((await item.controller.readiness(fixtureNow)).ready, true);
    assert.equal(item.controller.health(fixtureNow).status, 'ok');
  } finally {
    item.close();
  }
});

test('readiness uses the configured local display date instead of the UTC date', async () => {
  const item = fixture(b407FixtureData, () => b407Date);
  try {
    const ready = await item.controller.readiness('2035-04-12T17:05:00.000Z');

    assert.equal(ready.ready, true);
    assert.deepEqual(ready.missingScreens, []);
    assert.deepEqual(ready.degradedScreens, []);
  } finally {
    item.close();
  }
});

test('normal target evaluation audits timed expiry and permits a revision-checked repeat', async () => {
  const item = fixture();
  try {
    const scope = {
      date: b407Date,
      screenId: b407Screen,
      roomId: b407Room,
      classId: b407ClassA,
      meetingId: 'meeting-b407-a',
      planId: b407Plan.effectivePlanId,
    } as const;
    const held = await item.controller.hold({
      ...scope,
      heldAt: '2035-04-13T08:00:00Z',
      expiresAt: '2035-04-13T08:01:00Z',
      reasonCode: 'synthetic-timed-hold',
    });
    assert.equal(held.status, 'stored');
    assert.equal(
      (await item.controller.getTarget(b407Screen, '2035-04-13T08:02:00Z'))
        .hold,
      undefined,
    );
    const terminal = await item.controller.getHold(scope);
    assert.equal(terminal?.record.data.status, 'expired');
    const repeated = await item.controller.hold({
      ...scope,
      heldAt: '2035-04-13T08:02:00Z',
      reasonCode: 'synthetic-repeat-after-expiry',
      expectedRevision: terminal?.revision,
    });
    assert.equal(repeated.status, 'stored');
  } finally {
    item.close();
  }
});

test('persists revision-checked hold release, repeat, expiry, and screen isolation', async () => {
  const item = fixture();
  try {
    const scope = {
      date: b407Date,
      screenId: b407Screen,
      roomId: b407Room,
      classId: b407ClassA,
      meetingId: 'meeting-b407-a',
      planId: b407Plan.effectivePlanId,
    } as const;
    const held = await item.controller.hold({
      ...scope,
      heldAt: '2035-04-13T08:01:00Z',
      reasonCode: 'synthetic-operator-hold',
    });
    assert.equal(held.status, 'stored');
    const reloaded = new FixtureBackedDisplayController({
      data: b407FixtureData,
      plans: item.source,
      planStore: item.persistence,
      overrides: item.overrides,
      holds: item.persistence,
    });
    assert.equal(
      (await reloaded.getTarget(b407Screen, '2035-04-13T08:02:00Z')).hold
        ?.record.data.status,
      'held',
    );
    assert.equal(
      (
        await item.controller.getTarget(
          b407SecondaryScreen,
          '2035-04-13T08:02:00Z',
        )
      ).hold,
      undefined,
    );

    const released = await item.controller.releaseHold({
      ...scope,
      releasedAt: '2035-04-13T08:03:00Z',
      reasonCode: 'synthetic-operator-release',
      expectedRevision: held.status === 'stored' ? held.revision : '',
    });
    assert.equal(released.status, 'stored');
    assert.equal(
      (await item.controller.getTarget(b407Screen, '2035-04-13T08:04:00Z'))
        .hold,
      undefined,
    );

    const repeated = await item.controller.hold({
      ...scope,
      heldAt: '2035-04-13T08:05:00Z',
      expiresAt: '2035-04-13T08:06:00Z',
      reasonCode: 'synthetic-repeat-hold',
      expectedRevision: released.status === 'stored' ? released.revision : '',
    });
    assert.equal(repeated.status, 'stored');
    assert.equal(item.controller.expireHolds('2035-04-13T08:06:00Z'), 1);
    assert.equal(
      (await item.controller.getTarget(b407Screen, '2035-04-13T08:07:00Z'))
        .hold,
      undefined,
    );
  } finally {
    item.close();
  }
});
