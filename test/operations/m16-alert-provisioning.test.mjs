import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  alertProvisioningPolicy,
  normalizeBotToken,
  parseLegacyDestination,
} from '../../scripts/operations/provision-m16-alert-authority.mjs';

test('M-16 alert provisioning extracts one bounded destination without evaluating source', () => {
  assert.equal(
    parseLegacyDestination(
      Buffer.from('const TELEGRAM_CHAT_ID = "-1001234567890";\n'),
    ).toString('ascii'),
    '-1001234567890',
  );
  assert.equal(
    parseLegacyDestination(
      Buffer.from('const TELEGRAM_CHAT_ID = "@ClassroomAlerts";\n'),
    ).toString('ascii'),
    '@ClassroomAlerts',
  );
  for (const invalid of [
    Buffer.from('const TELEGRAM_CHAT_ID = "bad value";\n'),
    Buffer.from(
      'const TELEGRAM_CHAT_ID = "12345";\nconst TELEGRAM_CHAT_ID = "67890";\n',
    ),
    Buffer.from('export const destination = "12345";\n'),
  ]) {
    assert.throws(
      () => parseLegacyDestination(invalid),
      /m16-alert-(?:source|destination)-invalid/u,
    );
  }
});

test('M-16 alert provisioning normalizes only one bounded bot token', () => {
  const syntheticToken = [
    '123456789',
    'AbCdEfGhIjKlMnOpQrStUvWxYz_123456',
  ].join(':');
  assert.equal(
    normalizeBotToken(Buffer.from(`${syntheticToken}\n`)).toString('ascii'),
    syntheticToken,
  );
  for (const invalid of [
    Buffer.from('not-a-token'),
    Buffer.from('12345:too-short'),
    Buffer.from('123456:bad value with spaces'),
    Buffer.from(
      ['123456', 'validlookingsegmentvalidlooking', 'second'].join(':'),
    ),
  ]) {
    assert.throws(() => normalizeBotToken(invalid), /m16-alert-token-invalid/u);
  }
});

test('M-16 alert provisioning policy is fixed, separate, and inert', () => {
  const policy = alertProvisioningPolicy();
  assert.deepEqual(policy, {
    version: 1,
    legacySource:
      '/opt/openclaw/plugins/classroom-screen/ops/classroom_screen_ops.js',
    legacySourceSha256:
      'sha256:0823354a44945838815571cb1dbd3910f35370aa06ee274f4e65f111e6b5f54a',
    legacyBotToken: '/etc/openclaw/secrets/telegram-work-bot-token',
    targetDirectory: '/etc/classroom-hub/providers/alert-delivery',
    botTokenPath: '/etc/classroom-hub/providers/alert-delivery/bot-token',
    destinationPath: '/etc/classroom-hub/providers/alert-delivery/destination',
    referencePath:
      '/etc/classroom-hub/providers/alert-delivery/alert-delivery.json',
  });
  assert.notEqual(policy.botTokenPath, policy.destinationPath);

  const provisioner = readFileSync(
    'scripts/operations/provision-m16-alert-authority.mjs',
    'utf8',
  );
  for (const forbidden of [
    'systemctl',
    'tailscale',
    'fetch(',
    "from 'node:https'",
    'api.telegram.org',
    'sendMessage',
    'child_process',
    '/etc/systemd/system',
  ]) {
    assert.equal(provisioner.includes(forbidden), false, forbidden);
  }
  assert.doesNotMatch(provisioner, /TELEGRAM_CHAT_ID\s*=\s*"-?\d+/u);

  const tmpfiles = readFileSync('systemd/classroom-hub.tmpfiles', 'utf8');
  assert.match(
    tmpfiles,
    /^d \/etc\/classroom-hub\/providers\/alert-delivery 0700 classroom-hub classroom-hub -$/mu,
  );
});
