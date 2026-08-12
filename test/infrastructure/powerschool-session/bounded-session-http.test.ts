import assert from 'node:assert/strict';
import test from 'node:test';

import type { BrowserContext, Cookie } from 'playwright-core';

import {
  boundedSessionGet,
  countApplicableSessionCookies,
} from '../../../src/infrastructure/powerschool-session/bounded-session-http.js';

function contextWithCookies(cookies: readonly Cookie[]): BrowserContext {
  return {
    cookies: async () => [...cookies],
  } as unknown as BrowserContext;
}

const cookies: readonly Cookie[] = [
  {
    name: 'first',
    value: 'redacted-one',
    domain: 'powerschool.example',
    path: '/',
    expires: -1,
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
  },
  {
    name: 'second',
    value: 'redacted-two',
    domain: 'powerschool.example',
    path: '/teachers',
    expires: -1,
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
  },
];

test('same-origin redirect diagnostic strips origin, query, and fragment', async () => {
  const result = await boundedSessionGet({
    context: contextWithCookies(cookies),
    exactUrl: 'https://powerschool.example/teachers/home.html',
    maximumBytes: 1_024,
    timeoutMs: 1_000,
    signal: new AbortController().signal,
    requestIdentity: {
      userAgent: 'synthetic-browser',
      referer: 'https://powerschool.example/',
    },
    fetchImplementation: async () =>
      new Response(null, {
        status: 302,
        headers: {
          location:
            'https://powerschool.example/guardian/transition?ticket=discarded#fragment',
        },
      }),
  });

  assert.deepEqual(result, {
    status: 'repair-required',
    reason: 'redirect-same-origin',
    redirectDiagnostic: {
      httpStatus: 302,
      pathname: '/guardian/transition',
    },
  });
  assert.equal(JSON.stringify(result).includes('ticket'), false);
  assert.equal(JSON.stringify(result).includes('powerschool.example'), false);
});

test('cookie diagnostic returns only an applicable-cookie count', async () => {
  assert.equal(
    await countApplicableSessionCookies(
      contextWithCookies(cookies),
      'https://powerschool.example/teachers/home.html',
    ),
    2,
  );
});
