import type {
  BrowserContext,
  CDPSession,
  Page,
  Response as PlaywrightResponse,
} from 'playwright-core';

import type { BellScheduleCapture } from '../../application/normalization/bell-schedule.js';
import {
  renderPowerSchoolBellPath,
  type PowerSchoolRoutineConfig,
} from '../../config/powerschool-session.js';
import {
  installPageSafetyGuards,
  launchPowerSchoolSessionContext,
  normalizedChromeUserAgent,
  pageMatchesVerifiedMarker,
} from './browser-runtime.js';
import {
  boundedSessionGet,
  type BoundedSessionRequestIdentity,
  type BoundedSessionGetResult,
  type SessionRejectionReason,
} from './bounded-session-http.js';
import {
  applyFilteredPowerSchoolState,
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
  readonly beforeStopBrowserLoading?: () => Promise<void>;
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
    await applyFilteredPowerSchoolState(context, authenticationState);
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
    if (
      statusRead.status === 'repair-required' &&
      statusRead.reason !== 'redirect-authentication'
    ) {
      return {
        status: 'repair-required',
        code: sessionRejectionCode('status', statusRead.reason),
      };
    }
    if (statusRead.status === 'captured') {
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
      if (bellRead.reason === 'redirect-authentication') {
        const browserRead = await browserNativeBellRead({
          context,
          page,
          exactUrl: bellUrl,
          maximumBytes: remainingBytes,
          timeoutMs: options.config.navigationTimeoutMs,
          signal: operationSignal,
          timeoutSignal,
          requestIdentity,
          safety,
          selector: options.config.bellReadySelector,
          ...(options.beforeStopBrowserLoading === undefined
            ? {}
            : { beforeStopBrowserLoading: options.beforeStopBrowserLoading }),
          ...(options.config.expectedSchoolText === undefined
            ? {}
            : { expectedSchoolText: options.config.expectedSchoolText }),
        });
        if (browserRead.status === 'captured') {
          const refreshed = filterPowerSchoolStorageState(
            await context.storageState({ indexedDB: true }),
            options.config.powerSchoolOrigin,
            await context.cookies(),
          );
          writeFilteredPowerSchoolState(
            options.config.sessionDirectory,
            options.config.powerSchoolOrigin,
            refreshed,
          );
          return {
            status: 'captured',
            capture: {
              title: browserRead.title,
              html: browserRead.html,
              text: browserRead.text,
              capturedAt: (options.now ?? (() => new Date().toISOString()))(),
              sourceReference: 'powerschool-bell-schedule',
              method: 'browser-read',
            },
          };
        }
        if (browserRead.status === 'failed') return browserRead.result;
      }
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
      await context.cookies(),
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

type BrowserNativeBellReadResult =
  | {
      readonly status: 'captured';
      readonly html: string;
      readonly text: string;
      readonly title: string;
    }
  | { readonly status: 'not-authenticated' }
  | {
      readonly status: 'failed';
      readonly result: Extract<PassivePowerSchoolResult, { status: 'failed' }>;
    };

interface PausedBrowserRequest {
  readonly requestId: string;
  readonly resourceType: string;
  readonly responseErrorReason?: string;
  readonly responseStatusCode?: number;
  readonly responseHeaders?: readonly {
    readonly name: string;
    readonly value: string;
  }[];
  readonly request: {
    readonly method: string;
    readonly url: string;
  };
}

/**
 * One exact browser-native retry for a bell request rejected by session HTTP.
 * It reuses only the filtered PowerSchool state; every other browser request,
 * including an authentication redirect, is aborted before the wire.
 */
async function browserNativeBellRead(options: {
  readonly context: BrowserContext;
  readonly page: Page;
  readonly exactUrl: string;
  readonly maximumBytes: number;
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
  readonly timeoutSignal: AbortSignal;
  readonly requestIdentity: BoundedSessionRequestIdentity;
  readonly safety: ReturnType<typeof installPageSafetyGuards>;
  readonly selector: string;
  readonly expectedSchoolText?: string;
  readonly beforeStopBrowserLoading?: () => Promise<void>;
}): Promise<BrowserNativeBellReadResult> {
  await options.context.unrouteAll({ behavior: 'wait' });
  await options.context.setExtraHTTPHeaders({
    'user-agent': options.requestIdentity.userAgent,
  });
  let exactNavigationRequests = 0;
  let interceptionFailed = false;
  let responseRejected = false;
  let responseFailureCode:
    | 'browser-unavailable'
    | 'request-policy-violation'
    | 'response-budget-exceeded'
    | undefined;
  let capturedResponseBytes: Buffer | undefined;
  const cdp: CDPSession = await options.context.newCDPSession(options.page);
  const pendingInterceptions = new Set<Promise<void>>();
  const settleInterceptions = async (): Promise<void> => {
    while (pendingInterceptions.size > 0) {
      await Promise.allSettled([...pendingInterceptions]);
    }
  };
  const handlePausedRequest = (event: PausedBrowserRequest): void => {
    const task = (async () => {
      try {
        if (
          event.responseStatusCode !== undefined ||
          event.responseErrorReason !== undefined
        ) {
          if (
            event.request.url !== options.exactUrl ||
            event.resourceType !== 'Document' ||
            event.responseErrorReason !== undefined
          ) {
            responseFailureCode = 'request-policy-violation';
            await cdp.send('Fetch.failRequest', {
              requestId: event.requestId,
              errorReason: 'BlockedByClient',
            });
            return;
          }
          if (
            event.responseStatusCode === undefined ||
            event.responseStatusCode < 200 ||
            event.responseStatusCode >= 300
          ) {
            responseRejected = true;
            await cdp.send('Fetch.failRequest', {
              requestId: event.requestId,
              errorReason: 'BlockedByClient',
            });
            return;
          }
          const headers = event.responseHeaders ?? [];
          const contentType = headerValue(headers, 'content-type');
          if (
            !/^text\/html(?:;|$)|^application\/xhtml\+xml(?:;|$)/iu.test(
              contentType,
            )
          ) {
            responseFailureCode = 'request-policy-violation';
            await fulfillRejectedBrowserResponse(cdp, event.requestId, 415);
            return;
          }
          const declaredLength = headerValue(headers, 'content-length');
          if (declaredLength.length > 0) {
            const declared = Number(declaredLength);
            if (
              !Number.isSafeInteger(declared) ||
              declared < 0 ||
              declared > options.maximumBytes
            ) {
              responseFailureCode = 'response-budget-exceeded';
              await fulfillRejectedBrowserResponse(cdp, event.requestId, 413);
              return;
            }
          }
          const body = await readPausedResponseBody({
            cdp,
            requestId: event.requestId,
            maximumBytes: options.maximumBytes,
            signal: options.signal,
          });
          if (body === undefined) {
            responseFailureCode = options.signal.aborted
              ? 'browser-unavailable'
              : 'response-budget-exceeded';
            await fulfillRejectedBrowserResponse(cdp, event.requestId, 413);
            return;
          }
          capturedResponseBytes = body;
          await cdp.send('Fetch.fulfillRequest', {
            requestId: event.requestId,
            responseCode: event.responseStatusCode,
            responseHeaders: fulfilledBrowserHeaders(headers, body.byteLength),
            body: body.toString('base64'),
          });
          return;
        }
        if (
          exactNavigationRequests === 0 &&
          event.request.method === 'GET' &&
          event.resourceType === 'Document' &&
          event.request.url === options.exactUrl
        ) {
          exactNavigationRequests += 1;
          await cdp.send('Fetch.continueRequest', {
            requestId: event.requestId,
          });
          return;
        }
        await cdp.send('Fetch.failRequest', {
          requestId: event.requestId,
          errorReason: 'BlockedByClient',
        });
      } catch {
        interceptionFailed = true;
      }
    })();
    pendingInterceptions.add(task);
    void task.finally(() => pendingInterceptions.delete(task));
  };
  cdp.on('Fetch.requestPaused', handlePausedRequest);
  await cdp.send('Fetch.enable', {
    patterns: [
      { urlPattern: '*', requestStage: 'Request' },
      { urlPattern: options.exactUrl, requestStage: 'Response' },
    ],
  });
  try {
    let response: PlaywrightResponse | null;
    try {
      response = await options.page.goto(options.exactUrl, {
        waitUntil: 'domcontentloaded',
        timeout: options.timeoutMs,
        signal: options.signal,
      });
    } catch {
      await settleInterceptions();
      if (options.signal.aborted) {
        return {
          status: 'failed',
          result: abortedResult(options.timeoutSignal),
        };
      }
      if (responseFailureCode !== undefined) {
        return browserReadFailure(responseFailureCode);
      }
      if (responseRejected) return { status: 'not-authenticated' };
      return browserReadFailure('request-policy-violation');
    }
    if (options.signal.aborted) {
      return { status: 'failed', result: abortedResult(options.timeoutSignal) };
    }
    await options.beforeStopBrowserLoading?.().catch(() => {
      interceptionFailed = true;
    });
    if (!interceptionFailed) {
      await cdp.send('Page.stopLoading').catch(() => {
        interceptionFailed = true;
      });
    }
    await settleInterceptions();
    if (options.signal.aborted) {
      return { status: 'failed', result: abortedResult(options.timeoutSignal) };
    }
    if (responseFailureCode !== undefined) {
      return browserReadFailure(responseFailureCode);
    }
    if (
      interceptionFailed ||
      options.safety.violation !== undefined ||
      exactNavigationRequests !== 1
    ) {
      return {
        status: 'failed',
        result: {
          status: 'failed',
          code: 'request-policy-violation',
          retryable: false,
        },
      };
    }
    if (
      response === null ||
      response.url() !== options.exactUrl ||
      response.status() < 200 ||
      response.status() >= 300
    ) {
      return { status: 'not-authenticated' };
    }
    if (capturedResponseBytes === undefined) {
      return browserReadFailure('request-policy-violation');
    }
    let html: string;
    try {
      html = new TextDecoder('utf-8', { fatal: true }).decode(
        capturedResponseBytes,
      );
    } catch {
      return {
        status: 'failed',
        result: {
          status: 'failed',
          code: 'request-policy-violation',
          retryable: false,
        },
      };
    }
    const verified = await pageMatchesVerifiedMarker({
      page: options.page,
      exactUrl: options.exactUrl,
      selector: options.selector,
      ...(options.expectedSchoolText === undefined
        ? {}
        : { expectedSchoolText: options.expectedSchoolText }),
    });
    if (!verified) return { status: 'not-authenticated' };
    const [title, text] = await Promise.all([
      options.page.title(),
      options.page.locator('body').innerText(),
    ]);
    return { status: 'captured', html, text, title };
  } finally {
    await cdp.send('Fetch.disable').catch(() => undefined);
    await settleInterceptions();
    cdp.off('Fetch.requestPaused', handlePausedRequest);
    await cdp.detach().catch(() => undefined);
  }
}

function browserReadFailure(
  code:
    | 'browser-unavailable'
    | 'request-policy-violation'
    | 'response-budget-exceeded',
): BrowserNativeBellReadResult {
  return {
    status: 'failed',
    result: {
      status: 'failed',
      code,
      retryable: code === 'browser-unavailable',
    },
  };
}

function headerValue(
  headers: readonly { readonly name: string; readonly value: string }[],
  name: string,
): string {
  return (
    headers.find((header) => header.name.toLowerCase() === name)?.value ?? ''
  );
}

async function readPausedResponseBody(options: {
  readonly cdp: CDPSession;
  readonly requestId: string;
  readonly maximumBytes: number;
  readonly signal: AbortSignal;
}): Promise<Buffer | undefined> {
  const { stream } = await options.cdp.send('Fetch.takeResponseBodyAsStream', {
    requestId: options.requestId,
  });
  const chunks: Buffer[] = [];
  let length = 0;
  try {
    while (!options.signal.aborted) {
      const part = await options.cdp.send('IO.read', {
        handle: stream,
        size: 64 * 1024,
      });
      const chunk = Buffer.from(
        part.data,
        part.base64Encoded === true ? 'base64' : 'utf8',
      );
      length += chunk.byteLength;
      if (length > options.maximumBytes) return undefined;
      chunks.push(chunk);
      if (part.eof) return Buffer.concat(chunks, length);
    }
    return undefined;
  } finally {
    await options.cdp
      .send('IO.close', { handle: stream })
      .catch(() => undefined);
  }
}

function fulfilledBrowserHeaders(
  headers: readonly { readonly name: string; readonly value: string }[],
  bodyLength: number,
): { name: string; value: string }[] {
  const retained = headers.filter(
    (header) =>
      !/^(?:content-encoding|content-length|transfer-encoding)$/iu.test(
        header.name,
      ),
  );
  return [...retained, { name: 'content-length', value: String(bodyLength) }];
}

async function fulfillRejectedBrowserResponse(
  cdp: CDPSession,
  requestId: string,
  responseCode: 413 | 415,
): Promise<void> {
  await cdp.send('Fetch.fulfillRequest', {
    requestId,
    responseCode,
    responseHeaders: [{ name: 'content-length', value: '0' }],
    body: '',
  });
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
    userAgent: normalizedChromeUserAgent(browserUserAgent),
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

function abortedResult(
  timeoutSignal: AbortSignal,
): Extract<PassivePowerSchoolResult, { readonly status: 'failed' }> {
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
