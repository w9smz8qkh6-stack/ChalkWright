import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  loadPowerSchoolRepairReferences,
  powerSchoolRepairReferenceEnvironmentName,
} from '../../src/config/powerschool-repair.js';

test('loads only an exact owner-only external repair-reference payload', () => {
  const directory = mkdtempSync(join(tmpdir(), 'powerschool-repair-config-'));
  const path = join(directory, 'references.json');
  chmodSync(directory, 0o700);
  writeFileSync(
    path,
    JSON.stringify({
      version: 1,
      usernameReference: 'op://Synthetic/Google/username',
      passwordReference: 'op://Synthetic/Google/password',
      totpReference: 'op://Synthetic/Google/one-time password?attribute=otp',
    }),
    { mode: 0o600 },
  );
  try {
    assert.deepEqual(
      loadPowerSchoolRepairReferences({
        [powerSchoolRepairReferenceEnvironmentName]: path,
      }),
      {
        version: 1,
        usernameReference: 'op://Synthetic/Google/username',
        passwordReference: 'op://Synthetic/Google/password',
        totpReference: 'op://Synthetic/Google/one-time password?attribute=otp',
      },
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('rejects an unprotected file, inline value, duplicate reference, or non-OTP query', () => {
  const directory = mkdtempSync(join(tmpdir(), 'powerschool-repair-invalid-'));
  chmodSync(directory, 0o700);
  const path = join(directory, 'references.json');
  const cases = [
    {
      version: 1,
      usernameReference: 'teacher@example.invalid',
      passwordReference: 'op://Synthetic/Google/password',
      totpReference: 'op://Synthetic/Google/one-time password?attribute=otp',
    },
    {
      version: 1,
      usernameReference: 'op://Synthetic/Google/username',
      passwordReference: 'op://Synthetic/Google/username',
      totpReference: 'op://Synthetic/Google/one-time password?attribute=otp',
    },
    {
      version: 1,
      usernameReference: 'op://Synthetic/Google/username',
      passwordReference: 'op://Synthetic/Google/password',
      totpReference: 'op://Synthetic/Google/one-time password',
    },
  ];
  try {
    for (const payload of cases) {
      writeFileSync(path, JSON.stringify(payload), { mode: 0o600 });
      assert.throws(
        () =>
          loadPowerSchoolRepairReferences({
            [powerSchoolRepairReferenceEnvironmentName]: path,
          }),
        /powerschool-repair-config-invalid/u,
      );
    }
    chmodSync(path, 0o644);
    assert.throws(
      () =>
        loadPowerSchoolRepairReferences({
          [powerSchoolRepairReferenceEnvironmentName]: path,
        }),
      /powerschool-repair-config-invalid/u,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
