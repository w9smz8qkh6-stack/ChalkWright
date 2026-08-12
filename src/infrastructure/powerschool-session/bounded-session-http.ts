import type { BrowserContext, Cookie } from 'playwright-core';

export type BoundedSessionGetResult =
  | {
      readonly status: 'captured';
      readonly html: string;
      readonly bytes: number;
    }
  | {
      readonly status: 'repair-required';
      readonly reason: SessionRejectionReason;
      readonly redirectDiagnostic?: SanitizedSessionRedirectDiagnostic;
    }
  | {
      readonly status: 'failed';
      readonly code:
        | 'response-budget-exceeded'
        | 'request-policy-violation'
        | 'source-read-timeout'
        | 'source-read-unavailable';
      readonly retryable: boolean;
    };

export interface BoundedSessionRequestIdentity {
  readonly userAgent: string;
  readonly referer: string;
}

export interface SanitizedSessionRedirectDiagnostic {
  readonly httpStatus: number;
  readonly pathname: string;
}

/** Exact same-origin GET with manual redirects and a hard streamed byte cap. */
export async function boundedSessionGet(options: {
  readonly context: BrowserContext;
  readonly exactUrl: string;
  readonly maximumBytes: number;
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
  readonly requestIdentity: BoundedSessionRequestIdentity;
  readonly fetchImplementation?: typeof fetch;
}): Promise<BoundedSessionGetResult> {
  const target = new URL(options.exactUrl);
  const timeoutSignal = AbortSignal.timeout(options.timeoutMs);
  const signal = AbortSignal.any([options.signal, timeoutSignal]);
  try {
    const cookieHeader = await applicableCookieHeader(
      options.context,
      target.href,
    );
    const requestIdentity = validatedRequestIdentity(
      options.requestIdentity,
      target,
    );
    const response = await (options.fetchImplementation ?? fetch)(target, {
      method: 'GET',
      redirect: 'manual',
      headers: {
        accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        referer: requestIdentity.referer,
        'user-agent': requestIdentity.userAgent,
        ...(cookieHeader === undefined ? {} : { cookie: cookieHeader }),
      },
      signal,
    });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel().catch(() => undefined);
      const redirect = classifyRedirect(response, target);
      return {
        status: 'repair-required',
        reason: redirect.reason,
        ...(redirect.diagnostic === undefined
          ? {}
          : { redirectDiagnostic: redirect.diagnostic }),
      };
    }
    if (response.status === 401) {
      await response.body?.cancel().catch(() => undefined);
      return { status: 'repair-required', reason: 'unauthorized' };
    }
    if (response.status === 403) {
      await response.body?.cancel().catch(() => undefined);
      return { status: 'repair-required', reason: 'forbidden' };
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return {
        status: 'failed',
        code: 'source-read-unavailable',
        retryable: true,
      };
    }
    const contentType = response.headers.get('content-type') ?? '';
    if (
      !/^text\/html(?:;|$)|^application\/xhtml\+xml(?:;|$)/iu.test(contentType)
    ) {
      await response.body?.cancel().catch(() => undefined);
      return {
        status: 'failed',
        code: 'request-policy-violation',
        retryable: false,
      };
    }
    const body = await boundedText(response, options.maximumBytes);
    if (body === undefined) {
      return {
        status: 'failed',
        code: 'response-budget-exceeded',
        retryable: false,
      };
    }
    const cookies = response.headers
      .getSetCookie()
      .map((header) => parseSetCookie(header, target));
    if (cookies.length > 0) await options.context.addCookies(cookies);
    return {
      status: 'captured',
      html: body.text,
      bytes: body.bytes,
    };
  } catch (error: unknown) {
    if (signal.aborted || isAbortError(error)) {
      return {
        status: 'failed',
        code: 'source-read-timeout',
        retryable: true,
      };
    }
    if (
      error instanceof Error &&
      (error.message === 'powerschool-response-cookie-unsafe' ||
        error.message === 'powerschool-request-identity-unsafe')
    ) {
      return {
        status: 'failed',
        code: 'request-policy-violation',
        retryable: false,
      };
    }
    return {
      status: 'failed',
      code: 'source-read-unavailable',
      retryable: true,
    };
  }
}

export type SessionRejectionReason =
  | 'forbidden'
  | 'redirect-authentication'
  | 'redirect-cross-origin'
  | 'redirect-invalid'
  | 'redirect-same-origin'
  | 'redirect-teacher'
  | 'unauthorized';

function classifyRedirect(
  response: Response,
  target: URL,
): {
  readonly reason: SessionRejectionReason;
  readonly diagnostic?: SanitizedSessionRedirectDiagnostic;
} {
  const location = response.headers.get('location');
  if (
    location === null ||
    location.length < 1 ||
    location.length > 2_048 ||
    /[\r\n\u0000-\u001f\u007f]/u.test(location)
  ) {
    return { reason: 'redirect-invalid' };
  }
  let destination: URL;
  try {
    destination = new URL(location, target);
  } catch {
    return { reason: 'redirect-invalid' };
  }
  if (
    (destination.protocol !== 'https:' && destination.protocol !== 'http:') ||
    destination.username.length > 0 ||
    destination.password.length > 0
  ) {
    return { reason: 'redirect-invalid' };
  }
  if (destination.origin !== target.origin) {
    return { reason: 'redirect-cross-origin' };
  }
  const diagnostic = {
    httpStatus: response.status,
    pathname: destination.pathname,
  };
  if (
    /\/(?:login|signin|oauth|saml)\b|\/idp\//iu.test(destination.pathname) ||
    /^\/oidc\/openid_connect_login\/?$/iu.test(destination.pathname)
  ) {
    return { reason: 'redirect-authentication', diagnostic };
  }
  if (/\/teachers\//iu.test(destination.pathname)) {
    return { reason: 'redirect-teacher', diagnostic };
  }
  return { reason: 'redirect-same-origin', diagnostic };
}

function validatedRequestIdentity(
  identity: BoundedSessionRequestIdentity,
  target: URL,
): BoundedSessionRequestIdentity {
  if (
    identity === null ||
    typeof identity !== 'object' ||
    typeof identity.userAgent !== 'string' ||
    identity.userAgent.length < 1 ||
    identity.userAgent.length > 512 ||
    /[\r\n\u0000-\u001f\u007f]/u.test(identity.userAgent)
  ) {
    throw new Error('powerschool-request-identity-unsafe');
  }
  let referer: URL;
  try {
    referer = new URL(identity.referer);
  } catch {
    throw new Error('powerschool-request-identity-unsafe');
  }
  if (
    referer.origin !== target.origin ||
    referer.username.length > 0 ||
    referer.password.length > 0 ||
    referer.pathname !== '/' ||
    referer.search.length > 0 ||
    referer.hash.length > 0 ||
    referer.href !== `${target.origin}/`
  ) {
    throw new Error('powerschool-request-identity-unsafe');
  }
  return { userAgent: identity.userAgent, referer: referer.href };
}

async function applicableCookieHeader(
  context: BrowserContext,
  url: string,
): Promise<string | undefined> {
  const pairs = await applicableCookiePairs(context, url);
  const header = pairs.join('; ');
  if (header.length > 16_384) {
    throw new Error('powerschool-response-cookie-unsafe');
  }
  return header.length === 0 ? undefined : header;
}

/** Returns only the number of validated cookies applicable to an exact URL. */
export async function countApplicableSessionCookies(
  context: BrowserContext,
  exactUrl: string,
): Promise<number> {
  const target = new URL(exactUrl);
  if (
    (target.protocol !== 'https:' && target.protocol !== 'http:') ||
    target.username.length > 0 ||
    target.password.length > 0
  ) {
    throw new Error('powerschool-response-cookie-unsafe');
  }
  return (await applicableCookiePairs(context, target.href)).length;
}

async function applicableCookiePairs(
  context: BrowserContext,
  url: string,
): Promise<readonly string[]> {
  return (await context.cookies(url)).map((cookie) => {
    if (
      !/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/u.test(cookie.name) ||
      cookie.value.length > 4_096 ||
      /[;\r\n\u0000]/u.test(cookie.value)
    ) {
      throw new Error('powerschool-response-cookie-unsafe');
    }
    return `${cookie.name}=${cookie.value}`;
  });
}

async function boundedText(
  response: Response,
  maximumBytes: number,
): Promise<{ readonly text: string; readonly bytes: number } | undefined> {
  const declaredHeader = response.headers.get('content-length');
  if (declaredHeader !== null) {
    const declared = Number(declaredHeader);
    if (
      !Number.isSafeInteger(declared) ||
      declared < 0 ||
      declared > maximumBytes
    ) {
      await response.body?.cancel().catch(() => undefined);
      return undefined;
    }
  }
  if (response.body === null) return { text: '', bytes: 0 };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    length += chunk.value.byteLength;
    if (length > maximumBytes) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(chunk.value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return {
    text: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
    bytes: length,
  };
}

function parseSetCookie(header: string, target: URL): Cookie {
  if (
    header.length === 0 ||
    header.length > 8_192 ||
    /[\r\n\u0000]/u.test(header)
  ) {
    throw new Error('powerschool-response-cookie-unsafe');
  }
  const parts = header.split(';').map((part) => part.trim());
  const first = parts.shift();
  const separator = first?.indexOf('=') ?? -1;
  if (first === undefined || separator < 1) {
    throw new Error('powerschool-response-cookie-unsafe');
  }
  const name = first.slice(0, separator);
  const value = first.slice(separator + 1);
  if (
    !/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/u.test(name) ||
    value.length > 4_096
  ) {
    throw new Error('powerschool-response-cookie-unsafe');
  }
  let domain = target.hostname;
  let path = defaultCookiePath(target.pathname);
  let expires = -1;
  let httpOnly = false;
  let secure = false;
  let sameSite: Cookie['sameSite'] = 'Lax';
  for (const part of parts) {
    const [rawName, ...rawValue] = part.split('=');
    const attribute = rawName?.toLowerCase();
    const attributeValue = rawValue.join('=');
    switch (attribute) {
      case 'domain':
        domain = attributeValue.toLowerCase();
        break;
      case 'path':
        path = attributeValue;
        break;
      case 'expires': {
        const parsed = Date.parse(attributeValue);
        if (Number.isFinite(parsed)) expires = Math.floor(parsed / 1_000);
        break;
      }
      case 'max-age': {
        const seconds = Number(attributeValue);
        if (Number.isSafeInteger(seconds)) {
          expires = Math.floor(Date.now() / 1_000) + seconds;
        }
        break;
      }
      case 'httponly':
        httpOnly = true;
        break;
      case 'secure':
        secure = true;
        break;
      case 'samesite':
        if (/^strict$/iu.test(attributeValue)) sameSite = 'Strict';
        else if (/^none$/iu.test(attributeValue)) sameSite = 'None';
        else if (/^lax$/iu.test(attributeValue)) sameSite = 'Lax';
        else throw new Error('powerschool-response-cookie-unsafe');
        break;
      default:
        break;
    }
  }
  const normalizedDomain = domain.replace(/^\./u, '');
  if (
    (normalizedDomain !== target.hostname &&
      !target.hostname.endsWith(`.${normalizedDomain}`)) ||
    !path.startsWith('/') ||
    path.length > 1_024
  ) {
    throw new Error('powerschool-response-cookie-unsafe');
  }
  return {
    name,
    value,
    domain,
    path,
    expires,
    httpOnly,
    secure,
    sameSite,
  };
}

function defaultCookiePath(pathname: string): string {
  if (!pathname.startsWith('/') || pathname === '/') return '/';
  const index = pathname.lastIndexOf('/');
  return index <= 0 ? '/' : pathname.slice(0, index);
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === 'AbortError' || error.name === 'TimeoutError')
  );
}
