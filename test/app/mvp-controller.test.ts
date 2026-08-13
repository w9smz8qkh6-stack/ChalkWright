import assert from 'node:assert/strict';
import test from 'node:test';

import { presentationCourseLabel } from '../../src/app/mvp-controller.js';
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
