import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildPreCheckInDisplayModel,
  normalizeAttendanceSummary,
  resolveAttendanceLink,
} from '../../src/domain/attendance.js';
import {
  compactDirections,
  objectiveCardsForCoursework,
  resolveClassContent,
  type ContentCard,
} from '../../src/domain/content.js';
import {
  assignmentUnitLabel,
  normalizeCoursework,
  overlayCoursework,
  type CourseMapping,
  type NormalizedCourseworkItem,
} from '../../src/domain/coursework.js';
import type { ClassId, ScreenId } from '../../src/domain/identities.js';
import {
  classIdFromLegacyRecord,
  courseKeyFromSectionCode,
  roomIdFromLocation,
  screenIdFromLocation,
  sectionCodeContainsCourseKey,
} from '../../src/domain/identities.js';
import {
  applyScopedOverride,
  type DisplayContentModel,
  type ScopedDisplayOverride,
} from '../../src/domain/overrides.js';
import {
  deduplicateVocabularyCandidates,
  selectVocabulary,
} from '../../src/domain/vocabulary.js';
import {
  legacyCourseworkGolden,
  legacyVocabularyCandidates,
} from '../fixtures/m03-legacy-golden.js';

const classA = 'class-alpha' as ClassId;
const classB = 'class-beta' as ClassId;
const screenA = 'screen-alpha' as ScreenId;
const mappings: readonly CourseMapping[] = [
  { providerCourseKey: 'provider-a', classId: classA },
];

function normalizeGolden() {
  return normalizeCoursework({
    meetingDate: '2035-04-13',
    refreshedAt: '2035-04-20T12:00:00Z',
    provenanceReference: 'synthetic-classroom-capture',
    recentDays: 7,
    upcomingDays: 21,
    mappings,
    items: legacyCourseworkGolden,
  });
}

function objectiveCoursework(): readonly NormalizedCourseworkItem[] {
  return normalizeCoursework({
    meetingDate: '2035-04-13',
    refreshedAt: '2035-04-20T12:00:00Z',
    mappings,
    items: [
      {
        providerCourseKey: 'provider-a',
        providerItemKey: 'unit-6-a',
        title: 'Quiz 6.11.1',
        description:
          'Review the practice set. Submit the quiz in Classroom. Ignore this sentence.',
        dueDate: '2035-04-17',
        updateTime: '2035-04-12T12:00:00Z',
        state: 'PUBLISHED',
      },
      {
        providerCourseKey: 'provider-a',
        providerItemKey: 'unit-6-b',
        title: 'Quiz 6.10.2',
        description: 'Complete the second quiz.',
        dueDate: '2035-04-18',
        updateTime: '2035-04-12T11:00:00Z',
        state: 'PUBLISHED',
      },
      {
        providerCourseKey: 'provider-a',
        providerItemKey: 'unit-7',
        title: 'Unit 7 Project',
        dueDate: '2035-04-19',
        updateTime: '2035-04-12T10:00:00Z',
        state: 'PUBLISHED',
      },
    ],
  }).items;
}

test('normalizes legacy display/class identities and assignment unit labels', () => {
  assert.equal(screenIdFromLocation(' Room B407 '), 'room-b407');
  assert.equal(roomIdFromLocation('B407'), 'room-b407');
  assert.equal(roomIdFromLocation(' Room B407 '), 'room-b407');
  assert.equal(roomIdFromLocation('room-b407'), 'room-b407');
  assert.equal(courseKeyFromSectionCode(' 811.2 '), '811-2');
  assert.equal(
    courseKeyFromSectionCode('Current course - (SECTION-CODE)'),
    'current-course-section-code',
  );
  assert.equal(
    sectionCodeContainsCourseKey(
      'Current Course - IC008.1 - Semester 1',
      'ic008-1',
    ),
    true,
  );
  assert.equal(
    sectionCodeContainsCourseKey(
      'Current Course - IC008.10 - Semester 1',
      'ic008-1',
    ),
    false,
  );
  assert.equal(
    classIdFromLegacyRecord({
      studentCheckInUrl:
        'https://example.invalid/checkin?class_key=class%20alpha',
    }),
    'class alpha',
  );
  assert.equal(
    classIdFromLegacyRecord({
      courseName: 'Web Design',
      blockLabel: 'Block A',
    }),
    'web-design-block-a',
  );
  assert.equal(assignmentUnitLabel('CodeHS Unit 6A Project'), '6A');
  assert.equal(assignmentUnitLabel('Lesson 7.2.1 Quiz'), '7');
});

test('normalizes complete coursework fields in meeting-date windows with legacy order and caps', () => {
  const first = normalizeGolden();
  const second = normalizeGolden();
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.deepEqual(
    first.recent.map((item) => item.itemId),
    ['r-latest', 'r-bound', 'r-undated-old'],
  );
  assert.deepEqual(
    first.upcoming.map((item) => item.itemId),
    ['u-today', 'u-bound', 'u-undated'],
  );
  assert.equal(first.metadata.meetingDate, '2035-04-13');
  assert.equal(first.metadata.refreshedAt, '2035-04-20T12:00:00Z');
  const complete = first.upcoming[0];
  assert.equal(complete?.title, 'Unit 6 Quiz');
  assert.equal(
    complete?.description,
    'Review the practice set. Submit the quiz in Classroom. Ignore this third sentence.',
  );
  assert.equal(complete?.dueLabel, 'Fri, April 13');
  assert.equal(complete?.workType, 'ASSIGNMENT');
  assert.equal(complete?.materials[0]?.title, 'Practice set');
  assert.deepEqual(
    complete?.materials.map((material) => material.title),
    ['Practice set', 'Design brief', 'Demo video', 'Exit ticket'],
  );
  assert.equal(
    complete?.alternateLink,
    'https://fixture.example.invalid/classroom/u-today',
  );
  assert.deepEqual(
    complete?.materials.map((material) => material.url),
    [
      'https://fixture.example.invalid/material',
      'https://fixture.example.invalid/drive',
      'https://fixture.example.invalid/video',
      'https://fixture.example.invalid/form',
    ],
  );
  assert.equal(complete?.assignedCount, 24);
  assert.equal(complete?.submittedCount, 7);
  assert.ok(
    first.diagnostics.some((item) => item.code === 'coursework-item-malformed'),
  );
});

test('anchors buckets to meeting date rather than refresh provenance', () => {
  const result = normalizeCoursework({
    meetingDate: '2035-04-13',
    refreshedAt: '2035-04-20T23:59:59Z',
    mappings,
    items: [
      {
        providerCourseKey: 'provider-a',
        providerItemKey: 'between-dates',
        title: 'Due after the meeting but before refresh',
        dueDate: '2035-04-15',
        updateTime: '2035-04-12T09:00:00Z',
        state: 'PUBLISHED',
      },
    ],
  });
  assert.deepEqual(result.recent, []);
  assert.equal(result.upcoming[0]?.itemId, 'between-dates');
});

test('caps legacy recent and upcoming groups at three after their documented ordering', () => {
  const items = [
    ...['12', '11', '10', '09'].map((day, index) => ({
      providerCourseKey: 'provider-a',
      providerItemKey: `recent-${index}`,
      title: `Recent ${index}`,
      dueDate: `2035-04-${day}`,
      updateTime: `2035-04-${day}T09:00:00Z`,
      state: 'PUBLISHED',
    })),
    ...['13', '14', '15', '16'].map((day, index) => ({
      providerCourseKey: 'provider-a',
      providerItemKey: `upcoming-${index}`,
      title: `Upcoming ${index}`,
      dueDate: `2035-04-${day}`,
      updateTime: `2035-04-${day}T09:00:00Z`,
      state: 'PUBLISHED',
    })),
  ];
  const result = normalizeCoursework({
    meetingDate: '2035-04-13',
    refreshedAt: '2035-04-20T12:00:00Z',
    mappings,
    items,
  });
  assert.deepEqual(
    result.recent.map((item) => item.itemId),
    ['recent-0', 'recent-1', 'recent-2'],
  );
  assert.deepEqual(
    result.upcoming.map((item) => item.itemId),
    ['upcoming-0', 'upcoming-1', 'upcoming-2'],
  );
});

test('filters deleted/malformed work and isolates mapping failures per class', () => {
  const result = normalizeCoursework({
    meetingDate: '2035-04-13',
    refreshedAt: '2035-04-13T12:00:00Z',
    mappings,
    items: [
      {
        providerCourseKey: 'provider-a',
        providerItemKey: 'valid',
        title: 'Valid',
        dueDate: '2035-04-14',
        state: 'PUBLISHED',
      },
      {
        providerCourseKey: 'provider-a',
        providerItemKey: 'draft',
        title: 'Draft',
        dueDate: '2035-04-14',
        state: 'DRAFT',
      },
      {
        providerCourseKey: 'provider-b',
        providerItemKey: 'unmapped',
        title: 'Unmapped',
        dueDate: '2035-04-14',
        state: 'PUBLISHED',
      },
    ],
  });
  assert.deepEqual(
    result.items.map((item) => item.itemId),
    ['valid', 'draft'],
  );
  assert.ok(
    result.diagnostics.some(
      (item) => item.code === 'coursework-class-mapping-invalid',
    ),
  );
});

test('accepts only fresh matching-date/class enrichment and preserves refresh metadata', () => {
  const normalized = normalizeGolden();
  const enrichment = {
    observedForDate: '2035-04-13',
    classId: classA,
    freshness: 'fresh' as const,
    recent: normalized.recent,
    upcoming: normalized.upcoming,
    refreshedAt: normalized.metadata.refreshedAt,
    provenanceReference: 'synthetic-classroom-capture',
  };
  const matched = overlayCoursework({
    planDate: '2035-04-13',
    classId: classA,
    enrichment,
  });
  assert.equal(matched.items.length, 6);
  assert.ok(matched.metadata);
  assert.equal(matched.metadata.refreshedAt, normalized.metadata.refreshedAt);
  assert.equal(
    overlayCoursework({ planDate: '2035-04-14', classId: classA, enrichment })
      .diagnostics[0]?.code,
    'enrichment-date-mismatch',
  );
  assert.equal(
    overlayCoursework({ planDate: '2035-04-13', classId: classB, enrichment })
      .diagnostics[0]?.code,
    'enrichment-class-mismatch',
  );
  assert.equal(
    overlayCoursework({
      planDate: '2035-04-13',
      classId: classA,
      enrichment: { ...enrichment, freshness: 'stale' },
    }).diagnostics[0]?.code,
    'enrichment-not-fresh',
  );
});

test('composes grouped objectives, eligible static cards, date cards, and vocabulary in legacy order', () => {
  const staticObjective: ContentCard = {
    type: 'objective',
    title: "Today's objective",
    lines: ['Static objective'],
  };
  const bellringer: ContentCard = {
    type: 'bellringer',
    title: 'Bellringer',
    lines: ['Start here'],
    accent: 'calm',
    durationSeconds: 9,
  };
  const safety: ContentCard = {
    type: 'generic',
    title: 'Safety',
    lines: ['Wear eye protection'],
  };
  const dateCard: ContentCard = {
    type: 'card',
    title: 'Date only',
    lines: ['Today only'],
  };
  const vocabulary: ContentCard = {
    type: 'vocabulary',
    title: 'Boolean',
    lines: ['A true or false value'],
  };
  const configuration = {
    defaults: {
      [classA]: {
        items: [
          staticObjective,
          { type: 'agenda' as const, title: 'Agenda', lines: ['Hidden'] },
          {
            type: 'reminder' as const,
            title: 'Reminder',
            lines: ['Hidden'],
          },
          {
            type: 'assessment_prompt' as const,
            title: 'Assessment focus',
            lines: ['Hidden'],
          },
          bellringer,
          safety,
        ],
      },
    },
    dateOverrides: {
      '2035-04-13': { [classA]: { items: [dateCard] } },
    },
  };
  const coursework = objectiveCoursework();
  const objectives = objectiveCardsForCoursework(coursework);
  assert.deepEqual(
    objectives.map((card) => card.featured),
    ['Quiz 6.11.1', 'Quiz 6.10.2'],
  );
  assert.deepEqual(objectives[0]?.details, [
    'Unit 6 focus.',
    'Review the practice set.',
    'Submit the quiz in Classroom.',
    'Open Classroom for full directions.',
    'Due Tue, April 17.',
  ]);
  const resolved = resolveClassContent({
    configuration,
    date: '2035-04-13',
    classId: classA,
    coursework,
    courseworkFresh: true,
    vocabularyCard: vocabulary,
  });
  assert.deepEqual(
    resolved.items.map((card) => card.title),
    [
      'Objective 1',
      'Objective 2',
      'Bellringer',
      'Safety',
      'Date only',
      'Boolean',
    ],
  );
  assert.equal(resolved.items[2]?.accent, 'calm');
  assert.equal(resolved.items[2]?.durationSeconds, 9);
  assert.deepEqual(
    compactDirections(
      'Give Stitch reference material to produce your own website design layout. Keep this second sentence. Ignore the third.',
    ),
    [
      'Use references to design your website layout.',
      'Keep this second sentence.',
    ],
  );

  const stale = resolveClassContent({
    configuration,
    date: '2035-04-13',
    classId: classA,
    coursework,
    courseworkFresh: false,
    vocabularyCard: vocabulary,
  });
  assert.deepEqual(
    stale.items.map((card) => card.title),
    ['Bellringer', 'Safety', 'Date only', 'Boolean'],
  );
  assert.equal(stale.diagnostics[0]?.code, 'content-coursework-not-fresh');

  const legacyNested = resolveClassContent({
    configuration: {
      defaults: { [classA]: { items: [bellringer] } },
      dateOverrides: { [classA]: { '2035-04-13': { items: [dateCard] } } },
    },
    date: '2035-04-13',
    classId: classA,
  });
  assert.deepEqual(
    legacyNested.items.map((card) => card.title),
    ['Bellringer', 'Date only'],
  );
});

test('uses legacy vocabulary deduplication, focused pools, rotation, history reuse, and exhaustion', () => {
  const deduped = deduplicateVocabularyCandidates(legacyVocabularyCandidates);
  assert.equal(
    deduped.filter((candidate) => candidate.term.toLowerCase() === 'input')
      .length,
    1,
  );
  assert.equal(
    deduped.find((candidate) => candidate.term.toLowerCase() === 'input')
      ?.source,
    'class',
  );
  const coursework = objectiveCoursework();
  const first = selectVocabulary({
    classId: classA,
    subject: 'Computer Science CodeHS',
    blockLabel: '800.2',
    meetingKey: 'meeting-new',
    date: '2035-04-13',
    candidates: legacyVocabularyCandidates,
    history: [],
    coursework,
    providerCourseKey: 'provider-a',
  });
  assert.ok(first.candidate);
  assert.equal(first.candidate.source, 'codehs');
  assert.equal(first.candidate.term, 'If statement');
  assert.equal(first.candidate.partOfSpeech, 'noun');
  assert.equal(first.accent, 'calm');
  assert.equal(first.durationSeconds, 15);
  assert.deepEqual(first.lines, [
    '/if ˈsteɪtmənt/',
    'Runs code when a condition is true',
    'Use an if statement to choose a branch.',
    'câu lệnh nếu',
    'Chạy mã khi điều kiện đúng',
    'Dùng câu lệnh nếu để chọn một nhánh.',
  ]);
  assert.equal(first.selectionContext?.vocabularyPolicy, 'unused_focused');
  assert.equal(first.selectionContext?.vocabularyReuse, 'new');
  assert.equal(first.selectionContext?.assignmentRefs.length, 3);
  assert.equal(
    first.selectionContext?.assignmentRefs[0]?.courseWorkId,
    coursework[0]?.providerItemKey,
  );
  assert.equal(first.selectionContext?.classroomCourseId, 'provider-a');
  assert.ok(first.historyIntent);
  assert.equal(
    JSON.stringify(first),
    JSON.stringify(
      selectVocabulary({
        classId: classA,
        subject: 'Computer Science CodeHS',
        blockLabel: '800.2',
        meetingKey: 'meeting-new',
        date: '2035-04-13',
        candidates: legacyVocabularyCandidates,
        history: [],
        coursework,
        providerCourseKey: 'provider-a',
      }),
    ),
  );

  const reused = selectVocabulary({
    classId: classA,
    subject: 'Computer Science',
    blockLabel: '800.2',
    meetingKey: 'meeting-new',
    date: '2035-04-13',
    candidates: [],
    history: [first.historyIntent!.entry],
  });
  assert.equal(reused.candidate?.term, first.candidate?.term);
  assert.equal(
    reused.selectionContext?.vocabularyPolicy,
    'recorded_same_meeting',
  );
  assert.equal(reused.historyIntent, undefined);

  const exhausted = selectVocabulary({
    classId: 'study-hall-1' as ClassId,
    subject: 'Study Hall',
    blockLabel: '1',
    meetingKey: 'new-2035-04-19',
    date: '2035-04-19',
    candidates: legacyVocabularyCandidates.filter((candidate) =>
      ['input', 'output'].includes(candidate.term.toLowerCase()),
    ),
    history: [
      {
        classId: 'study-hall-1' as ClassId,
        meetingKey: 'old-input',
        date: '2035-04-11',
        term: 'Input',
      },
      {
        classId: 'study-hall-1' as ClassId,
        meetingKey: 'old-output',
        date: '2035-04-12',
        term: 'Output',
      },
    ],
  });
  assert.equal(exhausted.candidate?.term, 'Input');
  assert.equal(
    exhausted.selectionContext?.vocabularyPolicy,
    'exhausted_best_available',
  );
  assert.equal(exhausted.repeated, true);

  const bestAvailable = selectVocabulary({
    classId: classA,
    subject: 'Computer Science CodeHS',
    blockLabel: '800.2',
    meetingKey: 'best-available',
    date: '2035-04-20',
    candidates: legacyVocabularyCandidates,
    history: [
      {
        classId: classA,
        meetingKey: 'used-if',
        date: '2035-04-18',
        term: 'If statement',
      },
      {
        classId: classA,
        meetingKey: 'used-bool',
        date: '2035-04-19',
        term: 'Boolean',
      },
    ],
    coursework,
  });
  assert.equal(
    bestAvailable.selectionContext?.vocabularyPolicy,
    'unused_best_available',
  );
  assert.equal(bestAvailable.candidate?.term, 'Output');
});

test('preserves missing attendance counts, validates invalid counts, and retains links/QR target', () => {
  const attendance = normalizeAttendanceSummary({
    rosterCount: '24',
    presentCount: 0,
    tardyCount: 'invalid',
    responseCount: '7',
  });
  assert.equal(attendance.summary.absentCount, undefined);
  assert.deepEqual(attendance.summary, {
    rosterCount: 24,
    presentCount: 0,
    responseCount: 7,
  });
  assert.equal(attendance.diagnostics[0]?.code, 'attendance-count-invalid');
  assert.deepEqual(
    normalizeAttendanceSummary({
      rosterCount: 24,
      presentCount: 18,
      tardyCount: 2,
      absentCount: 4,
      responseCount: 20,
    }).summary,
    {
      rosterCount: 24,
      presentCount: 18,
      tardyCount: 2,
      absentCount: 4,
      responseCount: 20,
    },
  );

  const links = {
    directPrefilled: 'https://example.invalid/prefilled',
    directResponder: 'https://example.invalid/respond',
    wrapper: 'https://example.invalid/wrapper',
    quick: 'https://example.invalid/quick',
    teacherDisplay: 'https://example.invalid/teacher',
    classroom: 'https://example.invalid/classroom',
  };
  assert.equal(resolveAttendanceLink(links).source, 'directPrefilled');
  const model = buildPreCheckInDisplayModel({
    meetingId: 'meeting-1',
    links,
    attendanceSummary: attendance.summary,
    classCode: 'A-101',
  });
  assert.deepEqual(model.attendanceSummary, {
    rosterCount: 24,
    presentCount: 0,
    responseCount: 7,
  });
  assert.equal(model.qrTarget, links.directPrefilled);
});

test('applies global announcement and multiple class overrides with meeting precedence and isolation', () => {
  const base: DisplayContentModel = {
    cards: [
      { cardId: 'base', title: 'Base', lines: ['Base'] },
      {
        cardId: 'objective',
        type: 'objective',
        title: "Today's objective",
        lines: ['Assignment'],
      },
    ],
    assignmentsVisible: true,
  };
  const snapshot = JSON.stringify(base);
  const scope: ScopedDisplayOverride = {
    screenId: screenA,
    date: '2035-04-13',
    announcement: 'Lab today',
    simulator: {
      forcedState: 'in_class_content',
      forcedMeetingId: 'meeting-1',
    },
    classes: {
      [classA]: {
        cards: [{ cardId: 'class-a', title: 'Class A', lines: ['Class'] }],
        cardsMode: 'append',
        hideAssignments: true,
      },
      [classB]: {
        cards: [{ cardId: 'class-b', title: 'Class B', lines: ['Class'] }],
        cardsMode: 'replace',
      },
      'meeting-1': {
        cards: [
          { cardId: 'meeting', title: 'Meeting wins', lines: ['Meeting'] },
        ],
        cardsMode: 'replace',
        dismissalMessage: 'Pack up',
      },
    },
  };
  const meeting = applyScopedOverride({
    model: base,
    override: scope,
    screenId: screenA,
    date: '2035-04-13',
    classId: classA,
    meetingId: 'meeting-1',
  });
  assert.deepEqual(
    meeting.model.cards.map((card) => card.title),
    ['Announcement', 'Meeting wins'],
  );
  assert.equal(meeting.model.dismissalMessage, 'Pack up');
  assert.equal(meeting.model.assignmentsVisible, true);
  assert.deepEqual(meeting.model.simulator, {
    forcedState: 'in_class_content',
    forcedMeetingId: 'meeting-1',
  });
  assert.equal(meeting.model.announcement?.title, 'Announcement');

  const classOnly = applyScopedOverride({
    model: base,
    override: scope,
    screenId: screenA,
    date: '2035-04-13',
    classId: classA,
  });
  assert.deepEqual(
    classOnly.model.cards.map((card) => card.title),
    ['Announcement', 'Base', 'Class A'],
  );
  assert.equal(classOnly.model.assignmentsVisible, false);
  assert.equal(
    classOnly.model.cards.some((card) => card.type === 'objective'),
    false,
  );

  const classBResult = applyScopedOverride({
    model: base,
    override: scope,
    screenId: screenA,
    date: '2035-04-13',
    classId: classB,
  });
  assert.deepEqual(
    classBResult.model.cards.map((card) => card.title),
    ['Announcement', 'Class B'],
  );

  const globalOnly = applyScopedOverride({
    model: base,
    override: scope,
    screenId: screenA,
    date: '2035-04-13',
    classId: 'class-unrelated',
  });
  assert.deepEqual(
    globalOnly.model.cards.map((card) => card.title),
    ['Announcement', 'Base', "Today's objective"],
  );

  const unrelated = applyScopedOverride({
    model: base,
    override: scope,
    screenId: 'screen-beta' as ScreenId,
    date: '2035-04-13',
    classId: classA,
  });
  assert.deepEqual(unrelated.model, base);
  assert.equal(unrelated.diagnostics[0]?.code, 'override-scope-mismatch');
  assert.equal(JSON.stringify(base), snapshot);
  const wrongDate = applyScopedOverride({
    model: base,
    override: scope,
    screenId: screenA,
    date: '2035-04-14',
    classId: classA,
  });
  assert.deepEqual(wrongDate.model, base);
});
