import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { TelegramAlertProtectedReferences } from '../../../src/config/alert-delivery.js';
import type { AlertDecision } from '../../../src/domain/operations/alerts.js';
import {
  createTelegramAlertTransport,
  qualifyTelegramAlertDelivery,
  renderAlertText,
  renderTelegramQualificationText,
  type TelegramHttpExecutor,
  type TelegramHttpRequest,
} from '../../../src/infrastructure/operations/telegram-alert-transport.js';

const token = '00000:SYNTHETIC_ALERT_VALUE_1234567890';
const destination = '@synthetic_alert_test';
const fingerprint = 'fnv1a64:0000000000000001';

function decision(kind: AlertDecision['kind'] = 'new'): AlertDecision {
  const recovered = kind === 'recovery';
  const active = recovered ? [] : [fingerprint];
  return {
    kind,
    shouldSend: true,
    evaluatedAt: '2035-04-13T07:00:00Z',
    activeFingerprints: active,
    addedFingerprints: kind === 'new' ? [fingerprint] : [],
    recoveredFingerprints: recovered ? [fingerprint] : [],
    nextState: {
      activeFingerprints: active,
      notifiedFingerprints: active,
      lastNotifiedAt: '2035-04-13T07:00:00Z',
    },
  };
}

function protectedReferences(): {
  readonly root: string;
  readonly references: TelegramAlertProtectedReferences;
  readonly environment: NodeJS.ProcessEnv;
} {
  const root = mkdtempSync(join(tmpdir(), 'telegram-alert-'));
  chmodSync(root, 0o700);
  const botTokenPath = join(root, 'bot-token');
  const destinationPath = join(root, 'destination');
  writeFileSync(botTokenPath, `${token}\n`, { mode: 0o600 });
  writeFileSync(destinationPath, `${destination}\n`, { mode: 0o600 });
  const referencePath = join(root, 'references.json');
  writeFileSync(
    referencePath,
    JSON.stringify({ version: 1, botTokenPath, destinationPath }),
    { mode: 0o600 },
  );
  return {
    root,
    references: { version: 1, botTokenPath, destinationPath },
    environment: { CLASSROOM_HUB_ALERT_DELIVERY_REFERENCE: referencePath },
  };
}

test('sends one exact bounded request and overwrites request and response bytes', async () => {
  const fixture = protectedReferences();
  let observed: TelegramHttpRequest | undefined;
  const responseBody = Buffer.from('{"ok":true,"result":{}}');
  const execute: TelegramHttpExecutor = async (request) => {
    observed = request;
    assert.equal(request.hostname, 'api.telegram.org');
    assert.equal(request.method, 'POST');
    assert.equal(request.path, `/bot${token}/sendMessage`);
    assert.equal(request.timeoutMs, 10_000);
    assert.equal(request.maximumResponseBytes, 16 * 1024);
    assert.deepEqual(JSON.parse(request.body.toString('utf8')), {
      chat_id: destination,
      text: renderAlertText(decision()),
      disable_notification: false,
      protect_content: true,
    });
    assert.equal(
      request.headers['Content-Length'],
      String(request.body.byteLength),
    );
    return { statusCode: 200, body: responseBody };
  };
  try {
    assert.deepEqual(
      await createTelegramAlertTransport({
        environment: fixture.environment,
        execute,
      }).deliver(decision()),
      { status: 'delivered' },
    );
    assert.ok(observed);
    assert.equal(
      observed.body.every((byte) => byte === 0),
      true,
    );
    assert.equal(
      responseBody.every((byte) => byte === 0),
      true,
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('formats only redacted counts and the evaluated instant', () => {
  assert.equal(
    renderAlertText(decision('recovery')),
    [
      'Classroom Hub recovery',
      'Active issues: 0',
      'New issues: 0',
      'Recovered issues: 1',
      'Evaluated: 2035-04-13T07:00:00Z',
    ].join('\n'),
  );
  assert.equal(renderAlertText(decision()).includes(fingerprint), false);
});

test('qualification uses the same bounded transport with fixed non-operational text', async () => {
  const fixture = protectedReferences();
  let calls = 0;
  try {
    assert.deepEqual(
      await qualifyTelegramAlertDelivery({
        environment: fixture.environment,
        execute: async (request) => {
          calls += 1;
          assert.deepEqual(JSON.parse(request.body.toString('utf8')), {
            chat_id: destination,
            text: renderTelegramQualificationText(),
            disable_notification: false,
            protect_content: true,
          });
          return { statusCode: 200, body: Buffer.from('{"ok":true}') };
        },
      }),
      { status: 'delivered' },
    );
    assert.equal(calls, 1);
    assert.equal(
      renderTelegramQualificationText(),
      'Classroom Hub alert delivery test\nNo operational issue is being reported.',
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('maps provider, malformed, oversized, abort, and transport failures finitely', async () => {
  const fixture = protectedReferences();
  try {
    const cases = [
      [401, '{"ok":false}', 'alert-authority-rejected'],
      [429, '{"ok":false}', 'alert-transport-rate-limited'],
      [400, '{"ok":false}', 'alert-delivery-rejected'],
      [503, '{"ok":false}', 'alert-transport-unavailable'],
      [200, '{"ok":false}', 'alert-delivery-rejected'],
      [200, 'not-json', 'alert-response-invalid'],
    ] as const;
    for (const [statusCode, body, code] of cases) {
      const transport = createTelegramAlertTransport({
        environment: fixture.environment,
        execute: async () => ({ statusCode, body: Buffer.from(body) }),
      });
      assert.deepEqual(await transport.deliver(decision()), {
        status: 'failed',
        code,
      });
    }
    const oversized = createTelegramAlertTransport({
      environment: fixture.environment,
      execute: async () => ({
        statusCode: 200,
        body: Buffer.alloc(16 * 1024 + 1),
      }),
    });
    assert.deepEqual(await oversized.deliver(decision()), {
      status: 'failed',
      code: 'alert-response-invalid',
    });
    const throwing = createTelegramAlertTransport({
      environment: fixture.environment,
      execute: async () => {
        throw new Error('synthetic-private-provider-error');
      },
    });
    assert.deepEqual(await throwing.deliver(decision()), {
      status: 'failed',
      code: 'alert-transport-unavailable',
    });
    const controller = new AbortController();
    controller.abort('synthetic-abort');
    assert.deepEqual(await throwing.deliver(decision(), controller.signal), {
      status: 'failed',
      code: 'alert-delivery-aborted',
    });
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('rejects missing or malformed authority before constructing a request', async () => {
  const fixture = protectedReferences();
  let calls = 0;
  const execute: TelegramHttpExecutor = async () => {
    calls += 1;
    return { statusCode: 200, body: Buffer.from('{"ok":true}') };
  };
  try {
    writeFileSync(fixture.references.botTokenPath, 'not-a-token\n', {
      mode: 0o600,
    });
    assert.deepEqual(
      await createTelegramAlertTransport({
        environment: fixture.environment,
        execute,
      }).deliver(decision()),
      { status: 'failed', code: 'alert-authority-unavailable' },
    );
    writeFileSync(
      fixture.references.botTokenPath,
      '00000:SYNTHETIC_ALERT_VALUE_1234567890\n',
      { mode: 0o600 },
    );
    writeFileSync(fixture.references.destinationPath, 'unsafe destination\n', {
      mode: 0o600,
    });
    assert.deepEqual(
      await createTelegramAlertTransport({
        environment: fixture.environment,
        execute,
      }).deliver(decision()),
      { status: 'failed', code: 'alert-authority-invalid' },
    );
    assert.equal(calls, 0);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
