import assert from 'node:assert/strict';
import test from 'node:test';

import {
  googleClassroomCourseworkReadScope,
  loadGoogleClassroomReadConfig,
} from '../../src/config/google-classroom.js';

const base = {
  CLASSROOM_HUB_CLASSROOM_CREDENTIAL_REFERENCE:
    '/var/lib/classroom-hub/classroom-oauth.json',
  CLASSROOM_HUB_CLASSROOM_COURSE_MAPPINGS: JSON.stringify([
    { classId: 'class-a', providerCourseKey: '123456789' },
    { classId: 'class-b', providerCourseKey: '987654321' },
  ]),
};

test('loads only the approved Classroom read policy and external reference', () => {
  const config = loadGoogleClassroomReadConfig(
    base,
    '/workspace/classroom-hub',
  );
  assert.equal(
    googleClassroomCourseworkReadScope,
    'https://www.googleapis.com/auth/classroom.student-submissions.students.readonly',
  );
  assert.equal(
    config.credentialReferencePath,
    base.CLASSROOM_HUB_CLASSROOM_CREDENTIAL_REFERENCE,
  );
  assert.deepEqual(config.mappings, [
    { classId: 'class-a', providerCourseKey: '123456789' },
    { classId: 'class-b', providerCourseKey: '987654321' },
  ]);
  assert.deepEqual(
    {
      requestTimeoutMs: config.requestTimeoutMs,
      maximumPagesPerCourse: config.maximumPagesPerCourse,
      maximumItemsPerCourse: config.maximumItemsPerCourse,
      maximumParallelCourses: config.maximumParallelCourses,
      cacheFreshSeconds: config.cacheFreshSeconds,
      backoffBaseSeconds: config.backoffBaseSeconds,
      backoffMaximumSeconds: config.backoffMaximumSeconds,
    },
    {
      requestTimeoutMs: 15_000,
      maximumPagesPerCourse: 5,
      maximumItemsPerCourse: 500,
      maximumParallelCourses: 3,
      cacheFreshSeconds: 900,
      backoffBaseSeconds: 60,
      backoffMaximumSeconds: 3_600,
    },
  );
});

test('rejects repository credentials, broad mappings, duplicates, and unbounded policy', () => {
  for (const environment of [
    {
      ...base,
      CLASSROOM_HUB_CLASSROOM_CREDENTIAL_REFERENCE:
        '/workspace/classroom-hub/oauth.json',
    },
    {
      ...base,
      CLASSROOM_HUB_CLASSROOM_COURSE_MAPPINGS: JSON.stringify([
        { classId: 'class-a', providerCourseKey: 'alias:mutable' },
      ]),
    },
    {
      ...base,
      CLASSROOM_HUB_CLASSROOM_COURSE_MAPPINGS: JSON.stringify([
        { classId: 'class-a', providerCourseKey: '123' },
        { classId: 'class-a', providerCourseKey: '456' },
      ]),
    },
    {
      ...base,
      CLASSROOM_HUB_CLASSROOM_MAX_PARALLEL_COURSES: '5',
    },
    {
      ...base,
      CLASSROOM_HUB_CLASSROOM_BACKOFF_BASE_SECONDS: '4000',
      CLASSROOM_HUB_CLASSROOM_BACKOFF_MAX_SECONDS: '3600',
    },
  ]) {
    assert.throws(() =>
      loadGoogleClassroomReadConfig(environment, '/workspace/classroom-hub'),
    );
  }
});
