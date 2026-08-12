import assert from 'node:assert/strict';
import test from 'node:test';

import {
  decodePowerSchoolRepairSecretPacket,
  encodePowerSchoolRepairSecretPacket,
} from '../../../src/infrastructure/powerschool-session/repair-secret-packet.js';

test('round trips the bounded secret packet and overwrites the encoded bytes', () => {
  const packet = encodePowerSchoolRepairSecretPacket({
    username: Buffer.from('teacher@example.invalid'),
    password: Buffer.from('synthetic-password'),
    totp: Buffer.from('123456'),
  });
  assert.deepEqual(decodePowerSchoolRepairSecretPacket(packet), {
    username: 'teacher@example.invalid',
    password: 'synthetic-password',
    totp: '123456',
  });
  assert.equal(
    packet.every((byte) => byte === 0),
    true,
  );
});

test('rejects and overwrites malformed packets', () => {
  const packet = Buffer.from('malformed');
  assert.throws(
    () => decodePowerSchoolRepairSecretPacket(packet),
    /repair-packet-invalid/u,
  );
  assert.equal(
    packet.every((byte) => byte === 0),
    true,
  );
});
