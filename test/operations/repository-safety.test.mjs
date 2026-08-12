import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { verifyRepositorySafety } from '../../scripts/operations/verify-repository-safety.mjs';

const adapterPath = 'src/infrastructure/operations/telegram-alert-transport.ts';
const exactAdapter = `import { request as httpsRequest } from 'node:https';
const telegramHost = 'api.telegram.org';
const requestTimeoutMs = 10_000;
const maximumResponseBytes = 16 * 1024;
interface Request { readonly method: 'POST'; }
const request = {
  hostname: telegramHost,
  path: \`/bot\${token}/sendMessage\`,
  method: 'POST',
  agent: false,
  maxHeaderSize: 8 * 1024,
};
`;

test('permits only the exact unwired offline Telegram adapter', () => {
  const fixture = createFixture();
  try {
    write(fixture, adapterPath, exactAdapter);
    assert.deepEqual(verifyRepositorySafety(fixture), { candidates: 1 });
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('rejects broadened alert transport authority and runtime wiring', () => {
  for (const mutate of [
    (source) => source.replace('api.telegram.org', 'example.test'),
    (source) => source.replace('sendMessage', 'sendDocument'),
    (source) => `${source}\nimport 'node:http';\n`,
  ]) {
    const fixture = createFixture();
    try {
      write(fixture, adapterPath, mutate(exactAdapter));
      assert.throws(
        () => verifyRepositorySafety(fixture),
        /forbidden operational dependency/u,
      );
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  }

  const fixture = createFixture();
  try {
    write(fixture, adapterPath, exactAdapter);
    write(
      fixture,
      'src/application/operations/wired.ts',
      "import '../../infrastructure/operations/telegram-alert-transport.js';\n",
    );
    assert.throws(
      () => verifyRepositorySafety(fixture),
      /offline alert authority must remain unwired/u,
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

function createFixture() {
  return mkdtempSync(join(tmpdir(), 'classroom-hub-repository-safety-'));
}

function write(root, relativePath, content) {
  const path = join(root, relativePath);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content, 'utf8');
}
