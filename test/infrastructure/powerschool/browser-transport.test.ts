import assert from 'node:assert/strict';
import test from 'node:test';

import { PassiveBrowserReadSession } from '../../../src/infrastructure/powerschool/browser-read.js';
import { PowerSchoolBrowserTransport } from '../../../src/infrastructure/powerschool/browser-transport.js';

test('uses the browser context origin filter for parent-domain cookies', async () => {
  const session = {
    cookies: async () => [
      {
        name: 'synthetic_parent_session',
        value: 'synthetic-value',
        domain: '.example.test',
        path: '/',
        expires: -1,
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
      },
    ],
  } as unknown as PassiveBrowserReadSession;
  const transport = new PowerSchoolBrowserTransport(
    session,
    'https://school.example.test',
  );

  assert.equal(
    await transport.cookieHeaderFor('https://school.example.test'),
    'synthetic_parent_session=synthetic-value',
  );
});
