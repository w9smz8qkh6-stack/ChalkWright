import type { BrowserContext, Page } from 'playwright-core';

import {
  renderPowerSchoolBellPath,
  type PowerSchoolBootstrapConfig,
} from '../../config/powerschool-session.js';
import {
  launchPowerSchoolSessionContext,
  pageMatchesVerifiedMarker,
} from './browser-runtime.js';
import {
  acquirePowerSchoolSessionLock,
  createTemporaryBrowserProfile,
  filterPowerSchoolStorageState,
  removeTemporaryBrowserProfile,
  writeFilteredPowerSchoolState,
} from './protected-state.js';

export type PowerSchoolBootstrapResult =
  | { readonly status: 'authenticated' }
  | {
      readonly status: 'failed';
      readonly code:
        | 'aborted'
        | 'bootstrap-policy-violation'
        | 'browser-unavailable'
        | 'collector-already-running'
        | 'session-state-unsafe'
        | 'timeout';
    };

/**
 * Manual repair owns visible navigation only. It does not accept credentials,
 * form selectors, values, or an automation callback; the operator drives SSO.
 * Provider navigation is deliberately browser-native because identity flows may
 * use redirects, form posts, auxiliary origins, or additional tabs. The only
 * durable output is storage filtered to the exact PowerSchool origin.
 */
export async function bootstrapPowerSchoolSession(options: {
  readonly config: PowerSchoolBootstrapConfig;
  readonly requestedDate: string;
  readonly signal?: AbortSignal;
  readonly browserEnvironment?: NodeJS.ProcessEnv;
  /** Synthetic tests may replace only the browser launcher, never navigation. */
  readonly launchContext?: typeof launchPowerSchoolSessionContext;
}): Promise<PowerSchoolBootstrapResult> {
  let lock;
  try {
    lock = acquirePowerSchoolSessionLock(options.config.sessionDirectory);
  } catch (error: unknown) {
    return failureFromSetup(error);
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
    temporaryProfile = createTemporaryBrowserProfile();
    context = await (options.launchContext ?? launchPowerSchoolSessionContext)({
      profileDirectory: temporaryProfile,
      chromeExecutablePath: options.config.chromeExecutablePath,
      headless: false,
      javaScriptEnabled: true,
      timeoutMs: options.config.navigationTimeoutMs,
      environment: {
        ...(options.browserEnvironment ?? process.env),
        HOME: temporaryProfile,
      },
    });
    if (operationSignal.aborted) {
      return {
        status: 'failed',
        code: timeoutSignal.aborted ? 'timeout' : 'aborted',
      };
    }
    context.setDefaultTimeout(options.config.navigationTimeoutMs);
    context.setDefaultNavigationTimeout(options.config.navigationTimeoutMs);
    const page = await firstPage(context);
    const bellUrl = new URL(
      renderPowerSchoolBellPath(
        options.config.bellPathTemplate,
        options.requestedDate,
      ),
      options.config.powerSchoolOrigin,
    ).href;
    await page
      .goto(bellUrl, {
        waitUntil: 'domcontentloaded',
        timeout: options.config.navigationTimeoutMs,
      })
      .catch(() => undefined);
    const verified = await waitForVerifiedPage({
      context,
      exactUrl: bellUrl,
      selector: options.config.bellReadySelector,
      ...(options.config.expectedSchoolText === undefined
        ? {}
        : { expectedSchoolText: options.config.expectedSchoolText }),
      signal: operationSignal,
    });
    if (!verified) {
      if (operationSignal.aborted) {
        return {
          status: 'failed',
          code: timeoutSignal.aborted ? 'timeout' : 'aborted',
        };
      }
      return { status: 'failed', code: 'bootstrap-policy-violation' };
    }
    const filtered = filterPowerSchoolStorageState(
      await context.storageState({ indexedDB: true }),
      options.config.powerSchoolOrigin,
      await context.cookies(),
    );
    writeFilteredPowerSchoolState(
      options.config.sessionDirectory,
      options.config.powerSchoolOrigin,
      filtered,
    );
    return { status: 'authenticated' };
  } catch (error: unknown) {
    if (operationSignal.aborted) {
      return {
        status: 'failed',
        code: timeoutSignal.aborted ? 'timeout' : 'aborted',
      };
    }
    if (
      error instanceof Error &&
      (error.message.startsWith('powerschool-session') ||
        error.message.startsWith('powerschool-temporary-profile'))
    ) {
      return { status: 'failed', code: 'session-state-unsafe' };
    }
    return { status: 'failed', code: 'browser-unavailable' };
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

async function firstPage(context: BrowserContext): Promise<Page> {
  return context.pages()[0] ?? (await context.newPage());
}

async function waitForVerifiedPage(options: {
  readonly context: BrowserContext;
  readonly exactUrl: string;
  readonly selector: string;
  readonly expectedSchoolText?: string;
  readonly signal: AbortSignal;
}): Promise<boolean> {
  while (!options.signal.aborted) {
    const matches = await Promise.all(
      options.context.pages().map(async (page) =>
        pageMatchesVerifiedMarker({
          page,
          exactUrl: options.exactUrl,
          selector: options.selector,
          ...(options.expectedSchoolText === undefined
            ? {}
            : { expectedSchoolText: options.expectedSchoolText }),
        }),
      ),
    );
    if (matches.includes(true)) return true;
    await new Promise<void>((resolveWait) => setTimeout(resolveWait, 100));
  }
  return false;
}

function failureFromSetup(error: unknown): PowerSchoolBootstrapResult {
  if (
    error instanceof Error &&
    error.message === 'powerschool-session-concurrent'
  ) {
    return { status: 'failed', code: 'collector-already-running' };
  }
  return { status: 'failed', code: 'session-state-unsafe' };
}
