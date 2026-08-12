import assert from 'node:assert/strict';
import test from 'node:test';

import {
  powerSchoolCharacterizationProfileEnvironmentKey,
  powerSchoolCharacterizationSupervisorCapability,
  runPowerSchoolCharacterizationChild,
  type ManagedCharacterizationLaneFactory,
} from '../../src/entrypoints/powerschool-characterization-child.js';
import type {
  PassiveReadResult,
  PassiveReadTransport,
} from '../../src/infrastructure/powerschool/contracts.js';

class QueueTransport implements PassiveReadTransport {
  constructor(private readonly queue: PassiveReadResult[]) {}
  async read(): Promise<PassiveReadResult> {
    const result = this.queue.shift();
    if (result === undefined) throw new Error('unexpected-read');
    return result;
  }
}

test('fixed supervisor lane emits exactly one sanitized record and always closes', async () => {
  const bellHtml =
    '<table><tr><th dayindex="2">Monday<br>08/10/2026<br>MSHS Bell Schedule Normal (A)</th></tr></table>' +
    '<div class="aet_day" dayindex="2"><div class="aet_period"><b>Synthetic Design (100.1)</b><br>B407<br>08:00 AM - 08:45 AM</div></div>';
  let closeCount = 0;
  let createOptions: unknown;
  const factory: ManagedCharacterizationLaneFactory = {
    async create(options) {
      createOptions = options;
      return {
        http: new QueueTransport([
          {
            status: 'captured',
            capture: {
              title: 'Home',
              html: '<main>ok</main>',
              text: 'ok',
              path: '/teachers/home.html',
            },
          },
          {
            status: 'captured',
            capture: {
              title: 'Bell',
              html: bellHtml,
              text: bellHtml,
              path: '/teachers/aet_schedulebell.html',
            },
          },
        ]),
        browser: new QueueTransport([]),
        close: async () => {
          closeCount += 1;
        },
      };
    },
  };
  const writes: string[] = [];
  let tick = 0;
  const result = await runPowerSchoolCharacterizationChild({
    supervisorCapability: powerSchoolCharacterizationSupervisorCapability,
    environment: {
      [powerSchoolCharacterizationProfileEnvironmentKey]:
        '/tmp/synthetic-profile',
      ALTERNATE_PROFILE_PATH: '/must/not/be/read',
    },
    clock: { now: () => '2026-08-09T04:30:00.000Z' },
    monotonicNow: () => tick++,
    laneFactory: factory,
    writeEvidence: (line) => writes.push(line),
  });
  assert.equal(result.status, 'changed', JSON.stringify(result));
  assert.equal(writes.length, 1);
  assert.equal(closeCount, 1);
  assert.equal(
    (createOptions as { profileMode: string }).profileMode,
    'managed-powerschool',
  );
  const retained = JSON.parse(writes[0] ?? '{}') as Record<string, unknown>;
  assert.equal(retained.outcome, 'changed');
  assert.equal(writes[0]?.includes('/tmp/synthetic-profile'), false);
  assert.equal(writes[0]?.includes(bellHtml), false);
  assert.equal(writes[0]?.includes('cookie'), false);
});

test('outside-window execution makes no lane and emits one failure evidence record', async () => {
  let creates = 0;
  const writes: string[] = [];
  const result = await runPowerSchoolCharacterizationChild({
    supervisorCapability: powerSchoolCharacterizationSupervisorCapability,
    environment: {
      [powerSchoolCharacterizationProfileEnvironmentKey]: '/tmp/not-opened',
    },
    clock: { now: () => '2026-08-09T05:24:00.000Z' },
    monotonicNow: () => 0,
    laneFactory: {
      create: async () => {
        creates += 1;
        throw new Error('must-not-run');
      },
    },
    writeEvidence: (line) => writes.push(line),
  });
  assert.equal(result.evidence.failureCode, 'outside-window');
  assert.equal(creates, 0);
  assert.equal(writes.length, 1);
});

test('cannot be reached without the fixed supervisor capability', async () => {
  await assert.rejects(
    runPowerSchoolCharacterizationChild({
      supervisorCapability:
        'wrong' as typeof powerSchoolCharacterizationSupervisorCapability,
      environment: {},
      clock: { now: () => '2026-08-09T04:30:00.000Z' },
      monotonicNow: () => 0,
      writeEvidence: () => assert.fail('must not emit'),
    }),
    /supervisor-required/,
  );
});
