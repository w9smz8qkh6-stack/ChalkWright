import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { afterEach, describe, test } from 'node:test';

import {
  startClassroomHttpServer,
  type ClassroomHttpController,
  type ClassroomHttpControllerRequest,
  type ClassroomHttpControllerResult,
  type ClassroomHttpServerOptions,
  type RunningClassroomHttpServer,
} from '../../../src/infrastructure/http/index.js';

const runningServers: RunningClassroomHttpServer[] = [];
const authority = 'synthetic-local-authority';

afterEach(async () => {
  await Promise.all(
    runningServers.splice(0).map(async (server) => server.close()),
  );
});

class FixtureController implements ClassroomHttpController {
  readonly requests: ClassroomHttpControllerRequest[] = [];
  responder: (
    request: ClassroomHttpControllerRequest,
    signal: AbortSignal,
  ) =>
    | ClassroomHttpControllerResult
    | undefined
    | Promise<ClassroomHttpControllerResult | undefined> = (request) => {
    if (request.kind === 'display') {
      return { kind: 'html', value: `<main>${request.screenId}</main>` };
    }
    if (request.kind === 'qr') {
      return {
        kind: 'binary',
        value: Uint8Array.from([137, 80, 78, 71]),
        contentType: 'image/png',
      };
    }
    if (request.kind === 'readiness') {
      return { kind: 'json', status: 503, value: { ready: false } };
    }
    if (request.kind === 'attendance.redirect') {
      return {
        kind: 'redirect',
        location: `https://attendance.example.test/${request.classId}/${request.target}`,
        status: 307,
      };
    }
    return { kind: 'json', value: { kind: request.kind } };
  };

  handle(
    request: ClassroomHttpControllerRequest,
    context: { readonly signal: AbortSignal },
  ):
    | ClassroomHttpControllerResult
    | undefined
    | Promise<ClassroomHttpControllerResult | undefined> {
    this.requests.push(request);
    return this.responder(request, context.signal);
  }
}

describe('loopback HTTP routing', () => {
  test('binds only loopback and dispatches all read route families', async () => {
    const controller = new FixtureController();
    const server = await startFixture(controller);
    assert.equal(server.host, '127.0.0.1');
    assert.match(server.origin, /^http:\/\/127\.0\.0\.1:\d+$/);

    const routes: ReadonlyArray<readonly [string, string, number]> = [
      ['/', 'display', 200],
      ['/tv', 'display', 200],
      ['/display/screen-a', 'display', 200],
      ['/displays', 'displays', 200],
      ['/day-plan/screen-a?date=2035-03-04', 'day-plan', 200],
      ['/target/screen-a', 'target', 200],
      ['/preview/screen-a?mode=preview&date=2035-03-04', 'preview', 200],
      ['/overrides/screen-a', 'overrides.read', 200],
      ['/hold/screen-a', 'hold.read', 200],
      ['/qr/screen-a/meeting-a.png', 'qr', 200],
      ['/manifest.webmanifest', 'manifest', 200],
      ['/health', 'health', 200],
      ['/ready', 'readiness', 503],
      ['/attendance/class/algebra-a', 'attendance.class', 200],
      ['/attendance/algebra-a', 'attendance.class', 200],
      ['/attendance/current/screen-a', 'attendance.current', 200],
      ['/attendance/diagnostics/algebra-a', 'attendance.diagnostics', 200],
    ];
    for (const [path, kind, status] of routes) {
      const response = await fetch(`${server.origin}${path}`);
      assert.equal(response.status, status, path);
      assert.equal(controller.requests.at(-1)?.kind, kind, path);
    }

    const redirect = await fetch(`${server.origin}/go/check-in/algebra-a`, {
      redirect: 'manual',
    });
    assert.equal(redirect.status, 307);
    assert.equal(
      redirect.headers.get('location'),
      'https://attendance.example.test/algebra-a/check-in',
    );
    assert.equal(controller.requests.at(-1)?.kind, 'attendance.redirect');
  });

  test('supports HEAD, rejects unsupported methods, and reports the exact Allow matrix', async () => {
    const controller = new FixtureController();
    const server = await startFixture(controller);
    const head = await fetch(`${server.origin}/display/screen-a`, {
      method: 'HEAD',
    });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
    assert.equal(
      head.headers.get('content-length'),
      String('<main>screen-a</main>'.length),
    );

    const rejected = await fetch(`${server.origin}/display/screen-a`, {
      method: 'POST',
    });
    assert.equal(rejected.status, 405);
    assert.equal(rejected.headers.get('allow'), 'GET, HEAD');
    assert.deepEqual(await rejected.json(), {
      error: { code: 'method_not_allowed', message: 'Method not allowed.' },
    });

    const patch = await rawRequest(server, '/overrides/screen-a', {
      method: 'PATCH',
    });
    assert.equal(patch.status, 405);
    assert.equal(patch.headers.allow, 'GET, HEAD, POST, PUT, DELETE');
  });

  test('preserves the finite legacy mount and API route family without exposing unprefixed routes', async () => {
    const controller = new FixtureController();
    const server = await startFixture(controller, {
      routePrefix: '/classroom-screen',
      legacyRouteCompatibility: true,
      screenIdAliases: { b407: 'screen-b407' },
      displayCompatibilityPaths: {
        '/': 'screen-b407',
        '/b407': 'screen-b407',
      },
      assets: {
        'app.css': { bytes: Buffer.from('body{}'), contentType: 'text/css' },
        'classroom-hub.svg': {
          bytes: Buffer.from('<svg/>'),
          contentType: 'image/svg+xml',
        },
      },
      media: {
        dismissal: {
          bytes: Uint8Array.from([0, 1, 2]),
          contentType: 'video/mp4',
        },
      },
    });

    const routes: ReadonlyArray<
      readonly [string, ClassroomHttpControllerRequest['kind'] | 'resource']
    > = [
      ['/classroom-screen', 'display'],
      ['/classroom-screen/b407', 'display'],
      ['/classroom-screen/api/displays', 'displays'],
      ['/classroom-screen/api/day-plan/b407?date=2035-04-13', 'day-plan'],
      [
        '/classroom-screen/api/target/b407?now=2035-04-13T08%3A00%3A00Z',
        'target',
      ],
      ['/classroom-screen/api/preview/b407?date=2035-04-13', 'preview-data'],
      ['/classroom-screen/api/qr/b407/meeting-a', 'qr'],
      ['/classroom-screen/manifest.json', 'manifest'],
      ['/classroom-screen/health', 'health'],
      ['/classroom-screen/ready', 'readiness'],
      ['/classroom-screen/icon.svg', 'resource'],
      ['/classroom-screen/assets/app.css', 'resource'],
      ['/classroom-screen/api/media/horse-video', 'resource'],
    ];
    for (const [path, kind] of routes) {
      const before = controller.requests.length;
      const response = await fetch(`${server.origin}${path}`);
      assert.equal(response.status, kind === 'readiness' ? 503 : 200, path);
      await response.arrayBuffer();
      if (kind === 'resource') assert.equal(controller.requests.length, before);
      else assert.equal(controller.requests.at(-1)?.kind, kind, path);
    }
    assert.deepEqual(
      controller.requests.find(
        (request) => request.kind === 'target' && request.simulation === true,
      ),
      {
        kind: 'target',
        screenId: 'screen-b407',
        query: { now: '2035-04-13T08:00:00Z' },
        simulation: true,
      },
    );
    assert.equal((await fetch(`${server.origin}/health`)).status, 404);
    assert.equal(
      (
        await rawRequest(server, '/classroom-screen/assets/%2e%2e/private', {
          method: 'GET',
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await fetch(`${server.origin}/classroom-screen/api/displays`, {
          method: 'POST',
        })
      ).status,
      405,
    );
  });

  test('sets defensive headers and no-store on HTML, JSON, redirects, and errors', async () => {
    const controller = new FixtureController();
    const server = await startFixture(controller);
    for (const path of ['/display/screen-a', '/health', '/missing']) {
      const response = await fetch(`${server.origin}${path}`);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.match(
        response.headers.get('content-security-policy') ?? '',
        /frame-ancestors 'none'/,
      );
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(response.headers.get('x-frame-options'), 'DENY');
      assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
      assert.match(
        response.headers.get('permissions-policy') ?? '',
        /camera=\(\)/,
      );
    }
    const redirect = await fetch(`${server.origin}/go/check-in/algebra-a`, {
      redirect: 'manual',
    });
    assert.equal(redirect.headers.get('cache-control'), 'no-store');
  });
});

describe('local mutation boundary', () => {
  test('starts read-only without operator authority and fails mutations closed', async () => {
    const controller = new FixtureController();
    const configured = baseOptions(controller);
    const { mutationToken: _mutationToken, ...readOnlyOptions } = configured;
    const server = await startClassroomHttpServer(readOnlyOptions);
    runningServers.push(server);

    assert.equal((await fetch(`${server.origin}/health`)).status, 200);
    const mutation = await fetch(`${server.origin}/hold/screen-a`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${authority}` },
    });
    assert.equal(mutation.status, 503);
    assert.deepEqual(await mutation.json(), {
      error: {
        code: 'operator_auth_unconfigured',
        message: 'Local operator authorization is not configured.',
      },
    });
    assert.equal(controller.requests.length, 1);
  });

  test('requires a bearer token only for mutations and accepts bounded JSON', async () => {
    const controller = new FixtureController();
    const server = await startFixture(controller);
    assert.equal(
      (await fetch(`${server.origin}/overrides/screen-a`)).status,
      200,
    );

    const missing = await fetch(`${server.origin}/overrides/screen-a`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    assert.equal(missing.status, 401);
    assert.equal(missing.headers.get('www-authenticate'), 'Bearer');

    const wrong = await fetch(`${server.origin}/hold/screen-a`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer synthetic-wrong-authority',
        'content-type': 'application/json',
      },
      body: '{}',
    });
    assert.equal(wrong.status, 401);

    const accepted = await fetch(`${server.origin}/overrides/screen-a`, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${authority}`,
        'content-type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({ announcement: 'Synthetic notice' }),
    });
    assert.equal(accepted.status, 200);
    assert.deepEqual(controller.requests.at(-1), {
      kind: 'overrides.write',
      screenId: 'screen-a',
      query: {},
      body: { announcement: 'Synthetic notice' },
    });

    const deleted = await fetch(`${server.origin}/hold/screen-a`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${authority}` },
    });
    assert.equal(deleted.status, 200);
    assert.equal(controller.requests.at(-1)?.kind, 'hold.delete');

    const formWrite = await fetch(`${server.origin}/hold/screen-a`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${authority}`,
        'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
      },
      body: 'date=2035-03-04&reasonCode=discussion',
    });
    assert.equal(formWrite.status, 200);
    assert.deepEqual(controller.requests.at(-1), {
      kind: 'hold.write',
      screenId: 'screen-a',
      query: {},
      body: { date: '2035-03-04', reasonCode: 'discussion' },
    });

    const formRelease = await fetch(`${server.origin}/hold/screen-a/release`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${authority}`,
        'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
      },
      body: 'date=2035-03-04&meetingId=meeting-a',
    });
    assert.equal(formRelease.status, 200);
    assert.deepEqual(controller.requests.at(-1), {
      kind: 'hold.delete',
      screenId: 'screen-a',
      query: {},
      body: { date: '2035-03-04', meetingId: 'meeting-a' },
    });

    const overrideDelete = await fetch(
      `${server.origin}/overrides/screen-a/delete`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${authority}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: 'date=2035-03-04',
      },
    );
    assert.equal(overrideDelete.status, 200);
    assert.equal(controller.requests.at(-1)?.kind, 'overrides.delete');
  });

  test('never accepts credentials in the URL', async () => {
    const controller = new FixtureController();
    const server = await startFixture(controller);
    for (const name of ['token', 'access_token', 'authorization', 'api_key']) {
      const response = await fetch(
        `${server.origin}/overrides/screen-a?${name}=synthetic`,
      );
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), {
        error: {
          code: 'credentials_in_url',
          message: 'Credentials are not accepted in URLs.',
        },
      });
    }
    assert.equal(controller.requests.length, 0);
  });

  test('accepts authority only in the header, never in a form body', async () => {
    const controller = new FixtureController();
    const server = await startFixture(controller);
    const response = await fetch(`${server.origin}/hold/screen-a`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${authority}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: 'date=2035-03-04&token=synthetic',
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: {
        code: 'credentials_in_body',
        message: 'Credentials are accepted only in the Authorization header.',
      },
    });
    assert.equal(controller.requests.length, 0);
  });

  test('rejects oversized, absent, malformed, and incorrectly typed mutation bodies', async () => {
    const controller = new FixtureController();
    const server = await startFixture(controller, { maxBodyBytes: 32 });
    const headers = { authorization: `Bearer ${authority}` };
    const cases: ReadonlyArray<readonly [RequestInit, number, string]> = [
      [{ method: 'PUT', headers }, 415, 'unsupported_media_type'],
      [
        {
          method: 'PUT',
          headers: { ...headers, 'content-type': 'text/plain' },
          body: '{}',
        },
        415,
        'unsupported_media_type',
      ],
      [
        {
          method: 'PUT',
          headers: { ...headers, 'content-type': 'application/json' },
          body: '{',
        },
        400,
        'invalid_json',
      ],
      [
        {
          method: 'PUT',
          headers: { ...headers, 'content-type': 'application/json' },
          body: JSON.stringify({ value: 'x'.repeat(64) }),
        },
        413,
        'payload_too_large',
      ],
    ];
    for (const [init, status, code] of cases) {
      const response = await fetch(`${server.origin}/overrides/screen-a`, init);
      assert.equal(response.status, status);
      assert.equal(
        ((await response.json()) as { error: { code: string } }).error.code,
        code,
      );
    }
    assert.equal(controller.requests.length, 0);
  });
});

describe('bounded paths and resources', () => {
  test('refuses traversal, malformed encoding, excessive paths, queries, and duplicate keys', async () => {
    const controller = new FixtureController();
    const server = await startFixture(controller);
    const paths = [
      '/assets/v1/%2e%2e',
      '/assets/v1/%2fetc',
      '/assets/v1/%5cetc',
      '/assets/v1/%ZZ',
      `/display/${'a'.repeat(129)}`,
      `/display/screen-a?value=${'a'.repeat(257)}`,
      '/display/screen-a?date=one&date=two',
      `/display/screen-a?${Array.from({ length: 17 }, (_, index) => `k${index}=v`).join('&')}`,
    ];
    for (const path of paths) {
      const response = await fetch(`${server.origin}${path}`);
      assert.equal(response.status, 400, path);
    }
    assert.equal(controller.requests.length, 0);
  });

  test('serves only injected allowlisted resources and caches only versioned paths', async () => {
    const controller = new FixtureController();
    const server = await startFixture(controller);
    const asset = await fetch(`${server.origin}/assets/build-1/app.css`);
    assert.equal(asset.status, 200);
    assert.equal(await asset.text(), 'body{}');
    assert.equal(
      asset.headers.get('cache-control'),
      'public, max-age=31536000, immutable',
    );
    assert.equal(asset.headers.get('content-type'), 'text/css');

    const unversioned = await fetch(`${server.origin}/assets/app.css`);
    assert.equal(unversioned.status, 200);
    assert.equal(unversioned.headers.get('cache-control'), 'no-store');
    assert.equal(
      (await fetch(`${server.origin}/assets/build-1/missing.css`)).status,
      404,
    );
  });

  test('serves full, HEAD, open, bounded, and suffix media ranges plus 416', async () => {
    const controller = new FixtureController();
    const server = await startFixture(controller);
    const full = await fetch(`${server.origin}/media/build-1/dismissal.mp4`);
    assert.equal(full.status, 200);
    assert.deepEqual(
      new Uint8Array(await full.arrayBuffer()),
      Uint8Array.from([0, 1, 2, 3, 4, 5]),
    );
    assert.equal(full.headers.get('accept-ranges'), 'bytes');
    assert.equal(
      full.headers.get('cache-control'),
      'public, max-age=31536000, immutable',
    );

    const head = await fetch(`${server.origin}/media/dismissal.mp4`, {
      method: 'HEAD',
    });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get('content-length'), '6');
    assert.equal(await head.text(), '');
    assert.equal(head.headers.get('cache-control'), 'no-store');

    const ranges: ReadonlyArray<readonly [string, readonly number[], string]> =
      [
        ['bytes=1-3', [1, 2, 3], 'bytes 1-3/6'],
        ['bytes=3-', [3, 4, 5], 'bytes 3-5/6'],
        ['bytes=-2', [4, 5], 'bytes 4-5/6'],
        ['bytes=4-99', [4, 5], 'bytes 4-5/6'],
      ];
    for (const [range, expected, contentRange] of ranges) {
      const response = await fetch(`${server.origin}/media/dismissal.mp4`, {
        headers: { range },
      });
      assert.equal(response.status, 206, range);
      assert.deepEqual(
        [...new Uint8Array(await response.arrayBuffer())],
        expected,
      );
      assert.equal(response.headers.get('content-range'), contentRange);
    }
    for (const range of [
      'bytes=7-8',
      'bytes=4-2',
      'bytes=0-1,3-4',
      'items=0-1',
    ]) {
      const response = await fetch(`${server.origin}/media/dismissal.mp4`, {
        headers: { range },
      });
      assert.equal(response.status, 416, range);
      assert.equal(response.headers.get('content-range'), 'bytes */6');
      assert.equal(
        ((await response.json()) as { error: { code: string } }).error.code,
        'range_not_satisfiable',
      );
    }
  });

  test('returns injected QR PNG bytes only for the scoped request', async () => {
    const controller = new FixtureController();
    const server = await startFixture(controller);
    const response = await fetch(`${server.origin}/qr/screen-a/meeting-a.png`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/png');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(
      [...new Uint8Array(await response.arrayBuffer())],
      [137, 80, 78, 71],
    );
    assert.deepEqual(controller.requests.at(-1), {
      kind: 'qr',
      screenId: 'screen-a',
      meetingId: 'meeting-a',
      query: {},
    });
  });
});

describe('failure and lifecycle behavior', () => {
  test('accepts either explicit IPv4 or IPv6 loopback and never a non-loopback host', async () => {
    const controller = new FixtureController();
    const server = await startFixture(controller, { host: '::1' });
    assert.equal(server.host, '::1');
    assert.match(server.origin, /^http:\/\/\[::1\]:\d+$/);
    assert.equal((await fetch(`${server.origin}/health`)).status, 200);
    await assert.rejects(
      startClassroomHttpServer({
        ...baseOptions(controller),
        host: '0.0.0.0' as '127.0.0.1',
      }),
      TypeError,
    );
  });

  test('uses stable redacted 404 and generic 500 envelopes', async () => {
    const controller = new FixtureController();
    controller.responder = (request) => {
      if (request.kind === 'target')
        throw new Error('private implementation detail');
      return undefined;
    };
    const server = await startFixture(controller);
    const missing = await fetch(`${server.origin}/display/unknown`);
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), {
      error: {
        code: 'not_found',
        message: 'The requested resource was not found.',
      },
    });
    const failed = await fetch(`${server.origin}/target/screen-a`);
    assert.equal(failed.status, 500);
    const failureText = await failed.text();
    assert.deepEqual(JSON.parse(failureText), {
      error: {
        code: 'internal_error',
        message: 'The request could not be completed.',
      },
    });
    assert.equal(failureText.includes('private implementation detail'), false);
  });

  test('fails closed when a redirect target is not safe HTTPS', async () => {
    const controller = new FixtureController();
    controller.responder = () => ({
      kind: 'redirect',
      location: 'http://attendance.example.test/check-in',
    });
    const server = await startFixture(controller);
    const response = await fetch(`${server.origin}/go/check-in/algebra-a`, {
      redirect: 'manual',
    });
    assert.equal(response.status, 500);
    assert.equal(
      ((await response.json()) as { error: { code: string } }).error.code,
      'internal_error',
    );
  });

  test('bounds controller execution, aborts its signal, and closes idempotently', async () => {
    const controller = new FixtureController();
    let observedSignal: AbortSignal | undefined;
    controller.responder = (_request, signal) => {
      observedSignal = signal;
      return new Promise(() => undefined);
    };
    const server = await startFixture(controller, { requestTimeoutMs: 100 });
    const started = Date.now();
    const response = await fetch(`${server.origin}/health`);
    assert.equal(response.status, 504);
    assert.ok(Date.now() - started < 1_000);
    assert.equal(observedSignal?.aborted, true);
    await server.close();
    await server.close();
    runningServers.splice(runningServers.indexOf(server), 1);
  });

  test('rejects unsafe startup authority, resource, and compatibility configuration', async () => {
    const controller = new FixtureController();
    await assert.rejects(
      startClassroomHttpServer(
        baseOptions(controller, { mutationToken: 'short' }),
      ),
      TypeError,
    );
    await assert.rejects(
      startClassroomHttpServer(
        baseOptions(controller, {
          assets: {
            '../escape': {
              bytes: Uint8Array.from([]),
              contentType: 'text/plain',
            },
          },
        }),
      ),
      TypeError,
    );
    await assert.rejects(
      startClassroomHttpServer(
        baseOptions(controller, {
          displayCompatibilityPaths: { '/tv/../x': 'screen-a' },
        }),
      ),
      TypeError,
    );
    await assert.rejects(
      startClassroomHttpServer(
        baseOptions(controller, { legacyRouteCompatibility: true }),
      ),
      /requires the exact legacy routePrefix/u,
    );
    await assert.rejects(
      startClassroomHttpServer(
        baseOptions(controller, {
          routePrefix: '/classroom-screen',
          screenIdAliases: { '../b407': 'screen-b407' },
        }),
      ),
      TypeError,
    );
  });
});

async function startFixture(
  controller: ClassroomHttpController,
  overrides: Partial<ClassroomHttpServerOptions> = {},
): Promise<RunningClassroomHttpServer> {
  const server = await startClassroomHttpServer(
    baseOptions(controller, overrides),
  );
  runningServers.push(server);
  return server;
}

function baseOptions(
  controller: ClassroomHttpController,
  overrides: Partial<ClassroomHttpServerOptions> = {},
): ClassroomHttpServerOptions {
  return {
    controller,
    mutationToken: authority,
    media: {
      'dismissal.mp4': {
        bytes: Uint8Array.from([0, 1, 2, 3, 4, 5]),
        contentType: 'video/mp4',
      },
    },
    assets: {
      'app.css': { bytes: Buffer.from('body{}'), contentType: 'text/css' },
    },
    displayCompatibilityPaths: { '/': 'screen-b407', '/tv': 'screen-b407' },
    ...overrides,
  };
}

async function rawRequest(
  server: RunningClassroomHttpServer,
  path: string,
  options: { readonly method: string },
): Promise<{
  readonly status: number | undefined;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
}> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        host: server.host,
        port: server.port,
        path,
        method: options.method,
      },
      (response) => {
        response.resume();
        response.once('end', () =>
          resolve({ status: response.statusCode, headers: response.headers }),
        );
      },
    );
    request.once('error', reject);
    request.end();
  });
}
