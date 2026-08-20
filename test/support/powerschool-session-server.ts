import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { gzipSync } from 'node:zlib';

export type SyntheticRoutineMode =
  | 'bell-session-rejected'
  | 'download'
  | 'foreign-origin'
  | 'foreign-path'
  | 'invalid-redirect'
  | 'many-requests'
  | 'no-classes'
  | 'normal'
  | 'oversize'
  | 'popup'
  | 'post'
  | 'service-worker'
  | 'stall'
  | 'status-forbidden'
  | 'status-oidc-bell-marker-missing'
  | 'status-oidc-redirect'
  | 'status-saml-redirect'
  | 'status-unauthorized'
  | 'teacher-redirect'
  | 'websocket';

export type SyntheticRepairFlow =
  | 'bad-password'
  | 'challenge-selection'
  | 'credentials-totp'
  | 'credentials-totp-post-return'
  | 'delayed-totp'
  | 'phone-approval'
  | 'try-another-totp'
  | 'unknown-challenge';

export interface SyntheticSessionRequest {
  readonly origin: 'foreign' | 'identity' | 'powerschool';
  readonly method: string;
  readonly path: string;
  readonly referer?: string;
  readonly userAgent?: string;
}

export interface RunningSyntheticPowerSchoolSessionServer {
  readonly powerSchoolOrigin: string;
  readonly identityOrigin: string;
  readonly foreignOrigin: string;
  readonly requests: readonly SyntheticSessionRequest[];
  close(): Promise<void>;
}

export async function startSyntheticPowerSchoolSessionServer(
  options: {
    readonly routineMode?: SyntheticRoutineMode;
    readonly bootstrapStalls?: boolean;
    readonly gzipIdentityPage?: boolean;
    readonly identityResponseBytes?: number;
    readonly bootstrapPopup?: boolean;
    readonly bootstrapResourceIframe?: boolean;
    readonly repairFlow?: SyntheticRepairFlow;
    readonly bindSessionToUserAgent?: boolean;
    readonly requireBrowserNavigationForBell?: boolean;
    readonly browserBellSubresource?: boolean;
    readonly browserBellResponseBytes?: number;
    readonly omitBellContentLength?: boolean;
  } = {},
): Promise<RunningSyntheticPowerSchoolSessionServer> {
  const requests: SyntheticSessionRequest[] = [];
  const sessionIdentity: { userAgent: string | undefined } = {
    userAgent: undefined,
  };
  const foreignServer = createServer((request, response) => {
    record(requests, 'foreign', request);
    respond(response, 200, page('Foreign', '<main>Foreign</main>'));
  });
  await listen(foreignServer, '127.0.0.3');
  const foreignOrigin = originFor(foreignServer);
  const identityServer = createServer((request, response) => {
    record(requests, 'identity', request);
    routeIdentity(request, response, {
      gzipPage: options.gzipIdentityPage === true,
      ...(options.identityResponseBytes === undefined
        ? {}
        : { responseBytes: options.identityResponseBytes }),
      ...(options.bootstrapPopup === true
        ? { popupOrigin: foreignOrigin }
        : {}),
      ...(options.bootstrapResourceIframe === true
        ? { resourceIframeOrigin: foreignOrigin }
        : {}),
      ...(options.repairFlow === undefined
        ? {}
        : { repairFlow: options.repairFlow }),
    });
  });
  await listen(identityServer, '127.0.0.2');
  const identityOrigin = originFor(identityServer);
  const powerSchoolServer = createServer((request, response) => {
    record(requests, 'powerschool', request);
    routePowerSchool(request, response, {
      powerSchoolOrigin: originFor(powerSchoolServer),
      identityOrigin,
      routineMode: options.routineMode ?? 'normal',
      bootstrapStalls: options.bootstrapStalls === true,
      bindSessionToUserAgent: options.bindSessionToUserAgent === true,
      requireBrowserNavigationForBell:
        options.requireBrowserNavigationForBell === true,
      browserBellSubresource: options.browserBellSubresource === true,
      ...(options.browserBellResponseBytes === undefined
        ? {}
        : { browserBellResponseBytes: options.browserBellResponseBytes }),
      omitBellContentLength: options.omitBellContentLength === true,
      sessionIdentity,
    });
  });
  await listen(powerSchoolServer, '127.0.0.1');
  return {
    powerSchoolOrigin: originFor(powerSchoolServer),
    identityOrigin,
    foreignOrigin,
    requests,
    close: async () => {
      await Promise.all([
        close(powerSchoolServer),
        close(identityServer),
        close(foreignServer),
      ]);
    },
  };
}

function routePowerSchool(
  request: IncomingMessage,
  response: ServerResponse,
  options: {
    readonly powerSchoolOrigin: string;
    readonly identityOrigin: string;
    readonly routineMode: SyntheticRoutineMode;
    readonly bootstrapStalls: boolean;
    readonly bindSessionToUserAgent: boolean;
    readonly requireBrowserNavigationForBell: boolean;
    readonly browserBellSubresource: boolean;
    readonly browserBellResponseBytes?: number;
    readonly omitBellContentLength: boolean;
    readonly sessionIdentity: { userAgent: string | undefined };
  },
): void {
  const url = new URL(request.url ?? '/', options.powerSchoolOrigin);
  if (
    request.method !== 'GET' &&
    request.method !== 'HEAD' &&
    !(url.pathname === '/auth/callback' && request.method === 'POST')
  ) {
    request.resume();
    respond(response, 405, page('Method rejected', '<main>Rejected</main>'));
    return;
  }
  if (url.pathname === '/status' || url.pathname === '/teachers/home.html') {
    if (!hasBoundSession(request, options)) {
      redirect(response, '/login');
      return;
    }
    if (options.routineMode === 'status-unauthorized') {
      respond(response, 401, page('Unauthorized', '<main>Unauthorized</main>'));
      return;
    }
    if (options.routineMode === 'status-forbidden') {
      respond(response, 403, page('Forbidden', '<main>Forbidden</main>'));
      return;
    }
    if (options.routineMode === 'invalid-redirect') {
      redirect(response, 'javascript:blocked');
      return;
    }
    if (options.routineMode === 'status-saml-redirect') {
      redirect(response, '/saml/start');
      return;
    }
    if (
      options.routineMode === 'status-oidc-redirect' ||
      options.routineMode === 'status-oidc-bell-marker-missing'
    ) {
      redirect(response, '/oidc/openid_connect_login?private=discarded');
      return;
    }
    if (options.routineMode === 'teacher-redirect') {
      redirect(response, '/teachers/landing.html');
      return;
    }
    if (options.routineMode === 'stall') return;
    if (options.routineMode === 'foreign-origin') {
      redirect(response, `${options.identityOrigin}/unexpected`);
      return;
    }
    if (options.routineMode === 'foreign-path') {
      redirect(response, '/unexpected');
      return;
    }
    response.setHeader(
      'set-cookie',
      'synthetic_powerschool_session=refreshed; HttpOnly; SameSite=Lax; Path=/',
    );
    respond(response, 200, statusPage(options.routineMode));
    return;
  }
  if (
    (url.pathname === '/bell' ||
      url.pathname === '/teachers/aet_schedulebell.html') &&
    url.searchParams.has('target_date')
  ) {
    if (options.routineMode === 'bell-session-rejected') {
      redirect(response, '/login');
      return;
    }
    if (!hasBoundSession(request, options)) {
      if (options.bootstrapStalls) return;
      redirect(response, '/login');
      return;
    }
    if (
      options.requireBrowserNavigationForBell &&
      request.headers['sec-fetch-mode'] !== 'navigate'
    ) {
      redirect(response, '/login');
      return;
    }
    const body = bellPage(
      url.searchParams.get('target_date') ?? '',
      options.routineMode,
      options.browserBellSubresource,
      options.browserBellResponseBytes,
    );
    if (options.omitBellContentLength)
      respondWithoutLength(response, 200, body);
    else respond(response, 200, body);
    return;
  }
  if (url.pathname === '/login') {
    const callback = new URL('/auth/callback', options.powerSchoolOrigin);
    const identity = new URL('/authorize', options.identityOrigin);
    identity.searchParams.set('return', callback.href);
    redirect(response, identity.href);
    return;
  }
  if (url.pathname === '/auth/callback') {
    request.resume();
    if (options.bindSessionToUserAgent) {
      options.sessionIdentity.userAgent = request.headers['user-agent'];
    }
    response.setHeader(
      'set-cookie',
      'synthetic_powerschool_session=valid; HttpOnly; SameSite=Lax; Path=/',
    );
    respond(
      response,
      200,
      page(
        'Synthetic PowerSchool callback',
        `<script>localStorage.setItem('synthetic_powerschool_storage','powerschool-only');location.replace('/bell?target_date=04/13/2035')</script>`,
      ),
    );
    return;
  }
  respond(response, 404, page('Not found', '<main>Not found</main>'));
}

function hasBoundSession(
  request: IncomingMessage,
  options: {
    readonly bindSessionToUserAgent: boolean;
    readonly sessionIdentity: { userAgent: string | undefined };
  },
): boolean {
  return (
    hasSession(request) &&
    (!options.bindSessionToUserAgent ||
      (options.sessionIdentity.userAgent !== undefined &&
        request.headers['user-agent'] === options.sessionIdentity.userAgent))
  );
}

function routeIdentity(
  request: IncomingMessage,
  response: ServerResponse,
  options: {
    readonly gzipPage: boolean;
    readonly responseBytes?: number;
    readonly popupOrigin?: string;
    readonly resourceIframeOrigin?: string;
    readonly repairFlow?: SyntheticRepairFlow;
  },
): void {
  const origin = `http://${request.headers.host ?? '127.0.0.2'}`;
  const url = new URL(request.url ?? '/', origin);
  if (options.repairFlow !== undefined) {
    routeRepairIdentity(
      request,
      response,
      url,
      options.repairFlow,
      options.popupOrigin,
      options.resourceIframeOrigin,
    );
    return;
  }
  if (url.pathname !== '/authorize' || request.method !== 'GET') {
    respond(response, 404, page('Not found', '<main>Not found</main>'));
    return;
  }
  response.setHeader(
    'set-cookie',
    'synthetic_identity_session=present; Max-Age=3600; HttpOnly; SameSite=Lax; Path=/',
  );
  if (options.responseBytes !== undefined) {
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    });
    response.end('x'.repeat(options.responseBytes));
    return;
  }
  const body = page(
    'Synthetic identity',
    `<script>localStorage.setItem('synthetic_identity_storage','identity-only');${options.popupOrigin === undefined ? '' : `window.open(${JSON.stringify(`${options.popupOrigin}/popup`)},'_blank');`}location.replace(${JSON.stringify(url.searchParams.get('return') ?? '/unexpected')})</script>`,
  );
  if (options.gzipPage) {
    const compressed = gzipSync(body);
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'content-encoding': 'gzip',
      'content-length': compressed.byteLength,
      'cache-control': 'no-store',
    });
    response.end(compressed);
    return;
  }
  respond(response, 200, body);
}

function routeRepairIdentity(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  flow: SyntheticRepairFlow,
  popupOrigin?: string,
  resourceIframeOrigin?: string,
): void {
  const returnUrl = url.searchParams.get('return') ?? '/unexpected';
  const action = (path: string): string => {
    const next = new URL(path, url.origin);
    next.searchParams.set('return', returnUrl);
    return `${next.pathname}${next.search}`;
  };
  if (url.pathname === '/authorize' && request.method === 'GET') {
    if (hasIdentitySession(request)) {
      redirect(response, returnUrl);
      return;
    }
    response.setHeader(
      'set-cookie',
      'synthetic_identity_session=present; Max-Age=3600; HttpOnly; SameSite=Lax; Path=/',
    );
    respond(
      response,
      200,
      page(
        'Synthetic identity username',
        `<script>localStorage.setItem('synthetic_identity_storage','identity-only');${popupOrigin === undefined ? '' : `window.open(${JSON.stringify(`${popupOrigin}/popup`)},'_blank');`}</script>${resourceIframeOrigin === undefined ? '' : `<iframe src="${escapeHtml(`${resourceIframeOrigin}/resource-frame`)}"></iframe>`}<form method="post" action="${escapeHtml(action('/identifier'))}"><input name="identifier" type="email" autocomplete="username"><button id="identifierNext" type="submit">Next</button></form>`,
      ),
    );
    return;
  }
  if (url.pathname === '/identifier' && request.method === 'POST') {
    request.resume();
    if (flow === 'challenge-selection') {
      redirect(response, action('/challenge/selection/password'));
      return;
    }
    respond(
      response,
      200,
      page(
        'Synthetic identity password',
        `<form method="post" action="${escapeHtml(action('/password'))}"><input name="Passwd" type="password" autocomplete="current-password"><button id="passwordNext" type="submit">Next</button></form>`,
      ),
    );
    return;
  }
  if (
    url.pathname === '/challenge/selection/password' &&
    request.method === 'GET'
  ) {
    respond(
      response,
      200,
      page(
        'Synthetic identity challenge selection',
        `<main>Choose how you want to sign in</main><a href="${escapeHtml(action('/challenge/pwd'))}">Enter your password</a>`,
      ),
    );
    return;
  }
  if (url.pathname === '/challenge/pwd' && request.method === 'GET') {
    respond(
      response,
      200,
      page(
        'Synthetic identity password',
        `<form method="post" action="${escapeHtml(action('/password'))}"><input name="Passwd" type="password" autocomplete="current-password"><button id="passwordNext" type="submit">Next</button></form>`,
      ),
    );
    return;
  }
  if (url.pathname === '/password' && request.method === 'POST') {
    request.resume();
    if (flow === 'bad-password') {
      respond(
        response,
        200,
        page('Synthetic identity rejected', '<main>Wrong password</main>'),
      );
      return;
    }
    if (flow === 'unknown-challenge') {
      respond(
        response,
        200,
        page(
          'Synthetic identity challenge',
          '<main>Insert your security key to continue</main>',
        ),
      );
      return;
    }
    if (flow === 'phone-approval') {
      respond(
        response,
        200,
        page(
          'Synthetic phone approval',
          `<main>Check your phone and tap Yes</main><script>setTimeout(()=>location.replace(${JSON.stringify(returnUrl)}),1000)</script>`,
        ),
      );
      return;
    }
    if (flow === 'delayed-totp') {
      const delayedForm = `<form method="post" action="${escapeHtml(action('/totp'))}"><input name="totpPin" type="tel" autocomplete="one-time-code"><button type="submit">Next</button></form>`;
      respond(
        response,
        200,
        page(
          'Synthetic delayed identity transition',
          `<main>Loading the next identity step</main><script>setTimeout(()=>{document.body.innerHTML=${JSON.stringify(delayedForm)}},2500)</script>`,
        ),
      );
      return;
    }
    if (flow === 'challenge-selection') {
      redirect(response, action('/challenge/selection/totp'));
      return;
    }
    if (flow === 'try-another-totp') {
      redirect(response, action('/challenge/security-key'));
      return;
    }
    respond(
      response,
      200,
      page(
        'Synthetic authenticator',
        `<form method="post" action="${escapeHtml(action('/totp'))}"><input name="totpPin" type="tel" autocomplete="one-time-code"><button type="submit">Next</button></form>`,
      ),
    );
    return;
  }
  if (url.pathname === '/challenge/security-key' && request.method === 'GET') {
    respond(
      response,
      200,
      page(
        'Synthetic alternate challenge',
        `<main>Use your security key</main><a href="${escapeHtml(action('/challenge/selection/totp'))}">Try another way</a>`,
      ),
    );
    return;
  }
  if (
    url.pathname === '/challenge/selection/totp' &&
    request.method === 'GET'
  ) {
    respond(
      response,
      200,
      page(
        'Synthetic authenticator selection',
        `<main>Choose another option</main><a href="${escapeHtml(action('/challenge/totp'))}">Authenticator</a>`,
      ),
    );
    return;
  }
  if (url.pathname === '/challenge/totp' && request.method === 'GET') {
    respond(
      response,
      200,
      page(
        'Synthetic authenticator',
        `<form method="post" action="${escapeHtml(action('/totp'))}"><input name="totpPin" type="tel" autocomplete="one-time-code"><button type="submit">Next</button></form>`,
      ),
    );
    return;
  }
  if (url.pathname === '/totp' && request.method === 'POST') {
    request.resume();
    if (flow === 'credentials-totp-post-return') {
      respond(
        response,
        200,
        page(
          'Synthetic identity accepted',
          `<form method="post" action="${escapeHtml(returnUrl)}"><input type="hidden" name="synthetic_assertion" value="accepted"></form><script>document.forms[0].submit()</script>`,
        ),
      );
      return;
    }
    respond(
      response,
      200,
      page(
        'Synthetic identity accepted',
        `<script>location.replace(${JSON.stringify(returnUrl)})</script>`,
      ),
    );
    return;
  }
  respond(response, 404, page('Not found', '<main>Not found</main>'));
}

function statusPage(mode: SyntheticRoutineMode): string {
  const bellPath = '/bell?target_date=04/13/2035';
  let behavior = '';
  switch (mode) {
    case 'post':
      behavior =
        '<form method="post" action="/status"></form><script>document.forms[0].submit()</script>';
      break;
    case 'websocket':
      behavior =
        '<script>new WebSocket(`ws://${location.host}/bell?target_date=04/13/2035`)</script>';
      break;
    case 'popup':
      behavior = `<script>window.open(${JSON.stringify(bellPath)})</script>`;
      break;
    case 'download':
      behavior = `<a id="download" download href="${bellPath}">download</a><script>document.querySelector('#download').click()</script>`;
      break;
    case 'service-worker':
      behavior = `<script>navigator.serviceWorker?.register(${JSON.stringify(bellPath)}).catch(() => undefined)</script>`;
      break;
    case 'many-requests':
      behavior = `<script>Promise.all(Array.from({length:12},()=>fetch('/status',{cache:'no-store'}))).catch(() => undefined)</script>`;
      break;
    case 'oversize':
      behavior = `<p>${'x'.repeat(32 * 1024)}</p>`;
      break;
    case 'foreign-origin':
    case 'foreign-path':
    case 'bell-session-rejected':
    case 'no-classes':
    case 'normal':
    case 'stall':
      break;
  }
  return page(
    'Synthetic PowerSchool status',
    `<main id="status-ready">Synthetic Academy status</main>${behavior}`,
  );
}

function bellPage(
  date: string,
  mode: SyntheticRoutineMode,
  includeSubresource = false,
  responseBytes?: number,
): string {
  const periods =
    mode === 'no-classes'
      ? '<table><tr><th dayindex="6">Friday<br>04/13/2035<br>Synthetic Academy Bell Schedule</th></tr></table><div class="aet_day" dayindex="6"></div>'
      : '<table><tr><td>Period 1</td><td>08:00 AM - 08:45 AM</td></tr><tr><td>Period 2</td><td>08:50 AM - 09:35 AM</td></tr></table>';
  return page(
    'Synthetic Academy bell schedule Friday April 13, 2035',
    `<main${mode === 'status-oidc-bell-marker-missing' ? '' : ' id="bell-ready"'}><h1>Synthetic Academy — Friday, April 13, 2035 Bell Schedule</h1>${periods}<span data-date="${escapeHtml(date)}"></span>${includeSubresource ? '<img src="/browser-native-subresource" alt="">' : ''}${responseBytes === undefined ? '' : `<p>${'x'.repeat(responseBytes)}</p>`}</main>`,
  );
}

function hasSession(request: IncomingMessage): boolean {
  return (request.headers.cookie ?? '')
    .split(';')
    .some((part) =>
      [
        'synthetic_powerschool_session=valid',
        'synthetic_powerschool_session=refreshed',
      ].includes(part.trim()),
    );
}

function hasIdentitySession(request: IncomingMessage): boolean {
  return (request.headers.cookie ?? '')
    .split(';')
    .some((part) => part.trim() === 'synthetic_identity_session=present');
}

function record(
  requests: SyntheticSessionRequest[],
  origin: SyntheticSessionRequest['origin'],
  request: IncomingMessage,
): void {
  requests.push({
    origin,
    method: request.method ?? '',
    path: request.url ?? '/',
    ...(typeof request.headers.referer === 'string'
      ? { referer: request.headers.referer }
      : {}),
    ...(typeof request.headers['user-agent'] === 'string'
      ? { userAgent: request.headers['user-agent'] }
      : {}),
  });
}

async function listen(server: Server, host: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, resolve);
  });
}

function originFor(server: Server): string {
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('synthetic-server-address-unavailable');
  }
  return `http://${address.address}:${address.port}`;
}

async function close(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}

function redirect(
  response: ServerResponse,
  location: string,
  status = 302,
): void {
  response.writeHead(status, { location, 'cache-control': 'no-store' });
  response.end();
}

function respond(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  response.end(body);
}

function respondWithoutLength(
  response: ServerResponse,
  status: number,
  body: string,
): void {
  response.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(body);
}

function page(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body>${body}</body></html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}
