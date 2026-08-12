import assert from 'node:assert/strict';
import test from 'node:test';

import { PassiveSameOriginHttpReader } from '../../../src/infrastructure/powerschool/passive-http.js';

function reader(
  fetchImplementation: typeof fetch,
  cookie = 'synthetic_session=valid',
): PassiveSameOriginHttpReader {
  return new PassiveSameOriginHttpReader({
    origin: 'http://127.0.0.1:43199',
    authenticationProbePath: '/auth/status',
    allowedPathTemplates: [
      '/auth/status',
      '/schedule',
      '/schedule?date={date}',
      '/schedule/{date}',
    ],
    maximumTimeoutMs: 1_000,
    maximumBodyBytes: 4_096,
    cookies: {
      cookieHeaderFor: async (origin) => {
        assert.equal(origin, 'http://127.0.0.1:43199');
        return cookie;
      },
    },
    fetchImplementation,
  });
}

test('same-origin HTTP transport can issue only a bounded GET', async () => {
  let calls = 0;
  const transport = reader(async (input, init) => {
    calls += 1;
    assert.equal(
      String(input),
      'http://127.0.0.1:43199/schedule?date=2035-04-13',
    );
    assert.equal(init?.method, 'GET');
    assert.equal(init?.redirect, 'manual');
    assert.equal(
      new Headers(init?.headers).get('cookie'),
      'synthetic_session=valid',
    );
    return new Response(
      '<html><title>Synthetic Bell</title><body>Period 1 08:00 - 09:00</body></html>',
      { headers: { 'content-type': 'text/html' } },
    );
  });
  const result = await transport.read('/schedule?date=2035-04-13');
  assert.equal(result.status, 'captured');
  assert.equal(
    result.status === 'captured' ? result.capture.title : '',
    'Synthetic Bell',
  );
  assert.equal(
    result.status === 'captured' ? result.capture.path : '',
    '/schedule?date=2035-04-13',
  );
  assert.equal(calls, 1);
  for (const unsafe of [
    'https://outside.example.invalid/schedule',
    '//outside.example.invalid/schedule',
    '/schedule\\escape',
    '',
  ]) {
    assert.equal((await transport.read(unsafe)).status, 'failed');
  }
  assert.equal(calls, 1);
});

test('HTTP allowlist supports validated dates in paths but never fragments', async () => {
  let lastUrl = '';
  const transport = reader(async (input) => {
    lastUrl = String(input);
    return new Response('<html><title>Synthetic</title></html>', {
      headers: { 'content-type': 'text/html' },
    });
  });
  assert.equal(
    (await transport.read('/schedule/2035-04-13')).status,
    'captured',
  );
  assert.equal(lastUrl, 'http://127.0.0.1:43199/schedule/2035-04-13');
  for (const path of [
    '/schedule/2035-02-30',
    '/schedule/%32%30%33%35-04-13',
    '/schedule/2035-04-13#dynamic',
  ]) {
    assert.equal((await transport.read(path)).status, 'failed');
  }
});

test('HTTP transport classifies rendering and authentication without following redirects', async () => {
  const dynamic = reader(
    async () =>
      new Response(
        '<meta name="powerschool-render" content="browser"><div id="app"></div>',
        { headers: { 'content-type': 'text/html' } },
      ),
  );
  assert.deepEqual(await dynamic.read('/schedule'), {
    status: 'browser-required',
  });

  const expired = reader(
    async () =>
      new Response(null, { status: 302, headers: { location: '/login' } }),
  );
  assert.deepEqual(await expired.read('/schedule'), {
    status: 'repair-required',
    code: 'session-expired',
  });
  assert.deepEqual(await expired.probe(1_000), {
    state: 'authentication-required',
    blocker: 'session-expired',
  });

  const sso = reader(
    async () =>
      new Response(null, {
        status: 302,
        headers: { location: 'https://sso.example.invalid/approve' },
      }),
  );
  assert.deepEqual(await sso.read('/schedule'), {
    status: 'repair-required',
    code: 'sso-approval-required',
  });
});

test('HTTP transport fails closed for malformed, oversized, and timed-out responses', async () => {
  const wrongType = reader(
    async () =>
      new Response('{}', { headers: { 'content-type': 'application/json' } }),
  );
  assert.deepEqual(await wrongType.read('/schedule'), {
    status: 'failed',
    code: 'source-content-type-invalid',
    retryable: false,
  });

  const oversized = reader(
    async () =>
      new Response('x', {
        headers: { 'content-type': 'text/html', 'content-length': '5000' },
      }),
  );
  assert.deepEqual(await oversized.read('/schedule'), {
    status: 'failed',
    code: 'source-response-too-large',
    retryable: false,
  });

  const timedOut = reader(async () => {
    throw new DOMException('synthetic secret omitted', 'TimeoutError');
  });
  assert.deepEqual(await timedOut.read('/schedule'), {
    status: 'failed',
    code: 'source-read-timeout',
    retryable: true,
  });
  assert.deepEqual(await timedOut.probe(1_000), {
    state: 'failed',
    reason: 'timeout',
  });

  assert.throws(
    () =>
      new PassiveSameOriginHttpReader({
        origin: 'http://example.com',
        authenticationProbePath: '/auth/status',
        allowedPathTemplates: ['/auth/status'],
        maximumTimeoutMs: 1_000,
        maximumBodyBytes: 4_096,
        cookies: { cookieHeaderFor: async () => undefined },
        fetchImplementation: fetch,
      }),
    /powerschool-origin-invalid/,
  );
});

test('bounds a never-settling cookie provider before any HTTP request', async () => {
  let fetchCalls = 0;
  const transport = new PassiveSameOriginHttpReader({
    origin: 'http://127.0.0.1:43199',
    authenticationProbePath: '/auth/status',
    allowedPathTemplates: ['/auth/status', '/schedule'],
    maximumTimeoutMs: 100,
    maximumBodyBytes: 4_096,
    cookies: { cookieHeaderFor: () => new Promise(() => undefined) },
    fetchImplementation: async () => {
      fetchCalls += 1;
      return new Response('<main>unexpected</main>');
    },
  });
  const started = Date.now();
  assert.deepEqual(await transport.read('/schedule'), {
    status: 'failed',
    code: 'source-read-timeout',
    retryable: true,
  });
  assert.ok(Date.now() - started < 500);
  assert.equal(fetchCalls, 0);
});

test('rejects same-origin GET mutation traps outside the finite allowlist before cookies or fetch', async () => {
  let cookieCalls = 0;
  let fetchCalls = 0;
  const transport = new PassiveSameOriginHttpReader({
    origin: 'http://127.0.0.1:43199',
    authenticationProbePath: '/auth/status',
    allowedPathTemplates: ['/auth/status', '/schedule?date={date}'],
    maximumTimeoutMs: 100,
    maximumBodyBytes: 4_096,
    cookies: {
      cookieHeaderFor: async () => {
        cookieCalls += 1;
        return undefined;
      },
    },
    fetchImplementation: async () => {
      fetchCalls += 1;
      return new Response('<main>unexpected</main>');
    },
  });

  for (const path of [
    '/admin/save',
    '/schedule?date=2035-04-13&action=save',
    '/schedule?date=2035-02-30',
    '/schedule?date=%32%30%33%35-04-13',
  ]) {
    assert.deepEqual(await transport.read(path), {
      status: 'failed',
      code: 'source-read-path-not-allowed',
      retryable: false,
    });
  }
  assert.equal(cookieCalls, 0);
  assert.equal(fetchCalls, 0);
});

test('accepts only the authorized MM/DD/YYYY target_date shape when configured', async () => {
  const calls: string[] = [];
  const transport = new PassiveSameOriginHttpReader({
    origin: 'http://127.0.0.1:43199',
    authenticationProbePath: '/teachers/home.html',
    allowedPathTemplates: [
      '/teachers/home.html',
      '/teachers/aet_schedulebell.html?target_date={date}',
    ],
    dateValueFormat: 'mm/dd/yyyy',
    expectedDate: '2026-08-10',
    maximumTimeoutMs: 1_000,
    maximumBodyBytes: 4_096,
    cookies: { cookieHeaderFor: async () => 'synthetic_session=valid' },
    fetchImplementation: async (input, init) => {
      calls.push(String(input));
      assert.equal(init?.method, 'GET');
      return new Response('<html><title>Synthetic</title></html>', {
        headers: { 'content-type': 'text/html' },
      });
    },
  });

  assert.equal(
    (
      await transport.read(
        '/teachers/aet_schedulebell.html?target_date=08/10/2026',
      )
    ).status,
    'captured',
  );
  for (const path of [
    '/teachers/aet_schedulebell.html?target_date=2026-08-10',
    '/teachers/aet_schedulebell.html?target_date=02/30/2026',
    '/teachers/aet_schedulebell.html?target_date=08%2F10%2F2026',
    '/teachers/aet_schedulebell.html?target_date=08/11/2026',
    '/teachers/aet_schedulebell.html?target_date=08/10/2026&action=save',
    '/teachers/other.html?target_date=08/10/2026',
  ]) {
    assert.deepEqual(await transport.read(path), {
      status: 'failed',
      code: 'source-read-path-not-allowed',
      retryable: false,
    });
  }
  assert.deepEqual(calls, [
    'http://127.0.0.1:43199/teachers/aet_schedulebell.html?target_date=08/10/2026',
  ]);
});
