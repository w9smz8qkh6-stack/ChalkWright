import assert from 'node:assert/strict';
import {
  chmodSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  alertDeliveryReferenceEnvironmentName,
  loadTelegramAlertProtectedReferences,
} from '../../src/config/alert-delivery.js';

function protectedRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'alert-delivery-config-'));
  chmodSync(root, 0o700);
  return root;
}

test('loads only two distinct external protected-value paths', () => {
  const root = protectedRoot();
  try {
    const reference = join(root, 'references.json');
    const botTokenPath = join(root, 'bot-token');
    const destinationPath = join(root, 'destination');
    writeFileSync(
      reference,
      JSON.stringify({ version: 1, botTokenPath, destinationPath }),
      { mode: 0o600 },
    );
    assert.deepEqual(
      loadTelegramAlertProtectedReferences({
        [alertDeliveryReferenceEnvironmentName]: reference,
      }),
      { version: 1, botTokenPath, destinationPath },
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects repository, linked, permissive, augmented, and coupled references', () => {
  const root = protectedRoot();
  try {
    assert.throws(
      () =>
        loadTelegramAlertProtectedReferences({
          [alertDeliveryReferenceEnvironmentName]: join(
            process.cwd(),
            'unsafe-alert-reference.json',
          ),
        }),
      /alert-delivery-config-invalid/u,
    );

    const path = join(root, 'references.json');
    const token = join(root, 'token');
    writeFileSync(
      path,
      JSON.stringify({
        version: 1,
        botTokenPath: token,
        destinationPath: token,
      }),
      { mode: 0o600 },
    );
    assert.throws(
      () =>
        loadTelegramAlertProtectedReferences({
          [alertDeliveryReferenceEnvironmentName]: path,
        }),
      /alert-delivery-config-invalid/u,
    );

    writeFileSync(
      path,
      JSON.stringify({
        version: 1,
        botTokenPath: token,
        destinationPath: join(root, 'destination'),
        unexpected: true,
      }),
      { mode: 0o600 },
    );
    assert.throws(
      () =>
        loadTelegramAlertProtectedReferences({
          [alertDeliveryReferenceEnvironmentName]: path,
        }),
      /alert-delivery-config-invalid/u,
    );

    const linked = join(root, 'linked.json');
    symlinkSync(path, linked);
    assert.throws(
      () =>
        loadTelegramAlertProtectedReferences({
          [alertDeliveryReferenceEnvironmentName]: linked,
        }),
      /alert-delivery-config-invalid/u,
    );
    chmodSync(root, 0o755);
    assert.throws(
      () =>
        loadTelegramAlertProtectedReferences({
          [alertDeliveryReferenceEnvironmentName]: path,
        }),
      /alert-delivery-config-invalid/u,
    );
  } finally {
    chmodSync(root, 0o700);
    rmSync(root, { recursive: true, force: true });
  }
});
