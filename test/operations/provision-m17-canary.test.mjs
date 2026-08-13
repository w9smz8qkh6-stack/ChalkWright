import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  buildM17Payloads,
  parseEnvironment,
  renderEnvironment,
} from '../../scripts/operations/provision-m17-canary.mjs';
import { readFileSync } from 'node:fs';

const digest = (value) =>
  `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
const server = {
  version: 1,
  instanceId: 'classroom-hub-c509-production',
  roomId: 'room-c509',
  screenId: 'screen-old',
  screenLabel: 'C509',
  host: '127.0.0.1',
  port: 4317,
  timeZone: 'Asia/Ho_Chi_Minh',
  academicYearEnd: '2027-06-30',
  managedRoot: '/var/lib/classroom-hub/production',
  databasePath: '/var/lib/classroom-hub/production/state/old.sqlite',
  backupDirectory: '/var/lib/classroom-hub/production/backups',
  operatorTokenReference: '/etc/classroom-hub/operator/token',
  courseMappings: [{ classId: 'mict02-2', providerCourseKey: 'MICT02.2' }],
  checkInOpenMinutesBefore: 10,
  dismissalWarningMinutesBefore: 5,
};
const calendarId = 'auto-lesson-2@example.test';
const calendar = {
  environment: 'non-production',
  calendarSummary: 'Auto Lesson 2',
  calendarId,
  calendarReferenceHash: digest(calendarId),
  productionCalendarReferenceHash: digest('legacy-auto-lesson@example.test'),
};

test('derives distinct M-17 server, state, scope, and exact Calendar deny bindings', () => {
  const result = buildM17Payloads(
    server,
    { KEEP: 'plan' },
    { KEEP: 'classroom' },
    calendar,
  );
  assert.equal(result.production.port, 4319);
  assert.equal(
    result.production.instanceId,
    'chalkwright-c509-canary-production',
  );
  assert.equal(result.calendar.calendarSummary, 'Auto Lesson 2');
  assert.deepEqual(result.calendar.deniedCalendarReferenceHashes, [
    digest('primary'),
    calendar.productionCalendarReferenceHash,
  ]);
  assert.equal(result.plan.CLASSROOM_HUB_ALERT_DELIVERY_MODE, 'report-only');
  assert.equal(
    result.classroom.CLASSROOM_HUB_ALERT_DELIVERY_MODE,
    'report-only',
  );
  assert.equal(result.maintenance.CLASSROOM_HUB_JOB_DEADLINE_SECONDS, '120');
  assert.equal(
    result.maintenance.CLASSROOM_HUB_BACKUP_DIRECTORY,
    '/var/lib/chalkwright/canary-production/backups',
  );
  assert.doesNotMatch(
    JSON.stringify(result),
    /\/var\/lib\/classroom-hub\/production/u,
  );
});

test('provisioning reads the generic protected M-14 writer handoff', () => {
  const source = readFileSync(
    'scripts/operations/provision-m17-canary.mjs',
    'utf8',
  );
  assert.match(
    source,
    /\/etc\/chalkwright\/migration\/google-calendar-writer-config\.json/u,
  );
  assert.doesNotMatch(
    source,
    /\/home\/|\/etc\/classroom-hub\/providers\/google-calendar\/writer-config\.json/u,
  );
});

test('rejects target, legacy-hash, timezone, and environment ambiguity', () => {
  for (const changed of [
    { calendarSummary: 'Auto Lesson' },
    { calendarId: 'primary', calendarReferenceHash: digest('primary') },
    { productionCalendarReferenceHash: digest(calendarId) },
  ])
    assert.throws(
      () => buildM17Payloads(server, {}, {}, { ...calendar, ...changed }),
      /m17-provision-calendar-policy-invalid/u,
    );
  assert.throws(() =>
    buildM17Payloads({ ...server, timeZone: 'Etc/UTC' }, {}, {}, calendar),
  );
  assert.deepEqual(Object.entries(parseEnvironment('A="one"\nB="two"\n')), [
    ['A', 'one'],
    ['B', 'two'],
  ]);
  assert.throws(() => parseEnvironment('A="one"\nA="two"\n'));
  assert.match(
    renderEnvironment({ B: 'two', A: 'one' }),
    /^A="one"\nB="two"\n$/u,
  );
});
