import assert from 'node:assert/strict';
import test from 'node:test';

import type { AuthenticationRepairPort } from '../../src/ports/authentication-repair.js';
import type { ScheduleObservationSource } from '../../src/ports/read-sources.js';
import type { SourceAuthenticationPort } from '../../src/ports/source-authentication.js';

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <
    Value,
  >() => Value extends Right ? 1 : 2
    ? true
    : false;

const authenticationIsStatusOnly: Equal<
  keyof SourceAuthenticationPort,
  'getStatus'
> = true;
const repairIsSeparate: Equal<keyof AuthenticationRepairPort, 'repair'> = true;
const passiveScheduleIsReadOnly: Equal<
  keyof ScheduleObservationSource,
  'readSchedule'
> = true;

test('keeps status, explicit repair, and passive source reads as separate capabilities', () => {
  assert.equal(authenticationIsStatusOnly, true);
  assert.equal(repairIsSeparate, true);
  assert.equal(passiveScheduleIsReadOnly, true);
});
