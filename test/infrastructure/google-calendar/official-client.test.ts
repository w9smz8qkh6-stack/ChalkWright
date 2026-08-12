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

import { googleCalendarOwnedEventsReadScope } from '../../../src/config/google-calendar.js';
import {
  createCalendarEventListTransport,
  loadOfficialCalendarEventListTransport,
} from '../../../src/infrastructure/google-calendar/official-client.js';

test('official transport exposes one exact bounded Events.list read', async () => {
  const calls: { readonly params: unknown; readonly options: unknown }[] = [];
  const transport = createCalendarEventListTransport({
    events: {
      async list(params: unknown, options: unknown) {
        calls.push({ params, options });
        return {
          data: { items: [{ id: 'event-one' }], nextPageToken: 'next-page' },
        };
      },
    },
  });
  const signal = new AbortController().signal;
  const result = await transport.listEvents({
    calendarId: 'primary',
    timeMin: '2035-04-13T00:00:00.000Z',
    timeMax: '2035-04-14T00:00:00.000Z',
    pageToken: 'prior-page',
    maximumResults: 100,
    timeoutMs: 5_000,
    signal,
  });
  assert.equal(result.items.length, 1);
  assert.equal(result.nextPageToken, 'next-page');
  assert.deepEqual(calls[0]?.params, {
    calendarId: 'primary',
    timeMin: '2035-04-13T00:00:00.000Z',
    timeMax: '2035-04-14T00:00:00.000Z',
    singleEvents: true,
    orderBy: 'startTime',
    showDeleted: false,
    maxResults: 100,
    pageToken: 'prior-page',
  });
  assert.deepEqual(calls[0]?.options, {
    fields:
      'nextPageToken,items(id,status,eventType,summary,description,start(date,dateTime,timeZone),end(date,dateTime,timeZone),extendedProperties(private),recurringEventId,originalStartTime(date,dateTime,timeZone))',
    retry: false,
    signal,
    timeout: 5_000,
  });
});

test('official transport maps provider errors to finite sanitized codes', async () => {
  for (const [status, code] of [
    [401, 'calendar-authentication-required'],
    [403, 'calendar-authorization-denied'],
    [404, 'calendar-not-found'],
    [429, 'calendar-rate-limited'],
    [500, 'calendar-read-unavailable'],
  ] as const) {
    const transport = createCalendarEventListTransport({
      events: {
        async list() {
          throw { response: { status }, privateDetail: 'must-not-escape' };
        },
      },
    });
    await assert.rejects(
      transport.listEvents({
        calendarId: 'primary',
        timeMin: '2035-04-13T00:00:00.000Z',
        timeMax: '2035-04-14T00:00:00.000Z',
        maximumResults: 100,
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

test('authorized-user reference is separate, exact, owner-only, and read-only scoped', () => {
  const root = mkdtempSync(join(tmpdir(), 'm13-calendar-oauth-'));
  const path = join(root, 'authorized-user.json');
  const reference = {
    version: 1,
    type: 'authorized-user',
    clientId: `${'a'.repeat(24)}.apps.googleusercontent.com`,
    clientSecret: 's'.repeat(32),
    refreshToken: 'r'.repeat(32),
    scopes: [googleCalendarOwnedEventsReadScope],
  };
  try {
    const absent = join(root, 'private-absent-reference.json');
    assert.throws(
      () => loadOfficialCalendarEventListTransport(absent),
      (error: unknown) =>
        error instanceof Error &&
        error.message === 'calendar-audit-credential-reference-unsafe' &&
        !error.message.includes(absent),
    );

    writeFileSync(path, JSON.stringify(reference), { mode: 0o600 });
    assert.doesNotThrow(() => loadOfficialCalendarEventListTransport(path));

    chmodSync(path, 0o640);
    assert.throws(
      () => loadOfficialCalendarEventListTransport(path),
      /calendar-audit-credential-reference-unsafe/u,
    );
    chmodSync(path, 0o600);

    const hardLink = join(root, 'reference-hard-link.json');
    linkSync(path, hardLink);
    assert.throws(
      () => loadOfficialCalendarEventListTransport(path),
      /calendar-audit-credential-reference-unsafe/u,
    );
    unlinkSync(hardLink);

    const symlink = join(root, 'reference-link.json');
    symlinkSync(path, symlink);
    assert.throws(
      () => loadOfficialCalendarEventListTransport(symlink),
      /calendar-audit-credential-reference-unsafe/u,
    );

    writeFileSync(
      path,
      JSON.stringify({
        ...reference,
        scopes: ['https://www.googleapis.com/auth/calendar.events.owned'],
      }),
      { mode: 0o600 },
    );
    assert.throws(
      () => loadOfficialCalendarEventListTransport(path),
      /calendar-audit-credential-reference-invalid/u,
    );

    writeFileSync(
      path,
      JSON.stringify({ ...reference, extra: 'synthetic-extra-field' }),
      { mode: 0o600 },
    );
    assert.throws(
      () => loadOfficialCalendarEventListTransport(path),
      /calendar-audit-credential-reference-invalid/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
