import type { BrowserContext, Page } from 'playwright-core';

import type { BellScheduleCapture } from '../../application/normalization/bell-schedule.js';
import {
  renderPowerSchoolBellPath,
  type PowerSchoolRoutineConfig,
} from '../../config/powerschool-session.js';
import {
  installPageSafetyGuards,
  launchPowerSchoolSessionContext,
} from './browser-runtime.js';
import {
  boundedSessionGet,
  type BoundedSessionRequestIdentity,
  type BoundedSessionGetResult,
  type SessionRejectionReason,
} from './bounded-session-http.js';
import {
  acquirePowerSchoolSessionLock,
  createTemporaryBrowserProfile,
  filterPowerSchoolStorageState,
  loadFilteredPowerSchoolState,
  removeTemporaryBrowserProfile,
  writeFilteredPowerSchoolState,
} from './protected-state.js';

export type PassivePowerSchoolResult =
  | { readonly status: 'captured'; readonly capture: BellScheduleCapture }
  | {
      readonly status: 'repair-required';
      readonly code:
        | 'bell-marker-missing'
        | 'bell-session-forbidden'
        | 'bell-session-redirect-authentication'
        | 'bell-session-redirect-cross-origin'
        | 'bell-session-redirect-invalid'
        | 'bell-session-redirect-same-origin'
        | 'bell-session-redirect-teacher'
        | 'bell-session-unauthorized'
        | 'session-state-missing'
        | 'status-session-forbidden'
        | 'status-session-redirect-authentication'
        | 'status-session-redirect-cross-origin'
        | 'status-session-redirect-invalid'
        | 'status-session-redirect-same-origin'
        | 'status-session-redirect-teacher'
        | 'status-session-unauthorized'
        | 'status-marker-missing';
    }
  | {
      readonly status: 'failed';
      readonly code:
        | 'aborted'
        | 'browser-unavailable'
        | 'collector-already-running'
        | 'response-budget-exceeded'
        | 'request-policy-violation'
        | 'session-state-unsafe'
        | 'timeout';
      readonly retryable: boolean;
    };

/**
 * Routine collection has no credential, repair, form, or identity-origin
 * capability. Exact bounded GETs are rendered in a network-blocked disposable
 * Chrome profile only after their redirect and byte policies have passed.
 */
export async function collectPassivePowerSchoolBell(options: {
  readonly config: PowerSchoolRoutineConfig;
  readonly requestedDate: string;
  readonly signal?: AbortSignal;
  readonly browserEnvironment?: NodeJS.ProcessEnv;
  readonly now?: () => string;
}): Promise<PassivePowerSchoolResult> {
  let lock;
  try {
    lock = acquirePowerSchoolSessionLock(options.config.sessionDirectory);
  } catch (error: unknown) {
    return setupFailure(error);
  }
  let temporaryProfile: string | undefined;
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
    let authenticationState;
    try {
      authenticationState = loadFilteredPowerSchoolState(
        options.config.sessionDirectory,
        options.config.powerSchoolOrigin,
      );
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        error.message === 'powerschool-session-state-missing'
      ) {
        return { status: 'repair-required', code: 'session-state-missing' };
      }
      return {
        status: 'failed',
        code: 'session-state-unsafe',
        retryable: false,
      };
    }
    temporaryProfile = createTemporaryBrowserProfile();
    context = await launchPowerSchoolSessionContext({
      profileDirectory: temporaryProfile,
      chromeExecutablePath: options.config.chromeExecutablePath,
      headless: true,
      javaScriptEnabled: false,
      timeoutMs: options.config.navigationTimeoutMs,
      environment: {
        ...(options.browserEnvironment ?? process.env),
        HOME: temporaryProfile,
      },
    });
    if (operationSignal.aborted) return abortedResult(timeoutSignal);
    context.setDefaultTimeout(options.config.navigationTimeoutMs);
    const page = await singlePage(context);
    const safety = installPageSafetyGuards({
      context,
      page,
    });
    await context.route('**/*', async (route) => {
      await route.abort('blockedbyclient');
    });
    await context.setStorageState(authenticationState);
    const requestIdentity = await browserRequestIdentity(
      page,
      options.config.powerSchoolOrigin,
    );

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
    let remainingBytes = options.config.maxResponseBytes;
    const statusRead = await boundedSessionGet({
      context,
      exactUrl: statusUrl,
      maximumBytes: remainingBytes,
      timeoutMs: options.config.navigationTimeoutMs,
      signal: operationSignal,
      requestIdentity,
    });
    if (statusRead.status === 'failed') {
      const statusFailure = mapReadFailure(statusRead);
      if (statusFailure === undefined) throw new Error('unmapped-read-failure');
      return statusFailure;
    }
    if (statusRead.status === 'repair-required') {
      return {
        status: 'repair-required',
        code: sessionRejectionCode('status', statusRead.reason),
      };
    }
    remainingBytes -= statusRead.bytes;
    const statusReady = await renderAndVerify({
      page,
      html: statusRead.html,
      baseUrl: statusUrl,
      selector: options.config.statusReadySelector,
      ...(options.config.expectedSchoolText === undefined
        ? {}
        : { expectedSchoolText: options.config.expectedSchoolText }),
      timeoutMs: options.config.navigationTimeoutMs,
    });
    if (operationSignal.aborted) return abortedResult(timeoutSignal);
    const statusSafety = safetyResult(safety.violation);
    if (statusSafety !== undefined) return statusSafety;
    if (!statusReady) {
      return { status: 'repair-required', code: 'status-marker-missing' };
    }

    const bellRead = await boundedSessionGet({
      context,
      exactUrl: bellUrl,
      maximumBytes: remainingBytes,
      timeoutMs: options.config.navigationTimeoutMs,
      signal: operationSignal,
      requestIdentity,
    });
    if (bellRead.status === 'failed') {
      const bellFailure = mapReadFailure(bellRead);
      if (bellFailure === undefined) throw new Error('unmapped-read-failure');
      return bellFailure;
    }
    if (bellRead.status === 'repair-required') {
      return {
        status: 'repair-required',
        code: sessionRejectionCode('bell', bellRead.reason),
      };
    }
    const bellReady = await renderAndVerify({
      page,
      html: bellRead.html,
      baseUrl: bellUrl,
      selector: options.config.bellReadySelector,
      ...(options.config.expectedSchoolText === undefined
        ? {}
        : { expectedSchoolText: options.config.expectedSchoolText }),
      timeoutMs: options.config.navigationTimeoutMs,
    });
    if (operationSignal.aborted) return abortedResult(timeoutSignal);
    const bellSafety = safetyResult(safety.violation);
    if (bellSafety !== undefined) return bellSafety;
    if (!bellReady) {
      return { status: 'repair-required', code: 'bell-marker-missing' };
    }
    const [title, text] = await Promise.all([
      page.title(),
      page.locator('body').innerText(),
    ]);
    const refreshed = filterPowerSchoolStorageState(
      await context.storageState({ indexedDB: true }),
      options.config.powerSchoolOrigin,
    );
    writeFilteredPowerSchoolState(
      options.config.sessionDirectory,
      options.config.powerSchoolOrigin,
      refreshed,
    );
    return {
      status: 'captured',
      capture: {
        title,
        html: bellRead.html,
        text,
        capturedAt: (options.now ?? (() => new Date().toISOString()))(),
        sourceReference: 'powerschool-bell-schedule',
        method: 'session-http',
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
    if (temporaryProfile !== undefined) {
      removeTemporaryBrowserProfile(temporaryProfile);
    }
    lock.release();
  }
}

function sessionRejectionCode(
  stage: 'bell' | 'status',
  reason: SessionRejectionReason,
):
  | 'bell-session-forbidden'
  | 'bell-session-redirect-authentication'
  | 'bell-session-redirect-cross-origin'
  | 'bell-session-redirect-invalid'
  | 'bell-session-redirect-same-origin'
  | 'bell-session-redirect-teacher'
  | 'bell-session-unauthorized'
  | 'status-session-forbidden'
  | 'status-session-redirect-authentication'
  | 'status-session-redirect-cross-origin'
  | 'status-session-redirect-invalid'
  | 'status-session-redirect-same-origin'
  | 'status-session-redirect-teacher'
  | 'status-session-unauthorized' {
  return `${stage}-session-${reason}`;
}

async function browserRequestIdentity(
  page: Page,
  powerSchoolOrigin: string,
): Promise<BoundedSessionRequestIdentity> {
  const browserUserAgent = await page.evaluate(() => navigator.userAgent);
  return {
    userAgent: browserUserAgent.replace('HeadlessChrome/', 'Chrome/'),
    referer: new URL(powerSchoolOrigin).href,
  };
}

async function renderAndVerify(options: {
  readonly page: Page;
  readonly html: string;
  readonly baseUrl: string;
  readonly selector: string;
  readonly expectedSchoolText?: string;
  readonly timeoutMs: number;
}): Promise<boolean> {
  const base = `<base href="${escapeHtml(options.baseUrl)}">`;
  const rendered = /<head(?:\s|>)/iu.test(options.html)
    ? options.html.replace(/<head([^>]*)>/iu, `<head$1>${base}`)
    : `${base}${options.html}`;
  await options.page.setContent(rendered, {
    waitUntil: 'load',
    timeout: options.timeoutMs,
  });
  await new Promise<void>((resolveWait) => setTimeout(resolveWait, 25));
  const marker = options.page.locator(options.selector);
  if ((await marker.count().catch(() => 0)) !== 1) return false;
  if (!(await marker.isVisible().catch(() => false))) return false;
  if (options.expectedSchoolText !== undefined) {
    const text = await options.page
      .locator('body')
      .innerText()
      .catch(() => '');
    if (!text.includes(options.expectedSchoolText)) return false;
  }
  return true;
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

function mapReadFailure(
  result: BoundedSessionGetResult,
): PassivePowerSchoolResult | undefined {
  if (result.status !== 'failed') return undefined;
  if (result.code === 'source-read-timeout') {
    return {
      status: 'failed',
      code: 'timeout',
      retryable: true,
    };
  }
  return {
    status: 'failed',
    code:
      result.code === 'source-read-unavailable'
        ? 'browser-unavailable'
        : result.code,
    retryable: result.retryable,
  };
}

function safetyResult(
  violation: ReturnType<typeof installPageSafetyGuards>['violation'],
): PassivePowerSchoolResult | undefined {
  if (violation === undefined) return undefined;
  return {
    status: 'failed',
    code:
      violation === 'byte-budget-exceeded'
        ? 'response-budget-exceeded'
        : 'request-policy-violation',
    retryable: false,
  };
}

function abortedResult(timeoutSignal: AbortSignal): PassivePowerSchoolResult {
  return {
    status: 'failed',
    code: timeoutSignal.aborted ? 'timeout' : 'aborted',
    retryable: timeoutSignal.aborted,
  };
}

function setupFailure(error: unknown): PassivePowerSchoolResult {
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

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}
