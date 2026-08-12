import assert from 'node:assert/strict';
import test from 'node:test';

import {
  alertDecisionKinds,
  alertDeliveryModes,
  alertDeliveryStates,
  type AlertCheckpoint,
  type OperationsRunLedgerQuery,
  type OperationsStateReader,
  type OperationsStateWriter,
} from '../../src/ports/operations.js';

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <
    Value,
  >() => Value extends Right ? 1 : 2
    ? true
    : false;

const readerIsDatabaseNeutral: Equal<
  keyof OperationsStateReader,
  'listJobRuns' | 'loadAlertCheckpoint'
> = true;
const writerIsDatabaseNeutral: Equal<
  keyof OperationsStateWriter,
  'storeAlertCheckpoint' | 'storeJobRun'
> = true;
const queryIsBoundedAndTyped: Equal<
  keyof OperationsRunLedgerQuery,
  'jobName' | 'limit' | 'startedAtOrAfter'
> = true;
const checkpointHasNoDeliveryAddress: Equal<
  Extract<
    keyof AlertCheckpoint,
    'recipient' | 'recipients' | 'url' | 'endpoint' | 'credential'
  >,
  never
> = true;

test('exposes finite transport-neutral operations persistence ports', () => {
  assert.deepEqual(alertDecisionKinds, [
    'new',
    'unchanged',
    'repeat',
    'recovery',
    'mixed',
    'no-send',
  ]);
  assert.deepEqual(alertDeliveryModes, ['report-only', 'fake']);
  assert.deepEqual(alertDeliveryStates, [
    'not-attempted',
    'delivered',
    'failed',
  ]);
  assert.equal(readerIsDatabaseNeutral, true);
  assert.equal(writerIsDatabaseNeutral, true);
  assert.equal(queryIsBoundedAndTyped, true);
  assert.equal(checkpointHasNoDeliveryAddress, true);
});
