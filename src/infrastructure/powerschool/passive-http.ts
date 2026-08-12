import { isIsoDate } from '../../domain/runtime-validation.js';
import type { AuthenticationBlocker } from '../../ports/source-authentication.js';
import type {
  LiveAuthenticationProbe,
  LiveAuthenticationProbeResult,
  PassiveCapture,
  PassiveReadResult,
  PassiveReadTransport,
} from './contracts.js';
import { isBoundedOperationTimeout, withBoundedSettlement } from './timeout.js';

const redirectStatuses = new Set([301, 302, 303, 307, 308]);

export interface SessionCookieReader {
  /** Sensitive cookie material remains inside the infrastructure transport. */
  cookieHeaderFor(origin: string): Promise<string | undefined>;
}

export interface PassiveHttpReaderOptions {
  readonly origin: string;
  readonly authenticationProbePath: string;
  readonly allowedPathTemplates: readonly string[];
  /** Defaults to the M-07A ISO form; M-07B authorizes one US-form date query. */
  readonly dateValueFormat?: 'iso-date' | 'mm/dd/yyyy';
  /** When set, `{date}` matches only this exact authorized ISO date. */
  readonly expectedDate?: string;
  readonly maximumTimeoutMs: number;
  readonly maximumBodyBytes: number;
  readonly cookies: SessionCookieReader;
  readonly fetchImplementation?: typeof fetch;
}

/**
 * Same-origin GET-only transport. Callers provide a named surface and date,
 * never a method, URL, body, form value, or credential.
 */
export class PassiveSameOriginHttpReader
  implements PassiveReadTransport, LiveAuthenticationProbe
{
  readonly #origin: string;
  readonly #authenticationProbePath: string;
  readonly #allowedPathTemplates: readonly string[];
  readonly #dateValueFormat: 'iso-date' | 'mm/dd/yyyy';
  readonly #expectedDate: string | undefined;
  readonly #maximumTimeoutMs: number;
  readonly #maximumBodyBytes: number;
  readonly #cookies: SessionCookieReader;
  readonly #fetch: typeof fetch;

  constructor(options: PassiveHttpReaderOptions) {
    this.#origin = normalizedAllowedOrigin(options.origin);
    this.#authenticationProbePath = safeConfiguredPath(
      options.authenticationProbePath,
    );
    this.#dateValueFormat = options.dateValueFormat ?? 'iso-date';
    if (
      options.expectedDate !== undefined &&
      !isIsoDate(options.expectedDate)
    ) {
      throw new Error('powerschool-read-expected-date-invalid');
    }
    if (
      this.#dateValueFormat === 'mm/dd/yyyy' &&
      options.expectedDate === undefined
    ) {
      throw new Error('powerschool-read-expected-date-required');
    }
    this.#expectedDate = options.expectedDate;
    this.#allowedPathTemplates = validateAllowedPathTemplates(
      this.#origin,
      options.allowedPathTemplates,
      this.#dateValueFormat,
      this.#expectedDate,
    );
    if (
      !pathIsAllowed(
        new URL(this.#authenticationProbePath, this.#origin),
        this.#origin,
        this.#allowedPathTemplates,
        this.#dateValueFormat,
        this.#expectedDate,
      )
    ) {
      throw new Error('powerschool-auth-probe-path-not-allowed');
    }
    if (
      !Number.isInteger(options.maximumTimeoutMs) ||
      options.maximumTimeoutMs < 100 ||
      options.maximumTimeoutMs > 30_000 ||
      !Number.isInteger(options.maximumBodyBytes) ||
      options.maximumBodyBytes < 1_024 ||
      options.maximumBodyBytes > 2 * 1_024 * 1_024
    ) {
      throw new Error('powerschool-http-config-invalid');
    }
    this.#maximumTimeoutMs = options.maximumTimeoutMs;
    this.#maximumBodyBytes = options.maximumBodyBytes;
    this.#cookies = options.cookies;
    this.#fetch = options.fetchImplementation ?? fetch;
  }

  async read(path: string): Promise<PassiveReadResult> {
    return this.#read(path, this.#maximumTimeoutMs);
  }

  async probe(
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<LiveAuthenticationProbeResult> {
    const result = await this.#read(
      this.#authenticationProbePath,
      timeoutMs,
      signal,
    );
    if (result.status === 'captured') return { state: 'authenticated' };
    if (result.status === 'repair-required') {
      return {
        state: 'authentication-required',
        blocker: blockerFromCode(result.code),
      };
    }
    return {
      state: 'failed',
      reason:
        result.status === 'failed' && result.code === 'source-read-timeout'
          ? 'timeout'
          : 'unavailable',
    };
  }

  async #read(
    path: string,
    requestedTimeoutMs: number,
    parentSignal?: AbortSignal,
  ): Promise<PassiveReadResult> {
    let cookie: string | undefined;
    try {
      const target = sameOriginTarget(this.#origin, path);
      const timeoutMs = boundedTimeout(
        requestedTimeoutMs,
        this.#maximumTimeoutMs,
      );
      if (
        !pathIsAllowed(
          target,
          this.#origin,
          this.#allowedPathTemplates,
          this.#dateValueFormat,
          this.#expectedDate,
        )
      ) {
        return failed('source-read-path-not-allowed', false);
      }
      return await withBoundedSettlement(
        timeoutMs,
        async (signal) => {
          cookie = await this.#cookies.cookieHeaderFor(this.#origin);
          signal.throwIfAborted();
          if (cookie !== undefined && !isBoundedCookieHeader(cookie)) {
            return failed('session-cookie-invalid', false);
          }
          const response = await this.#fetch(target, {
            method: 'GET',
            redirect: 'manual',
            headers: {
              accept: 'text/html,application/xhtml+xml',
              ...(cookie === undefined ? {} : { cookie }),
            },
            signal,
          });
          if (redirectStatuses.has(response.status)) {
            return classifyRedirect(
              this.#origin,
              response.headers.get('location'),
            );
          }
          if (response.status === 401 || response.status === 403) {
            return authenticationRequired('session-expired');
          }
          if (!response.ok) return failed('source-read-unavailable', true);
          const contentType = response.headers.get('content-type') ?? '';
          if (
            !/^text\/html(?:;|$)|^application\/xhtml\+xml(?:;|$)/i.test(
              contentType,
            )
          ) {
            return failed('source-content-type-invalid', false);
          }
          const html = await boundedText(response, this.#maximumBodyBytes);
          if (html === undefined)
            return failed('source-response-too-large', false);
          const blocker = blockerFromHtml(html);
          if (blocker !== undefined) return authenticationRequired(blocker);
          if (requiresBrowserRendering(html))
            return { status: 'browser-required' };
          return { status: 'captured', capture: captureFromHtml(target, html) };
        },
        parentSignal,
      );
    } catch (error: unknown) {
      if (isTimeout(error) || isBoundedOperationTimeout(error)) {
        return failed('source-read-timeout', true);
      }
      return failed('source-read-unavailable', true);
    } finally {
      cookie = undefined;
    }
  }
}

function validateAllowedPathTemplates(
  origin: string,
  templates: readonly string[],
  dateValueFormat: 'iso-date' | 'mm/dd/yyyy',
  expectedDate: string | undefined,
): readonly string[] {
  if (
    !Array.isArray(templates) ||
    templates.length < 1 ||
    templates.length > 32
  ) {
    throw new Error('powerschool-read-allowlist-invalid');
  }
  const unique = new Set<string>();
  for (const template of templates) {
    if (
      typeof template !== 'string' ||
      template.length < 1 ||
      template.length > 512 ||
      (template.match(/\{date\}/g)?.length ?? 0) > 1 ||
      /\{(?!date\})|(?<!\{date)\}/u.test(template)
    ) {
      throw new Error('powerschool-read-allowlist-invalid');
    }
    const concrete = template.replace(
      '{date}',
      formatDateValue(expectedDate ?? '2035-04-13', dateValueFormat),
    );
    const target = sameOriginTarget(origin, concrete);
    if (target.hash.length > 0 || unique.has(template)) {
      throw new Error('powerschool-read-allowlist-invalid');
    }
    unique.add(template);
  }
  return [...unique];
}

function pathIsAllowed(
  target: URL,
  _origin: string,
  templates: readonly string[],
  dateValueFormat: 'iso-date' | 'mm/dd/yyyy',
  expectedDate: string | undefined,
): boolean {
  if (target.hash.length > 0) return false;
  const actual = `${target.pathname}${target.search}`;
  return templates.some((template) =>
    matchesPathTemplate(actual, template, dateValueFormat, expectedDate),
  );
}

function matchesPathTemplate(
  actual: string,
  template: string,
  dateValueFormat: 'iso-date' | 'mm/dd/yyyy',
  expectedDate: string | undefined,
): boolean {
  const marker = template.indexOf('{date}');
  if (marker < 0) return actual === template;
  const prefix = template.slice(0, marker);
  const suffix = template.slice(marker + '{date}'.length);
  if (!actual.startsWith(prefix) || !actual.endsWith(suffix)) return false;
  const encodedDate = actual.slice(
    prefix.length,
    actual.length - suffix.length,
  );
  try {
    const date = decodeURIComponent(encodedDate);
    if (encodedDate !== date) return false;
    const isoDate =
      dateValueFormat === 'iso-date' ? date : isoDateFromUsDate(date);
    return (
      isoDate !== undefined &&
      isIsoDate(isoDate) &&
      (expectedDate === undefined || isoDate === expectedDate)
    );
  } catch {
    return false;
  }
}

function isoDateFromUsDate(value: string): string | undefined {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/u.exec(value);
  return match === null ? undefined : `${match[3]}-${match[1]}-${match[2]}`;
}

function formatDateValue(
  value: string,
  format: 'iso-date' | 'mm/dd/yyyy',
): string {
  if (format === 'iso-date') return value;
  const [year, month, day] = value.split('-');
  return `${month}/${day}/${year}`;
}

function normalizedAllowedOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('powerschool-origin-invalid');
  }
  if (
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.pathname !== '/' ||
    url.search.length > 0 ||
    url.hash.length > 0 ||
    (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && isLoopback(url.hostname)))
  ) {
    throw new Error('powerschool-origin-invalid');
  }
  return url.origin;
}

function isLoopback(hostname: string): boolean {
  return hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
}

function safeConfiguredPath(path: string): string {
  if (
    typeof path !== 'string' ||
    path.length < 1 ||
    path.length > 256 ||
    !path.startsWith('/') ||
    path.startsWith('//') ||
    path.includes('?') ||
    path.includes('#') ||
    /[\u0000-\u001f\\]/u.test(path)
  ) {
    throw new Error('powerschool-read-path-invalid');
  }
  return path;
}

function sameOriginTarget(origin: string, path: string): URL {
  if (
    typeof path !== 'string' ||
    path.length < 1 ||
    path.length > 512 ||
    !path.startsWith('/') ||
    path.startsWith('//') ||
    /[\u0000-\u001f\\]/u.test(path)
  ) {
    throw new Error('powerschool-read-path-invalid');
  }
  const target = new URL(path, origin);
  if (target.origin !== origin || target.username || target.password) {
    throw new Error('powerschool-read-path-invalid');
  }
  return target;
}

function boundedTimeout(requested: number, maximum: number): number {
  if (!Number.isInteger(requested) || requested < 100 || requested > maximum) {
    throw new Error('powerschool-timeout-invalid');
  }
  return requested;
}

function classifyRedirect(
  origin: string,
  location: string | null,
): PassiveReadResult {
  if (location === null || location.length > 512) {
    return failed('source-redirect-invalid', false);
  }
  let target: URL;
  try {
    target = new URL(location, origin);
  } catch {
    return failed('source-redirect-invalid', false);
  }
  if (target.origin !== origin)
    return authenticationRequired('sso-approval-required');
  if (/\b(?:login|signin|auth)\b/i.test(target.pathname)) {
    return authenticationRequired('session-expired');
  }
  return failed('source-redirect-unexpected', false);
}

async function boundedText(
  response: Response,
  maximumBodyBytes: number,
): Promise<string | undefined> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maximumBodyBytes)
    return undefined;
  if (response.body === null) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    length += chunk.value.byteLength;
    if (length > maximumBodyBytes) {
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
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

function captureFromHtml(_url: URL, html: string): PassiveCapture {
  const title = decodeEntities(
    html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '',
  )
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 256);
  const text = decodeEntities(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
  return { title, html, text, path: `${_url.pathname}${_url.search}` };
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function blockerFromHtml(html: string): AuthenticationBlocker | undefined {
  if (/data-auth-blocker=["']sso["']/i.test(html))
    return 'sso-approval-required';
  if (/data-auth-blocker=["'](?:manual|challenge)["']/i.test(html)) {
    return 'manual-sign-in-required';
  }
  if (/data-auth-state=["']expired["']/i.test(html)) return 'session-expired';
  return undefined;
}

function requiresBrowserRendering(html: string): boolean {
  return /<meta\b[^>]*name=["']powerschool-render["'][^>]*content=["']browser["']/i.test(
    html,
  );
}

function isBoundedCookieHeader(value: string): boolean {
  return (
    value.length > 0 && value.length <= 16_384 && !/[\r\n\u0000]/u.test(value)
  );
}

function authenticationRequired(
  blocker: AuthenticationBlocker,
): Extract<PassiveReadResult, { readonly status: 'repair-required' }> {
  return { status: 'repair-required', code: blocker };
}

function failed(
  code: string,
  retryable: boolean,
): Extract<PassiveReadResult, { readonly status: 'failed' }> {
  return { status: 'failed', code, retryable };
}

function blockerFromCode(code: string): AuthenticationBlocker {
  if (code === 'sso-approval-required') return code;
  if (code === 'manual-sign-in-required') return code;
  return 'session-expired';
}

function isTimeout(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === 'TimeoutError' || error.name === 'AbortError')
  );
}
