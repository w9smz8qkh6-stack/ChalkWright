import assert from 'node:assert/strict';
import {
  chmodSync,
  linkSync,
  lstatSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  readProtectedJson,
  readProtectedText,
  writeNewProtectedJson,
} from '../../../src/infrastructure/filesystem/protected-json.js';

const valid = (value: unknown): value is { readonly ok: true } =>
  typeof value === 'object' &&
  value !== null &&
  (value as { ok?: unknown }).ok === true;

test('atomically creates and reads one owner-only exact protected payload', () => {
  const root = mkdtempSync(join(tmpdir(), 'protected-json-'));
  const path = join(root, 'state.json');
  try {
    chmodSync(root, 0o700);
    writeNewProtectedJson(path, { ok: true });
    assert.deepEqual(readProtectedJson(path, valid), { ok: true });
    assert.equal(lstatSync(path).mode & 0o077, 0);
    assert.throws(
      () => writeNewProtectedJson(path, { ok: true }),
      /protected-json-unsafe/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('reads only a bounded owner-only single-line protected value', () => {
  const root = mkdtempSync(join(tmpdir(), 'protected-text-'));
  const path = join(root, 'operator-token');
  try {
    chmodSync(root, 0o700);
    writeFileSync(path, 'synthetic-local-authority\n', { mode: 0o600 });
    assert.equal(
      readProtectedText(path, { minimumBytes: 16, maximumBytes: 64 }),
      'synthetic-local-authority',
    );
    writeFileSync(path, 'unsafe\nsecond-line\n', { mode: 0o600 });
    assert.throws(
      () => readProtectedText(path, { minimumBytes: 1, maximumBytes: 64 }),
      /protected-json-unsafe/u,
    );
    chmodSync(path, 0o644);
    assert.throws(
      () => readProtectedText(path, { minimumBytes: 1, maximumBytes: 64 }),
      /protected-json-unsafe/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects symlinks, hard links, permissive directories, and invalid shape', () => {
  const root = mkdtempSync(join(tmpdir(), 'protected-json-'));
  try {
    chmodSync(root, 0o700);
    const path = join(root, 'state.json');
    writeNewProtectedJson(path, { ok: false });
    assert.throws(
      () => readProtectedJson(path, valid),
      /protected-json-invalid/u,
    );
    const linked = join(root, 'linked.json');
    linkSync(path, linked);
    assert.throws(
      () => readProtectedJson(path, valid),
      /protected-json-unsafe/u,
    );
    rmSync(linked);
    const symbolic = join(root, 'symbolic.json');
    symlinkSync(path, symbolic);
    assert.throws(
      () => readProtectedJson(symbolic, valid),
      /protected-json-unsafe/u,
    );
    chmodSync(root, 0o755);
    assert.throws(
      () => readProtectedJson(path, valid),
      /protected-json-unsafe/u,
    );
  } finally {
    chmodSync(root, 0o700);
    rmSync(root, { recursive: true, force: true });
  }
});
