import assert from 'node:assert/strict';
import test from 'node:test';

import {
  contractVersion,
  type ScheduleObservation,
} from '../../src/contracts/v1/index.js';
import {
  selectDisplayState,
  selectNextClassDay,
} from '../../src/application/read-only/state-machine.js';
import { selectPlanSource } from '../../src/domain/fallback-plans.js';
import type { ClassId, RoomId, ScreenId } from '../../src/domain/identities.js';
import {
  deriveCanonicalPlan,
  projectEffectivePlan,
} from '../../src/domain/plan-derivation.js';
import type {
  CanonicalPlan,
  EffectiveDayPlan,
} from '../../src/domain/plans.js';
import {
  buildMeeting,
  buildScheduleObservation,
  buildPeriod,
} from '../fixtures/builders.js';

const room = 'room-alpha' as RoomId;
const screen = 'screen-alpha' as ScreenId;
const mappings = [
  {
    classId: 'class-alpha' as ClassId,
    sectionCode: 'Course Alpha',
    roomId: room,
    periodId: 'p1',
  },
  {
    classId: 'class-beta' as ClassId,
    sectionCode: 'Course Beta',
    roomId: room,
    periodId: 'p2',
  },
];

function observation(
  kind: ScheduleObservation['kind'] = 'normal',
  freshness: 'fresh' | 'stale' = 'fresh',
) {
  return buildScheduleObservation({
    id: `obs-${kind}-${freshness}`,
    date: '2035-04-13',
    kind,
    freshness,
    verification: 'verified',
    periods:
      kind === 'no-classes'
        ? []
        : [
            buildPeriod(
              'p1',
              'course-alpha',
              'Block A',
              '2035-04-13T08:00:00Z',
              '2035-04-13T09:00:00Z',
              room,
            ),
            buildPeriod(
              'p2',
              'course-beta',
              'Block B',
              '2035-04-13T09:10:00Z',
              '2035-04-13T10:00:00Z',
              room,
            ),
          ],
  });
}

function effective(): EffectiveDayPlan {
  return {
    contractVersion,
    effectivePlanId: 'effective-alpha',
    canonicalPlanId: 'plan-alpha',
    date: '2035-04-13',
    timeZone: 'Etc/UTC',
    roomId: room,
    screenId: screen,
    verification: 'synthetic',
    meetings: [
      buildMeeting({
        id: 'm1',
        courseKey: 'course-alpha',
        blockLabel: 'A',
        checkInOpensAt: '2035-04-13T07:55:00Z',
        officialStartsAt: '2035-04-13T08:00:00Z',
        checkInClosesAt: '2035-04-13T08:00:00Z',
        contentStartsAt: '2035-04-13T08:00:00Z',
        dismissalStartsAt: '2035-04-13T08:55:00Z',
        officialEndsAt: '2035-04-13T09:00:00Z',
      }),
      buildMeeting({
        id: 'm2',
        courseKey: 'course-beta',
        blockLabel: 'B',
        checkInOpensAt: '2035-04-13T09:05:00Z',
        officialStartsAt: '2035-04-13T09:10:00Z',
        checkInClosesAt: '2035-04-13T09:10:00Z',
        contentStartsAt: '2035-04-13T09:10:00Z',
        dismissalStartsAt: '2035-04-13T09:55:00Z',
        officialEndsAt: '2035-04-13T10:00:00Z',
      }),
    ],
    diagnostics: [],
  };
}

test('derives fresh verified normal, special, and empty plans deterministically', () => {
  for (const kind of ['normal', 'special'] as const) {
    const first = deriveCanonicalPlan(observation(kind), room, mappings, {
      timeZone: 'Etc/UTC',
      checkInOpenMinutesBefore: 5,
      dismissalWarningMinutesBefore: 5,
    });
    const second = deriveCanonicalPlan(observation(kind), room, mappings, {
      timeZone: 'Etc/UTC',
      checkInOpenMinutesBefore: 5,
      dismissalWarningMinutesBefore: 5,
    });
    assert.equal(first.status, 'planned');
    assert.equal(JSON.stringify(first), JSON.stringify(second));
    if (first.status === 'planned')
      assert.equal(
        first.plan.meetings[0]?.checkInOpensAt,
        '2035-04-13T07:55:00.000Z',
      );
  }
  const empty = deriveCanonicalPlan(observation('no-classes'), room, [], {
    timeZone: 'Etc/UTC',
    checkInOpenMinutesBefore: 5,
    dismissalWarningMinutesBefore: 5,
  });
  assert.equal(empty.status, 'planned');
  for (const contradictory of [
    { ...observation(), kind: 'no-classes' as const },
    { ...observation('no-classes'), kind: 'normal' as const },
  ]) {
    const rejected = deriveCanonicalPlan(contradictory, room, mappings, {
      timeZone: 'Etc/UTC',
      checkInOpenMinutesBefore: 5,
      dismissalWarningMinutesBefore: 5,
    });
    assert.equal(rejected.status, 'rejected');
    assert.ok(
      rejected.diagnostics.some(
        (item) => item.code === 'schedule-kind-periods-mismatch',
      ),
    );
  }
  const stale = deriveCanonicalPlan(
    observation('normal', 'stale'),
    room,
    mappings,
    {
      timeZone: 'Etc/UTC',
      checkInOpenMinutesBefore: 5,
      dismissalWarningMinutesBefore: 5,
    },
  );
  assert.equal(stale.status, 'rejected');
  assert.ok(
    stale.diagnostics.some(
      (item) => item.code === 'schedule-not-authoritative',
    ),
  );
  const unverified = deriveCanonicalPlan(
    { ...observation(), verification: 'unverified' },
    room,
    mappings,
    {
      timeZone: 'Etc/UTC',
      checkInOpenMinutesBefore: 5,
      dismissalWarningMinutesBefore: 5,
    },
  );
  assert.equal(unverified.status, 'rejected');
});

test('rejects malformed intervals and diagnoses missing or partial mappings without reassignment', () => {
  const malformed = {
    ...observation(),
    periods: [
      { ...observation().periods[0]!, startsAt: 'bad', endsAt: 'also-bad' },
    ],
  };
  assert.equal(
    deriveCanonicalPlan(malformed, room, mappings, {
      timeZone: 'Etc/UTC',
      checkInOpenMinutesBefore: 5,
      dismissalWarningMinutesBefore: 5,
    }).status,
    'rejected',
  );
  const partial = deriveCanonicalPlan(
    observation(),
    room,
    mappings.slice(0, 1),
    {
      timeZone: 'Etc/UTC',
      checkInOpenMinutesBefore: 5,
      dismissalWarningMinutesBefore: 5,
    },
  );
  assert.equal(partial.status, 'planned');
  if (partial.status === 'planned') {
    assert.equal(partial.plan.meetings.length, 1);
    assert.ok(
      partial.diagnostics.some(
        (item) => item.code === 'course-mapping-missing',
      ),
    );
  }
});

test('joins only delimiter-bounded embedded PowerSchool codes and reports mapping causes safely', () => {
  const timing = {
    timeZone: 'Etc/UTC',
    checkInOpenMinutesBefore: 5,
    dismissalWarningMinutesBefore: 5,
  } as const;
  const wrongSection = deriveCanonicalPlan(
    observation(),
    room,
    [
      {
        classId: 'class-alpha' as ClassId,
        sectionCode: 'different-section',
        roomId: room,
        periodId: 'p1',
      },
    ],
    timing,
  );
  assert.equal(wrongSection.status, 'rejected');
  assert.ok(
    wrongSection.diagnostics.some(
      (item) => item.code === 'course-mapping-missing',
    ),
  );

  const embeddedSection = deriveCanonicalPlan(
    { ...observation(), periods: [observation().periods[0]!] },
    room,
    [
      {
        classId: 'class-alpha' as ClassId,
        sectionCode: 'Current Course - Course Alpha - Semester 1',
        roomId: room,
      },
    ],
    timing,
  );
  assert.equal(embeddedSection.status, 'planned');
  if (embeddedSection.status === 'planned') {
    assert.equal(embeddedSection.plan.meetings[0]?.courseKey, 'course-alpha');
  }

  const ambiguous = deriveCanonicalPlan(
    { ...observation(), periods: [observation().periods[0]!] },
    room,
    [
      {
        classId: 'class-alpha' as ClassId,
        sectionCode: 'Course Alpha',
        roomId: room,
      },
      {
        classId: 'class-beta' as ClassId,
        sectionCode: 'course-alpha',
        roomId: room,
      },
    ],
    timing,
  );
  assert.equal(ambiguous.status, 'rejected');
  assert.ok(
    ambiguous.diagnostics.some(
      (item) => item.code === 'course-mapping-ambiguous',
    ),
  );

  const otherRoom = deriveCanonicalPlan(
    {
      ...observation(),
      periods: [
        { ...observation().periods[0]!, roomKey: 'room-private-other' },
      ],
    },
    room,
    mappings,
    timing,
  );
  assert.equal(otherRoom.status, 'rejected');
  assert.ok(
    otherRoom.diagnostics.some(
      (item) => item.code === 'schedule-room-mismatch',
    ),
  );
  assert.doesNotMatch(JSON.stringify(otherRoom), /private-other|room-alpha/u);
});

test('keeps room and screen projections strictly isolated', () => {
  const result = deriveCanonicalPlan(observation(), room, mappings, {
    timeZone: 'Etc/UTC',
    checkInOpenMinutesBefore: 5,
    dismissalWarningMinutesBefore: 5,
  });
  assert.equal(result.status, 'planned');
  if (result.status !== 'planned') return;
  assert.equal(
    projectEffectivePlan(result.plan, {
      contractVersion,
      screenId: screen,
      roomId: room,
      routeKey: 'alpha',
    })?.screenId,
    screen,
  );
  assert.equal(
    projectEffectivePlan(result.plan, {
      contractVersion,
      screenId: 'screen-beta',
      roomId: 'room-beta',
      routeKey: 'beta',
    }),
    undefined,
  );
});

test('selects exact minus-one, boundary, and plus-one states with equal start precedence', () => {
  const cases = [
    ['2035-04-13T07:54:59Z', 'idle'],
    ['2035-04-13T07:55:00Z', 'pre_checkin'],
    ['2035-04-13T07:55:01Z', 'pre_checkin'],
    ['2035-04-13T07:59:59Z', 'pre_checkin'],
    ['2035-04-13T08:00:00Z', 'in_class_content'],
    ['2035-04-13T08:00:01Z', 'in_class_content'],
    ['2035-04-13T08:54:59Z', 'in_class_content'],
    ['2035-04-13T08:55:00Z', 'dismissal_warning'],
    ['2035-04-13T08:55:01Z', 'dismissal_warning'],
    ['2035-04-13T08:59:59Z', 'dismissal_warning'],
    ['2035-04-13T09:00:00Z', 'post_end'],
    ['2035-04-13T09:00:01Z', 'post_end'],
    ['2035-04-13T09:04:59Z', 'post_end'],
    ['2035-04-13T09:05:00Z', 'pre_checkin'],
    ['2035-04-13T09:05:01Z', 'pre_checkin'],
    ['2035-04-13T09:09:59Z', 'pre_checkin'],
    ['2035-04-13T09:10:00Z', 'in_class_content'],
    ['2035-04-13T09:10:01Z', 'in_class_content'],
    ['2035-04-13T09:54:59Z', 'in_class_content'],
    ['2035-04-13T09:55:00Z', 'dismissal_warning'],
    ['2035-04-13T09:55:01Z', 'dismissal_warning'],
    ['2035-04-13T09:59:59Z', 'dismissal_warning'],
    ['2035-04-13T10:00:00Z', 'day_complete'],
    ['2035-04-13T10:00:01Z', 'day_complete'],
  ] as const;
  for (const [at, state] of cases)
    assert.equal(
      selectDisplayState(effective(), at, {
        showCheckIn: true,
        morningOverviewUntil: '07:30',
      }).state,
      state,
      at,
    );
});

test('handles morning overview, no classes, and hidden check-in first/between-class transitions', () => {
  assert.equal(
    selectDisplayState(effective(), '2035-04-13T07:00:00Z', {
      showCheckIn: true,
      morningOverviewUntil: '07:30',
    }).state,
    'morning_overview',
  );
  assert.equal(
    selectDisplayState(effective(), '2035-04-13T07:30:00Z', {
      showCheckIn: true,
      morningOverviewUntil: '07:30',
    }).state,
    'idle',
  );
  const earlyOpen = {
    ...effective(),
    meetings: [
      { ...effective().meetings[0]!, checkInOpensAt: '2035-04-13T06:55:00Z' },
      effective().meetings[1]!,
    ],
  };
  assert.equal(
    selectDisplayState(earlyOpen, '2035-04-13T07:00:00Z', {
      showCheckIn: true,
      morningOverviewUntil: '07:30',
    }).state,
    'pre_checkin',
  );
  assert.equal(
    selectDisplayState(
      { ...effective(), meetings: [] },
      '2035-04-13T08:00:00Z',
      { showCheckIn: true },
    ).state,
    'no_classes',
  );
  assert.equal(
    selectDisplayState(effective(), '2035-04-13T07:55:00Z', {
      showCheckIn: false,
    }).state,
    'in_class_content',
  );
  assert.equal(
    selectDisplayState(effective(), '2035-04-13T09:05:00Z', {
      showCheckIn: false,
    }).state,
    'post_end',
  );
  assert.equal(
    selectDisplayState(effective(), '2035-04-13T09:10:00Z', {
      showCheckIn: false,
    }).state,
    'in_class_content',
  );
});

test('selects gap days only for the same screen with legacy labels', () => {
  const base = effective();
  const tomorrow = { ...base, effectivePlanId: 'tomorrow', date: '2035-04-14' };
  const wrongScreen = {
    ...base,
    effectivePlanId: 'wrong',
    date: '2035-04-14',
    screenId: 'screen-beta' as ScreenId,
  };
  assert.equal(
    selectNextClassDay(base.date, screen, [wrongScreen, tomorrow]).label,
    'Tomorrow',
  );
  assert.equal(
    selectNextClassDay('2035-04-13', screen, [{ ...base, date: '2035-04-16' }])
      .label,
    'Next Week',
  );
  assert.equal(
    selectNextClassDay('2035-04-15', screen, [{ ...base, date: '2035-04-19' }])
      .label,
    'Next Class Day',
  );
  assert.equal(
    selectNextClassDay('2035-04-13', screen, []).label,
    'Next Class Day',
  );
});

test('fallbacks are disabled by default and always explicitly unverified when enabled', () => {
  const plan = effective() as unknown as CanonicalPlan;
  assert.equal(
    selectPlanSource({
      requestedDate: plan.date,
      roomId: plan.roomId,
      primary: plan,
      policy: { allowCalendarFallback: false, allowLatestLocalFallback: false },
    }).source,
    'none',
  );
  assert.equal(
    selectPlanSource({
      requestedDate: plan.date,
      roomId: plan.roomId,
      primary: { ...plan, verification: 'verified' },
      policy: { allowCalendarFallback: false, allowLatestLocalFallback: false },
    }).source,
    'primary',
  );
  assert.equal(
    selectPlanSource({
      requestedDate: plan.date,
      roomId: plan.roomId,
      policy: { allowCalendarFallback: false, allowLatestLocalFallback: false },
      calendar: { source: 'calendar', plan },
    }).source,
    'none',
  );
  const selected = selectPlanSource({
    requestedDate: plan.date,
    roomId: plan.roomId,
    policy: { allowCalendarFallback: true, allowLatestLocalFallback: false },
    calendar: { source: 'calendar', plan },
  });
  assert.equal(selected.plan?.verification, 'unverified');
  assert.equal(
    selectPlanSource({
      requestedDate: '2035-04-14',
      roomId: plan.roomId,
      policy: { allowCalendarFallback: true, allowLatestLocalFallback: false },
      calendar: { source: 'calendar', plan },
    }).source,
    'none',
  );
});
