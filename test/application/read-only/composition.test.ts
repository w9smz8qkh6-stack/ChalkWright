import assert from 'node:assert/strict';
import test from 'node:test';

import { contractVersion } from '../../../src/contracts/v1/common.js';
import { composePreview } from '../../../src/application/read-only/composition.js';
import type {
  ClassId,
  RoomId,
  ScreenId,
} from '../../../src/domain/identities.js';
import type { EffectiveDayPlan } from '../../../src/domain/plans.js';
import { buildMeeting } from '../../fixtures/builders.js';

test('composes preview without calling mutation ports or mutating values', () => {
  let writes = 0;
  let commands = 0;
  const mutationPortSpies = {
    write: () => {
      writes += 1;
    },
    command: () => {
      commands += 1;
    },
  };
  const plan: EffectiveDayPlan = {
    contractVersion,
    effectivePlanId: 'effective-alpha',
    canonicalPlanId: 'plan-alpha',
    date: '2035-04-13',
    timeZone: 'Etc/UTC',
    roomId: 'room-alpha' as RoomId,
    screenId: 'screen-alpha' as ScreenId,
    verification: 'synthetic',
    diagnostics: [],
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
    ],
  };
  const before = JSON.stringify(plan);
  const result = composePreview({
    plans: [plan],
    screenId: plan.screenId,
    evaluatedAt: '2035-04-13T08:00:00Z',
    classId: 'class-alpha' as ClassId,
    content: { cards: [], assignmentsVisible: true },
    override: {
      screenId: plan.screenId,
      date: plan.date,
      announcement: 'Preview only',
    },
    statePolicy: { showCheckIn: true },
  });
  void mutationPortSpies;
  assert.equal(result.state?.state, 'in_class_content');
  assert.equal(result.content.announcement?.title, 'Announcement');
  assert.equal(result.originalPlan?.effectivePlanId, plan.effectivePlanId);
  assert.equal(result.effectivePlan?.effectivePlanId, plan.effectivePlanId);
  assert.deepEqual(
    result.timeline.map((item) => item.state),
    [
      'idle',
      'pre_checkin',
      'in_class_content',
      'dismissal_warning',
      'post_end',
      'day_complete',
    ],
  );
  assert.equal(result.forcedTarget?.state, 'in_class_content');
  assert.equal(writes, 0);
  assert.equal(commands, 0);
  assert.equal(JSON.stringify(plan), before);
  const missing = composePreview({
    plans: [plan],
    screenId: 'screen-beta' as ScreenId,
    evaluatedAt: '2035-04-13T08:00:00Z',
    content: { cards: [], assignmentsVisible: true },
    statePolicy: { showCheckIn: true },
  });
  assert.equal(missing.plan, undefined);
  assert.equal(missing.diagnostics[0]?.code, 'preview-plan-missing');
  const hidden = composePreview({
    plans: [plan],
    screenId: plan.screenId,
    evaluatedAt: '2035-04-13T08:00:00Z',
    content: { cards: [], assignmentsVisible: true },
    statePolicy: { showCheckIn: false },
  });
  assert.ok(hidden.timeline.every((item) => item.state !== 'pre_checkin'));
  const empty = composePreview({
    plans: [{ ...plan, meetings: [] }],
    screenId: plan.screenId,
    evaluatedAt: '2035-04-13T08:00:00Z',
    content: { cards: [], assignmentsVisible: true },
    statePolicy: { showCheckIn: true },
  });
  assert.equal(empty.timeline[0]?.state, 'no_classes');
  assert.equal(empty.diagnostics[0]?.code, 'preview-plan-empty');
});
