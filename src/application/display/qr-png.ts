import { deflateSync } from 'node:zlib';

const version = 4;
const size = 17 + 4 * version;
const dataCodewords = 80;
const errorCodewords = 20;

function appendBits(bits: number[], value: number, length: number): void {
  for (let shift = length - 1; shift >= 0; shift -= 1)
    bits.push((value >>> shift) & 1);
}

function multiply(left: number, right: number): number {
  let result = 0;
  for (let index = 0; index < 8; index += 1) {
    if ((right & 1) !== 0) result ^= left;
    const carry = (left & 0x80) !== 0;
    left = (left << 1) & 0xff;
    if (carry) left ^= 0x1d;
    right >>>= 1;
  }
  return result;
}

function reedSolomonGenerator(degree: number): Uint8Array {
  const result = new Uint8Array(degree);
  result[degree - 1] = 1;
  let root = 1;
  for (let index = 0; index < degree; index += 1) {
    for (let position = 0; position < degree; position += 1) {
      result[position] = multiply(result[position] ?? 0, root);
      if (position + 1 < degree)
        result[position] =
          (result[position] ?? 0) ^ (result[position + 1] ?? 0);
    }
    root = multiply(root, 2);
  }
  return result;
}

function errorCorrection(data: Uint8Array, degree: number): Uint8Array {
  const divisor = reedSolomonGenerator(degree);
  const remainder = new Uint8Array(degree);
  for (const value of data) {
    const factor = value ^ (remainder[0] ?? 0);
    remainder.copyWithin(0, 1);
    remainder[degree - 1] = 0;
    for (let index = 0; index < degree; index += 1)
      remainder[index] =
        (remainder[index] ?? 0) ^ multiply(divisor[index] ?? 0, factor);
  }
  return remainder;
}

/** Encode the fixed Version 4-L data codewords; exported for conformance tests. */
export function encodeQrDataCodewords(value: string): Uint8Array {
  const payload = new TextEncoder().encode(value);
  if (payload.length > 78) throw new RangeError('qr-payload-too-large');
  const bits: number[] = [];
  appendBits(bits, 0b0100, 4);
  appendBits(bits, payload.length, 8);
  for (const byte of payload) appendBits(bits, byte, 8);
  appendBits(bits, 0, Math.min(4, dataCodewords * 8 - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);
  const data = new Uint8Array(dataCodewords);
  for (let index = 0; index < bits.length; index += 1) {
    const byteIndex = Math.floor(index / 8);
    data[byteIndex] =
      (data[byteIndex] ?? 0) | ((bits[index] ?? 0) << (7 - (index % 8)));
  }
  let padIndex = 0;
  for (let index = bits.length / 8; index < data.length; index += 1) {
    data[index] = padIndex % 2 === 0 ? 0xec : 0x11;
    padIndex += 1;
  }
  const correction = errorCorrection(data, errorCodewords);
  return Uint8Array.from([...data, ...correction]);
}

function drawQr(value: string): readonly (readonly boolean[])[] {
  const modules = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => false),
  );
  const functions = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => false),
  );
  const setFunction = (x: number, y: number, dark: boolean): void => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    modules[y]![x] = dark;
    functions[y]![x] = true;
  };
  const finder = (centerX: number, centerY: number): void => {
    for (let y = -4; y <= 4; y += 1)
      for (let x = -4; x <= 4; x += 1) {
        const distance = Math.max(Math.abs(x), Math.abs(y));
        setFunction(centerX + x, centerY + y, distance !== 2 && distance !== 4);
      }
  };
  finder(3, 3);
  finder(size - 4, 3);
  finder(3, size - 4);
  // Timing modules occupy only the gap between finder separators. Rewriting
  // the whole row/column would corrupt the three finder patterns.
  for (let index = 8; index < size - 8; index += 1) {
    setFunction(6, index, index % 2 === 0);
    setFunction(index, 6, index % 2 === 0);
  }
  for (let y = -2; y <= 2; y += 1)
    for (let x = -2; x <= 2; x += 1)
      setFunction(26 + x, 26 + y, Math.max(Math.abs(x), Math.abs(y)) !== 1);

  const mask = 0;
  const formatData = (1 << 3) | mask;
  let remainder = formatData;
  for (let index = 0; index < 10; index += 1)
    remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
  const formatBits = ((formatData << 10) | remainder) ^ 0x5412;
  const formatBit = (index: number): boolean =>
    ((formatBits >>> index) & 1) !== 0;
  for (let index = 0; index <= 5; index += 1)
    setFunction(8, index, formatBit(index));
  setFunction(8, 7, formatBit(6));
  setFunction(8, 8, formatBit(7));
  setFunction(7, 8, formatBit(8));
  for (let index = 9; index < 15; index += 1)
    setFunction(14 - index, 8, formatBit(index));
  for (let index = 0; index < 8; index += 1)
    setFunction(size - 1 - index, 8, formatBit(index));
  for (let index = 8; index < 15; index += 1)
    setFunction(8, size - 15 + index, formatBit(index));
  setFunction(8, size - 8, true);

  const codewords = encodeQrDataCodewords(value);
  let bitIndex = 0;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vertical = 0; vertical < size; vertical += 1) {
      const y = upward ? size - 1 - vertical : vertical;
      for (let offset = 0; offset < 2; offset += 1) {
        const x = right - offset;
        if (functions[y]![x]) continue;
        const byte = codewords[Math.floor(bitIndex / 8)] ?? 0;
        const bit = ((byte >>> (7 - (bitIndex % 8))) & 1) !== 0;
        modules[y]![x] = bit !== ((x + y) % 2 === 0);
        bitIndex += 1;
      }
    }
    upward = !upward;
  }
  return modules;
}

function crc32(value: Uint8Array): number {
  let result = 0xffffffff;
  for (const byte of value) {
    result ^= byte;
    for (let bit = 0; bit < 8; bit += 1)
      result = (result >>> 1) ^ (0xedb88320 & -(result & 1));
  }
  return (result ^ 0xffffffff) >>> 0;
}

function pngChunk(name: string, data: Uint8Array): Buffer {
  const type = Buffer.from(name, 'ascii');
  const body = Buffer.from(data);
  const result = Buffer.alloc(12 + body.length);
  result.writeUInt32BE(body.length, 0);
  type.copy(result, 4);
  body.copy(result, 8);
  result.writeUInt32BE(
    crc32(result.subarray(4, 8 + body.length)),
    8 + body.length,
  );
  return result;
}

/** Generate a deterministic, dependency-free Version 4-L QR PNG for bounded fixture URLs. */
export function qrPng(value: string, scale = 8): Uint8Array {
  if (!Number.isInteger(scale) || scale < 4 || scale > 16)
    throw new RangeError('qr-scale-invalid');
  const modules = drawQr(value);
  const quiet = 4;
  const width = (size + quiet * 2) * scale;
  const raw = Buffer.alloc((width + 1) * width, 0xff);
  for (let y = 0; y < width; y += 1) {
    const row = y * (width + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const moduleX = Math.floor(x / scale) - quiet;
      const moduleY = Math.floor(y / scale) - quiet;
      if (
        moduleX >= 0 &&
        moduleY >= 0 &&
        moduleX < size &&
        moduleY < size &&
        modules[moduleY]![moduleX]
      )
        raw[row + 1 + x] = 0;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(width, 4);
  header[8] = 8;
  header[9] = 0;
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Uint8Array.from(
    Buffer.concat([
      signature,
      pngChunk('IHDR', header),
      pngChunk('IDAT', deflateSync(raw, { level: 9 })),
      pngChunk('IEND', new Uint8Array()),
    ]),
  );
}
