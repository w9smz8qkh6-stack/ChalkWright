import assert from 'node:assert/strict';
import test from 'node:test';

import { buildPeriod, buildScheduleObservation } from './builders.js';
import {
  malformedScheduleFixture,
  multiScreenFixture,
  scheduleFixtureCatalog,
} from './schedule-cases.js';

function buildDeterminismProbe() {
  return buildScheduleObservation({
    id: 'observation-determinism',
    date: '2035-03-01',
    kind: 'normal',
    periods: [
      buildPeriod(
        'period-determinism-1',
        'course-determinism',
        'Block A',
        '2035-03-01T08:00:00Z',
        '2035-03-01T09:00:00Z',
      ),
    ],
  });
}

test('provides every required synthetic scenario exactly once', () => {
  assert.deepEqual(
    scheduleFixtureCatalog.map((entry) => entry.scenario),
    [
      'normal',
      'special-schedule',
      'empty',
      'stale',
      'malformed',
      'gap-day',
      'multi-screen',
    ],
  );
  assert.equal(
    new Set(scheduleFixtureCatalog.map((entry) => entry.fixtureId)).size,
    scheduleFixtureCatalog.length,
  );
  assert.ok(scheduleFixtureCatalog.every((entry) => entry.synthetic));
});

test('builds byte-stable fixtures without clocks or randomness', () => {
  assert.equal(
    JSON.stringify(buildDeterminismProbe()),
    JSON.stringify(buildDeterminismProbe()),
  );
});

test('marks malformed input rejected without implementing a parser', () => {
  assert.equal(malformedScheduleFixture.expectation.acceptedByContract, false);
  assert.equal(
    malformedScheduleFixture.expectation.laterBehaviorGate,
    'M-03 validation and failure classification',
  );
});

test('keeps synthetic multi-screen plans isolated by explicit scope', () => {
  assert.deepEqual(multiScreenFixture.input.isolationExpectation, {
    'screen-alpha': 'plan-room-alpha',
    'screen-beta': 'plan-room-beta',
  });
  assert.notEqual(
    multiScreenFixture.input.plans[0]?.roomId,
    multiScreenFixture.input.plans[1]?.roomId,
  );

  for (const plan of multiScreenFixture.input.plans) {
    assert.equal(plan.timeZone, 'Etc/UTC');

    for (const meeting of plan.meetings) {
      assert.ok(
        Date.parse(meeting.checkInOpensAt) <
          Date.parse(meeting.officialStartsAt),
      );
      assert.equal(meeting.officialStartsAt, meeting.checkInClosesAt);
      assert.equal(meeting.checkInClosesAt, meeting.contentStartsAt);
      assert.ok(
        Date.parse(meeting.dismissalStartsAt) <
          Date.parse(meeting.officialEndsAt),
      );
    }
  }
});
