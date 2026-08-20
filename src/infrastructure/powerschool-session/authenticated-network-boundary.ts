import type { BrowserContext, Page, Route } from 'playwright-core';
import { getDomain } from 'tldts';

import type { PowerSchoolBootstrapConfig } from '../../config/powerschool-session.js';

export interface AuthenticatedNavigationSafetyState {
  violation: boolean;
  violationReason?: AuthenticatedNetworkViolationReason;
  topLevelRequests: number;
  authenticationReturnExpected: boolean;
}

export const authenticatedNetworkViolationReasons = [
  'declared-response-oversize',
  'download-attempted',
  'identity-method-blocked',
  'invalid-request-url',
  'network-control-failed',
  'popup-attempted',
  'powerschool-method-blocked',
  'resource-method-blocked',
  'resource-origin-blocked-google-accounts-static',
  'resource-origin-blocked-google-font-css',
  'resource-origin-blocked-google-other',
  'resource-origin-blocked-google-user-content',
  'resource-origin-blocked-non-http',
  'resource-origin-blocked-powerschool-child',
  'resource-origin-blocked-powerschool-parent',
  'resource-origin-blocked-powerschool-sibling-assets',
  'resource-origin-blocked-powerschool-sibling-assets-child',
  'resource-origin-blocked-powerschool-sibling-assets-sis-child',
  'resource-origin-blocked-powerschool-sibling-auth',
  'resource-origin-blocked-powerschool-sibling-auth-child',
  'resource-origin-blocked-powerschool-sibling-cdn',
  'resource-origin-blocked-powerschool-sibling-cdn-child',
  'resource-origin-blocked-powerschool-sibling-login',
  'resource-origin-blocked-powerschool-sibling-login-child',
  'resource-origin-blocked-powerschool-sibling-other',
  'resource-origin-blocked-powerschool-sibling-sso',
  'resource-origin-blocked-powerschool-sibling-sso-child',
  'resource-origin-blocked-powerschool-sibling-static',
  'resource-origin-blocked-powerschool-sibling-static-child',
  'resource-origin-blocked-powerschool-sibling-www',
  'resource-origin-blocked-powerschool-sibling-www-child',
  'resource-origin-blocked-powerschool-sibling',
  'resource-origin-blocked',
  'top-level-budget-exceeded',
  'top-level-origin-blocked',
  'untrusted-navigation',
  'websocket-attempted',
] as const;

export type AuthenticatedNetworkViolationReason =
  (typeof authenticatedNetworkViolationReasons)[number];

export function isAuthenticatedNetworkViolationReason(
  value: unknown,
): value is AuthenticatedNetworkViolationReason {
  return authenticatedNetworkViolationReasons.some(
    (candidate) => candidate === value,
  );
}

/**
 * Installs the shared browser-network boundary used by the explicit repair and
 * persistent compatibility lanes. It must be installed before application
 * navigation. The passive filtered-state collector intentionally does not use
 * this broader identity-origin policy.
 */
export async function installAuthenticatedNetworkBoundary(options: {
  readonly context: BrowserContext;
  readonly page: Page;
  readonly config: PowerSchoolBootstrapConfig;
}): Promise<AuthenticatedNavigationSafetyState> {
  const state: AuthenticatedNavigationSafetyState = {
    violation: false,
    topLevelRequests: 0,
    authenticationReturnExpected: false,
  };
  const explicitlyAllowedResources = new Set(
    options.config.allowedBootstrapResourceOrigins,
  );
  await options.context.routeWebSocket('**/*', async (socket) => {
    recordViolation(state, 'websocket-attempted');
    await socket
      .close({ code: 1008, reason: 'blocked' })
      .catch(() => undefined);
  });
  await options.context.route('**/*', async (route) => {
    const violation = requestViolation(
      route,
      options.config,
      explicitlyAllowedResources,
      state,
    );
    if (violation !== undefined) {
      recordViolation(state, violation);
      await route.abort('blockedbyclient').catch(() => undefined);
      return;
    }
    await route.continue().catch(() => {
      recordViolation(state, 'network-control-failed');
    });
  });
  const guardPage = (page: Page): void => {
    page.on('download', (download) => {
      recordViolation(state, 'download-attempted');
      void download.cancel().catch(() => undefined);
    });
  };
  guardPage(options.page);
  options.context.on('page', (page) => {
    if (page === options.page) return;
    recordViolation(state, 'popup-attempted');
    guardPage(page);
    void page.close({ runBeforeUnload: false }).catch(() => undefined);
  });
  options.context.on('response', (response) => {
    const declared = Number(response.headers()['content-length']);
    if (
      Number.isFinite(declared) &&
      declared > options.config.maxResponseBytes
    ) {
      recordViolation(state, 'declared-response-oversize');
      try {
        void response
          .request()
          .frame()
          .page()
          .close()
          .catch(() => undefined);
      } catch {
        // The request may no longer have a frame during teardown. The policy
        // violation remains recorded and the main loop will fail closed.
      }
    }
  });
  return state;
}

function requestViolation(
  route: Route,
  config: PowerSchoolBootstrapConfig,
  explicitlyAllowedResources: ReadonlySet<string>,
  state: AuthenticatedNavigationSafetyState,
): AuthenticatedNetworkViolationReason | undefined {
  const request = route.request();
  let url: URL;
  try {
    url = new URL(request.url());
  } catch {
    return 'invalid-request-url';
  }
  const method = request.method().toUpperCase();
  let isTopLevelNavigation = false;
  if (request.isNavigationRequest()) {
    try {
      const frame = request.frame();
      isTopLevelNavigation = frame === frame.page().mainFrame();
    } catch {
      // Playwright does not expose a frame for an initial popup request. Treat
      // that pre-frame request as untrusted so it is blocked before egress.
      return 'untrusted-navigation';
    }
  }
  if (isTopLevelNavigation) {
    state.topLevelRequests += 1;
    if (state.topLevelRequests > config.maxTopLevelRequests)
      return 'top-level-budget-exceeded';
    if (url.origin === config.powerSchoolOrigin) {
      if (method === 'GET' || method === 'HEAD') {
        state.authenticationReturnExpected = false;
        return undefined;
      }
      if (method === 'POST' && state.authenticationReturnExpected) {
        state.authenticationReturnExpected = false;
        return undefined;
      }
      return 'powerschool-method-blocked';
    }
    if (url.origin === config.identityOrigin) {
      if (method === 'GET' || method === 'HEAD' || method === 'POST') {
        state.authenticationReturnExpected = true;
        return undefined;
      }
      return 'identity-method-blocked';
    }
    return 'top-level-origin-blocked';
  }
  if (url.origin === config.identityOrigin) {
    return method === 'GET' || method === 'HEAD' || method === 'POST'
      ? undefined
      : 'identity-method-blocked';
  }
  // The proven legacy repair lets Chrome load the identity page's ordinary
  // HTTPS resources without trying to predict every CDN hostname. Keep that
  // behavior for read-only subresources while retaining explicit allowances
  // for synthetic/local HTTP fixtures. Top-level navigation remains confined
  // above, and non-read methods remain confined below.
  if (
    !isAllowedBrowserResourceOrigin({
      url,
      explicitlyAllowedResources,
      powerSchoolOrigin: config.powerSchoolOrigin,
    })
  )
    return classifyBlockedResourceOrigin(url, config.powerSchoolOrigin);
  return isAllowedBrowserResourceMethod({
    method,
    url,
    powerSchoolOrigin: config.powerSchoolOrigin,
  })
    ? undefined
    : url.origin === config.powerSchoolOrigin
      ? 'powerschool-method-blocked'
      : 'resource-method-blocked';
}

export function isAllowedBrowserResourceOrigin(options: {
  readonly url: URL;
  readonly explicitlyAllowedResources: ReadonlySet<string>;
  readonly powerSchoolOrigin: string;
}): boolean {
  return (
    options.url.protocol === 'https:' ||
    options.explicitlyAllowedResources.has(options.url.origin) ||
    isPowerSchoolSameSiteResourceOrigin(options.url, options.powerSchoolOrigin)
  );
}

/**
 * Compatibility page loads intentionally emulate the proven legacy browser
 * lane: exact PowerSchool top-level navigations remain GET/HEAD-only, while
 * non-top-level same-site resource endpoints may use browser-internal CORS or
 * beacon-style OPTIONS/POST requests. The caller still aborts all unrelated
 * origins, downloads, popups, WebSockets, and over-budget responses.
 */
export function isAllowedBrowserResourceMethod(options: {
  readonly method: string;
  readonly url: URL;
  readonly powerSchoolOrigin: string;
}): boolean {
  const method = options.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD') return true;
  if (
    (method === 'OPTIONS' || method === 'POST') &&
    options.url.origin !== options.powerSchoolOrigin &&
    isPowerSchoolSameSiteResourceOrigin(options.url, options.powerSchoolOrigin)
  ) {
    return true;
  }
  return false;
}

export function isPowerSchoolSameSiteResourceOrigin(
  url: URL,
  powerSchoolOrigin: string,
): boolean {
  if (url.protocol !== 'https:') return false;
  const powerSchoolHost = new URL(powerSchoolOrigin).hostname;
  const powerSchoolSite = getDomain(powerSchoolHost, {
    allowPrivateDomains: true,
    extractHostname: false,
  });
  const candidateSite = getDomain(url.hostname, {
    allowPrivateDomains: true,
    extractHostname: false,
  });
  return powerSchoolSite !== null && candidateSite === powerSchoolSite;
}

/** Returns only a fixed diagnostic class and never retains the blocked URL. */
export function classifyBlockedResourceOrigin(
  url: URL,
  powerSchoolOrigin: string,
): AuthenticatedNetworkViolationReason {
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    return 'resource-origin-blocked-non-http';
  if (url.origin === 'https://fonts.googleapis.com')
    return 'resource-origin-blocked-google-font-css';
  if (url.origin === 'https://accounts.gstatic.com')
    return 'resource-origin-blocked-google-accounts-static';
  if (
    url.hostname === 'googleusercontent.com' ||
    url.hostname.endsWith('.googleusercontent.com')
  )
    return 'resource-origin-blocked-google-user-content';
  if (
    url.hostname === 'google.com' ||
    url.hostname.endsWith('.google.com') ||
    url.hostname === 'googleapis.com' ||
    url.hostname.endsWith('.googleapis.com')
  )
    return 'resource-origin-blocked-google-other';

  const powerSchoolHost = new URL(powerSchoolOrigin).hostname;
  const powerSchoolSite = getDomain(powerSchoolHost, {
    allowPrivateDomains: true,
    extractHostname: false,
  });
  const blockedSite = getDomain(url.hostname, {
    allowPrivateDomains: true,
    extractHostname: false,
  });
  if (powerSchoolSite !== null && blockedSite === powerSchoolSite) {
    const powerSchoolUrl = new URL(powerSchoolOrigin);
    if (url.origin === `${powerSchoolUrl.protocol}//${powerSchoolSite}`)
      return 'resource-origin-blocked-powerschool-parent';
    if (url.hostname.endsWith(`.${powerSchoolHost}`))
      return 'resource-origin-blocked-powerschool-child';
    const siblingLabel = url.hostname.slice(0, -(powerSchoolSite.length + 1));
    if (!siblingLabel.includes('.')) {
      const fixedSiblingReasons = {
        assets: 'resource-origin-blocked-powerschool-sibling-assets',
        auth: 'resource-origin-blocked-powerschool-sibling-auth',
        cdn: 'resource-origin-blocked-powerschool-sibling-cdn',
        login: 'resource-origin-blocked-powerschool-sibling-login',
        sso: 'resource-origin-blocked-powerschool-sibling-sso',
        static: 'resource-origin-blocked-powerschool-sibling-static',
        www: 'resource-origin-blocked-powerschool-sibling-www',
      } as const;
      const fixedReason =
        fixedSiblingReasons[siblingLabel as keyof typeof fixedSiblingReasons];
      if (fixedReason !== undefined) return fixedReason;
      return 'resource-origin-blocked-powerschool-sibling-other';
    }
    if (siblingLabel.endsWith('.assets-sis'))
      return 'resource-origin-blocked-powerschool-sibling-assets-sis-child';
    if (siblingLabel.endsWith('.assets'))
      return 'resource-origin-blocked-powerschool-sibling-assets-child';
    const fixedNestedSiblingReasons = {
      auth: 'resource-origin-blocked-powerschool-sibling-auth-child',
      cdn: 'resource-origin-blocked-powerschool-sibling-cdn-child',
      login: 'resource-origin-blocked-powerschool-sibling-login-child',
      sso: 'resource-origin-blocked-powerschool-sibling-sso-child',
      static: 'resource-origin-blocked-powerschool-sibling-static-child',
      www: 'resource-origin-blocked-powerschool-sibling-www-child',
    } as const;
    const nestedRole = siblingLabel.slice(siblingLabel.lastIndexOf('.') + 1);
    const fixedNestedReason =
      fixedNestedSiblingReasons[
        nestedRole as keyof typeof fixedNestedSiblingReasons
      ];
    if (fixedNestedReason !== undefined) return fixedNestedReason;
    return 'resource-origin-blocked-powerschool-sibling';
  }
  return 'resource-origin-blocked';
}

function recordViolation(
  state: AuthenticatedNavigationSafetyState,
  reason: AuthenticatedNetworkViolationReason,
): void {
  if (state.violation) return;
  state.violation = true;
  state.violationReason = reason;
}
