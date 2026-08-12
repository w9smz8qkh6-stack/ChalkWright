import {
  buildDayPlan,
  buildMeeting,
  buildPeriod,
  buildScheduleObservation,
  buildScreen,
  fixture,
} from './builders.js';

const normalDate = '2035-02-12';
const specialDate = '2035-02-13';

export const normalScheduleFixture = fixture(
  'schedule-normal',
  'normal',
  buildScheduleObservation({
    id: 'observation-normal',
    date: normalDate,
    kind: 'normal',
    periods: [
      buildPeriod(
        'period-alpha-1',
        'course-alpha',
        'Block A',
        `${normalDate}T08:00:00Z`,
        `${normalDate}T09:00:00Z`,
      ),
      buildPeriod(
        'period-alpha-2',
        'course-beta',
        'Block B',
        `${normalDate}T09:10:00Z`,
        `${normalDate}T10:10:00Z`,
      ),
    ],
  }),
  true,
  'M-03 schedule normalization and timing behavior',
);

export const specialScheduleFixture = fixture(
  'schedule-special',
  'special-schedule',
  buildScheduleObservation({
    id: 'observation-special',
    date: specialDate,
    kind: 'special',
    periods: [
      buildPeriod(
        'period-special-1',
        'course-alpha',
        'Advisory',
        `${specialDate}T09:00:00Z`,
        `${specialDate}T09:25:00Z`,
      ),
      buildPeriod(
        'period-special-2',
        'course-gamma',
        'Block C',
        `${specialDate}T09:35:00Z`,
        `${specialDate}T10:20:00Z`,
      ),
    ],
  }),
  true,
  'M-03 special-schedule normalization behavior',
);

export const emptyScheduleFixture = fixture(
  'schedule-empty',
  'empty',
  buildScheduleObservation({
    id: 'observation-empty',
    date: '2035-02-14',
    kind: 'no-classes',
    periods: [],
  }),
  true,
  'M-03 no-classes and day-complete behavior',
);

export const staleScheduleFixture = fixture(
  'schedule-stale',
  'stale',
  buildScheduleObservation({
    id: 'observation-stale',
    date: '2035-02-15',
    kind: 'normal',
    freshness: 'stale',
    periods: [
      buildPeriod(
        'period-stale-1',
        'course-delta',
        'Block D',
        '2035-02-15T08:00:00Z',
        '2035-02-15T09:00:00Z',
      ),
    ],
  }),
  true,
  'M-03 stale-input behavior and M-10 read-only integration gate',
);

export const malformedScheduleFixture = fixture(
  'schedule-malformed',
  'malformed',
  {
    contractVersion: 'unsupported-version',
    observationId: 'observation-malformed',
    observedForDate: 'not-a-date',
    kind: 'normal',
    periods: [
      {
        periodId: 'period-malformed-1',
        startsAt: 'after-end',
        endsAt: 'before-start',
      },
    ],
  } satisfies unknown,
  false,
  'M-03 validation and failure classification',
);

export const gapDayFixture = fixture(
  'schedule-gap-day',
  'gap-day',
  {
    requestedDate: '2035-02-16',
    loadedObservations: [
      buildScheduleObservation({
        id: 'observation-before-gap',
        date: '2035-02-15',
        kind: 'normal',
        periods: [
          buildPeriod(
            'period-before-gap-1',
            'course-alpha',
            'Block A',
            '2035-02-15T08:00:00Z',
            '2035-02-15T09:00:00Z',
          ),
        ],
      }),
      buildScheduleObservation({
        id: 'observation-after-gap',
        date: '2035-02-19',
        kind: 'normal',
        periods: [
          buildPeriod(
            'period-after-gap-1',
            'course-alpha',
            'Block A',
            '2035-02-19T08:00:00Z',
            '2035-02-19T09:00:00Z',
          ),
        ],
      }),
    ],
    expectedNextLoadedDate: '2035-02-19',
  },
  true,
  'M-03 next-class-day selection behavior',
);

const roomAlphaPlan = buildDayPlan({
  id: 'plan-room-alpha',
  date: '2035-02-20',
  timeZone: 'Etc/UTC',
  roomId: 'room-alpha',
  sourceObservationIds: ['observation-room-alpha'],
  meetings: [
    buildMeeting({
      id: 'meeting-room-alpha-1',
      courseKey: 'course-alpha',
      blockLabel: 'Block A',
      checkInOpensAt: '2035-02-20T07:55:00Z',
      officialStartsAt: '2035-02-20T08:00:00Z',
      checkInClosesAt: '2035-02-20T08:00:00Z',
      contentStartsAt: '2035-02-20T08:00:00Z',
      dismissalStartsAt: '2035-02-20T08:55:00Z',
      officialEndsAt: '2035-02-20T09:00:00Z',
    }),
  ],
});

const roomBetaPlan = buildDayPlan({
  id: 'plan-room-beta',
  date: '2035-02-20',
  timeZone: 'Etc/UTC',
  roomId: 'room-beta',
  sourceObservationIds: ['observation-room-beta'],
  meetings: [
    buildMeeting({
      id: 'meeting-room-beta-1',
      courseKey: 'course-beta',
      blockLabel: 'Block B',
      checkInOpensAt: '2035-02-20T08:25:00Z',
      officialStartsAt: '2035-02-20T08:30:00Z',
      checkInClosesAt: '2035-02-20T08:30:00Z',
      contentStartsAt: '2035-02-20T08:30:00Z',
      dismissalStartsAt: '2035-02-20T09:25:00Z',
      officialEndsAt: '2035-02-20T09:30:00Z',
    }),
  ],
});

export const multiScreenFixture = fixture(
  'schedule-multi-screen',
  'multi-screen',
  {
    screens: [
      buildScreen('screen-alpha', 'room-alpha'),
      buildScreen('screen-beta', 'room-beta'),
    ],
    plans: [roomAlphaPlan, roomBetaPlan],
    isolationExpectation: {
      'screen-alpha': 'plan-room-alpha',
      'screen-beta': 'plan-room-beta',
    },
  },
  true,
  'M-03 multi-room isolation and M-05 route isolation',
);

export const scheduleFixtureCatalog = [
  normalScheduleFixture,
  specialScheduleFixture,
  emptyScheduleFixture,
  staleScheduleFixture,
  malformedScheduleFixture,
  gapDayFixture,
  multiScreenFixture,
] as const;
