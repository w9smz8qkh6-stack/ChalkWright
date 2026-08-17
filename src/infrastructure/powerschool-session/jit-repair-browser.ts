import type { BrowserContext, Page } from 'playwright-core';

import {
  renderPowerSchoolBellPath,
  type PowerSchoolBootstrapConfig,
} from '../../config/powerschool-session.js';
import {
  launchPowerSchoolSessionContext,
  normalizedChromeUserAgent,
  pageMatchesVerifiedMarker,
} from './browser-runtime.js';
import {
  installAuthenticatedNetworkBoundary,
  type AuthenticatedNavigationSafetyState,
} from './authenticated-network-boundary.js';
import {
  launchDirectCdpPowerSchoolSession,
  type DirectCdpPowerSchoolSession,
} from './direct-cdp-browser.js';
import type { PowerSchoolRepairCredentials } from './repair-secret-packet.js';
import {
  acquirePowerSchoolSessionLock,
  createTemporaryBrowserProfile,
  ensureProtectedSessionDirectory,
  filterPowerSchoolStorageState,
  jitRepairTemporaryProfilePrefix,
  removeTemporaryBrowserProfile,
  writeFilteredPowerSchoolState,
} from './protected-state.js';

export type PowerSchoolJitRepairResult =
  | {
      readonly status: 'authenticated';
      readonly phoneApprovalObserved: boolean;
    }
  | {
      readonly status: 'failed';
      readonly code:
        | 'aborted'
        | 'browser-unavailable'
        | 'collector-already-running'
        | 'credential-rejected'
        | 'repair-policy-violation'
        | 'session-state-unsafe'
        | 'timeout';
    }
  | {
      readonly status: 'failed';
      readonly code: 'unexpected-challenge';
      readonly challengeCategory: PowerSchoolChallengeCategory;
    };

export type PowerSchoolChallengeCategory =
  | 'account-choice-ambiguous'
  | 'account-verification-required'
  | 'browser-rejected'
  | 'captcha-required'
  | 'passkey-or-security-key-required'
  | 'recovery-required'
  | 'selection-unrecognized'
  | 'unclassified';

const unrecognizedIdentityStepGraceMs = 10_000;

/**
 * High-authority repair browser. Only the dedicated repair worker may call it;
 * routine collection cannot import credentials or this module.
 */
export async function repairPowerSchoolSessionWithCredentials(options: {
  readonly config: PowerSchoolBootstrapConfig;
  readonly requestedDate: string;
  readonly credentials: PowerSchoolRepairCredentials;
  readonly signal?: AbortSignal;
  readonly browserEnvironment?: NodeJS.ProcessEnv;
  readonly headless?: boolean;
  readonly launchContext?: typeof launchPowerSchoolSessionContext;
  readonly persistentProfileDirectory?: string;
}): Promise<PowerSchoolJitRepairResult> {
  let lock;
  try {
    lock = acquirePowerSchoolSessionLock(options.config.sessionDirectory);
  } catch (error: unknown) {
    return setupFailure(error);
  }
  let profile: string | undefined;
  let context: BrowserContext | undefined;
  let browserSession: DirectCdpPowerSchoolSession | undefined;
  let closePromise: Promise<void> | undefined;
  let safety: AuthenticatedNavigationSafetyState | undefined;
  let browserLaunched = false;
  let temporaryProfile = false;
  const timeoutSignal = AbortSignal.timeout(options.config.overallTimeoutMs);
  let abortCode: 'aborted' | 'timeout' | undefined;
  const recordCallerAbort = (): void => {
    abortCode ??= 'aborted';
  };
  const recordTimeout = (): void => {
    abortCode ??= 'timeout';
  };
  options.signal?.addEventListener('abort', recordCallerAbort, { once: true });
  timeoutSignal.addEventListener('abort', recordTimeout, { once: true });
  const operationSignal =
    options.signal === undefined
      ? timeoutSignal
      : AbortSignal.any([options.signal, timeoutSignal]);
  const closeOnAbort = (): void => {
    if (browserSession !== undefined && closePromise === undefined) {
      closePromise = browserSession.close().catch(() => undefined);
    }
  };
  operationSignal.addEventListener('abort', closeOnAbort, { once: true });
  try {
    if (options.persistentProfileDirectory === undefined) {
      profile = createTemporaryBrowserProfile(jitRepairTemporaryProfilePrefix);
      temporaryProfile = true;
    } else {
      ensureProtectedSessionDirectory(options.persistentProfileDirectory, {
        create: true,
      });
      profile = options.persistentProfileDirectory;
    }
    const launchOptions = {
      profileDirectory: profile,
      chromeExecutablePath: options.config.chromeExecutablePath,
      headless: options.headless ?? false,
      javaScriptEnabled: true,
      timeoutMs: options.config.navigationTimeoutMs,
      environment: {
        ...(options.browserEnvironment ?? process.env),
        HOME: profile,
      },
    };
    if (options.launchContext === undefined) {
      browserSession = await launchDirectCdpPowerSchoolSession({
        ...launchOptions,
        signal: operationSignal,
      });
      context = browserSession.context;
    } else {
      const injectedContext = await options.launchContext(launchOptions);
      browserSession = {
        context: injectedContext,
        close: async () => await injectedContext.close(),
      };
      context = injectedContext;
    }
    browserLaunched = true;
    context.setDefaultTimeout(options.config.navigationTimeoutMs);
    context.setDefaultNavigationTimeout(options.config.navigationTimeoutMs);
    const page = context.pages()[0] ?? (await context.newPage());
    const browserUserAgent = await page.evaluate(() => navigator.userAgent);
    await context.setExtraHTTPHeaders({
      'user-agent': normalizedChromeUserAgent(browserUserAgent),
    });
    const bellUrl = new URL(
      renderPowerSchoolBellPath(
        options.config.bellPathTemplate,
        options.requestedDate,
      ),
      options.config.powerSchoolOrigin,
    ).href;
    safety = await installAuthenticatedNetworkBoundary({
      context,
      page,
      config: options.config,
    });
    try {
      await page.goto(bellUrl, {
        waitUntil: 'domcontentloaded',
        timeout: options.config.navigationTimeoutMs,
        signal: operationSignal,
      });
    } catch {
      // An identity flow may replace the initial document while Playwright is
      // still settling goto(). Continue only when the browser actually landed
      // on one of the two allowed origins; the installed request boundary and
      // the recognized-state driver remain authoritative.
      const origin = safeOrigin(page.url());
      if (
        !operationSignal.aborted &&
        safety.violation === false &&
        origin !== options.config.powerSchoolOrigin &&
        origin !== options.config.identityOrigin
      ) {
        return unexpectedChallenge('unclassified');
      }
    }
    const flow = await driveRecognizedRepairFlow({
      page,
      config: options.config,
      bellUrl,
      credentials: options.credentials,
      safety,
      signal: operationSignal,
    });
    if (
      flow.status === 'failed' &&
      flow.code === 'aborted' &&
      abortCode === 'timeout'
    ) {
      return { status: 'failed', code: 'timeout' };
    }
    if (flow.status !== 'authenticated') return flow;
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
    return flow;
  } catch (error: unknown) {
    if (operationSignal.aborted) {
      return {
        status: 'failed',
        code: abortCode ?? (timeoutSignal.aborted ? 'timeout' : 'aborted'),
      };
    }
    if (
      error instanceof Error &&
      (error.message.startsWith('powerschool-session') ||
        error.message.startsWith('powerschool-temporary-profile'))
    ) {
      return { status: 'failed', code: 'session-state-unsafe' };
    }
    if (safety?.violation === true) {
      return { status: 'failed', code: 'repair-policy-violation' };
    }
    return browserLaunched
      ? unexpectedChallenge('unclassified')
      : { status: 'failed', code: 'browser-unavailable' };
  } finally {
    operationSignal.removeEventListener('abort', closeOnAbort);
    options.signal?.removeEventListener('abort', recordCallerAbort);
    timeoutSignal.removeEventListener('abort', recordTimeout);
    if (browserSession !== undefined && closePromise === undefined) {
      closePromise = browserSession.close().catch(() => undefined);
    }
    await closePromise;
    if (profile !== undefined && temporaryProfile)
      removeTemporaryBrowserProfile(profile);
    lock.release();
  }
}

async function driveRecognizedRepairFlow(options: {
  readonly page: Page;
  readonly config: PowerSchoolBootstrapConfig;
  readonly bellUrl: string;
  readonly credentials: PowerSchoolRepairCredentials;
  readonly safety: AuthenticatedNavigationSafetyState;
  readonly signal: AbortSignal;
}): Promise<PowerSchoolJitRepairResult> {
  let emailSubmitted = false;
  let passwordSubmitted = false;
  let totpSubmitted = false;
  let phoneApprovalObserved = false;
  let alternateOptionsRequested = false;
  let unrecognizedSince: number | undefined;
  while (!options.signal.aborted && !options.safety.violation) {
    if (
      await pageMatchesVerifiedMarker({
        page: options.page,
        exactUrl: options.bellUrl,
        selector: options.config.bellReadySelector,
        ...(options.config.expectedSchoolText === undefined
          ? {}
          : { expectedSchoolText: options.config.expectedSchoolText }),
      })
    ) {
      return { status: 'authenticated', phoneApprovalObserved };
    }
    const origin = safeOrigin(options.page.url());
    if (origin === options.config.identityOrigin) {
      const body = await options.page
        .locator('body')
        .innerText()
        .catch(() => '');
      const normalized = body.replace(/\s+/gu, ' ').trim();
      if (/wrong password|incorrect password/iu.test(normalized)) {
        return { status: 'failed', code: 'credential-rejected' };
      }
      const phonePrompt =
        /check your phone|approve sign[ -]in|tap yes|open the gmail app/iu.test(
          normalized,
        );
      if (phonePrompt) {
        phoneApprovalObserved = true;
        unrecognizedSince = undefined;
        await pause();
        continue;
      }
      if (
        !emailSubmitted &&
        (await visibleCount(options.page, emailSelectors)) === 1
      ) {
        await fillFirst(
          options.page,
          emailSelectors,
          options.credentials.username,
        );
        await submitRecognized(options.page, [
          '#identifierNext',
          'button[type="submit"]',
        ]);
        emailSubmitted = true;
        unrecognizedSince = undefined;
        await pause(500);
        continue;
      }
      if (
        !passwordSubmitted &&
        (await visibleCount(options.page, passwordSelectors)) === 1
      ) {
        await fillFirst(
          options.page,
          passwordSelectors,
          options.credentials.password,
        );
        await submitRecognized(options.page, [
          '#passwordNext',
          'button[type="submit"]',
        ]);
        passwordSubmitted = true;
        unrecognizedSince = undefined;
        await pause(500);
        continue;
      }
      if (
        !totpSubmitted &&
        (await visibleCount(options.page, totpSelectors)) === 1
      ) {
        await fillFirst(options.page, totpSelectors, options.credentials.totp);
        await submitRecognized(options.page, ['button[type="submit"]']);
        totpSubmitted = true;
        unrecognizedSince = undefined;
        await pause(500);
        continue;
      }
      if (/choose an account/iu.test(normalized) && !emailSubmitted) {
        const exactAccount = options.page.getByText(
          options.credentials.username,
          {
            exact: true,
          },
        );
        if ((await exactAccount.count()) === 1) {
          await exactAccount.click();
        } else {
          const alternate = options.page.getByText('Use another account', {
            exact: true,
          });
          if ((await alternate.count()) !== 1)
            return unexpectedChallenge('account-choice-ambiguous');
          await alternate.click();
        }
        unrecognizedSince = undefined;
        await pause(500);
        continue;
      }
      const identityPath = safePath(options.page.url());
      if (
        identityPath?.includes('/challenge/selection') === true &&
        !passwordSubmitted
      ) {
        const passwordOption = options.page.getByText(/enter your password/iu, {
          exact: true,
        });
        if ((await passwordOption.count()) === 1) {
          await passwordOption.click();
          unrecognizedSince = undefined;
          await pause(500);
          continue;
        }
      }
      if (
        identityPath?.includes('/challenge/selection') === true &&
        !totpSubmitted
      ) {
        const authenticatorOption = options.page.getByText(
          /authenticator|enter a code|verification code/iu,
          { exact: true },
        );
        if ((await authenticatorOption.count()) === 1) {
          await authenticatorOption.click();
          unrecognizedSince = undefined;
          await pause(500);
          continue;
        }
      }
      if (!totpSubmitted && !alternateOptionsRequested) {
        const alternateOption = options.page.getByText(
          /^(?:try another way|another way|different way|choose another option)$/iu,
        );
        if ((await alternateOption.count()) === 1) {
          await alternateOption.click();
          alternateOptionsRequested = true;
          unrecognizedSince = undefined;
          await pause(500);
          continue;
        }
      }
      if (/try another way|choose another option/iu.test(normalized)) {
        const authenticator = options.page.getByText(
          /authenticator|enter a code|verification code/iu,
        );
        if ((await authenticator.count()) === 1) {
          await authenticator.click();
          unrecognizedSince = undefined;
          await pause(500);
          continue;
        }
      }
      unrecognizedSince ??= Date.now();
      if (Date.now() - unrecognizedSince > unrecognizedIdentityStepGraceMs)
        return unexpectedChallenge(
          classifyUnexpectedChallenge(identityPath, normalized),
        );
    } else if (origin === options.config.powerSchoolOrigin) {
      unrecognizedSince = undefined;
    } else if (origin !== null && origin !== 'null') {
      return { status: 'failed', code: 'repair-policy-violation' };
    }
    await pause();
  }
  if (options.signal.aborted) return { status: 'failed', code: 'aborted' };
  return { status: 'failed', code: 'repair-policy-violation' };
}

const emailSelectors = [
  'input[name="identifier"]',
  'input[autocomplete*="username"]',
  'input[type="email"]',
] as const;
const passwordSelectors = [
  'input[name="Passwd"]',
  'input[type="password"]',
] as const;
const totpSelectors = [
  'input[autocomplete="one-time-code"]',
  'input[name*="totpPin"]',
  'input[name*="code"]',
  'input[type="tel"]',
] as const;

async function visibleCount(
  page: Page,
  selectors: readonly string[],
): Promise<number> {
  const locator = page.locator(selectors.join(','));
  let count = 0;
  for (let index = 0; index < (await locator.count()); index += 1) {
    if (
      await locator
        .nth(index)
        .isVisible()
        .catch(() => false)
    )
      count += 1;
  }
  return count;
}

async function fillFirst(
  page: Page,
  selectors: readonly string[],
  value: string,
): Promise<void> {
  const filled = await page.evaluate(
    ({ selectorList, fieldValue }) => {
      const visible = (node: Element): boolean => {
        const style = getComputedStyle(node);
        const rectangle = node.getBoundingClientRect();
        return (
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          (rectangle.width > 0 || rectangle.height > 0)
        );
      };
      for (const selector of selectorList) {
        const node = [
          ...document.querySelectorAll<HTMLInputElement>(selector),
        ].find((candidate) => visible(candidate));
        if (node === undefined) continue;
        node.focus();
        const descriptor = Object.getOwnPropertyDescriptor(
          Object.getPrototypeOf(node) as object,
          'value',
        );
        if (descriptor?.set !== undefined)
          descriptor.set.call(node, fieldValue);
        else node.value = fieldValue;
        node.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            inputType: 'insertText',
            data: fieldValue,
          }),
        );
        node.dispatchEvent(new Event('change', { bubbles: true }));
        return node.value === fieldValue;
      }
      return false;
    },
    { selectorList: [...selectors], fieldValue: value },
  );
  if (!filled) throw new Error('powerschool-repair-field-missing');
}

async function submitRecognized(
  page: Page,
  selectors: readonly string[],
): Promise<void> {
  const submitted = await page.evaluate(
    (selectorList) => {
      const visible = (node: Element): boolean => {
        const style = getComputedStyle(node);
        const rectangle = node.getBoundingClientRect();
        return (
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          (rectangle.width > 0 || rectangle.height > 0)
        );
      };
      for (const selector of selectorList) {
        const node = [...document.querySelectorAll<HTMLElement>(selector)].find(
          (candidate) => visible(candidate),
        );
        if (node === undefined) continue;
        const clickable = node.matches(
          'button, a, [role="button"], [role="link"], input[type="submit"]',
        )
          ? node
          : (node.querySelector<HTMLElement>(
              'button, a, [role="button"], [role="link"], input[type="submit"]',
            ) ?? node);
        clickable.click();
        return true;
      }
      return false;
    },
    [...selectors],
  );
  if (!submitted) throw new Error('powerschool-repair-submit-missing');
}

function safeOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function safePath(value: string): string | null {
  try {
    return new URL(value).pathname;
  } catch {
    return null;
  }
}

function classifyUnexpectedChallenge(
  path: string | null,
  normalizedText: string,
): PowerSchoolChallengeCategory {
  if (
    /browser or app may not be secure|couldn.t sign you in|could not sign you in|cookies are disabled|javascript (?:is )?disabled/iu.test(
      normalizedText,
    )
  )
    return 'browser-rejected';
  if (
    /couldn.t verify|could not verify|can.t verify|verify (?:that )?this account belongs|verify it.s you/iu.test(
      normalizedText,
    )
  )
    return 'account-verification-required';
  if (/captcha|not a robot/iu.test(normalizedText)) return 'captcha-required';
  if (/security key|passkey/iu.test(normalizedText))
    return 'passkey-or-security-key-required';
  if (/recovery email|recovery phone|account recovery/iu.test(normalizedText))
    return 'recovery-required';
  if (path?.includes('/challenge/selection') === true)
    return 'selection-unrecognized';
  return 'unclassified';
}

function unexpectedChallenge(
  challengeCategory: PowerSchoolChallengeCategory,
): PowerSchoolJitRepairResult {
  return {
    status: 'failed',
    code: 'unexpected-challenge',
    challengeCategory,
  };
}

async function pause(milliseconds = 100): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function setupFailure(error: unknown): PowerSchoolJitRepairResult {
  if (
    error instanceof Error &&
    error.message === 'powerschool-session-concurrent'
  ) {
    return { status: 'failed', code: 'collector-already-running' };
  }
  return { status: 'failed', code: 'session-state-unsafe' };
}
