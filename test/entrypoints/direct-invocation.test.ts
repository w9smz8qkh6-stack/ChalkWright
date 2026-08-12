import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

import { isDirectEntrypoint } from '../../src/entrypoints/direct-invocation.js';

test('direct entrypoint detection accepts an invocation through a release symlink', () => {
  const root = mkdtempSync(join(tmpdir(), 'classroom-hub-entrypoint-'));
  const target = join(root, 'release-entrypoint.js');
  const link = join(root, 'current-entrypoint.js');
  writeFileSync(target, 'export {};\n', { mode: 0o600 });
  symlinkSync(target, link);
  try {
    assert.equal(isDirectEntrypoint(pathToFileURL(target).href, link), true);
    assert.equal(isDirectEntrypoint(pathToFileURL(target).href, target), true);
    assert.equal(
      isDirectEntrypoint(pathToFileURL(target).href, undefined),
      false,
    );
    assert.equal(
      isDirectEntrypoint(pathToFileURL(target).href, join(root, 'missing')),
      false,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
