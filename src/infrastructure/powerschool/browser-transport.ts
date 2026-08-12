import type { PassiveReadResult, PassiveReadTransport } from './contracts.js';
import { PassiveBrowserReadSession } from './browser-read.js';
import type { SessionCookieReader } from './passive-http.js';

/** Adapts the capability-limited Chrome session to passive acquisition ports. */
export class PowerSchoolBrowserTransport
  implements PassiveReadTransport, SessionCookieReader
{
  constructor(
    private readonly session: PassiveBrowserReadSession,
    private readonly origin: string,
  ) {
    if (new URL(origin).origin !== origin) {
      throw new Error('powerschool-browser-origin-invalid');
    }
  }

  async read(path: string): Promise<PassiveReadResult> {
    try {
      const snapshot = await this.session.read(path, {
        waitForSelector: '[data-powerschool-ready="true"], [data-auth-state]',
      });
      if (this.session.forbiddenAttempted) {
        return failed('browser-forbidden-request', false);
      }
      const final = new URL(snapshot.url);
      if (final.origin !== this.origin) {
        return failed('browser-cross-origin-navigation', false);
      }
      const blocker = authBlocker(snapshot.url, snapshot.html);
      if (blocker !== undefined) {
        return { status: 'repair-required', code: blocker };
      }
      if (
        snapshot.status === undefined ||
        snapshot.status < 200 ||
        snapshot.status > 299
      ) {
        return failed('browser-read-unavailable', true);
      }
      return {
        status: 'captured',
        capture: {
          title: snapshot.title.slice(0, 256),
          html: snapshot.html,
          text: snapshot.text,
          path: `${final.pathname}${final.search}${final.hash}`,
        },
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '';
      if (/timeout/i.test(message)) return failed('browser-read-timeout', true);
      if (/body-too-large|forbidden|invalid/i.test(message)) {
        return failed('browser-read-unsafe', false);
      }
      return failed('browser-read-unavailable', true);
    }
  }

  async cookieHeaderFor(origin: string): Promise<string | undefined> {
    if (origin !== this.origin)
      throw new Error('powerschool-cookie-origin-forbidden');
    const pairs = (await this.session.cookies()).map((cookie) => {
      if (
        !/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/.test(cookie.name) ||
        cookie.value.length > 4_096 ||
        /[;\r\n\u0000]/u.test(cookie.value)
      ) {
        throw new Error('powerschool-cookie-invalid');
      }
      return `${cookie.name}=${cookie.value}`;
    });
    const header = pairs.join('; ');
    if (header.length > 16_384) throw new Error('powerschool-cookie-invalid');
    return header.length === 0 ? undefined : header;
  }
}

function authBlocker(url: string, html: string): string | undefined {
  if (
    /\/login(?:$|[?#])/i.test(url) ||
    /data-auth-state=["']login-required["']/i.test(html)
  ) {
    return 'session-expired';
  }
  if (/data-auth-state=["']sso-required["']/i.test(html)) {
    return 'sso-approval-required';
  }
  if (/data-auth-state=["']manual-required["']/i.test(html)) {
    return 'manual-sign-in-required';
  }
  return undefined;
}

function failed(
  code: string,
  retryable: boolean,
): Extract<PassiveReadResult, { readonly status: 'failed' }> {
  return { status: 'failed', code, retryable };
}
