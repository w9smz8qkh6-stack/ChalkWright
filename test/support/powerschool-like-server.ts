import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import type {
  PassiveBrowserResourceRule,
  PassiveBrowserRouteRule,
} from '../../src/infrastructure/powerschool/browser-read.js';
import {
  syntheticPowerSchoolScheduleBody,
  syntheticPowerSchoolScheduleTitle,
} from '../fixtures/powerschool-pages.js';

export interface SyntheticPowerSchoolRequest {
  readonly method: string;
  readonly path: string;
}

export interface RunningPowerSchoolLikeServer {
  readonly origin: string;
  readonly requests: readonly SyntheticPowerSchoolRequest[];
  readonly mutationAttempts: readonly SyntheticPowerSchoolRequest[];
  readonly readMutationAttempts: readonly SyntheticPowerSchoolRequest[];
  close(): Promise<void>;
}

export interface PowerSchoolLikeServerOptions {
  readonly hostileCrossOriginTarget?: string;
}

export async function startPowerSchoolLikeServer(
  options: PowerSchoolLikeServerOptions = {},
): Promise<RunningPowerSchoolLikeServer> {
  const requests: SyntheticPowerSchoolRequest[] = [];
  const mutationAttempts: SyntheticPowerSchoolRequest[] = [];
  const readMutationAttempts: SyntheticPowerSchoolRequest[] = [];
  const server = createServer((request, response) => {
    const method = request.method ?? '';
    const url = new URL(request.url ?? '/', 'http://synthetic.invalid');
    const record = { method, path: url.pathname };
    requests.push(record);
    if (method !== 'GET' && method !== 'HEAD') {
      mutationAttempts.push(record);
      respond(
        response,
        405,
        '<main data-state="mutation-rejected">Method not allowed</main>',
      );
      return;
    }
    if (url.pathname === '/unexpected-get-mutation') {
      readMutationAttempts.push(record);
      respond(
        response,
        405,
        '<main data-state="read-mutation-rejected">Unsafe GET rejected</main>',
      );
      return;
    }
    routeRead(request, response, url, options);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    server.close();
    throw new Error('synthetic-server-address-unavailable');
  }
  return {
    origin: `http://127.0.0.1:${address.port}`,
    requests,
    mutationAttempts,
    readMutationAttempts,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) =>
          error === undefined ? resolve() : reject(error),
        );
      });
    },
  };
}

function routeRead(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  options: PowerSchoolLikeServerOptions,
): void {
  if (url.pathname === '/session/valid') {
    response.setHeader(
      'set-cookie',
      'synthetic_session=valid; HttpOnly; SameSite=Strict; Path=/',
    );
    redirect(response, '/schedule/static');
    return;
  }
  if (url.pathname === '/session/expired') {
    response.setHeader(
      'set-cookie',
      'synthetic_session=expired; HttpOnly; SameSite=Strict; Path=/',
    );
    redirect(response, '/schedule/static');
    return;
  }
  if (url.pathname.startsWith('/schedule/')) {
    if (!hasValidSession(request)) {
      redirect(response, '/login');
      return;
    }
    if (url.pathname === '/schedule/static') {
      respond(
        response,
        200,
        scheduleMarkup('static', url.searchParams.get('date')),
      );
      return;
    }
    if (url.pathname === '/schedule/2035-04-13') {
      respond(response, 200, scheduleMarkup('static', '2035-04-13'));
      return;
    }
    if (url.pathname === '/schedule/dynamic') {
      respond(
        response,
        200,
        page(
          'Synthetic dynamic schedule',
          '<meta name="powerschool-render" content="browser"><main id="schedule-root">Loading synthetic schedule</main>',
          `<script>setTimeout(() => { const root = document.getElementById('schedule-root'); root.dataset.powerschoolReady = 'true'; root.innerHTML = ${JSON.stringify(syntheticPowerSchoolScheduleBody('dynamic', url.searchParams.get('date')))}; }, 20);</script>`,
        ),
      );
      return;
    }
  }
  if (url.pathname === '/assets/schedule.css') {
    respondTyped(
      response,
      200,
      'text/css; charset=utf-8',
      'main { display: block; }',
    );
    return;
  }
  if (url.pathname === '/login') {
    respond(
      response,
      200,
      page(
        'Synthetic login required',
        '<main data-auth-state="login-required"><form method="post"><button>Sign in manually</button></form></main>',
      ),
    );
    return;
  }
  if (url.pathname === '/sso') {
    respond(
      response,
      200,
      page(
        'Synthetic SSO blocker',
        '<main data-auth-state="sso-required">Manual SSO repair required</main>',
      ),
    );
    return;
  }
  if (url.pathname === '/manual') {
    respond(
      response,
      200,
      page(
        'Synthetic manual blocker',
        '<main data-auth-state="manual-required">Manual challenge required</main>',
      ),
    );
    return;
  }
  if (url.pathname === '/hostile') {
    const crossOriginTarget =
      options.hostileCrossOriginTarget ?? 'https://cross-origin.invalid/read';
    respond(
      response,
      200,
      page(
        'Synthetic hostile page',
        '<main id="hostile-ready">Hostile attempts scheduled</main>',
        `<script src="/assets/schedule.css"></script><script>
          fetch('/unexpected-mutation', { method: 'POST', body: 'synthetic' }).catch(() => {});
          fetch('/unexpected-get-mutation').catch(() => {});
          fetch(${JSON.stringify(crossOriginTarget)}).catch(() => {});
        </script>`,
      ),
    );
    return;
  }
  if (url.pathname === '/delayed-script') {
    respond(
      response,
      200,
      page(
        'Synthetic delayed script',
        '<main data-powerschool-ready="true">Ready before delayed request</main>',
        `<script>setTimeout(() => { fetch('/delayed-allowed-resource').catch(() => {}); }, 250);</script>`,
      ),
    );
    return;
  }
  if (url.pathname === '/timeout-delayed-script') {
    respond(
      response,
      200,
      page(
        'Synthetic timeout script',
        '<main>Waiting beyond the read deadline</main>',
        `<script>setTimeout(() => { fetch('/delayed-allowed-resource').catch(() => {}); }, 1100);</script>`,
      ),
    );
    return;
  }
  if (url.pathname === '/delayed-allowed-resource') {
    respond(response, 200, '<main>Delayed resource reached server</main>');
    return;
  }
  if (url.pathname === '/delay') {
    const requested = Number(url.searchParams.get('ms') ?? '0');
    const delay = Number.isFinite(requested)
      ? Math.max(0, Math.min(3_000, requested))
      : 0;
    setTimeout(
      () => respond(response, 200, page('Delayed', '<main>Delayed</main>')),
      delay,
    );
    return;
  }
  if (url.pathname === '/large') {
    const requested = Number(url.searchParams.get('bytes') ?? '0');
    const size = Number.isFinite(requested)
      ? Math.max(0, Math.min(3 * 1024 * 1024, requested))
      : 0;
    respond(response, 200, page('Large', `<main>${'x'.repeat(size)}</main>`));
    return;
  }
  if (url.pathname === '/large-chunked') {
    const requested = Number(url.searchParams.get('bytes') ?? '0');
    const size = Number.isFinite(requested)
      ? Math.max(0, Math.min(3 * 1024 * 1024, requested))
      : 0;
    respondChunked(response, size);
    return;
  }
  respond(response, 404, page('Not found', '<main>Not found</main>'));
}

function hasValidSession(request: IncomingMessage): boolean {
  return (request.headers.cookie ?? '')
    .split(';')
    .some((part) => part.trim() === 'synthetic_session=valid');
}

function scheduleMarkup(kind: 'static', requestedDate: string | null): string {
  return page(
    syntheticPowerSchoolScheduleTitle,
    `<link rel="stylesheet" href="/assets/schedule.css"><main data-powerschool-ready="true">${syntheticPowerSchoolScheduleBody(kind, requestedDate)}</main>`,
  );
}

function redirect(response: ServerResponse, location: string): void {
  response.writeHead(302, { location, 'cache-control': 'no-store' });
  response.end();
}

function respond(response: ServerResponse, status: number, body: string): void {
  respondTyped(response, status, 'text/html; charset=utf-8', body);
}

function respondTyped(
  response: ServerResponse,
  status: number,
  contentType: string,
  body: string,
): void {
  response.writeHead(status, {
    'content-type': contentType,
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  });
  response.end(body);
}

function respondChunked(response: ServerResponse, size: number): void {
  response.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'transfer-encoding': 'chunked',
  });
  response.write('<!doctype html><html><body><main>');
  let remaining = size;
  const write = (): void => {
    if (remaining <= 0 || response.destroyed) {
      if (!response.destroyed) response.end('</main></body></html>');
      return;
    }
    const count = Math.min(512, remaining);
    remaining -= count;
    response.write('x'.repeat(count));
    setTimeout(write, 1);
  };
  write();
}

function page(title: string, body: string, script = ''): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body>${body}${script}</body></html>`;
}

export function syntheticPowerSchoolBrowserPolicy(): {
  readonly allowedRoutes: readonly PassiveBrowserRouteRule[];
  readonly allowedResources: readonly PassiveBrowserResourceRule[];
} {
  return {
    allowedRoutes: [
      { pathTemplate: '/session/valid' },
      { pathTemplate: '/session/expired' },
      { pathTemplate: '/schedule/static' },
      { pathTemplate: '/schedule/static?date={date}' },
      { pathTemplate: '/schedule/{date}' },
      { pathTemplate: '/schedule/dynamic' },
      { pathTemplate: '/schedule/dynamic?date={date}' },
      { pathTemplate: '/schedule/dynamic#{date}' },
      { pathTemplate: '/login' },
      { pathTemplate: '/sso' },
      { pathTemplate: '/manual' },
      { pathTemplate: '/hostile' },
      { pathTemplate: '/delayed-script' },
      { pathTemplate: '/timeout-delayed-script' },
      { pathTemplate: '/delay?ms=2500' },
      { pathTemplate: '/delay?ms=700' },
      { pathTemplate: '/large?bytes=2048' },
      { pathTemplate: '/large-chunked?bytes=2048' },
    ],
    allowedResources: [
      {
        pathTemplate: '/assets/schedule.css',
        resourceTypes: ['stylesheet'],
      },
      {
        pathTemplate: '/delayed-allowed-resource',
        resourceTypes: ['fetch'],
      },
    ],
  };
}
