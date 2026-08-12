import assert from 'node:assert/strict';
import test from 'node:test';

import type { IsoInstant } from '../../../src/contracts/v1/common.js';
import type { Clock } from '../../../src/domain/determinism.js';
import { PowerSchoolAuthentication } from '../../../src/infrastructure/powerschool/auth.js';
import type {
  LiveAuthenticationProbe,
  LiveAuthenticationProbeResult,
} from '../../../src/infrastructure/powerschool/contracts.js';

class MutableClock implements Clock {
  constructor(public value: IsoInstant) {}
  now(): IsoInstant {
    return this.value;
  }
}

class FakeProbe implements LiveAuthenticationProbe {
  calls = 0;
  readonly timeouts: number[] = [];
  constructor(private readonly results: LiveAuthenticationProbeResult[]) {}
  async probe(timeoutMs: number): Promise<LiveAuthenticationProbeResult> {
    this.calls += 1;
    this.timeouts.push(timeoutMs);
    return this.results.shift() ?? { state: 'failed', reason: 'unavailable' };
  }
}

function authentication(clock: MutableClock, probe: FakeProbe) {
  return new PowerSchoolAuthentication(clock, probe, {
    failureThreshold: 2,
    cooloffMs: 1_000,
    liveProbeTimeoutMs: 250,
  });
}

test('cached authentication status is the network-free default and live probing is explicit', async () => {
  const clock = new MutableClock('2035-04-13T07:00:00.000Z');
  const probe = new FakeProbe([{ state: 'authenticated' }]);
  const auth = authentication(clock, probe);

  assert.equal((await auth.getStatus()).state, 'unavailable');
  assert.equal(probe.calls, 0);
  const live = await auth.getStatus({ probe: true });
  assert.equal(live.state, 'authenticated');
  assert.equal(live.provenance, 'live-probe');
  assert.equal(live.lastSuccessfulAt, clock.value);
  assert.deepEqual(probe.timeouts, [250]);
});

test('auth failures enter cooloff at the exact threshold and expire at the exact boundary', async () => {
  const clock = new MutableClock('2035-04-13T07:00:00.000Z');
  const probe = new FakeProbe([
    { state: 'authentication-required', blocker: 'session-expired' },
    { state: 'authentication-required', blocker: 'session-expired' },
    { state: 'authenticated' },
  ]);
  const auth = authentication(clock, probe);

  assert.equal((await auth.getStatus({ probe: true })).state, 'expired');
  clock.value = '2035-04-13T07:00:00.100Z';
  const threshold = await auth.getStatus({ probe: true });
  assert.equal(threshold.state, 'cooloff');
  assert.equal(threshold.cooloffUntil, '2035-04-13T07:00:01.100Z');
  assert.equal(probe.calls, 2);

  clock.value = '2035-04-13T07:00:01.099Z';
  assert.equal((await auth.getStatus({ probe: true })).state, 'cooloff');
  assert.equal(probe.calls, 2);

  clock.value = '2035-04-13T07:00:01.100Z';
  assert.equal((await auth.getStatus({ probe: true })).state, 'authenticated');
  assert.equal(probe.calls, 3);
});

test('last success survives probe outages and success resets auth failure accounting', async () => {
  const clock = new MutableClock('2035-04-13T07:00:00.000Z');
  const probe = new FakeProbe([
    { state: 'authenticated' },
    { state: 'failed', reason: 'timeout' },
    { state: 'authentication-required', blocker: 'session-expired' },
    { state: 'authenticated' },
    { state: 'authentication-required', blocker: 'session-expired' },
  ]);
  const auth = authentication(clock, probe);

  const success = await auth.getStatus({ probe: true });
  clock.value = '2035-04-13T07:00:01.000Z';
  const outage = await auth.getStatus({ probe: true });
  assert.equal(outage.state, 'unavailable');
  assert.equal(outage.lastSuccessfulAt, success.lastSuccessfulAt);
  assert.equal(outage.diagnostics[0]?.code, 'powerschool-auth-probe-timeout');

  clock.value = '2035-04-13T07:00:02.000Z';
  assert.equal((await auth.getStatus({ probe: true })).state, 'expired');
  clock.value = '2035-04-13T07:00:03.000Z';
  assert.equal((await auth.getStatus({ probe: true })).state, 'authenticated');
  clock.value = '2035-04-13T07:00:04.000Z';
  assert.equal((await auth.getStatus({ probe: true })).state, 'expired');
});

test('rejects unbounded cooloff and probe policies', () => {
  const clock = new MutableClock('2035-04-13T07:00:00.000Z');
  const probe = new FakeProbe([]);
  assert.throws(
    () =>
      new PowerSchoolAuthentication(clock, probe, {
        failureThreshold: 0,
        cooloffMs: 1_000,
        liveProbeTimeoutMs: 250,
      }),
    /Invalid failure threshold/,
  );
});

test('rejects non-normalized injected clock instants before exposing status', () => {
  assert.throws(
    () =>
      new PowerSchoolAuthentication(
        { now: () => '2035-04-13T07:00:00+00:00' },
        new FakeProbe([]),
        { failureThreshold: 2, cooloffMs: 1_000, liveProbeTimeoutMs: 250 },
      ),
    /injected clock is invalid/u,
  );
});

test('redacts unexpected live-probe exceptions', async () => {
  const clock = new MutableClock('2035-04-13T07:00:00.000Z');
  const auth = new PowerSchoolAuthentication(
    clock,
    {
      probe: async () => {
        throw new Error('sensitive transport detail');
      },
    },
    { failureThreshold: 2, cooloffMs: 1_000, liveProbeTimeoutMs: 250 },
  );
  const result = await auth.getStatus({ probe: true });
  assert.equal(result.state, 'unavailable');
  assert.equal(JSON.stringify(result).includes('sensitive'), false);
});

test('bounds a live probe that never settles', async () => {
  const clock = new MutableClock('2035-04-13T07:00:00.000Z');
  const auth = new PowerSchoolAuthentication(
    clock,
    { probe: () => new Promise(() => undefined) },
    { failureThreshold: 2, cooloffMs: 1_000, liveProbeTimeoutMs: 20 },
  );
  const started = Date.now();
  const result = await auth.getStatus({ probe: true });
  assert.ok(Date.now() - started < 500);
  assert.equal(result.state, 'unavailable');
  assert.equal(result.diagnostics[0]?.code, 'powerschool-auth-probe-timeout');
});

test('consumes a probe rejection that arrives after the timeout', async () => {
  let unhandled: unknown;
  const listener = (reason: unknown): void => {
    unhandled = reason;
  };
  process.on('unhandledRejection', listener);
  try {
    const clock = new MutableClock('2035-04-13T07:00:00.000Z');
    const auth = new PowerSchoolAuthentication(
      clock,
      {
        probe: () =>
          new Promise((_, reject) => {
            setTimeout(() => reject(new Error('late sensitive failure')), 30);
          }),
      },
      { failureThreshold: 2, cooloffMs: 1_000, liveProbeTimeoutMs: 10 },
    );
    const result = await auth.getStatus({ probe: true });
    assert.equal(result.diagnostics[0]?.code, 'powerschool-auth-probe-timeout');
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(unhandled, undefined);
  } finally {
    process.removeListener('unhandledRejection', listener);
  }
});
