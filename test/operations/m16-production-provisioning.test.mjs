import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  buildJobEnvironments,
  parseSystemdEnvironmentText,
  renderEnvironment,
} from '../../scripts/operations/provision-m16-production.mjs';

const mappings = [
  {
    classId: 'robotics',
    providerCourseKey: '123456',
    sectionCode: 'C509',
    attendanceClassCode: 'C509',
  },
];

function fixtures() {
  const server = {
    CLASSROOM_HUB_SHADOW_ROOM_ID: 'C509',
    CLASSROOM_HUB_TIME_ZONE: 'Asia/Ho_Chi_Minh',
    CLASSROOM_HUB_SHADOW_COURSE_MAPPINGS: JSON.stringify(mappings),
    CLASSROOM_HUB_SHADOW_SCREEN_LABEL: 'Classroom C509',
    CLASSROOM_HUB_ACADEMIC_YEAR_END: '2027-06-30',
    CLASSROOM_HUB_SHADOW_CHECKIN_MINUTES: '10',
    CLASSROOM_HUB_SHADOW_DISMISSAL_WARNING_MINUTES: '5',
  };
  const refresh = {
    CLASSROOM_HUB_CLASSROOM_COURSE_MAPPINGS: JSON.stringify(
      mappings.map(({ classId, providerCourseKey }) => ({
        classId,
        providerCourseKey,
      })),
    ),
    CLASSROOM_HUB_POWERSCHOOL_ROOM_ID: 'C509',
    CLASSROOM_HUB_JOB_DEADLINE_SECONDS: '45',
    CLASSROOM_HUB_POWERSCHOOL_ORIGIN: 'https://powerschool.example.test',
    CLASSROOM_HUB_POWERSCHOOL_STATUS_PATH: '/status',
    CLASSROOM_HUB_POWERSCHOOL_STATUS_READY_SELECTOR: '#ready',
    CLASSROOM_HUB_POWERSCHOOL_BELL_PATH_TEMPLATE:
      '/bell?target_date={MM/DD/YYYY}',
    CLASSROOM_HUB_POWERSCHOOL_BELL_READY_SELECTOR: '#bell',
    CLASSROOM_HUB_POWERSCHOOL_CHROME_EXECUTABLE: '/usr/bin/google-chrome',
    CLASSROOM_HUB_POWERSCHOOL_NAVIGATION_TIMEOUT_SECONDS: '15',
    CLASSROOM_HUB_POWERSCHOOL_ROUTINE_TIMEOUT_SECONDS: '45',
    CLASSROOM_HUB_POWERSCHOOL_MAX_RESPONSE_BYTES: '1048576',
    CLASSROOM_HUB_POWERSCHOOL_UTC_OFFSET: '+07:00',
    CLASSROOM_HUB_CLASSROOM_REQUEST_TIMEOUT_SECONDS: '15',
    CLASSROOM_HUB_CLASSROOM_MAX_PAGES_PER_COURSE: '3',
    CLASSROOM_HUB_CLASSROOM_MAX_ITEMS_PER_COURSE: '100',
    CLASSROOM_HUB_CLASSROOM_MAX_PARALLEL_COURSES: '2',
    CLASSROOM_HUB_CLASSROOM_CACHE_FRESH_SECONDS: '900',
    CLASSROOM_HUB_CLASSROOM_BACKOFF_BASE_SECONDS: '60',
    CLASSROOM_HUB_CLASSROOM_BACKOFF_MAX_SECONDS: '3600',
  };
  return { server, refresh };
}

test('M-16 provision parser accepts only inert JSON-quoted environment entries', () => {
  assert.deepEqual(
    { ...parseSystemdEnvironmentText('A="one"\nB="two three"\n') },
    { A: 'one', B: 'two three' },
  );
  for (const hostile of [
    'A=unquoted\n',
    'A="one"\nA="two"\n',
    'A="$(touch /tmp/nope)" trailing\n',
    'lower="value"\n',
  ]) {
    assert.throws(
      () => parseSystemdEnvironmentText(hostile),
      /m16-provision-source-invalid/u,
    );
  }
});

test('M-16 provisioning derives fixed production references without provider or unit authority', () => {
  const { server, refresh } = fixtures();
  const result = buildJobEnvironments(server, refresh);
  assert.equal(result.payload.instanceId, 'classroom-hub-c509-production');
  assert.equal(result.payload.host, '127.0.0.1');
  assert.equal(result.payload.port, 4317);
  assert.equal(
    result.payload.databasePath,
    '/var/lib/classroom-hub/production/state/classroom-hub.sqlite',
  );
  assert.equal(
    result.plan.CLASSROOM_HUB_POWERSCHOOL_SESSION_DIRECTORY,
    '/var/lib/classroom-hub/powerschool-session',
  );
  assert.equal(
    result.classroom.CLASSROOM_HUB_CLASSROOM_CREDENTIAL_REFERENCE,
    '/etc/classroom-hub/providers/google-classroom/authorized-user.json',
  );
  assert.equal(result.plan.CLASSROOM_HUB_ALERT_DELIVERY_MODE, 'report-only');
  assert.equal(
    result.classroom.CLASSROOM_HUB_CLASSROOM_BACKOFF_MAX_SECONDS,
    '900',
  );
  assert.equal(
    Object.keys(result.plan).some((key) => /PASSWORD|TOKEN|SECRET/u.test(key)),
    false,
  );
  assert.equal(
    Object.keys(result.classroom).some((key) =>
      /PASSWORD|TOKEN|SECRET/u.test(key),
    ),
    false,
  );
  assert.equal(
    parseSystemdEnvironmentText(renderEnvironment(result.plan))
      .CLASSROOM_HUB_INSTANCE_ID,
    'classroom-hub-c509-production',
  );
});

test('M-16 provisioning fails closed on mapping, room, timezone, or backoff drift', () => {
  for (const mutate of [
    ({ server }) => {
      server.CLASSROOM_HUB_TIME_ZONE = 'Etc/UTC';
    },
    ({ refresh }) => {
      refresh.CLASSROOM_HUB_POWERSCHOOL_ROOM_ID = 'B407';
    },
    ({ refresh }) => {
      refresh.CLASSROOM_HUB_CLASSROOM_COURSE_MAPPINGS = '[]';
    },
    ({ refresh }) => {
      refresh.CLASSROOM_HUB_CLASSROOM_BACKOFF_MAX_SECONDS = '3599';
    },
  ]) {
    const value = fixtures();
    mutate(value);
    assert.throws(() => buildJobEnvironments(value.server, value.refresh));
  }
});

test('M-16 provisioning artifacts remain inert and omit service/provider commands', () => {
  const provisioner = readFileSync(
    'scripts/operations/provision-m16-production.mjs',
    'utf8',
  );
  for (const forbidden of [
    'systemctl',
    'tailscale serve',
    'fetch(',
    "from '@googleapis/",
    'playwright',
    'child_process',
    '/etc/systemd/system',
  ]) {
    assert.equal(provisioner.includes(forbidden), false, forbidden);
  }
  const sysusers = readFileSync('systemd/classroom-hub.sysusers', 'utf8');
  const tmpfiles = readFileSync('systemd/classroom-hub.tmpfiles', 'utf8');
  assert.match(sysusers, /^u classroom-hub /mu);
  assert.match(
    tmpfiles,
    /^d \/etc\/classroom-hub\/server 0700 classroom-hub classroom-hub -$/mu,
  );
  assert.match(
    tmpfiles,
    /^d \/var\/lib\/classroom-hub\/production\/state 0700 classroom-hub classroom-hub -$/mu,
  );
  assert.doesNotMatch(
    `${sysusers}\n${tmpfiles}`,
    /systemctl|tailscale|ExecStart/u,
  );
});
