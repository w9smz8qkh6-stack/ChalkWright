import assert from 'node:assert/strict';
import {
  chmodSync,
  linkSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { googleClassroomCourseworkReadScope } from '../../../src/config/google-classroom.js';
import {
  createClassroomCourseWorkListTransport,
  loadOfficialClassroomCourseWorkTransport,
} from '../../../src/infrastructure/google-classroom/official-client.js';

test('official transport exposes one fixed published-coursework list operation', async () => {
  const calls: { readonly params: unknown; readonly options: unknown }[] = [];
  const transport = createClassroomCourseWorkListTransport({
    courses: {
      courseWork: {
        async list(params: unknown, options: unknown) {
          calls.push({ params, options });
          return {
            data: {
              courseWork: [{ id: 'item-1', title: 'Synthetic work' }],
              nextPageToken: 'next-page',
            },
          };
        },
      },
    },
  });
  const signal = new AbortController().signal;
  const result = await transport.listPublishedCourseWork({
    providerCourseKey: '123456789',
    pageToken: 'prior-page',
    timeoutMs: 5_000,
    signal,
  });
  assert.equal(result.items.length, 1);
  assert.equal(result.nextPageToken, 'next-page');
  assert.deepEqual(calls[0]?.params, {
    courseId: '123456789',
    courseWorkStates: ['PUBLISHED'],
    orderBy: 'dueDate asc,updateTime desc',
    pageSize: 100,
    pageToken: 'prior-page',
  });
  assert.deepEqual(calls[0]?.options, {
    fields:
      'nextPageToken,courseWork(id,courseId,title,description,dueDate,dueTime,alternateLink,state,workType,materials,updateTime,creationTime)',
    retry: false,
    signal,
    timeout: 5_000,
  });
});

test('official transport maps provider errors to finite sanitized codes', async () => {
  for (const [status, code] of [
    [401, 'classroom-authentication-required'],
    [403, 'classroom-authorization-denied'],
    [404, 'classroom-course-not-found'],
    [429, 'classroom-rate-limited'],
    [500, 'classroom-read-unavailable'],
  ] as const) {
    const transport = createClassroomCourseWorkListTransport({
      courses: {
        courseWork: {
          async list() {
            throw { response: { status }, privateDetail: 'must-not-escape' };
          },
        },
      },
    });
    await assert.rejects(
      transport.listPublishedCourseWork({
        providerCourseKey: '123',
        timeoutMs: 1_000,
        signal: new AbortController().signal,
      }),
      (error: unknown) =>
        error instanceof Error &&
        error.message === code &&
        !error.message.includes('privateDetail'),
    );
  }
});

test('authorized-user reference is exact, owner-only, single-link, and read-only scoped', () => {
  const root = mkdtempSync(join(tmpdir(), 'm08-classroom-oauth-'));
  const path = join(root, 'authorized-user.json');
  const reference = {
    version: 1,
    type: 'authorized-user',
    clientId: `${'a'.repeat(24)}.apps.googleusercontent.com`,
    clientSecret: 's'.repeat(32),
    refreshToken: 'r'.repeat(32),
    scopes: [googleClassroomCourseworkReadScope],
  };
  try {
    writeFileSync(path, JSON.stringify(reference), { mode: 0o600 });
    assert.doesNotThrow(() => loadOfficialClassroomCourseWorkTransport(path));

    chmodSync(path, 0o640);
    assert.throws(
      () => loadOfficialClassroomCourseWorkTransport(path),
      /classroom-credential-reference-unsafe/u,
    );
    chmodSync(path, 0o600);

    const hardLink = join(root, 'reference-hard-link.json');
    linkSync(path, hardLink);
    assert.throws(
      () => loadOfficialClassroomCourseWorkTransport(path),
      /classroom-credential-reference-unsafe/u,
    );
    unlinkSync(hardLink);

    const symlink = join(root, 'reference-link.json');
    symlinkSync(path, symlink);
    assert.throws(
      () => loadOfficialClassroomCourseWorkTransport(symlink),
      /classroom-credential-reference-unsafe/u,
    );

    writeFileSync(
      path,
      JSON.stringify({
        ...reference,
        scopes: ['https://www.googleapis.com/auth/classroom.coursework.me'],
      }),
      { mode: 0o600 },
    );
    assert.throws(
      () => loadOfficialClassroomCourseWorkTransport(path),
      /classroom-credential-reference-invalid/u,
    );

    writeFileSync(
      path,
      JSON.stringify({ ...reference, unexpected: 'synthetic-extra-field' }),
      { mode: 0o600 },
    );
    assert.throws(
      () => loadOfficialClassroomCourseWorkTransport(path),
      /classroom-credential-reference-invalid/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
