import type { BrowserContext, Page, Route } from 'playwright-core';

import type { PowerSchoolBootstrapConfig } from '../../config/powerschool-session.js';

export interface AuthenticatedNavigationSafetyState {
  violation: boolean;
  topLevelRequests: number;
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
  };
  const allowedResources = new Set(
    options.config.allowedBootstrapResourceOrigins,
  );
  await options.context.routeWebSocket('**/*', async (socket) => {
    state.violation = true;
    await socket
      .close({ code: 1008, reason: 'blocked' })
      .catch(() => undefined);
  });
  await options.context.route('**/*', async (route) => {
    if (!requestAllowed(route, options.config, allowedResources, state)) {
      state.violation = true;
      await route.abort('blockedbyclient').catch(() => undefined);
      return;
    }
    await route.continue().catch(() => {
      state.violation = true;
    });
  });
  const guardPage = (page: Page): void => {
    page.on('download', (download) => {
      state.violation = true;
      void download.cancel().catch(() => undefined);
    });
  };
  guardPage(options.page);
  options.context.on('page', (page) => {
    if (page === options.page) return;
    state.violation = true;
    guardPage(page);
    void page.close({ runBeforeUnload: false }).catch(() => undefined);
  });
  options.context.on('response', (response) => {
    const declared = Number(response.headers()['content-length']);
    if (
      Number.isFinite(declared) &&
      declared > options.config.maxResponseBytes
    ) {
      state.violation = true;
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

function requestAllowed(
  route: Route,
  config: PowerSchoolBootstrapConfig,
  allowedResources: ReadonlySet<string>,
  state: AuthenticatedNavigationSafetyState,
): boolean {
  const request = route.request();
  let url: URL;
  try {
    url = new URL(request.url());
  } catch {
    return false;
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
      return false;
    }
  }
  if (isTopLevelNavigation) {
    state.topLevelRequests += 1;
    if (state.topLevelRequests > config.maxTopLevelRequests) return false;
    if (url.origin === config.powerSchoolOrigin)
      return method === 'GET' || method === 'HEAD';
    if (url.origin === config.identityOrigin)
      return method === 'GET' || method === 'HEAD' || method === 'POST';
    return false;
  }
  if (url.origin === config.identityOrigin) {
    return method === 'GET' || method === 'HEAD' || method === 'POST';
  }
  return (
    allowedResources.has(url.origin) && (method === 'GET' || method === 'HEAD')
  );
}
