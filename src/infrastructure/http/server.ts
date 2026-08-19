import { createHash, timingSafeEqual } from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';

import type {
  ClassroomHttpControllerRequest,
  ClassroomHttpControllerResult,
  ClassroomHttpServerOptions,
  HttpBinaryResource,
  HttpQuery,
  RunningClassroomHttpServer,
} from './types.js';

const DEFAULT_LOOPBACK_HOST = '127.0.0.1' as const;
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_GRACEFUL_CLOSE_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_BODY_BYTES = 32 * 1_024;
const MAX_URL_BYTES = 2_048;
const MAX_PATH_BYTES = 1_024;
const MAX_QUERY_BYTES = 1_024;
const MAX_QUERY_ENTRIES = 16;
const MAX_QUERY_COMPONENT_BYTES = 256;
const MAX_SEGMENT_BYTES = 128;
const MAX_RESOURCE_BYTES = 128 * 1_024 * 1_024;
const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';
const NO_STORE = 'no-store';
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._~-]*$/;
const URL_CREDENTIAL_KEYS = new Set([
  'access_token',
  'api_key',
  'authorization',
  'bearer',
  'token',
]);

type HttpMethod = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'DELETE';

type MatchedRoute =
  | {
      readonly type: 'controller';
      readonly allow: readonly HttpMethod[];
      readonly mutation: boolean;
      readonly body: boolean;
      readonly expected: 'general' | 'qr' | 'redirect';
      build(body: unknown): ClassroomHttpControllerRequest;
    }
  | {
      readonly type: 'resource';
      readonly allow: readonly HttpMethod[];
      readonly family: 'asset' | 'media';
      readonly name: string;
      readonly versioned: boolean;
    };

class HttpProtocolError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly publicMessage: string,
    readonly headers: Readonly<Record<string, string>> = {},
  ) {
    super(code);
    this.name = 'HttpProtocolError';
  }
}

export async function startClassroomHttpServer(
  options: ClassroomHttpServerOptions,
): Promise<RunningClassroomHttpServer> {
  const requestTimeoutMs = positiveBoundedInteger(
    options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    100,
    120_000,
    'requestTimeoutMs',
  );
  const gracefulCloseTimeoutMs = positiveBoundedInteger(
    options.gracefulCloseTimeoutMs ?? DEFAULT_GRACEFUL_CLOSE_TIMEOUT_MS,
    10,
    60_000,
    'gracefulCloseTimeoutMs',
  );
  const maxBodyBytes = positiveBoundedInteger(
    options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES,
    1,
    1_048_576,
    'maxBodyBytes',
  );
  const mutationToken =
    options.mutationToken === undefined
      ? undefined
      : validateMutationToken(options.mutationToken);
  const host = options.host ?? DEFAULT_LOOPBACK_HOST;
  if (host !== '127.0.0.1' && host !== '::1') {
    throw new TypeError('host must be an explicit loopback address.');
  }
  const media = validateResources(options.media);
  const assets = validateResources(options.assets);
  const compatibilityPaths = validateCompatibilityPaths(
    options.displayCompatibilityPaths ?? {},
  );
  const routePrefix = validateRoutePrefix(options.routePrefix);
  const screenIdAliases = validateScreenIdAliases(
    options.screenIdAliases ?? {},
  );
  const legacyRouteCompatibility = options.legacyRouteCompatibility === true;
  if (legacyRouteCompatibility && routePrefix !== '/classroom-screen')
    throw new TypeError(
      'legacyRouteCompatibility requires the exact legacy routePrefix.',
    );

  const server = createServer((request, response) => {
    void handleRequest({
      request,
      response,
      controller: options.controller,
      mutationToken,
      media,
      assets,
      compatibilityPaths,
      routePrefix,
      screenIdAliases,
      legacyRouteCompatibility,
      requestTimeoutMs,
      maxBodyBytes,
    });
  });
  server.requestTimeout = requestTimeoutMs;
  server.headersTimeout = Math.min(requestTimeoutMs, 5_000);
  server.keepAliveTimeout = Math.min(requestTimeoutMs, 5_000);
  server.maxRequestsPerSocket = 100;

  const requestedPort = options.port ?? 0;
  if (
    !Number.isSafeInteger(requestedPort) ||
    requestedPort < 0 ||
    requestedPort > 65_535
  ) {
    throw new RangeError('port must be an integer from 0 through 65535.');
  }
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => reject(error);
    server.once('error', onError);
    server.listen(requestedPort, host, () => {
      server.off('error', onError);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  let closed = false;
  return {
    host,
    port: address.port,
    origin: `http://${host === '::1' ? `[${host}]` : host}:${address.port}`,
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(
          () => server.closeAllConnections(),
          gracefulCloseTimeoutMs,
        );
        timer.unref();
        server.close(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    },
  };
}

async function handleRequest(options: {
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
  readonly controller: ClassroomHttpServerOptions['controller'];
  readonly mutationToken: string | undefined;
  readonly media: ReadonlyMap<string, HttpBinaryResource>;
  readonly assets: ReadonlyMap<string, HttpBinaryResource>;
  readonly compatibilityPaths: ReadonlyMap<string, string>;
  readonly routePrefix: '' | '/classroom-screen';
  readonly screenIdAliases: ReadonlyMap<string, string>;
  readonly legacyRouteCompatibility: boolean;
  readonly requestTimeoutMs: number;
  readonly maxBodyBytes: number;
}): Promise<void> {
  const { request, response } = options;
  setSecurityHeaders(response);
  try {
    const method = parseMethod(request.method);
    const requested = parseRequestTarget(request.url);
    // Root compatibility aliases are display-only. They remain available when
    // the broader legacy route family is mounted under `/classroom-screen`, so
    // a reverse proxy can serve the display at its root without exposing an
    // unprefixed API or mutation surface.
    const rootCompatibilityScreen = options.compatibilityPaths.get(
      requested.path,
    );
    const parsed =
      rootCompatibilityScreen === undefined
        ? applyRoutePrefix(requested, options.routePrefix)
        : requested;
    const compatibilityScreen =
      rootCompatibilityScreen ?? options.compatibilityPaths.get(parsed.path);
    const route =
      compatibilityScreen === undefined
        ? ((options.legacyRouteCompatibility
            ? matchLegacyRoute(
                parsed.segments,
                parsed.query,
                method,
                options.screenIdAliases,
              )
            : undefined) ??
          matchRoute(
            parsed.segments,
            parsed.query,
            method,
            options.screenIdAliases,
          ))
        : displayCompatibilityRoute(compatibilityScreen, parsed.query);
    if (route === undefined) throw protocolError(404, 'not_found');
    enforceMethod(method, route.allow);

    if (route.type === 'resource') {
      const resources =
        route.family === 'media' ? options.media : options.assets;
      const resource = resources.get(route.name);
      if (resource === undefined) throw protocolError(404, 'not_found');
      if (route.family === 'media') {
        sendMedia(request, response, method, resource, route.versioned);
      } else {
        sendBinary(
          response,
          method,
          resource,
          route.versioned ? IMMUTABLE_CACHE : NO_STORE,
        );
      }
      return;
    }

    if (route.mutation) authenticateMutation(request, options.mutationToken);
    const body = route.body
      ? await readRequestBody(request, options.maxBodyBytes)
      : undefined;
    const controllerRequest = route.build(body);
    const result = await callController(
      options.controller,
      controllerRequest,
      options.requestTimeoutMs,
    );
    if (result === undefined) throw protocolError(404, 'not_found');
    sendControllerResult(response, method, result, route.expected);
  } catch (error: unknown) {
    if (!response.headersSent) {
      const failure =
        error instanceof HttpProtocolError
          ? error
          : protocolError(500, 'internal_error');
      sendError(response, request.method === 'HEAD', failure);
    } else {
      response.destroy();
    }
  }
}

function validateRoutePrefix(
  value: ClassroomHttpServerOptions['routePrefix'],
): '' | '/classroom-screen' {
  if (value === undefined) return '';
  if (value !== '/classroom-screen')
    throw new TypeError('routePrefix must be the exact legacy mount point.');
  return value;
}

function applyRoutePrefix(
  parsed: ReturnType<typeof parseRequestTarget>,
  prefix: '' | '/classroom-screen',
): ReturnType<typeof parseRequestTarget> {
  if (prefix === '') return parsed;
  if (parsed.path !== prefix && !parsed.path.startsWith(`${prefix}/`))
    throw protocolError(404, 'not_found');
  const path = parsed.path === prefix ? '/' : parsed.path.slice(prefix.length);
  return {
    path,
    segments: path === '/' ? [] : path.slice(1).split('/'),
    query: parsed.query,
  };
}

function matchRoute(
  segments: readonly string[],
  query: HttpQuery,
  method: HttpMethod,
  screenIdAliases: ReadonlyMap<string, string> = new Map(),
): MatchedRoute | undefined {
  if (segments.length === 1) {
    const family = segments[0];
    if (family === 'displays')
      return readRoute(() => ({ kind: 'displays', query }));
    if (family === 'manifest.webmanifest')
      return readRoute(() => ({ kind: 'manifest', query }));
    if (family === 'health')
      return readRoute(() => ({ kind: 'health', query }));
    if (family === 'ready')
      return readRoute(() => ({ kind: 'readiness', query }));
  }

  const [family, first, second] = segments;
  if (segments.length === 2 && first !== undefined) {
    const screenId = resolveScreenId(first, screenIdAliases);
    if (family === 'display')
      return readRoute(() => ({ kind: 'display', screenId, query }));
    if (family === 'day-plan')
      return readRoute(() => ({ kind: 'day-plan', screenId, query }));
    if (family === 'target')
      return readRoute(() => ({ kind: 'target', screenId, query }));
    if (family === 'preview')
      return readRoute(() => ({ kind: 'preview', screenId, query }));
    if (family === 'overrides')
      return mutationRoute('overrides', screenId, query, method);
    if (family === 'hold')
      return mutationRoute('hold', screenId, query, method);
    if (family === 'media') return resourceRoute('media', first, false);
    if (family === 'assets') return resourceRoute('asset', first, false);
    if (family === 'attendance')
      return readRoute(() => ({
        kind: 'attendance.class',
        classId: first,
        query,
      }));
  }
  if (segments.length === 3 && first !== undefined && second !== undefined) {
    const screenId = resolveScreenId(first, screenIdAliases);
    if (family === 'qr' && second.endsWith('.png') && second.length > 4) {
      return {
        ...readRoute(() => ({
          kind: 'qr',
          screenId,
          meetingId: second.slice(0, -4),
          query,
        })),
        expected: 'qr',
      };
    }
    if (family === 'media') return resourceRoute('media', second, true);
    if (family === 'assets') return resourceRoute('asset', second, true);
    if (family === 'attendance' && first === 'current')
      return readRoute(() => ({
        kind: 'attendance.current',
        screenId: resolveScreenId(second, screenIdAliases),
        query,
      }));
    if (family === 'attendance' && first === 'diagnostics')
      return readRoute(() => ({
        kind: 'attendance.diagnostics',
        classId: second,
        query,
      }));
    if (family === 'attendance' && first === 'class')
      return readRoute(() => ({
        kind: 'attendance.class',
        classId: second,
        query,
      }));
    if (family === 'go') {
      return {
        ...readRoute(() => ({
          kind: 'attendance.redirect',
          target: first,
          classId: second,
          query,
        })),
        expected: 'redirect',
      };
    }
    if (family === 'overrides' && second === 'delete')
      return terminalMutationRoute('overrides', screenId, query, method);
    if (family === 'hold' && second === 'release')
      return terminalMutationRoute('hold', screenId, query, method);
  }
  return undefined;
}

function matchLegacyRoute(
  segments: readonly string[],
  query: HttpQuery,
  method: HttpMethod,
  screenIdAliases: ReadonlyMap<string, string>,
): MatchedRoute | undefined {
  if (segments.length === 1) {
    if (segments[0] === 'manifest.json')
      return readRoute(() => ({ kind: 'manifest', query }));
    if (segments[0] === 'icon.svg')
      return resourceRoute('asset', 'classroom-hub.svg', false);
  }
  if (segments[0] !== 'api') return undefined;
  if (segments.length === 2 && segments[1] === 'displays')
    return readRoute(() => ({ kind: 'displays', query }));
  const family = segments[1];
  const rawScreenId = segments[2];
  if (segments.length === 3 && rawScreenId !== undefined) {
    if (family === 'media') {
      if (rawScreenId === 'horse-video' || rawScreenId === 'dismissal-video')
        return resourceRoute('media', 'dismissal', false);
      return undefined;
    }
    const screenId = resolveScreenId(rawScreenId, screenIdAliases);
    if (family === 'day-plan')
      return readRoute(() => ({ kind: 'day-plan', screenId, query }));
    if (family === 'target')
      return readRoute(() => ({
        kind: 'target',
        screenId,
        query,
        simulation: true,
      }));
    if (family === 'preview')
      return readRoute(() => ({ kind: 'preview-data', screenId, query }));
    if (family === 'overrides')
      return mutationRoute('overrides', screenId, query, method);
  }
  if (
    segments.length === 4 &&
    family === 'qr' &&
    rawScreenId !== undefined &&
    segments[3] !== undefined
  ) {
    return {
      ...readRoute(() => ({
        kind: 'qr',
        screenId: resolveScreenId(rawScreenId, screenIdAliases),
        meetingId: segments[3] as string,
        query,
      })),
      expected: 'qr',
    };
  }
  return undefined;
}

function resolveScreenId(
  screenId: string,
  aliases: ReadonlyMap<string, string>,
): string {
  return aliases.get(screenId) ?? screenId;
}

function terminalMutationRoute(
  family: 'overrides' | 'hold',
  screenId: string,
  query: HttpQuery,
  method: HttpMethod,
): MatchedRoute {
  const bodyRequired = method === 'POST';
  return {
    type: 'controller',
    allow: ['POST', 'DELETE'],
    mutation: true,
    body: bodyRequired,
    expected: 'general',
    build(body): ClassroomHttpControllerRequest {
      const base = { screenId, query };
      if (bodyRequired) {
        return family === 'overrides'
          ? { kind: 'overrides.delete', ...base, body }
          : { kind: 'hold.delete', ...base, body };
      }
      return family === 'overrides'
        ? { kind: 'overrides.delete', ...base }
        : { kind: 'hold.delete', ...base };
    },
  };
}

function readRoute(
  build: () => ClassroomHttpControllerRequest,
): Extract<MatchedRoute, { type: 'controller' }> {
  return {
    type: 'controller',
    allow: ['GET', 'HEAD'],
    mutation: false,
    body: false,
    expected: 'general',
    build,
  };
}

function displayCompatibilityRoute(
  screenId: string,
  query: HttpQuery,
): MatchedRoute {
  return readRoute(() => ({ kind: 'display', screenId, query }));
}

function mutationRoute(
  family: 'overrides' | 'hold',
  screenId: string,
  query: HttpQuery,
  method: HttpMethod,
): MatchedRoute {
  const mutation = method === 'POST' || method === 'PUT' || method === 'DELETE';
  const body = method === 'POST' || method === 'PUT';
  return {
    type: 'controller',
    allow: ['GET', 'HEAD', 'POST', 'PUT', 'DELETE'],
    mutation,
    body,
    expected: 'general',
    build(body): ClassroomHttpControllerRequest {
      if (method === 'DELETE') {
        return family === 'overrides'
          ? { kind: 'overrides.delete', screenId, query }
          : { kind: 'hold.delete', screenId, query };
      }
      if (method === 'POST' || method === 'PUT') {
        return family === 'overrides'
          ? { kind: 'overrides.write', screenId, query, body }
          : { kind: 'hold.write', screenId, query, body };
      }
      return family === 'overrides'
        ? { kind: 'overrides.read', screenId, query }
        : { kind: 'hold.read', screenId, query };
    },
  };
}

function resourceRoute(
  family: 'asset' | 'media',
  name: string,
  versioned: boolean,
): MatchedRoute {
  return { type: 'resource', allow: ['GET', 'HEAD'], family, name, versioned };
}

function parseRequestTarget(rawTarget: string | undefined): {
  readonly path: string;
  readonly segments: readonly string[];
  readonly query: HttpQuery;
} {
  if (
    rawTarget === undefined ||
    Buffer.byteLength(rawTarget) > MAX_URL_BYTES ||
    !rawTarget.startsWith('/') ||
    rawTarget.includes('#')
  ) {
    throw protocolError(400, 'invalid_request');
  }
  const queryIndex = rawTarget.indexOf('?');
  const rawPath =
    queryIndex === -1 ? rawTarget : rawTarget.slice(0, queryIndex);
  const rawQuery = queryIndex === -1 ? '' : rawTarget.slice(queryIndex + 1);
  if (
    Buffer.byteLength(rawPath) > MAX_PATH_BYTES ||
    Buffer.byteLength(rawQuery) > MAX_QUERY_BYTES ||
    rawPath.includes('\\') ||
    (rawPath !== '/' && (rawPath.endsWith('/') || rawPath.includes('//')))
  ) {
    throw protocolError(400, 'invalid_request');
  }
  const segments =
    rawPath === '/'
      ? []
      : rawPath
          .slice(1)
          .split('/')
          .map((rawSegment) => decodeSegment(rawSegment));
  const path = segments.length === 0 ? '/' : `/${segments.join('/')}`;
  const queryEntries = [...new URLSearchParams(rawQuery).entries()];
  if (queryEntries.length > MAX_QUERY_ENTRIES)
    throw protocolError(400, 'invalid_request');
  const query: Record<string, string> = {};
  for (const [key, value] of queryEntries) {
    if (
      key.length === 0 ||
      Buffer.byteLength(key) > MAX_QUERY_COMPONENT_BYTES ||
      Buffer.byteLength(value) > MAX_QUERY_COMPONENT_BYTES ||
      Object.hasOwn(query, key)
    ) {
      throw protocolError(400, 'invalid_request');
    }
    if (URL_CREDENTIAL_KEYS.has(key.toLowerCase()))
      throw protocolError(400, 'credentials_in_url');
    query[key] = value;
  }
  return { path, segments, query };
}

function decodeSegment(rawSegment: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawSegment);
  } catch {
    throw protocolError(400, 'invalid_request');
  }
  if (
    Buffer.byteLength(decoded) > MAX_SEGMENT_BYTES ||
    !SAFE_SEGMENT.test(decoded) ||
    decoded === '.' ||
    decoded === '..' ||
    decoded.includes('/') ||
    decoded.includes('\\')
  ) {
    throw protocolError(400, 'invalid_request');
  }
  return decoded;
}

function parseMethod(value: string | undefined): HttpMethod {
  if (
    value === 'GET' ||
    value === 'HEAD' ||
    value === 'POST' ||
    value === 'PUT' ||
    value === 'DELETE'
  ) {
    return value;
  }
  if (value === undefined || !/^[A-Z]+$/.test(value))
    throw protocolError(400, 'invalid_request');
  return value as HttpMethod;
}

function enforceMethod(method: HttpMethod, allow: readonly HttpMethod[]): void {
  if (!allow.includes(method)) {
    throw new HttpProtocolError(
      405,
      'method_not_allowed',
      'Method not allowed.',
      {
        Allow: allow.join(', '),
      },
    );
  }
}

function authenticateMutation(
  request: IncomingMessage,
  expectedToken: string | undefined,
): void {
  if (expectedToken === undefined) {
    throw new HttpProtocolError(
      503,
      'operator_auth_unconfigured',
      'Local operator authorization is not configured.',
    );
  }
  const authorization = request.headers.authorization;
  const supplied = authorization?.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : '';
  const expectedDigest = createHash('sha256').update(expectedToken).digest();
  const suppliedDigest = createHash('sha256').update(supplied).digest();
  if (
    supplied.length === 0 ||
    !timingSafeEqual(expectedDigest, suppliedDigest)
  ) {
    throw new HttpProtocolError(
      401,
      'unauthorized',
      'Authorization is required.',
      {
        'WWW-Authenticate': 'Bearer',
      },
    );
  }
}

async function readRequestBody(
  request: IncomingMessage,
  maximumBytes: number,
): Promise<unknown> {
  const contentType = request.headers['content-type']
    ?.split(';', 1)[0]
    ?.trim()
    .toLowerCase();
  if (
    contentType !== 'application/json' &&
    contentType !== 'application/x-www-form-urlencoded'
  )
    throw protocolError(415, 'unsupported_media_type');
  const contentLength = request.headers['content-length'];
  if (contentLength !== undefined) {
    const parsed = Number(contentLength);
    if (!Number.isSafeInteger(parsed) || parsed < 0)
      throw protocolError(400, 'invalid_request');
    if (parsed > maximumBytes) throw protocolError(413, 'payload_too_large');
  }
  const chunks: Buffer[] = [];
  let byteLength = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    byteLength += bytes.length;
    if (byteLength > maximumBytes)
      throw protocolError(413, 'payload_too_large');
    chunks.push(bytes);
  }
  if (byteLength === 0) throw protocolError(400, 'invalid_json');
  const text = Buffer.concat(chunks).toString('utf8');
  if (contentType === 'application/x-www-form-urlencoded') {
    return parseBoundedForm(text);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw protocolError(400, 'invalid_json');
  }
}

function parseBoundedForm(value: string): Readonly<Record<string, string>> {
  const entries = [...new URLSearchParams(value).entries()];
  if (entries.length > MAX_QUERY_ENTRIES)
    throw protocolError(400, 'invalid_request');
  const parsed: Record<string, string> = {};
  for (const [key, fieldValue] of entries) {
    if (
      key.length === 0 ||
      Buffer.byteLength(key) > MAX_QUERY_COMPONENT_BYTES ||
      Buffer.byteLength(fieldValue) > MAX_QUERY_COMPONENT_BYTES ||
      Object.hasOwn(parsed, key)
    ) {
      throw protocolError(400, 'invalid_request');
    }
    if (URL_CREDENTIAL_KEYS.has(key.toLowerCase()))
      throw protocolError(400, 'credentials_in_body');
    parsed[key] = fieldValue;
  }
  return parsed;
}

async function callController(
  controller: ClassroomHttpServerOptions['controller'],
  request: ClassroomHttpControllerRequest,
  timeoutMs: number,
): Promise<ClassroomHttpControllerResult | undefined> {
  const abort = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      Promise.resolve(controller.handle(request, { signal: abort.signal })),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          abort.abort();
          reject(protocolError(504, 'deadline_exceeded'));
        }, timeoutMs);
        timer.unref();
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function sendControllerResult(
  response: ServerResponse,
  method: HttpMethod,
  result: ClassroomHttpControllerResult,
  expected: 'general' | 'qr' | 'redirect',
): void {
  const status = result.status ?? (result.kind === 'redirect' ? 302 : 200);
  if (!Number.isSafeInteger(status) || status < 200 || status > 599)
    throw protocolError(500, 'internal_error');
  if (expected === 'qr') {
    if (result.kind !== 'binary' || result.contentType !== 'image/png')
      throw protocolError(500, 'internal_error');
    sendBytes(
      response,
      method,
      status,
      Buffer.from(result.value),
      'image/png',
      NO_STORE,
    );
    return;
  }
  if (expected === 'redirect') {
    if (result.kind !== 'redirect') throw protocolError(500, 'internal_error');
    if (![302, 303, 307, 308].includes(status))
      throw protocolError(500, 'internal_error');
    const location = validateRedirect(result.location);
    response.statusCode = status;
    response.setHeader('Location', location);
    response.setHeader('Cache-Control', NO_STORE);
    response.setHeader('Content-Length', '0');
    response.end();
    return;
  }
  if (result.kind === 'json') {
    let body: Buffer;
    try {
      const serialized = JSON.stringify(result.value);
      if (serialized === undefined) throw new TypeError('not serializable');
      body = Buffer.from(`${serialized}\n`);
    } catch {
      throw protocolError(500, 'internal_error');
    }
    sendBytes(
      response,
      method,
      status,
      body,
      'application/json; charset=utf-8',
      NO_STORE,
    );
    return;
  }
  if (result.kind === 'html') {
    sendBytes(
      response,
      method,
      status,
      Buffer.from(result.value),
      'text/html; charset=utf-8',
      NO_STORE,
    );
    return;
  }
  if (
    result.kind === 'binary' &&
    result.contentType === 'application/manifest+json; charset=utf-8'
  ) {
    sendBytes(
      response,
      method,
      status,
      Buffer.from(result.value),
      result.contentType,
      NO_STORE,
    );
    return;
  }
  throw protocolError(500, 'internal_error');
}

function sendMedia(
  request: IncomingMessage,
  response: ServerResponse,
  method: HttpMethod,
  resource: HttpBinaryResource,
  versioned: boolean,
): void {
  const bytes = Buffer.from(resource.bytes);
  response.setHeader('Accept-Ranges', 'bytes');
  const range = request.headers.range;
  if (range === undefined) {
    sendBytes(
      response,
      method,
      200,
      bytes,
      resource.contentType,
      versioned ? IMMUTABLE_CACHE : NO_STORE,
    );
    return;
  }
  const selected = parseByteRange(range, bytes.length);
  if (selected === undefined) {
    throw new HttpProtocolError(
      416,
      'range_not_satisfiable',
      'Range not satisfiable.',
      {
        'Content-Range': `bytes */${bytes.length}`,
        'Accept-Ranges': 'bytes',
      },
    );
  }
  const body = bytes.subarray(selected.start, selected.end + 1);
  response.setHeader(
    'Content-Range',
    `bytes ${selected.start}-${selected.end}/${bytes.length}`,
  );
  sendBytes(
    response,
    method,
    206,
    body,
    resource.contentType,
    versioned ? IMMUTABLE_CACHE : NO_STORE,
  );
}

function parseByteRange(
  value: string,
  length: number,
): { readonly start: number; readonly end: number } | undefined {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (match === null || length === 0) return undefined;
  const startText = match[1] ?? '';
  const endText = match[2] ?? '';
  if (startText === '' && endText === '') return undefined;
  if (startText === '') {
    const suffix = Number(endText);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return undefined;
    return { start: Math.max(0, length - suffix), end: length - 1 };
  }
  const start = Number(startText);
  const requestedEnd = endText === '' ? length - 1 : Number(endText);
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start < 0 ||
    requestedEnd < start ||
    start >= length
  ) {
    return undefined;
  }
  return { start, end: Math.min(requestedEnd, length - 1) };
}

function sendBinary(
  response: ServerResponse,
  method: HttpMethod,
  resource: HttpBinaryResource,
  cacheControl: string,
): void {
  sendBytes(
    response,
    method,
    200,
    Buffer.from(resource.bytes),
    resource.contentType,
    cacheControl,
  );
}

function sendBytes(
  response: ServerResponse,
  method: HttpMethod,
  status: number,
  body: Buffer,
  contentType: string,
  cacheControl: string,
): void {
  response.statusCode = status;
  response.setHeader('Content-Type', validateContentType(contentType));
  response.setHeader('Cache-Control', cacheControl);
  response.setHeader('Content-Length', String(body.length));
  response.end(method === 'HEAD' ? undefined : body);
}

function sendError(
  response: ServerResponse,
  head: boolean,
  error: HttpProtocolError,
): void {
  const body = Buffer.from(
    `${JSON.stringify({ error: { code: error.code, message: error.publicMessage } })}\n`,
  );
  response.statusCode = error.status;
  for (const [name, value] of Object.entries(error.headers))
    response.setHeader(name, value);
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', NO_STORE);
  response.setHeader('Content-Length', String(body.length));
  response.end(head ? undefined : body);
}

function setSecurityHeaders(response: ServerResponse): void {
  response.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'",
  );
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader(
    'Permissions-Policy',
    'camera=(), geolocation=(), microphone=(), payment=(), usb=()',
  );
}

function protocolError(status: number, code: string): HttpProtocolError {
  const messages: Readonly<Record<string, string>> = {
    credentials_in_body:
      'Credentials are accepted only in the Authorization header.',
    credentials_in_url: 'Credentials are not accepted in URLs.',
    deadline_exceeded: 'The request deadline was exceeded.',
    internal_error: 'The request could not be completed.',
    invalid_json: 'The request body is not valid JSON.',
    invalid_request: 'The request is invalid.',
    not_found: 'The requested resource was not found.',
    payload_too_large: 'The request body is too large.',
    unsupported_media_type: 'The request content type is not supported.',
  };
  return new HttpProtocolError(
    status,
    code,
    messages[code] ?? 'The request was rejected.',
  );
}

function validateResources(
  resources: Readonly<Record<string, HttpBinaryResource>>,
): ReadonlyMap<string, HttpBinaryResource> {
  const validated = new Map<string, HttpBinaryResource>();
  for (const [name, resource] of Object.entries(resources)) {
    if (!SAFE_SEGMENT.test(name) || name === '.' || name === '..')
      throw new TypeError('Resource names must be safe single path segments.');
    if (
      !(resource.bytes instanceof Uint8Array) ||
      resource.bytes.byteLength > MAX_RESOURCE_BYTES
    )
      throw new TypeError(
        'Resource bytes are invalid or exceed the resource limit.',
      );
    validated.set(name, {
      bytes: Uint8Array.from(resource.bytes),
      contentType: validateContentType(resource.contentType),
    });
  }
  return validated;
}

function validateCompatibilityPaths(
  paths: Readonly<Record<string, string>>,
): ReadonlyMap<string, string> {
  const validated = new Map<string, string>();
  for (const [path, screenId] of Object.entries(paths)) {
    let parsed: ReturnType<typeof parseRequestTarget>;
    try {
      parsed = parseRequestTarget(path);
    } catch {
      throw new TypeError(
        'Compatibility paths and screen identities must be canonical and safe.',
      );
    }
    if (
      parsed.path !== path ||
      Object.keys(parsed.query).length !== 0 ||
      !isSafeSegment(screenId)
    )
      throw new TypeError(
        'Compatibility paths and screen identities must be canonical and safe.',
      );
    validated.set(path, screenId);
  }
  return validated;
}

function validateScreenIdAliases(
  aliases: Readonly<Record<string, string>>,
): ReadonlyMap<string, string> {
  const validated = new Map<string, string>();
  for (const [alias, screenId] of Object.entries(aliases)) {
    if (!isSafeSegment(alias) || !isSafeSegment(screenId) || alias === screenId)
      throw new TypeError(
        'Screen aliases and canonical identities must be distinct safe segments.',
      );
    validated.set(alias, screenId);
  }
  return validated;
}

function validateMutationToken(value: string): string {
  if (value.length < 16 || value.length > 512 || /[\r\n]/.test(value))
    throw new TypeError(
      'mutationToken must contain 16 through 512 safe characters.',
    );
  return value;
}

function validateContentType(value: string): string {
  if (
    !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+(?:; charset=[a-z0-9_-]+)?$/i.test(
      value,
    )
  )
    throw new TypeError('Resource contentType is invalid.');
  return value;
}

function validateRedirect(value: string): string {
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== 'https:' ||
      parsed.username !== '' ||
      parsed.password !== '' ||
      parsed.hash !== ''
    ) {
      throw new Error('unsafe');
    }
    return parsed.toString();
  } catch {
    throw protocolError(500, 'internal_error');
  }
}

function positiveBoundedInteger(
  value: number,
  minimum: number,
  maximum: number,
  name: string,
): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw new RangeError(`${name} is outside its supported range.`);
  return value;
}

function isSafeSegment(value: string): boolean {
  return (
    Buffer.byteLength(value) <= MAX_SEGMENT_BYTES &&
    SAFE_SEGMENT.test(value) &&
    value !== '.' &&
    value !== '..'
  );
}
