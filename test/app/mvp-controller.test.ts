import assert from 'node:assert/strict';
import test from 'node:test';

import {
  presentationCard,
  presentationCourseLabel,
} from '../../src/app/mvp-controller.js';
import type { DayPlanMeeting } from '../../src/contracts/v1/day-plan.js';

function meeting(courseKey: string, blockLabel: string): DayPlanMeeting {
  return {
    meetingId: `meeting-${courseKey}`,
    courseKey,
    blockLabel,
    checkInOpensAt: '2035-04-13T07:55:00Z',
    checkInClosesAt: '2035-04-13T08:00:00Z',
    officialStartsAt: '2035-04-13T08:00:00Z',
    contentStartsAt: '2035-04-13T08:00:00Z',
    dismissalStartsAt: '2035-04-13T08:55:00Z',
    officialEndsAt: '2035-04-13T09:00:00Z',
  };
}

test('projects a human course title only from its matching section suffix', () => {
  assert.equal(
    presentationCourseLabel(meeting('ic008-1', 'Robotics (IC008.1)')),
    'Robotics',
  );
  assert.equal(
    presentationCourseLabel(meeting('ic008-1', 'Robotics (OTHER.1)')),
    'Robotics (OTHER.1)',
  );
  assert.equal(
    presentationCourseLabel(meeting('ic008-1', 'Robotics')),
    'Robotics',
  );
});

test('retains normalized-key and synthetic-fixture fallbacks', () => {
  assert.equal(
    presentationCourseLabel(meeting('ic008-1', 'IC008.1')),
    'ic008-1',
  );
  assert.equal(
    presentationCourseLabel(meeting('course-a', 'Synthetic block A')),
    'Web Design',
  );
});

test('preserves structured Classroom objective content for presentation icons', () => {
  assert.deepEqual(
    presentationCard({
      cardId: 'card-objective',
      type: 'objective',
      title: 'Objective 1',
      lines: [
        'Changing the Wheels',
        'Complete Lesson 3.',
        'Open Classroom for full directions.',
        'Due Tue, April 17.',
      ],
      featured: 'Changing the Wheels',
      details: [
        'Complete Lesson 3.',
        'Open Classroom for full directions.',
        'Due Tue, April 17.',
      ],
      accent: 'warm',
      durationSeconds: 12,
    }),
    {
      cardId: 'card-objective',
      type: 'objective',
      title: 'Objective 1',
      lines: [],
      featured: 'Changing the Wheels',
      details: [
        'Complete Lesson 3.',
        'Open Classroom for full directions.',
        'Due Tue, April 17.',
      ],
      accent: 'warm',
      durationSeconds: 12,
    },
  );
});
