import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  contractVersion,
  displayPollingTiming,
  displayStates,
  jobOutcomeCategories,
  meetingTimelineOrder,
  retirementDecisions,
  routeFamilies,
  visualBaselineManifest,
  visualViewports,
  type CalendarMutationIntent,
  type JobOutcome,
} from '../../../src/contracts/v1/index.js';
import {
  multiScreenFixture,
  normalScheduleFixture,
} from '../../fixtures/schedule-cases.js';

test('freezes the initial contract version', () => {
  assert.equal(contractVersion, '1.0.0');
  assert.equal(normalScheduleFixture.input.contractVersion, contractVersion);
});

test('enumerates every legacy display state and categorized job outcome', () => {
  assert.deepEqual(displayStates, [
    'no_classes',
    'morning_overview',
    'idle',
    'pre_checkin',
    'in_class_content',
    'dismissal_warning',
    'post_end',
    'day_complete',
  ]);
  assert.deepEqual(jobOutcomeCategories, [
    'succeeded',
    'degraded',
    'skipped',
    'repair-required',
    'failed',
  ]);
});

test('freezes initial route families and timing tables without implementing them', () => {
  assert.deepEqual(routeFamilies, [
    'display',
    'displays',
    'day-plan',
    'target',
    'preview',
    'overrides',
    'qr',
    'media',
    'assets',
    'manifest',
    'health',
    'readiness',
  ]);
  assert.deepEqual(meetingTimelineOrder, [
    'checkInOpensAt',
    'officialStartsAt',
    'checkInClosesAt',
    'contentStartsAt',
    'dismissalStartsAt',
    'officialEndsAt',
  ]);
  assert.deepEqual(displayPollingTiming, {
    requestTimeoutMs: 10_000,
    healthyIntervalMs: 30_000,
    initialRetryMs: 5_000,
    maximumRetryMs: 120_000,
    retryStrategy: 'exponential',
  });
});

test('keeps the effective timezone on canonical plans', () => {
  for (const plan of multiScreenFixture.input.plans) {
    assert.equal(plan.timeZone, 'Etc/UTC');
    assert.equal('calendarId' in plan, false);
    assert.equal('screenId' in plan, false);
  }
});

test('keeps Calendar intents inert, owned, and notification-suppressed', () => {
  const intents: readonly CalendarMutationIntent[] = [
    {
      contractVersion,
      intentId: 'intent-noop',
      planId: 'plan-alpha',
      kind: 'no-op',
      notifyAttendees: false,
      existingEventReference: 'synthetic-event-alpha',
      reason: 'semantic-match',
    },
    {
      contractVersion,
      intentId: 'intent-create',
      planId: 'plan-alpha',
      kind: 'create',
      notifyAttendees: false,
      ownership: {
        classification: 'verified-application-owned',
        scopeId: 'scope-alpha',
        ownershipMarker: 'synthetic-owner-alpha',
      },
      desired: {
        summary: 'Synthetic Block A',
        description: 'Synthetic schedule projection',
        startsAt: '2035-02-12T08:00:00Z',
        endsAt: '2035-02-12T09:00:00Z',
        timeZone: 'Etc/UTC',
      },
    },
  ];

  for (const intent of intents) {
    assert.equal(intent.notifyAttendees, false);

    if (intent.kind !== 'no-op') {
      assert.equal(
        intent.ownership.classification,
        'verified-application-owned',
      );
    }
  }
});

test('categorizes repair-required outcomes with zero external mutations', () => {
  const outcome: JobOutcome = {
    contractVersion,
    runId: 'run-repair-required',
    jobName: 'synthetic-schedule-refresh',
    category: 'repair-required',
    startedAt: '2035-02-12T05:00:00Z',
    finishedAt: '2035-02-12T05:00:01Z',
    attemptedExternalMutations: 0,
    completedExternalMutations: 0,
    diagnostics: [
      {
        code: 'synthetic-auth-repair-required',
        severity: 'error',
        message: 'Synthetic authentication repair is required.',
      },
    ],
  };

  assert.equal(outcome.category, 'repair-required');
  assert.equal(outcome.attemptedExternalMutations, 0);
  assert.equal(outcome.completedExternalMutations, 0);
});

test('records agent-inspected visual evidence without implying approval', () => {
  assert.deepEqual(
    visualBaselineManifest.map((entry) => entry.state),
    displayStates,
  );
  assert.ok(
    visualBaselineManifest.every(
      (entry) => entry.evidenceStatus === 'captured-agent-inspected',
    ),
  );
  assert.ok(
    visualBaselineManifest.every(
      (entry) =>
        entry.viewportIds.length === 1 && entry.viewportIds[0] === 'large-tv',
    ),
  );
  assert.ok(
    visualViewports.every((viewport) => viewport.status === 'provisional'),
  );
  assert.deepEqual(retirementDecisions, []);
  assert.match(
    readFileSync('docs/migration/retirement-decisions.md', 'utf8'),
    /Approved retirements: \*\*None\.\*\*/,
  );
});
