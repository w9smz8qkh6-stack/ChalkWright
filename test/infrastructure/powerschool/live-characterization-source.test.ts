import assert from 'node:assert/strict';
import test from 'node:test';

import type { RoomId } from '../../../src/domain/identities.js';
import { powerSchoolM07bCharacterizationPolicy as policy } from '../../../src/infrastructure/powerschool/characterization-policy.js';
import type {
  PassiveReadResult,
  PassiveReadTransport,
} from '../../../src/infrastructure/powerschool/contracts.js';
import { LivePowerSchoolCharacterizationSource } from '../../../src/infrastructure/powerschool/live-characterization-source.js';

class FakeTransport implements PassiveReadTransport {
  readonly calls: string[] = [];
  constructor(private readonly results: PassiveReadResult[]) {}
  async read(path: string): Promise<PassiveReadResult> {
    this.calls.push(path);
    const result = this.results.shift();
    if (result === undefined) throw new Error('unexpected-read');
    return result;
  }
}

const capture = (html: string): PassiveReadResult => ({
  status: 'captured',
  capture: { title: 'Synthetic', html, text: html, path: '/synthetic' },
});

function source(http: FakeTransport, browser = new FakeTransport([])) {
  let tick = 0;
  return new LivePowerSchoolCharacterizationSource({
    policy,
    clock: { now: () => '2026-08-09T04:20:00.000Z' },
    monotonicNow: () => tick++,
    http,
    browser,
    roomId: 'room-b407' as RoomId,
    utcOffset: '+07:00',
  });
}

test('uses only the exact status and bell surfaces and projects a minimal observation', async () => {
  const html =
    '<table><tr><th dayindex="2">Monday<br>08/10/2026<br>MSHS Bell Schedule Normal (A)</th></tr></table>' +
    '<div class="aet_day" dayindex="2"><div class="aet_period"><b>Synthetic Design (100.1)</b><br>B407<br>08:00 AM - 08:45 AM</div></div>';
  const http = new FakeTransport([capture('<main>home</main>'), capture(html)]);
  const subject = source(http);
  const signal = new AbortController().signal;
  const status = await subject.readStatus(
    {
      origin: policy.origin,
      path: policy.statusPath,
      method: 'GET',
      timeoutMs: policy.requestTimeoutMs,
      maximumTopLevelRequests: policy.maximumTopLevelRequests,
    },
    signal,
  );
  assert.equal(status.status, 'authenticated');

  const schedule = await subject.readBellSchedule(
    {
      origin: policy.origin,
      path: policy.bellPath,
      method: 'GET',
      timeoutMs: policy.requestTimeoutMs,
      maximumTopLevelRequests: policy.maximumTopLevelRequests,
    },
    signal,
  );
  assert.equal(schedule.status, 'observed', JSON.stringify(schedule));
  if (schedule.status !== 'observed') return;
  assert.deepEqual(http.calls, [policy.statusPath, policy.bellPath]);
  assert.equal(schedule.observation.requestedDate, policy.requestedDate);
  assert.equal(
    schedule.observation.provenance.sourceReference,
    'powerschool-bell-schedule',
  );
  assert.equal('diagnostics' in schedule.observation, false);
  assert.equal('observationId' in schedule.observation, false);
  assert.equal('contractVersion' in schedule.observation, false);
  assert.equal(JSON.stringify(schedule).includes(html), false);
});

test('uses browser only after an explicit dynamic classification and reports auth blockers', async () => {
  const http = new FakeTransport([{ status: 'browser-required' }]);
  const browser = new FakeTransport([
    { status: 'repair-required', code: 'session-expired' },
  ]);
  const result = await source(http, browser).readStatus(
    {
      origin: policy.origin,
      path: policy.statusPath,
      method: 'GET',
      timeoutMs: 1_000,
      maximumTopLevelRequests: policy.maximumTopLevelRequests,
    },
    new AbortController().signal,
  );
  assert.equal(result.status, 'authentication-required');
  assert.equal(result.topLevelRequests, 2);
  assert.equal(result.metadata.transport, 'browser-read');
  assert.deepEqual(result.metadata.diagnosticCodes, [
    'source-browser-fallback',
    'source-authentication-required',
  ]);
});

test('rejects any request outside the frozen policy before transport access', async () => {
  const http = new FakeTransport([]);
  const result = await source(http).readStatus(
    {
      origin: policy.origin,
      path: '/teachers/mutation-trap',
      method: 'GET',
      timeoutMs: 1_000,
      maximumTopLevelRequests: policy.maximumTopLevelRequests,
    },
    new AbortController().signal,
  );
  assert.equal(result.status, 'failed');
  assert.deepEqual(http.calls, []);

  const head = await source(http).readStatus(
    {
      origin: policy.origin,
      path: policy.statusPath,
      method: 'HEAD',
      timeoutMs: 1_000,
      maximumTopLevelRequests: policy.maximumTopLevelRequests,
    },
    new AbortController().signal,
  );
  assert.equal(head.status, 'failed');
  assert.deepEqual(http.calls, []);
});
