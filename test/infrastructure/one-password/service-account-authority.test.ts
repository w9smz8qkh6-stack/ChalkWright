import assert from 'node:assert/strict';
import {
  chmodSync,
  linkSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  loadPowerSchoolOnePasswordServiceAccountToken,
  powerSchoolOnePasswordServiceAccountEnvironmentName,
} from '../../../src/infrastructure/one-password/service-account-authority.js';

const token = `ops_${'Synthetic0123456789'.repeat(4)}`;

test('extracts only one protected service-account token without evaluating the file', () => {
  const root = mkdtempSync(join(tmpdir(), 'powerschool-service-account-'));
  chmodSync(root, 0o770);
  const path = join(root, 'legacy-op.env');
  writeFileSync(
    path,
    `# synthetic\nIGNORED_VALUE="not-forwarded"\nexport OP_SERVICE_ACCOUNT_TOKEN='${token}'\n`,
    { mode: 0o600 },
  );
  try {
    const value = loadPowerSchoolOnePasswordServiceAccountToken({
      [powerSchoolOnePasswordServiceAccountEnvironmentName]: path,
    });
    assert.ok(value);
    assert.equal(value.toString('ascii'), token);
    value.fill(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects unsafe paths, files, syntax, duplicates, and token shapes', () => {
  const root = mkdtempSync(join(tmpdir(), 'powerschool-service-account-'));
  chmodSync(root, 0o700);
  const path = join(root, 'legacy-op.env');
  const environment = {
    [powerSchoolOnePasswordServiceAccountEnvironmentName]: path,
  };
  try {
    for (const content of [
      'echo unsafe\n',
      'OP_SERVICE_ACCOUNT_TOKEN=not-a-service-account\n',
      `OP_SERVICE_ACCOUNT_TOKEN=${token}\nOP_SERVICE_ACCOUNT_TOKEN=${token}\n`,
    ]) {
      writeFileSync(path, content, { mode: 0o600 });
      assert.throws(
        () => loadPowerSchoolOnePasswordServiceAccountToken(environment),
        /powerschool-repair-service-account-unavailable/u,
      );
    }

    writeFileSync(path, `OP_SERVICE_ACCOUNT_TOKEN=${token}\n`);
    chmodSync(path, 0o644);
    assert.throws(
      () => loadPowerSchoolOnePasswordServiceAccountToken(environment),
      /powerschool-repair-service-account-unavailable/u,
    );
    chmodSync(path, 0o600);

    const hardLink = join(root, 'hard-link.env');
    linkSync(path, hardLink);
    assert.throws(
      () => loadPowerSchoolOnePasswordServiceAccountToken(environment),
      /powerschool-repair-service-account-unavailable/u,
    );
    rmSync(hardLink);

    const symbolic = join(root, 'symbolic.env');
    symlinkSync(path, symbolic);
    assert.throws(
      () =>
        loadPowerSchoolOnePasswordServiceAccountToken({
          [powerSchoolOnePasswordServiceAccountEnvironmentName]: symbolic,
        }),
      /powerschool-repair-service-account-unavailable/u,
    );

    assert.throws(
      () => loadPowerSchoolOnePasswordServiceAccountToken(environment, root),
      /powerschool-repair-service-account-unavailable/u,
    );

    chmodSync(root, 0o772);
    assert.throws(
      () => loadPowerSchoolOnePasswordServiceAccountToken(environment),
      /powerschool-repair-service-account-unavailable/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
