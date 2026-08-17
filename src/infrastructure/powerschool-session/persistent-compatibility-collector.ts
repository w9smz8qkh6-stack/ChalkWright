import type { BrowserContext, Page } from 'playwright-core';

import type { BellScheduleCapture } from '../../application/normalization/bell-schedule.js';
import type { PowerSchoolCompatibilityConfig } from '../../config/powerschool-session.js';
import { renderPowerSchoolBellPath } from '../../config/powerschool-session.js';
import type { IsoInstant } from '../../contracts/v1/common.js';
import {
  launchPowerSchoolSessionContext,
  pageMatchesVerifiedMarker,
} from './browser-runtime.js';
import {
  installAuthenticatedNetworkBoundary,
  type AuthenticatedNetworkViolationReason,
  type AuthenticatedNavigationSafetyState,
} from './authenticated-network-boundary.js';
import {
  acquirePowerSchoolSessionLock,
  ensureProtectedSessionDirectory,
} from './protected-state.js';

export type PersistentPowerSchoolCompatibilityResult =
  | { readonly status: 'captured'; readonly capture: BellScheduleCapture }
  | {
      readonly status: 'repair-required';
      readonly code:
        | 'compatibility-authentication-required'
        | 'compatibility-bell-marker-missing'
        | 'compatibility-status-marker-missing';
    }
  | {
      readonly status: 'failed';
      readonly code:
        | 'aborted'
        | 'browser-unavailable'
        | 'collector-already-running'
        | 'request-policy-violation'
        | 'response-budget-exceeded'
        | 'session-state-unsafe'
        | 'timeout';
      readonly retryable: boolean;
      readonly policyReason?: AuthenticatedNetworkViolationReason;
    };

type NavigationResult =
  | { readonly status: 'verified' }
  | { readonly status: 'authentication-required' }
  | { readonly status: 'marker-missing' }
  | {
      readonly status: 'policy-violation';
      readonly reason: AuthenticatedNetworkViolationReason;
    }
  | { readonly status: 'timeout' };

/**
 * Retained-profile schedule reader. Unlike the passive ADR-0014 collector,
 * this isolated application-owned capability intentionally retains a dedicated
 * Google-bearing profile so browser-native OIDC can silently renew a
 * PowerSchool session. It remains GET/HEAD-only on PowerSchool and never
 * receives credential values.
 */
export async function collectPersistentPowerSchoolBell(options: {
  readonly config: PowerSchoolCompatibilityConfig;
  readonly requestedDate: string;
  readonly signal?: AbortSignal;
  readonly browserEnvironment?: NodeJS.ProcessEnv;
  readonly now?: () => IsoInstant;
  readonly launchContext?: typeof launchPowerSchoolSessionContext;
}): Promise<PersistentPowerSchoolCompatibilityResult> {
  let lock;
  try {
    lock = acquirePowerSchoolSessionLock(options.config.sessionDirectory);
  } catch (error: unknown) {
    return setupFailure(error);
  }
  try {
    ensureProtectedSessionDirectory(options.config.persistentProfileDirectory, {
      create: true,
    });
  } catch (error: unknown) {
    lock.release();
    return setupFailure(error);
  }
  let context: BrowserContext | undefined;
  let closePromise: Promise<void> | undefined;
  const timeoutSignal = AbortSignal.timeout(options.config.overallTimeoutMs);
  const operationSignal =
    options.signal === undefined
      ? timeoutSignal
      : AbortSignal.any([options.signal, timeoutSignal]);
  const closeOnAbort = (): void => {
    if (context !== undefined && closePromise === undefined) {
      closePromise = context.close().catch(() => undefined);
    }
  };
  operationSignal.addEventListener('abort', closeOnAbort, { once: true });
  try {
    context = await (options.launchContext ?? launchPowerSchoolSessionContext)({
      profileDirectory: options.config.persistentProfileDirectory,
      chromeExecutablePath: options.config.chromeExecutablePath,
      headless: true,
      javaScriptEnabled: true,
      timeoutMs: options.config.navigationTimeoutMs,
      environment: {
        ...minimalBrowserEnvironment(options.browserEnvironment ?? process.env),
        HOME: options.config.persistentProfileDirectory,
      },
    });
    context.setDefaultTimeout(options.config.navigationTimeoutMs);
    context.setDefaultNavigationTimeout(options.config.navigationTimeoutMs);
    const page = await singlePage(context);
    const safety = await installAuthenticatedNetworkBoundary({
      context,
      page,
      config: options.config,
    });
    const statusUrl = new URL(
      options.config.statusPath,
      options.config.powerSchoolOrigin,
    ).href;
    const bellUrl = new URL(
      renderPowerSchoolBellPath(
        options.config.bellPathTemplate,
        options.requestedDate,
      ),
      options.config.powerSchoolOrigin,
    ).href;
    const status = await navigateToVerifiedMarker({
      page,
      exactUrl: statusUrl,
      selector: options.config.statusReadySelector,
      ...(options.config.expectedSchoolText === undefined
        ? {}
        : { expectedSchoolText: options.config.expectedSchoolText }),
      config: options.config,
      safety,
      signal: operationSignal,
    });
    const statusFailure = navigationFailure(status, 'status', timeoutSignal);
    if (statusFailure !== undefined) return statusFailure;

    const bell = await navigateToVerifiedMarker({
      page,
      exactUrl: bellUrl,
      selector: options.config.bellReadySelector,
      ...(options.config.expectedSchoolText === undefined
        ? {}
        : { expectedSchoolText: options.config.expectedSchoolText }),
      config: options.config,
      safety,
      signal: operationSignal,
    });
    const bellFailure = navigationFailure(bell, 'bell', timeoutSignal);
    if (bellFailure !== undefined) return bellFailure;
    const html = await page.content();
    const bytes = Buffer.byteLength(html, 'utf8');
    if (bytes > options.config.maxResponseBytes) {
      return {
        status: 'failed',
        code: 'response-budget-exceeded',
        retryable: false,
      };
    }
    const [title, text] = await Promise.all([
      page.title(),
      page.locator('body').innerText(),
    ]);
    return {
      status: 'captured',
      capture: {
        title,
        html,
        text,
        capturedAt: options.now?.() ?? (new Date().toISOString() as IsoInstant),
        sourceReference: 'powerschool-bell-schedule',
        method: 'browser-read',
      },
    };
  } catch {
    if (operationSignal.aborted) return abortedResult(timeoutSignal);
    return { status: 'failed', code: 'browser-unavailable', retryable: true };
  } finally {
    operationSignal.removeEventListener('abort', closeOnAbort);
    if (context !== undefined && closePromise === undefined) {
      closePromise = context.close().catch(() => undefined);
    }
    await closePromise;
    lock.release();
  }
}

function minimalBrowserEnvironment(
  source: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const output: NodeJS.ProcessEnv = {};
  for (const name of [
    'DBUS_SESSION_BUS_ADDRESS',
    'DISPLAY',
    'FONTCONFIG_PATH',
    'LANG',
    'PATH',
    'TMPDIR',
    'TZ',
    'WAYLAND_DISPLAY',
    'XAUTHORITY',
    'XDG_RUNTIME_DIR',
  ]) {
    const value = source[name];
    if (value !== undefined) output[name] = value;
  }
  return output;
}

async function navigateToVerifiedMarker(options: {
  readonly page: Page;
  readonly exactUrl: string;
  readonly selector: string;
  readonly expectedSchoolText?: string;
  readonly config: PowerSchoolCompatibilityConfig;
  readonly safety: AuthenticatedNavigationSafetyState;
  readonly signal: AbortSignal;
}): Promise<NavigationResult> {
  try {
    await options.page.goto(options.exactUrl, {
      waitUntil: 'domcontentloaded',
      timeout: options.config.navigationTimeoutMs,
      signal: options.signal,
    });
  } catch {
    if (options.signal.aborted) return { status: 'timeout' };
    const origin = safeOrigin(options.page.url());
    if (
      origin !== options.config.powerSchoolOrigin &&
      origin !== options.config.identityOrigin
    ) {
      return { status: 'policy-violation', reason: 'top-level-origin-blocked' };
    }
  }
  const deadline = Date.now() + options.config.navigationTimeoutMs;
  let retriedExactTarget = false;
  while (Date.now() < deadline && !options.signal.aborted) {
    if (options.safety.violation)
      return {
        status: 'policy-violation',
        reason: options.safety.violationReason ?? 'network-control-failed',
      };
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
      return { status: 'verified' };
    }
    const origin = safeOrigin(options.page.url());
    if (origin === options.config.identityOrigin) {
      if (await visibleAuthenticationControl(options.page)) {
        return { status: 'authentication-required' };
      }
    } else if (origin === options.config.powerSchoolOrigin) {
      if (options.page.url() !== options.exactUrl && !retriedExactTarget) {
        retriedExactTarget = true;
        await pause(250);
        await options.page
          .goto(options.exactUrl, {
            waitUntil: 'domcontentloaded',
            timeout: options.config.navigationTimeoutMs,
            signal: options.signal,
          })
          .catch(() => undefined);
      }
    } else if (origin !== null && origin !== 'null') {
      return { status: 'policy-violation', reason: 'top-level-origin-blocked' };
    }
    await pause(100);
  }
  if (options.signal.aborted) return { status: 'timeout' };
  return safeOrigin(options.page.url()) === options.config.identityOrigin
    ? { status: 'authentication-required' }
    : { status: 'marker-missing' };
}

async function visibleAuthenticationControl(page: Page): Promise<boolean> {
  const controls = page.locator(
    'input[name="identifier"],input[name="Passwd"],input[type="email"],input[type="password"],input[autocomplete="one-time-code"]',
  );
  for (let index = 0; index < (await controls.count()); index += 1) {
    if (
      await controls
        .nth(index)
        .isVisible()
        .catch(() => false)
    )
      return true;
  }
  const text = await page
    .locator('body')
    .innerText()
    .catch(() => '');
  return /check your phone|approve sign[ -]in|tap yes|captcha|passkey|security key|account recovery/iu.test(
    text,
  );
}

async function singlePage(context: BrowserContext): Promise<Page> {
  const pages = context.pages();
  const page = pages[0] ?? (await context.newPage());
  await Promise.all(
    context
      .pages()
      .filter((candidate) => candidate !== page)
      .map(async (candidate) => candidate.close({ runBeforeUnload: false })),
  );
  return page;
}

function navigationFailure(
  result: NavigationResult,
  stage: 'bell' | 'status',
  timeoutSignal: AbortSignal,
): PersistentPowerSchoolCompatibilityResult | undefined {
  switch (result.status) {
    case 'verified':
      return undefined;
    case 'authentication-required':
      return {
        status: 'repair-required',
        code: 'compatibility-authentication-required',
      };
    case 'marker-missing':
      return {
        status: 'repair-required',
        code:
          stage === 'status'
            ? 'compatibility-status-marker-missing'
            : 'compatibility-bell-marker-missing',
      };
    case 'policy-violation':
      return {
        status: 'failed',
        code: 'request-policy-violation',
        retryable: false,
        policyReason: result.reason,
      };
    case 'timeout':
      return abortedResult(timeoutSignal);
  }
}

function abortedResult(
  timeoutSignal: AbortSignal,
): PersistentPowerSchoolCompatibilityResult {
  return {
    status: 'failed',
    code: timeoutSignal.aborted ? 'timeout' : 'aborted',
    retryable: timeoutSignal.aborted,
  };
}

function setupFailure(
  error: unknown,
): PersistentPowerSchoolCompatibilityResult {
  if (
    error instanceof Error &&
    error.message === 'powerschool-session-concurrent'
  ) {
    return {
      status: 'failed',
      code: 'collector-already-running',
      retryable: false,
    };
  }
  return {
    status: 'failed',
    code: 'session-state-unsafe',
    retryable: false,
  };
}

function safeOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

async function pause(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
