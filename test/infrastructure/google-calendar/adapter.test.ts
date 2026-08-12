import assert from 'node:assert/strict';
import test from 'node:test';

import {
  readCalendarAuditWindow,
  type CalendarAuditReadOptions,
} from '../../../src/infrastructure/google-calendar/adapter.js';
import { GoogleCalendarTransportError } from '../../../src/infrastructure/google-calendar/contracts.js';

function validEvent(id: string): Record<string, unknown> {
  return {
    id,
    status: 'confirmed',
    eventType: 'default',
    summary: 'Synthetic class',
    description: 'Synthetic schedule',
    start: {
      dateTime: '2035-04-13T08:00:00.000Z',
      timeZone: 'Etc/UTC',
    },
    end: {
      dateTime: '2035-04-13T09:00:00.000Z',
      timeZone: 'Etc/UTC',
    },
    extendedProperties: {
      private: {
        classroomHubOwner: 'classroom-hub',
        classroomHubScope: 'scope-alpha',
        classroomHubOwnershipMarker: 'classroom-hub-v1',
      },
    },
  };
}

function options(
  listEvents: CalendarAuditReadOptions['transport']['listEvents'],
): CalendarAuditReadOptions {
  return {
    calendarId: 'primary',
    requestTimeoutMs: 5_000,
    maximumPages: 3,
    maximumEvents: 10,
    maximumWindowDays: 14,
    transport: { listEvents },
    now: () => '2035-04-13T07:00:00.000Z',
  };
}

const request = {
  timeMin: '2035-04-13T00:00:00.000Z',
  timeMax: '2035-04-14T00:00:00.000Z',
  timeZone: 'Etc/UTC',
} as const;

test('reads finite pages and retains only minimal ownership fields', async () => {
  const tokens: (string | undefined)[] = [];
  const result = await readCalendarAuditWindow(
    options(async (read) => {
      tokens.push(read.pageToken);
      return read.pageToken === undefined
        ? { items: [validEvent('event-one')], nextPageToken: 'second' }
        : { items: [validEvent('event-two')] };
    }),
    request,
  );
  assert.equal(result.status, 'observed');
  if (result.status !== 'observed') return;
  assert.deepEqual(tokens, [undefined, 'second']);
  assert.equal(result.events.length, 2);
  assert.deepEqual(result.events[0]?.privateOwnership, {
    owner: 'classroom-hub',
    scopeId: 'scope-alpha',
    ownershipMarker: 'classroom-hub-v1',
  });
  assert.equal(result.invalidItemCount, 0);
  assert.equal(result.unsupportedItemCount, 0);
});

test('normalizes provider RFC3339 offsets to canonical UTC instants', async () => {
  const offsetEvent = {
    ...validEvent('event-offset'),
    start: {
      dateTime: '2035-04-13T15:00:00+07:00',
      timeZone: 'Asia/Ho_Chi_Minh',
    },
    end: {
      dateTime: '2035-04-13T16:00:00+07:00',
      timeZone: 'Asia/Ho_Chi_Minh',
    },
  };
  const result = await readCalendarAuditWindow(
    options(async () => ({ items: [offsetEvent] })),
    { ...request, timeZone: 'Asia/Ho_Chi_Minh' },
  );
  assert.equal(result.status, 'observed');
  if (result.status !== 'observed') return;
  assert.equal(result.events[0]?.startsAt, '2035-04-13T08:00:00.000Z');
  assert.equal(result.events[0]?.endsAt, '2035-04-13T09:00:00.000Z');
  assert.equal(result.events[0]?.timeZone, 'Asia/Ho_Chi_Minh');
});

test('rejects impossible provider dates instead of rolling them forward', async () => {
  const impossible = {
    ...validEvent('event-impossible'),
    start: {
      dateTime: '2035-02-30T08:00:00+07:00',
      timeZone: 'Asia/Ho_Chi_Minh',
    },
  };
  const result = await readCalendarAuditWindow(
    options(async () => ({ items: [impossible] })),
    { ...request, timeZone: 'Asia/Ho_Chi_Minh' },
  );
  assert.equal(result.status, 'observed');
  if (result.status !== 'observed') return;
  assert.equal(result.events.length, 0);
  assert.equal(result.invalidItemCount, 1);
});

test('counts malformed and all-day entries so ownership audit can fail closed', async () => {
  const allDay = {
    ...validEvent('all-day'),
    start: { date: '2035-04-13' },
    end: { date: '2035-04-14' },
  };
  const result = await readCalendarAuditWindow(
    options(async () => ({ items: [{ id: 'bad' }, allDay] })),
    request,
  );
  assert.equal(result.status, 'observed');
  if (result.status !== 'observed') return;
  assert.equal(result.events.length, 0);
  assert.equal(result.invalidItemCount, 1);
  assert.equal(result.unsupportedItemCount, 1);
});

test('bounds windows, pagination, provider errors, and authentication repair', async () => {
  const invalid = await readCalendarAuditWindow(
    options(async () => ({ items: [] })),
    { ...request, timeMax: '2035-06-01T00:00:00.000Z' },
  );
  assert.deepEqual(invalid, {
    status: 'failed',
    code: 'calendar-audit-request-invalid',
    retryable: false,
  });

  const repeated = await readCalendarAuditWindow(
    options(async () => ({ items: [], nextPageToken: 'same' })),
    request,
  );
  assert.equal(repeated.status, 'failed');
  if (repeated.status === 'failed')
    assert.equal(repeated.code, 'calendar-pagination-invalid');

  const repair = await readCalendarAuditWindow(
    options(async () => {
      throw new GoogleCalendarTransportError(
        'calendar-authentication-required',
      );
    }),
    request,
  );
  assert.deepEqual(repair, {
    status: 'repair-required',
    code: 'calendar-authentication-required',
    retryable: false,
  });
});
