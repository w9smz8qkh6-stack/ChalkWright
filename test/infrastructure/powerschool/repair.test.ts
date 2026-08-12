import assert from 'node:assert/strict';
import test from 'node:test';

import type { Clock } from '../../../src/domain/determinism.js';
import { PowerSchoolAuthentication } from '../../../src/infrastructure/powerschool/auth.js';
import type {
  InteractiveAuthenticationRepair,
  InteractiveAuthenticationRepairResult,
} from '../../../src/infrastructure/powerschool/contracts.js';
import { PowerSchoolAuthenticationRepair } from '../../../src/infrastructure/powerschool/repair.js';

const clock: Clock = { now: () => '2035-04-13T07:00:00.000Z' };

class FakeRepair implements InteractiveAuthenticationRepair {
  calls = 0;
  constructor(private readonly result: InteractiveAuthenticationRepairResult) {}
  async repair(): Promise<InteractiveAuthenticationRepairResult> {
    this.calls += 1;
    return this.result;
  }
}

function auth() {
  return new PowerSchoolAuthentication(
    clock,
    { probe: async () => ({ state: 'failed', reason: 'unavailable' }) },
    { failureThreshold: 3, cooloffMs: 1_000, liveProbeTimeoutMs: 100 },
  );
}

test('repair requires explicit consent before invoking an interactive capability', async () => {
  const transport = new FakeRepair({ state: 'authenticated' });
  const repair = new PowerSchoolAuthenticationRepair(transport, auth());
  const result = await repair.repair({ consent: false, timeoutMs: 1_000 });
  assert.equal(result.status, 'rejected');
  assert.equal(transport.calls, 0);
});

test('repair reports sanitized manual blockers and successful repair separately', async () => {
  const blockedTransport = new FakeRepair({
    state: 'blocked',
    blocker: 'sso-approval-required',
  });
  const blocked = await new PowerSchoolAuthenticationRepair(
    blockedTransport,
    auth(),
  ).repair({ consent: true, timeoutMs: 1_000 });
  assert.equal(blocked.status, 'blocked');
  if (blocked.status === 'blocked') {
    assert.equal(blocked.blocker, 'sso-approval-required');
    assert.equal(JSON.stringify(blocked).includes('cookie'), false);
  }

  const repaired = await new PowerSchoolAuthenticationRepair(
    new FakeRepair({ state: 'authenticated' }),
    auth(),
  ).repair({ consent: true, timeoutMs: 1_000 });
  assert.equal(repaired.status, 'repaired');
  if (repaired.status === 'repaired') {
    assert.equal(repaired.authentication.state, 'authenticated');
  }
});

test('repair timeout is redacted and bounded before transport invocation', async () => {
  const timedOut = new FakeRepair({ state: 'failed', reason: 'timeout' });
  const repair = new PowerSchoolAuthenticationRepair(timedOut, auth());
  assert.equal(
    (await repair.repair({ consent: true, timeoutMs: 301_000 })).status,
    'rejected',
  );
  assert.equal(timedOut.calls, 0);
  const result = await repair.repair({ consent: true, timeoutMs: 1_000 });
  assert.equal(result.status, 'failed');
  if (result.status === 'failed') {
    assert.equal(result.code, 'authentication-repair-timeout');
  }
});

test('redacts unexpected repair transport exceptions', async () => {
  const repair = new PowerSchoolAuthenticationRepair(
    {
      repair: async () => {
        throw new Error('sensitive browser detail');
      },
    },
    auth(),
  );
  const result = await repair.repair({ consent: true, timeoutMs: 1_000 });
  assert.equal(result.status, 'failed');
  assert.equal(JSON.stringify(result).includes('sensitive'), false);
});

test('bounds interactive repair when its transport never settles', async () => {
  const repair = new PowerSchoolAuthenticationRepair(
    { repair: () => new Promise(() => undefined) },
    auth(),
  );
  const started = Date.now();
  const result = await repair.repair({ consent: true, timeoutMs: 20 });
  assert.ok(Date.now() - started < 500);
  assert.equal(result.status, 'failed');
  if (result.status === 'failed') {
    assert.equal(result.code, 'authentication-repair-timeout');
  }
});
