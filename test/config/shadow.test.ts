import assert from 'node:assert/strict';
import test from 'node:test';

import { loadShadowConfig } from '../../src/config/shadow.js';

const valid = {
  CLASSROOM_HUB_SHADOW_INSTANCE_ID: 'classroom-hub-m11-shadow',
  CLASSROOM_HUB_SHADOW_ROOM_ID: 'room-c509',
  CLASSROOM_HUB_SHADOW_SCREEN_ID: 'screen-c509-shadow',
  CLASSROOM_HUB_SHADOW_SCREEN_LABEL: 'C509 Shadow Display',
  CLASSROOM_HUB_SHADOW_HOST: '127.0.0.1',
  CLASSROOM_HUB_SHADOW_PORT: '4328',
  CLASSROOM_HUB_SHADOW_PRODUCTION_PORT: '20790',
  CLASSROOM_HUB_TIME_ZONE: 'Asia/Ho_Chi_Minh',
  CLASSROOM_HUB_ACADEMIC_YEAR_END: '2027-06-30',
  CLASSROOM_HUB_MANAGED_ROOT: '/synthetic/classroom-hub-shadow',
  CLASSROOM_HUB_DATABASE_PATH:
    '/synthetic/classroom-hub-shadow/state/app.sqlite',
  CLASSROOM_HUB_BACKUP_DIRECTORY: '/synthetic/classroom-hub-shadow/backups',
  CLASSROOM_HUB_SHADOW_COURSE_MAPPINGS: JSON.stringify([
    {
      classId: 'class-c509-a',
      sectionCode: 'English C509 CODE-A',
      providerCourseKey: '123456789',
      attendanceClassCode: 'C509-A',
      attendanceCheckInUrl: 'https://attendance.example.invalid/check-in',
    },
  ]),
} satisfies NodeJS.ProcessEnv;

test('loads an isolated loopback-only shadow contract', () => {
  const config = loadShadowConfig(valid);
  assert.equal(config.port, 4328);
  assert.equal(config.productionPort, 20790);
  assert.equal(config.courseMappings.length, 1);
  assert.equal(config.courseMappings[0]?.roomId, 'room-c509');
  assert.equal(config.courseMappings[0]?.attendanceClassCode, 'C509-A');
  assert.equal(
    config.courseMappings[0]?.attendanceCheckInUrl,
    'https://attendance.example.invalid/check-in',
  );
});

test('rejects production aliasing, broad paths, duplicate mappings, and mutation capability', () => {
  const cases: NodeJS.ProcessEnv[] = [
    { ...valid, CLASSROOM_HUB_SHADOW_PORT: '20790' },
    { ...valid, CLASSROOM_HUB_SHADOW_HOST: '0.0.0.0' },
    { ...valid, CLASSROOM_HUB_MANAGED_ROOT: '/synthetic/production' },
    { ...valid, CLASSROOM_HUB_OPERATOR_TOKEN: 'not-accepted-in-shadow' },
    { ...valid, CLASSROOM_HUB_CALENDAR_CREDENTIAL: '/private/reference' },
    { ...valid, CLASSROOM_HUB_SHADOW_INSTANCE_ID: 'production' },
    {
      ...valid,
      CLASSROOM_HUB_SHADOW_COURSE_MAPPINGS: JSON.stringify([
        {
          classId: 'class-a',
          sectionCode: 'A CODE-A',
          providerCourseKey: '1',
          attendanceClassCode: 'invalid\ncode',
        },
      ]),
    },
    {
      ...valid,
      CLASSROOM_HUB_SHADOW_COURSE_MAPPINGS: JSON.stringify([
        {
          classId: 'class-a',
          sectionCode: 'A CODE-A',
          providerCourseKey: '1',
          attendanceCheckInUrl: 'javascript:alert(1)',
        },
      ]),
    },
    {
      ...valid,
      CLASSROOM_HUB_SHADOW_COURSE_MAPPINGS: JSON.stringify([
        { classId: 'class-a', sectionCode: 'A CODE-A', providerCourseKey: '1' },
        { classId: 'class-a', sectionCode: 'B CODE-B', providerCourseKey: '2' },
      ]),
    },
  ];
  for (const candidate of cases)
    assert.throws(() => loadShadowConfig(candidate));
});
