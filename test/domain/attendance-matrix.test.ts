import assert from 'node:assert/strict';
import test from 'node:test';

import { buildAttendanceMatrix } from '../../src/domain/attendance-matrix.js';

function completeFixture() {
  return {
    roster: [{ learnerKey: 'learner-b' }, { learnerKey: 'learner-a' }],
    meetings: [
      { meetingId: 'meeting-a', date: '2035-09-04' },
      { meetingId: 'meeting-b', date: '2035-09-05' },
    ],
    marks: [
      { learnerKey: 'learner-a', meetingId: 'meeting-b', status: 'A' },
      { learnerKey: 'learner-b', meetingId: 'meeting-a', status: 'P' },
      { learnerKey: 'learner-a', meetingId: 'meeting-a', status: 'T' },
      { learnerKey: 'learner-b', meetingId: 'meeting-b', status: 'P' },
    ],
  };
}

test('builds a complete immutable P/T/A matrix in roster and meeting order', () => {
  const input = completeFixture();
  const result = buildAttendanceMatrix(input);

  assert.equal(result.status, 'accepted');
  if (result.status !== 'accepted') return;
  assert.deepEqual(result.matrix, {
    meetings: [
      { meetingId: 'meeting-a', date: '2035-09-04' },
      { meetingId: 'meeting-b', date: '2035-09-05' },
    ],
    rows: [
      { learnerKey: 'learner-b', marks: ['P', 'P'] },
      { learnerKey: 'learner-a', marks: ['T', 'A'] },
    ],
  });
  assert.ok(Object.isFrozen(result.matrix));
  assert.ok(Object.isFrozen(result.matrix.rows));
  assert.deepEqual(input, completeFixture());
});

test('fails closed for incomplete, duplicate, foreign, or unsupported marks', () => {
  const cases: readonly [unknown, string][] = [
    [
      { ...completeFixture(), marks: completeFixture().marks.slice(0, 3) },
      'attendance-matrix-cell-missing',
    ],
    [
      {
        ...completeFixture(),
        marks: [...completeFixture().marks, completeFixture().marks[0]],
      },
      'attendance-matrix-marks-invalid',
    ],
    [
      {
        ...completeFixture(),
        marks: completeFixture().marks.map((mark, index) =>
          index === 0 ? { ...mark, learnerKey: 'foreign' } : mark,
        ),
      },
      'attendance-matrix-marks-invalid',
    ],
    [
      {
        ...completeFixture(),
        marks: completeFixture().marks.map((mark, index) =>
          index === 0 ? { ...mark, status: 'E' } : mark,
        ),
      },
      'attendance-matrix-marks-invalid',
    ],
  ];

  for (const [input, code] of cases)
    assert.deepEqual(buildAttendanceMatrix(input), {
      status: 'rejected',
      codes: [code],
    });
});

test('rejects identity-bearing fields, unordered meetings, and bounded-input violations', () => {
  assert.deepEqual(
    buildAttendanceMatrix({
      ...completeFixture(),
      roster: [
        {
          learnerKey: 'learner-a',
          studentName: 'Synthetic Student',
        },
      ],
    }),
    {
      status: 'rejected',
      codes: ['attendance-matrix-roster-invalid'],
    },
  );
  assert.deepEqual(
    buildAttendanceMatrix({
      ...completeFixture(),
      meetings: [...completeFixture().meetings].reverse(),
    }),
    {
      status: 'rejected',
      codes: ['attendance-matrix-meetings-invalid'],
    },
  );
  assert.deepEqual(
    buildAttendanceMatrix({
      roster: Array.from({ length: 101 }, (_, index) => ({
        learnerKey: `learner-${index}`,
      })),
      meetings: [{ meetingId: 'meeting-a', date: '2035-09-04' }],
      marks: [],
    }),
    {
      status: 'rejected',
      codes: ['attendance-matrix-budget-exceeded'],
    },
  );
});

test('rejects accessor-backed and sparse containers without invoking accessors', () => {
  let accessed = false;
  const hostile = Object.create(null) as Record<string, unknown>;
  Object.defineProperty(hostile, 'roster', {
    enumerable: true,
    get: () => {
      accessed = true;
      return [];
    },
  });
  hostile.meetings = [];
  hostile.marks = [];

  assert.deepEqual(buildAttendanceMatrix(hostile), {
    status: 'rejected',
    codes: ['attendance-matrix-shape-invalid'],
  });
  assert.equal(accessed, false);
  const sparse = completeFixture();
  sparse.marks = new Array(4) as typeof sparse.marks;
  assert.deepEqual(buildAttendanceMatrix(sparse), {
    status: 'rejected',
    codes: ['attendance-matrix-shape-invalid'],
  });
});
