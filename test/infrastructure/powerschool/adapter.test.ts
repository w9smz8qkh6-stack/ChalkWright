import assert from 'node:assert/strict';
import test from 'node:test';

import type { Clock } from '../../../src/domain/determinism.js';
import type { RoomId } from '../../../src/domain/identities.js';
import { PowerSchoolScheduleAdapter } from '../../../src/infrastructure/powerschool/adapter.js';
import { PowerSchoolAuthentication } from '../../../src/infrastructure/powerschool/auth.js';
import type {
  PassiveReadResult,
  PassiveReadTransport,
} from '../../../src/infrastructure/powerschool/contracts.js';

const clock: Clock = { now: () => '2035-04-13T07:00:00.000Z' };
const roomId = 'room-b407' as RoomId;

class FakeReadTransport implements PassiveReadTransport {
  calls: string[] = [];
  constructor(private readonly results: PassiveReadResult[]) {}
  async read(path: string): Promise<PassiveReadResult> {
    this.calls.push(path);
    return (
      this.results.shift() ?? {
        status: 'failed',
        code: 'source-read-unavailable',
        retryable: true,
      }
    );
  }
}

function bellCapture(methodPath = '/bell?date=2035-04-13') {
  return {
    status: 'captured' as const,
    capture: {
      title: 'Monday Bell Schedule April 13, 2035',
      html: '<table><tr><td>Period 1</td><td>8:00 AM - 9:00 AM</td></tr></table>',
      text: 'Monday, April 13, 2035\nPeriod 1 8:00 AM - 9:00 AM',
      path: methodPath,
    },
  };
}

function adapter(http: PassiveReadTransport, browser: PassiveReadTransport) {
  const authentication = new PowerSchoolAuthentication(
    clock,
    { probe: async () => ({ state: 'failed', reason: 'unavailable' }) },
    { failureThreshold: 2, cooloffMs: 1_000, liveProbeTimeoutMs: 100 },
  );
  return {
    authentication,
    adapter: new PowerSchoolScheduleAdapter({
      authentication,
      http,
      browser,
      clock,
      schedulePathTemplate: '/bell?date={date}',
      utcOffset: 'Z',
    }),
  };
}

test('formats the authorized M-07B bell query without exposing a generic query surface', async () => {
  const http = new FakeReadTransport([bellCapture()]);
  const browser = new FakeReadTransport([]);
  const authentication = new PowerSchoolAuthentication(
    clock,
    { probe: async () => ({ state: 'failed', reason: 'unavailable' }) },
    { failureThreshold: 2, cooloffMs: 1_000, liveProbeTimeoutMs: 100 },
  );
  const source = new PowerSchoolScheduleAdapter({
    authentication,
    http,
    browser,
    clock,
    schedulePathTemplate: '/teachers/aet_schedulebell.html?target_date={date}',
    scheduleDateFormat: 'mm/dd/yyyy',
    scheduleExpectedDate: '2035-04-13',
    utcOffset: 'Z',
  });

  await source.readSchedule({ date: '2035-04-13', roomId });
  assert.deepEqual(http.calls, [
    '/teachers/aet_schedulebell.html?target_date=04/13/2035',
  ]);
  assert.deepEqual(browser.calls, []);

  const rejected = await source.readSchedule({
    date: '2035-04-14',
    roomId,
  });
  assert.equal(rejected.status, 'failed');
  assert.deepEqual(http.calls, [
    '/teachers/aet_schedulebell.html?target_date=04/13/2035',
  ]);
});

test('normalizes a static HTTP capture into a minimal verified observation', async () => {
  const http = new FakeReadTransport([bellCapture()]);
  const browser = new FakeReadTransport([]);
  const source = adapter(http, browser).adapter;
  const result = await source.readSchedule({ date: '2035-04-13', roomId });

  assert.equal(result.status, 'observed');
  assert.deepEqual(http.calls, ['/bell?date=2035-04-13']);
  assert.equal(browser.calls.length, 0);
  if (result.status === 'observed') {
    assert.equal(result.observation.provenance.method, 'session-http');
    assert.equal(
      result.observation.provenance.sourceReference,
      'powerschool-bell-schedule',
    );
    assert.equal(result.observation.periods.length, 1);
    assert.equal('html' in result.observation, false);
    assert.equal('cookies' in result.observation, false);
    assert.equal('profile' in result.observation, false);
  }
});

test('uses browser fallback only after explicit dynamic classification', async () => {
  const http = new FakeReadTransport([{ status: 'browser-required' }]);
  const browser = new FakeReadTransport([bellCapture()]);
  const result = await adapter(http, browser).adapter.readSchedule({
    date: '2035-04-13',
    roomId,
  });
  assert.equal(result.status, 'observed');
  assert.equal(browser.calls.length, 1);
  if (result.status === 'observed') {
    assert.equal(result.observation.provenance.method, 'browser-read');
  }
});

test('maps authentication blockers without invoking repair or browser fallback', async () => {
  const http = new FakeReadTransport([
    { status: 'repair-required', code: 'sso-required' },
  ]);
  const browser = new FakeReadTransport([]);
  const result = await adapter(http, browser).adapter.readSchedule({
    date: '2035-04-13',
    roomId,
  });
  assert.equal(result.status, 'repair-required');
  assert.equal(browser.calls.length, 0);
  if (result.status === 'repair-required') {
    assert.equal(result.error.code, 'powerschool-sso-approval-required');
    assert.deepEqual(Object.keys(result.error).sort(), [
      'category',
      'code',
      'diagnostics',
      'message',
      'retryable',
    ]);
  }
});

test('maps timeouts and malformed captures to stable redacted failures', async () => {
  const timeout = await adapter(
    new FakeReadTransport([
      { status: 'failed', code: 'raw-secret-timeout', retryable: true },
    ]),
    new FakeReadTransport([]),
  ).adapter.readSchedule({ date: '2035-04-13', roomId });
  assert.equal(timeout.status, 'failed');
  if (timeout.status === 'failed') {
    assert.equal(timeout.error.category, 'timeout');
    assert.equal(JSON.stringify(timeout).includes('raw-secret'), false);
  }

  const malformed = await adapter(
    new FakeReadTransport([
      {
        status: 'captured',
        capture: { title: 'Empty', html: '<main />', text: '', path: '/bell' },
      },
    ]),
    new FakeReadTransport([]),
  ).adapter.readSchedule({ date: '2035-04-13', roomId });
  assert.equal(malformed.status, 'not-found');
});

test('invalid dates fail before either passive transport is invoked', async () => {
  const http = new FakeReadTransport([]);
  const browser = new FakeReadTransport([]);
  const result = await adapter(http, browser).adapter.readSchedule({
    date: '2035-02-30',
    roomId,
  });
  assert.equal(result.status, 'failed');
  assert.equal(http.calls.length, 0);
  assert.equal(browser.calls.length, 0);
});

test('redacts unexpected passive transport exceptions', async () => {
  const throwing: PassiveReadTransport = {
    read: async () => {
      throw new Error('sensitive session detail');
    },
  };
  const result = await adapter(
    throwing,
    new FakeReadTransport([]),
  ).adapter.readSchedule({ date: '2035-04-13', roomId });
  assert.equal(result.status, 'failed');
  assert.equal(JSON.stringify(result).includes('sensitive'), false);
});
