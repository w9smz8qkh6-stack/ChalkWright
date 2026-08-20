import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  lockedOnePasswordExecutable,
  type PowerSchoolRepairReferences,
} from '../../../src/config/powerschool-repair.js';
import {
  destroyPowerSchoolRepairSecrets,
  readPowerSchoolRepairSecrets,
} from '../../../src/infrastructure/one-password/powerschool-repair-secrets.js';

const references: PowerSchoolRepairReferences = {
  version: 1,
  usernameReference: 'op://Synthetic/Google/username',
  passwordReference: 'op://Synthetic/Google/password',
  totpReference: 'op://Synthetic/Google/one-time password?attribute=otp',
};

test('uses only fixed op read arguments and returns destroyable buffers', async () => {
  const calls: Array<{ executable: string; arguments_: readonly string[] }> =
    [];
  const values = [
    Buffer.from('teacher@example.invalid'),
    Buffer.from('synthetic-password'),
    Buffer.from('123456'),
  ];
  const secrets = await readPowerSchoolRepairSecrets({
    references,
    environment: {
      HOME: '/tmp/synthetic-home',
      OP_ACCOUNT: 'synthetic-account',
      OP_SERVICE_ACCOUNT_TOKEN: 'must-not-propagate',
      TMPDIR: '/tmp/synthetic-runtime',
      CLASSROOM_HUB_POWERSCHOOL_GOOGLE_PASSWORD: 'must-not-propagate',
    },
    execute: async (executable, arguments_, options) => {
      calls.push({ executable, arguments_ });
      assert.equal(options.environment.OP_SERVICE_ACCOUNT_TOKEN, undefined);
      assert.equal(options.environment.TMPDIR, '/tmp/synthetic-runtime');
      assert.equal(
        options.environment.CLASSROOM_HUB_POWERSCHOOL_GOOGLE_PASSWORD,
        undefined,
      );
      assert.equal(options.maximumBytes, 4_096);
      assert.equal(options.timeoutMs, 60_000);
      return values[calls.length - 1]!;
    },
  });
  assert.deepEqual(
    calls,
    Object.values(references)
      .filter((value): value is string => typeof value === 'string')
      .map((reference) => ({
        executable: lockedOnePasswordExecutable,
        arguments_: ['read', reference, '--no-newline'],
      })),
  );
  destroyPowerSchoolRepairSecrets(secrets);
  assert.equal(
    values.every((value) => value.every((byte) => byte === 0)),
    true,
  );
});

test('fails closed and scrubs acquired values after an invalid TOTP', async () => {
  const values = [
    Buffer.from('teacher@example.invalid'),
    Buffer.from('synthetic-password'),
    Buffer.from('not-a-code'),
  ];
  let index = 0;
  await assert.rejects(
    readPowerSchoolRepairSecrets({
      references,
      execute: async () => values[index++]!,
    }),
    /powerschool-repair-secret-unavailable/u,
  );
  assert.equal(
    values.every((value) => value.every((byte) => byte === 0)),
    true,
  );
});

test('passes explicit service-account authority only to fixed op reads', async () => {
  const serviceAccountToken = Buffer.from(
    `ops_${'Synthetic0123456789'.repeat(4)}`,
  );
  const values = [
    Buffer.from('teacher@example.invalid'),
    Buffer.from('synthetic-password'),
    Buffer.from('123456'),
  ];
  let index = 0;
  let configurationDirectory: string | undefined;
  const secrets = await readPowerSchoolRepairSecrets({
    references,
    environment: {
      HOME: '/tmp/synthetic-home',
      OP_CONNECT_HOST: 'must-not-propagate',
      OP_CONNECT_TOKEN: 'must-not-propagate',
    },
    serviceAccountToken,
    execute: async (_executable, arguments_, options) => {
      assert.equal(
        options.environment.OP_SERVICE_ACCOUNT_TOKEN,
        serviceAccountToken.toString('ascii'),
      );
      assert.equal(options.environment.OP_CONNECT_HOST, undefined);
      assert.equal(options.environment.OP_CONNECT_TOKEN, undefined);
      assert.equal(arguments_[0], '--config');
      assert.match(
        arguments_[1]!,
        new RegExp(
          `^${escapeRegExp(join(tmpdir(), 'chalkwright-onepassword-config-'))}[A-Za-z0-9]+$`,
          'u',
        ),
      );
      configurationDirectory ??= arguments_[1]!;
      assert.equal(arguments_[1], configurationDirectory);
      assert.equal(existsSync(configurationDirectory), true);
      assert.deepEqual(arguments_.slice(2), [
        '--cache=false',
        'read',
        Object.values(references)[index + 1],
        '--no-newline',
      ]);
      return values[index++]!;
    },
  });
  assert.equal(existsSync(configurationDirectory!), false);
  destroyPowerSchoolRepairSecrets(secrets);
  serviceAccountToken.fill(0);
  assert.equal(
    values.every((value) => value.every((byte) => byte === 0)),
    true,
  );
});

test('removes the private service-account configuration after failure', async () => {
  const serviceAccountToken = Buffer.from(
    `ops_${'Synthetic0123456789'.repeat(4)}`,
  );
  const username = Buffer.from('teacher@example.invalid');
  let configurationDirectory: string | undefined;
  let calls = 0;
  await assert.rejects(
    readPowerSchoolRepairSecrets({
      references,
      serviceAccountToken,
      execute: async (_executable, arguments_) => {
        configurationDirectory ??= arguments_[1]!;
        assert.equal(existsSync(configurationDirectory), true);
        calls += 1;
        if (calls === 1) return username;
        throw new Error('synthetic-op-failure');
      },
    }),
    /powerschool-repair-secret-unavailable/u,
  );
  assert.equal(existsSync(configurationDirectory!), false);
  assert.equal(
    username.every((byte) => byte === 0),
    true,
  );
  serviceAccountToken.fill(0);
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
