import assert from 'node:assert/strict';
import test from 'node:test';

import { displayStates } from '../../../src/contracts/v1/display.js';
import {
  b407FixtureData,
  b407Plan,
  b407SecondaryPlan,
  b407StateInstants,
  MemoryFixtureOverrideStore,
  MutableFixturePlanSource,
} from '../../../src/infrastructure/fixture/b407.js';

test('B407 fixture is deterministic, complete, and wholly synthetic', async () => {
  assert.deepEqual(
    Object.keys(b407StateInstants).sort(),
    [...displayStates].sort(),
  );
  assert.equal(b407FixtureData.displays.length, 2);
  assert.equal(b407Plan.roomId, b407SecondaryPlan.roomId);
  assert.notEqual(b407Plan.screenId, b407SecondaryPlan.screenId);
  assert.equal(
    JSON.stringify(b407FixtureData).includes('fixture.example.invalid'),
    true,
  );

  const source = new MutableFixturePlanSource([b407Plan]);
  assert.deepEqual(
    await source.read(b407Plan.screenId, b407Plan.date),
    b407Plan,
  );
  source.setAvailable(false);
  await assert.rejects(
    () => source.read(b407Plan.screenId, b407Plan.date),
    /synthetic-fixture-unavailable/u,
  );
});

test('fixture override storage clones values and isolates display/date keys', async () => {
  const store = new MemoryFixtureOverrideStore();
  const value = {
    screenId: b407Plan.screenId,
    date: b407Plan.date,
    announcement: 'Synthetic notice',
  } as const;
  await store.write(value);
  const first = await store.read(value.screenId, value.date);
  assert.deepEqual(first, value);
  if (first !== undefined)
    (first as { announcement?: string }).announcement = 'Changed clone';
  assert.deepEqual(await store.read(value.screenId, value.date), value);
  assert.equal(
    await store.read(b407SecondaryPlan.screenId, value.date),
    undefined,
  );
});
