import type { PowerSchoolRepairSecretBuffers } from '../one-password/powerschool-repair-secrets.js';

const headerBytes = 12;
const maximumPacketBytes = 9 * 1024;

export interface PowerSchoolRepairCredentials {
  readonly username: string;
  readonly password: string;
  readonly totp: string;
}

export function encodePowerSchoolRepairSecretPacket(
  secrets: PowerSchoolRepairSecretBuffers,
): Buffer {
  const total =
    headerBytes +
    secrets.username.byteLength +
    secrets.password.byteLength +
    secrets.totp.byteLength;
  if (total > maximumPacketBytes) throw new Error('repair-packet-invalid');
  const packet = Buffer.alloc(total);
  packet.writeUInt32BE(secrets.username.byteLength, 0);
  packet.writeUInt32BE(secrets.password.byteLength, 4);
  packet.writeUInt32BE(secrets.totp.byteLength, 8);
  let offset = headerBytes;
  offset += secrets.username.copy(packet, offset);
  offset += secrets.password.copy(packet, offset);
  secrets.totp.copy(packet, offset);
  return packet;
}

export function decodePowerSchoolRepairSecretPacket(
  packet: Buffer,
): PowerSchoolRepairCredentials {
  try {
    if (
      packet.byteLength < headerBytes ||
      packet.byteLength > maximumPacketBytes
    )
      throw new Error('repair-packet-invalid');
    const lengths = [
      packet.readUInt32BE(0),
      packet.readUInt32BE(4),
      packet.readUInt32BE(8),
    ];
    if (lengths.some((length) => length < 1 || length > 4_096))
      throw new Error('repair-packet-invalid');
    if (
      headerBytes + lengths.reduce((sum, length) => sum + length, 0) !==
      packet.byteLength
    )
      throw new Error('repair-packet-invalid');
    const values: string[] = [];
    let offset = headerBytes;
    for (const length of lengths) {
      const next = offset + length;
      const value = packet.subarray(offset, next);
      if (value.some((byte) => byte < 0x20 || byte === 0x7f))
        throw new Error('repair-packet-invalid');
      values.push(new TextDecoder('utf-8', { fatal: true }).decode(value));
      offset = next;
    }
    if (
      !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,63}$/u.test(
        values[0]!,
      ) ||
      values[1]!.length < 1 ||
      !/^\d{6,8}$/u.test(values[2]!)
    )
      throw new Error('repair-packet-invalid');
    return {
      username: values[0]!,
      password: values[1]!,
      totp: values[2]!,
    };
  } catch {
    throw new Error('repair-packet-invalid');
  } finally {
    packet.fill(0);
  }
}
