import { chromium, type BrowserContext, type Page } from 'playwright-core';

export function sanitizedChromeEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const name of [
    'DBUS_SESSION_BUS_ADDRESS',
    'DISPLAY',
    'FONTCONFIG_PATH',
    'HOME',
    'LANG',
    'PATH',
    'TMPDIR',
    'TZ',
    'WAYLAND_DISPLAY',
    'XAUTHORITY',
    'XDG_RUNTIME_DIR',
  ]) {
    const value = source[name];
    if (value !== undefined) environment[name] = value;
  }
  return environment;
}

/**
 * Launches the locked Playwright/Chrome tuple. Network routing can begin only
 * after Chrome starts, so callers must install a context route before any
 * application navigation and must not claim confinement of Chrome startup.
 */
export async function launchPowerSchoolSessionContext(options: {
  readonly profileDirectory: string;
  readonly chromeExecutablePath: string;
  readonly headless: boolean;
  readonly javaScriptEnabled: boolean;
  readonly timeoutMs: number;
  readonly environment?: NodeJS.ProcessEnv;
}): Promise<BrowserContext> {
  return await chromium.launchPersistentContext(options.profileDirectory, {
    executablePath: options.chromeExecutablePath,
    headless: options.headless,
    chromiumSandbox: true,
    acceptDownloads: false,
    serviceWorkers: 'block',
    javaScriptEnabled: options.javaScriptEnabled,
    env: sanitizedChromeEnvironment(options.environment ?? process.env),
    timeout: options.timeoutMs,
  });
}

export interface BrowserSafetyState {
  violation?:
    | 'byte-budget-exceeded'
    | 'download-attempted'
    | 'popup-attempted'
    | 'request-budget-exceeded'
    | 'request-policy-violation';
  bytes: number;
  topLevelRequests: number;
}

export function installPageSafetyGuards(options: {
  readonly context: BrowserContext;
  readonly page: Page;
}): BrowserSafetyState {
  const state: BrowserSafetyState = { bytes: 0, topLevelRequests: 0 };
  options.context.on('page', (page) => {
    if (page === options.page) return;
    state.violation ??= 'popup-attempted';
    void page.close({ runBeforeUnload: false }).catch(() => undefined);
  });
  options.page.on('download', (download) => {
    state.violation ??= 'download-attempted';
    void download.cancel().catch(() => undefined);
  });
  return state;
}

export async function pageMatchesVerifiedMarker(options: {
  readonly page: Page;
  readonly exactUrl: string;
  readonly selector: string;
  readonly expectedSchoolText?: string;
}): Promise<boolean> {
  if (options.page.url() !== options.exactUrl) return false;
  const marker = options.page.locator(options.selector);
  if ((await marker.count().catch(() => 0)) !== 1) return false;
  if (!(await marker.isVisible().catch(() => false))) return false;
  if (options.expectedSchoolText !== undefined) {
    const bodyText = await options.page
      .locator('body')
      .innerText()
      .catch(() => '');
    if (!bodyText.includes(options.expectedSchoolText)) return false;
  }
  return true;
}

export async function waitForVerifiedMarker(options: {
  readonly page: Page;
  readonly exactUrl: string;
  readonly selector: string;
  readonly expectedSchoolText?: string;
  readonly signal: AbortSignal;
  readonly safety: BrowserSafetyState;
}): Promise<boolean> {
  while (!options.signal.aborted && options.safety.violation === undefined) {
    if (
      await pageMatchesVerifiedMarker({
        page: options.page,
        exactUrl: options.exactUrl,
        selector: options.selector,
        ...(options.expectedSchoolText === undefined
          ? {}
          : { expectedSchoolText: options.expectedSchoolText }),
      })
    ) {
      return true;
    }
    await new Promise<void>((resolveWait) => setTimeout(resolveWait, 100));
  }
  return false;
}
