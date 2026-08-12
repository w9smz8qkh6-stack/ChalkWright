import assert from 'node:assert/strict';
import test from 'node:test';
import { inflateSync } from 'node:zlib';

import {
  encodeQrDataCodewords,
  qrPng,
} from '../../../src/application/display/qr-png.js';

function pngModules(
  png: Uint8Array,
  scale = 8,
): (x: number, y: number) => boolean {
  const buffer = Buffer.from(png);
  const chunks: Buffer[] = [];
  let offset = 8;
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    if (type === 'IDAT')
      chunks.push(buffer.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }
  const width = buffer.readUInt32BE(16);
  const pixels = inflateSync(Buffer.concat(chunks));
  const quietZone = 4;
  return (x, y) => {
    const pixelX = (quietZone + x) * scale + Math.floor(scale / 2);
    const pixelY = (quietZone + y) * scale + Math.floor(scale / 2);
    return pixels[pixelY * (width + 1) + 1 + pixelX] === 0;
  };
}

test('generates deterministic bounded grayscale QR PNG bytes', () => {
  const target = 'https://fixture.example.invalid/attendance/b407-a';
  const first = qrPng(target);
  assert.deepEqual(first, qrPng(target));
  assert.deepEqual([...first.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const view = Buffer.from(first);
  assert.equal(view.readUInt32BE(16), 328);
  assert.equal(view.readUInt32BE(20), 328);
  assert.ok(first.byteLength < 16_000);
  assert.throws(() => qrPng('x'.repeat(79)), /qr-payload-too-large/u);
  assert.throws(() => qrPng(target, 2), /qr-scale-invalid/u);
});

test('preserves finder patterns and limits timing modules to their reserved gap', () => {
  const dark = pngModules(
    qrPng('https://fixture.example.invalid/attendance/b407-a'),
  );
  const expectedFinder = [
    '#######',
    '#.....#',
    '#.###.#',
    '#.###.#',
    '#.###.#',
    '#.....#',
    '#######',
  ];
  for (const [originX, originY] of [
    [0, 0],
    [26, 0],
    [0, 26],
  ] as const) {
    for (let y = 0; y < 7; y += 1)
      for (let x = 0; x < 7; x += 1)
        assert.equal(
          dark(originX + x, originY + y),
          expectedFinder[y]![x] === '#',
        );
  }
  for (let index = 8; index <= 24; index += 1) {
    assert.equal(dark(6, index), index % 2 === 0);
    assert.equal(dark(index, 6), index % 2 === 0);
  }
});

test('starts QR padding with the mandated EC 11 sequence regardless of payload parity', () => {
  const codewords = encodeQrDataCodewords(
    'https://fixture.example.invalid/attendance/b407-a',
  );
  assert.deepEqual(
    [...codewords.slice(51, 57)],
    [0xec, 0x11, 0xec, 0x11, 0xec, 0x11],
  );
});
