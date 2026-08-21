import { lstatSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, relative, resolve, sep } from 'node:path';

import {
  chromium,
  type BrowserContext,
  type CDPSession,
  type Cookie,
  type Page,
  type Request,
} from 'playwright-core';
import { isIsoDate } from '../../domain/runtime-validation.js';
import { BoundedOperationTimeoutError } from './timeout.js';

const MAX_TIMEOUT_MS = 30_000;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const PROFILE_PREFIX = 'classroom-hub-powerschool-profile-';
const activeProfiles = new Set<string>();

export interface PassiveBrowserReadOptions {
  readonly userDataDir: string;
  readonly allowedOrigin: string;
  readonly timeoutMs: number;
  readonly maxBodyBytes: number;
  readonly allowedRoutes: readonly PassiveBrowserRouteRule[];
  readonly allowedResources: readonly PassiveBrowserResourceRule[];
  /** Defaults to the synthetic M-07A ISO date marker. */
  readonly dateValueFormat?: 'iso-date' | 'mm/dd/yyyy';
  /** When set, `{date}` matches only this exact authorized ISO date. */
  readonly expectedDate?: string;
}

export interface PassiveBrowserRouteRule {
  /** Exact relative path template; the only supported placeholder is `{date}`. */
  readonly pathTemplate: string;
}

export type PassiveBrowserResourceType =
  'fetch' | 'font' | 'image' | 'script' | 'stylesheet' | 'xhr';

export interface PassiveBrowserResourceRule extends PassiveBrowserRouteRule {
  readonly resourceTypes: readonly PassiveBrowserResourceType[];
}

export interface PassiveBrowserReadRequest {
  readonly waitForSelector?: string;
}

export interface PassiveBrowserSnapshot {
  readonly url: string;
  readonly status: number | undefined;
  readonly title: string;
  readonly html: string;
  readonly text: string;
}

export type PassiveBrowserCookie = Readonly<Cookie>;

/**
 * A deliberately narrow browser capability for passive PowerSchool reads.
 * Navigation is restricted before the network boundary; DOM interaction and
 * form APIs are intentionally absent from this public surface.
 */
export class PassiveBrowserReadSession {
  readonly #context: BrowserContext;
  readonly #keeperPage: Page;
  readonly #profilePath: string;
  readonly #allowedOrigin: string;
  readonly #timeoutMs: number;
  readonly #maxBodyBytes: number;
  readonly #allowedRoutes: readonly ValidatedRouteRule[];
  readonly #allowedResources: readonly ValidatedResourceRule[];
  readonly #dateValueFormat: 'iso-date' | 'mm/dd/yyyy';
  readonly #expectedDate: string | undefined;
  #activeRead: ActiveRead | undefined;
  #forbiddenAttempted = false;
  #closed = false;
  #poisoned = false;

  private constructor(
    context: BrowserContext,
    keeperPage: Page,
    options: {
      readonly profilePath: string;
      readonly allowedOrigin: string;
      readonly timeoutMs: number;
      readonly maxBodyBytes: number;
      readonly allowedRoutes: readonly ValidatedRouteRule[];
      readonly allowedResources: readonly ValidatedResourceRule[];
      readonly dateValueFormat: 'iso-date' | 'mm/dd/yyyy';
      readonly expectedDate: string | undefined;
    },
  ) {
    this.#context = context;
    this.#keeperPage = keeperPage;
    this.#profilePath = options.profilePath;
    this.#allowedOrigin = options.allowedOrigin;
    this.#timeoutMs = options.timeoutMs;
    this.#maxBodyBytes = options.maxBodyBytes;
    this.#allowedRoutes = options.allowedRoutes;
    this.#allowedResources = options.allowedResources;
    this.#dateValueFormat = options.dateValueFormat;
    this.#expectedDate = options.expectedDate;
  }

  static async launch(
    options: PassiveBrowserReadOptions,
  ): Promise<PassiveBrowserReadSession> {
    const profilePath = validateProfilePath(options.userDataDir);
    const allowedOrigin = validateOrigin(options.allowedOrigin);
    const timeoutMs = validateBoundedInteger(
      'timeoutMs',
      options.timeoutMs,
      MAX_TIMEOUT_MS,
    );
    const maxBodyBytes = validateBoundedInteger(
      'maxBodyBytes',
      options.maxBodyBytes,
      MAX_BODY_BYTES,
    );
    const dateValueFormat = options.dateValueFormat ?? 'iso-date';
    if (
      options.expectedDate !== undefined &&
      !isIsoDate(options.expectedDate)
    ) {
      throw new Error('browser-expected-date-invalid');
    }
    if (
      dateValueFormat === 'mm/dd/yyyy' &&
      options.expectedDate === undefined
    ) {
      throw new Error('browser-expected-date-required');
    }
    const expectedDate = options.expectedDate;
    const allowedRoutes = validateRouteRules(
      options.allowedRoutes,
      dateValueFormat,
      expectedDate,
    );
    const allowedResources = validateResourceRules(
      options.allowedResources,
      dateValueFormat,
      expectedDate,
    );

    if (activeProfiles.has(profilePath)) {
      throw new Error('browser-profile-in-use');
    }
    activeProfiles.add(profilePath);

    let context: BrowserContext | undefined;
    try {
      context = await chromium.launchPersistentContext(profilePath, {
        channel: 'chrome',
        headless: true,
        acceptDownloads: false,
        serviceWorkers: 'block',
        timeout: timeoutMs,
      });
      context.setDefaultNavigationTimeout(timeoutMs);
      context.setDefaultTimeout(timeoutMs);

      const existingPages = context.pages();
      const keeperPage = existingPages[0] ?? (await context.newPage());
      const session = new PassiveBrowserReadSession(context, keeperPage, {
        profilePath,
        allowedOrigin,
        timeoutMs,
        maxBodyBytes,
        allowedRoutes,
        allowedResources,
        dateValueFormat,
        expectedDate,
      });
      await context.route('**/*', async (route) => {
        const request = route.request();
        const method = request.method().toUpperCase();
        const requestOrigin = safeOrigin(request.url());
        if (
          (method !== 'GET' && method !== 'HEAD') ||
          requestOrigin !== allowedOrigin ||
          !session.#requestIsAllowed(request)
        ) {
          if (session.#activeRead !== undefined)
            session.#forbiddenAttempted = true;
          await route.abort('blockedbyclient');
          return;
        }
        await route.continue();
      });
      await Promise.all(
        context
          .pages()
          .filter((page) => page !== keeperPage)
          .map(async (page) => page.close({ runBeforeUnload: false })),
      );
      return session;
    } catch (error) {
      activeProfiles.delete(profilePath);
      if (context !== undefined) {
        await context.close().catch(() => undefined);
      }
      throw error;
    }
  }

  get forbiddenAttempted(): boolean {
    return this.#forbiddenAttempted;
  }

  async read(
    path: string,
    request: PassiveBrowserReadRequest = {},
  ): Promise<PassiveBrowserSnapshot> {
    this.#assertOpen();
    if (this.#activeRead !== undefined)
      throw new Error('browser-read-in-progress');
    validateSelector(request.waitForSelector);
    const target = resolveTarget(path, this.#allowedOrigin);
    if (
      !matchesRule(
        new URL(target),
        this.#allowedRoutes,
        true,
        this.#dateValueFormat,
        this.#expectedDate,
      )
    ) {
      this.#forbiddenAttempted = true;
      throw new Error('browser-route-forbidden');
    }

    const active: ActiveRead = {
      budget: {
        declaredBytes: 0,
        streamedBytes: 0,
        finishedBytes: 0,
        exceeded: false,
      },
      aborted: false,
    };
    this.#activeRead = active;
    let rejectDeadline: ((error: Error) => void) | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      rejectDeadline = reject;
    });
    const timer = setTimeout(() => {
      active.aborted = true;
      this.#stopLoading(active);
      rejectDeadline?.(new BoundedOperationTimeoutError());
    }, this.#timeoutMs);
    const operation = this.#readOnDisposablePage(active, target, request);
    let result: PassiveBrowserSnapshot | undefined;
    let failure: unknown;
    try {
      result = await Promise.race([operation, deadline]);
    } catch (error: unknown) {
      failure = error;
    } finally {
      clearTimeout(timer);
      active.aborted = true;
      const quiesced = await awaitBoundedBrowserQuiescence(
        operation,
        async () => this.#disposeActiveRead(active),
        quiescenceWindow(this.#timeoutMs),
      );
      if (quiesced) {
        if (this.#activeRead === active) this.#activeRead = undefined;
      } else {
        this.#poisoned = true;
        this.#forbiddenAttempted = true;
        void this.#context.close().catch(() => undefined);
      }
    }
    if (this.#poisoned) throw new Error('browser-session-poisoned');
    // A byte-budget breach can stop page loading before Playwright settles the
    // navigation promise. Preserve the stricter acquisition failure even when
    // the enclosing deadline wins that race under a loaded host.
    if (active.budget.exceeded) throw new Error('browser-body-too-large');
    if (failure !== undefined) throw failure;
    if (result === undefined) throw new Error('browser-read-unavailable');
    return result;
  }

  async #readOnDisposablePage(
    active: ActiveRead,
    target: string,
    request: PassiveBrowserReadRequest,
  ): Promise<PassiveBrowserSnapshot> {
    const page = await this.#context.newPage();
    active.page = page;
    if (active.aborted) throw new BoundedOperationTimeoutError();
    const cdp = await this.#context.newCDPSession(page);
    active.cdp = cdp;
    await cdp.send('Network.enable');
    this.#installBudgetGuards(active, page, cdp);
    if (active.aborted) throw new BoundedOperationTimeoutError();
    let response;
    try {
      response = await page.goto(target, {
        timeout: this.#timeoutMs,
        waitUntil: 'domcontentloaded',
      });
      await page.waitForLoadState('load', { timeout: this.#timeoutMs });
    } catch (error) {
      if (active.budget.exceeded) throw new Error('browser-body-too-large');
      throw error;
    }
    if (active.budget.exceeded) throw new Error('browser-body-too-large');
    if (request.waitForSelector !== undefined) {
      await page.waitForSelector(request.waitForSelector, {
        state: 'attached',
        timeout: this.#timeoutMs,
      });
    }

    const [title, html, text] = await Promise.all([
      page.title(),
      page.content(),
      page.locator('body').textContent(),
    ]);
    const normalizedText = text ?? '';
    if (
      Buffer.byteLength(html, 'utf8') > this.#maxBodyBytes ||
      Buffer.byteLength(normalizedText, 'utf8') > this.#maxBodyBytes
    ) {
      throw new Error('browser-body-too-large');
    }

    return {
      url: page.url(),
      status: response?.status(),
      title,
      html,
      text: normalizedText,
    };
  }

  /** Cookies remain inside the infrastructure adapter and are origin-scoped. */
  async cookies(): Promise<readonly PassiveBrowserCookie[]> {
    this.#assertOpen();
    return this.#context.cookies(this.#allowedOrigin);
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    try {
      if (this.#activeRead !== undefined) {
        this.#activeRead.aborted = true;
        await this.#disposeActiveRead(this.#activeRead);
      }
      await this.#keeperPage
        .close({ runBeforeUnload: false })
        .catch(() => undefined);
      await this.#context.close();
    } finally {
      activeProfiles.delete(this.#profilePath);
    }
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error('browser-session-closed');
    if (this.#poisoned) throw new Error('browser-session-poisoned');
  }

  #requestIsAllowed(request: Request): boolean {
    const active = this.#activeRead;
    if (
      this.#poisoned ||
      active?.aborted !== false ||
      active.page === undefined ||
      request.frame().page() !== active.page
    ) {
      return false;
    }
    const url = new URL(request.url());
    if (
      request.isNavigationRequest() &&
      request.frame() === active.page.mainFrame()
    ) {
      return matchesRule(
        url,
        this.#allowedRoutes,
        false,
        this.#dateValueFormat,
        this.#expectedDate,
      );
    }
    const resourceType = request.resourceType();
    if (!isPassiveResourceType(resourceType)) return false;
    return this.#allowedResources.some(
      (rule) =>
        rule.resourceTypes.has(resourceType) &&
        matchesRule(
          url,
          [rule],
          false,
          this.#dateValueFormat,
          this.#expectedDate,
        ),
    );
  }

  #installBudgetGuards(active: ActiveRead, page: Page, cdp: CDPSession): void {
    page.on('response', (response) => {
      const budget = active.budget;
      if (this.#activeRead !== active || budget.exceeded) return;
      const header = response.headers()['content-length'];
      if (header === undefined) return;
      const bytes = Number(header);
      if (!Number.isSafeInteger(bytes) || bytes < 0) {
        this.#exceedBudget(active);
        return;
      }
      budget.declaredBytes += bytes;
      if (budget.declaredBytes > this.#maxBodyBytes) this.#exceedBudget(active);
    });
    page.on('requestfinished', (request) => {
      const budget = active.budget;
      if (this.#activeRead !== active || budget.exceeded) return;
      void request
        .sizes()
        .then(({ responseBodySize }) => {
          if (this.#activeRead !== active || budget.exceeded) return;
          budget.finishedBytes += responseBodySize;
          if (budget.finishedBytes > this.#maxBodyBytes)
            this.#exceedBudget(active);
        })
        .catch(() => this.#exceedBudget(active));
    });
    cdp.on('Network.dataReceived', (event: { readonly dataLength: number }) => {
      const budget = active.budget;
      if (this.#activeRead !== active || budget.exceeded) return;
      if (!Number.isSafeInteger(event.dataLength) || event.dataLength < 0) {
        this.#exceedBudget(active);
        return;
      }
      budget.streamedBytes += event.dataLength;
      if (budget.streamedBytes > this.#maxBodyBytes) this.#exceedBudget(active);
    });
  }

  #exceedBudget(active: ActiveRead): void {
    const budget = active.budget;
    if (this.#activeRead !== active || budget.exceeded) return;
    budget.exceeded = true;
    this.#stopLoading(active);
  }

  #stopLoading(active: ActiveRead): void {
    void active.cdp?.send('Page.stopLoading').catch(() => undefined);
  }

  async #disposeActiveRead(active: ActiveRead): Promise<void> {
    await active.page?.close({ runBeforeUnload: false }).catch(() => undefined);
    await active.cdp?.detach().catch(() => undefined);
  }
}

/**
 * Confirms that a browser operation and its cleanup quiesce within a separate
 * bounded window. A false result requires the owning session to fail closed.
 */
export async function awaitBoundedBrowserQuiescence(
  operation: Promise<unknown>,
  cleanup: () => Promise<void>,
  timeoutMs: number,
): Promise<boolean> {
  const quiescence = (async () => {
    await cleanup();
    await operation.catch(() => undefined);
    await cleanup();
    return true as const;
  })().catch(() => false as const);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  try {
    return await Promise.race([quiescence, expired]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function quiescenceWindow(operationTimeoutMs: number): number {
  return Math.max(25, Math.min(250, Math.floor(operationTimeoutMs / 4)));
}

interface ActiveRead {
  page?: Page;
  cdp?: CDPSession;
  readonly budget: ReadBudget;
  aborted: boolean;
}

interface ValidatedRouteRule {
  readonly pathTemplate: string;
}

interface ValidatedResourceRule extends ValidatedRouteRule {
  readonly resourceTypes: ReadonlySet<PassiveBrowserResourceType>;
}

interface ReadBudget {
  declaredBytes: number;
  streamedBytes: number;
  finishedBytes: number;
  exceeded: boolean;
}

function validateProfilePath(input: string): string {
  if (!isAbsolute(input)) throw new Error('browser-profile-must-be-absolute');
  const resolved = resolve(input);
  if (resolved !== input) throw new Error('browser-profile-must-be-canonical');
  const stat = lstatSync(resolved);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error('browser-profile-must-be-real-directory');
  }
  const canonical = realpathSync(resolved);
  if (canonical !== resolved)
    throw new Error('browser-profile-symlink-rejected');

  const temporaryRoot = realpathSync(tmpdir());
  const fromTemporaryRoot = relative(temporaryRoot, canonical);
  if (
    fromTemporaryRoot.length === 0 ||
    fromTemporaryRoot === '..' ||
    fromTemporaryRoot.startsWith(`..${sep}`) ||
    basename(canonical).startsWith(PROFILE_PREFIX) === false
  ) {
    throw new Error('browser-profile-not-dedicated-temporary-directory');
  }
  return canonical;
}

function validateOrigin(input: string): string {
  const url = new URL(input);
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username !== '' ||
    url.password !== '' ||
    url.pathname !== '/' ||
    url.search !== '' ||
    url.hash !== '' ||
    input !== url.origin
  ) {
    throw new Error('browser-origin-invalid');
  }
  return url.origin;
}

function validateBoundedInteger(
  name: string,
  value: number,
  maximum: number,
): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`browser-${name}-out-of-range`);
  }
  return value;
}

function resolveTarget(path: string, allowedOrigin: string): string {
  if (!path.startsWith('/') || path.startsWith('//')) {
    throw new Error('browser-path-invalid');
  }
  const target = new URL(path, allowedOrigin);
  if (target.origin !== allowedOrigin)
    throw new Error('browser-origin-forbidden');
  return target.href;
}

function validateSelector(selector: string | undefined): void {
  if (
    selector !== undefined &&
    (selector.length === 0 || selector.length > 256)
  ) {
    throw new Error('browser-selector-invalid');
  }
}

function validateRouteRules(
  rules: readonly PassiveBrowserRouteRule[],
  dateValueFormat: 'iso-date' | 'mm/dd/yyyy',
  expectedDate: string | undefined,
): readonly ValidatedRouteRule[] {
  if (rules.length < 1 || rules.length > 32) {
    throw new Error('browser-route-rules-invalid');
  }
  const validated = rules.map((rule) =>
    validateRouteRule(rule, dateValueFormat, expectedDate),
  );
  if (new Set(validated.map(ruleKey)).size !== validated.length) {
    throw new Error('browser-route-rules-invalid');
  }
  return validated;
}

function validateResourceRules(
  rules: readonly PassiveBrowserResourceRule[],
  dateValueFormat: 'iso-date' | 'mm/dd/yyyy',
  expectedDate: string | undefined,
): readonly ValidatedResourceRule[] {
  if (rules.length > 64) throw new Error('browser-resource-rules-invalid');
  return rules.map((rule) => {
    const base = validateRouteRule(rule, dateValueFormat, expectedDate);
    if (
      rule.resourceTypes.length < 1 ||
      rule.resourceTypes.length > 6 ||
      new Set(rule.resourceTypes).size !== rule.resourceTypes.length ||
      rule.resourceTypes.some(
        (type) =>
          !['fetch', 'font', 'image', 'script', 'stylesheet', 'xhr'].includes(
            type,
          ),
      )
    ) {
      throw new Error('browser-resource-rules-invalid');
    }
    return { ...base, resourceTypes: new Set(rule.resourceTypes) };
  });
}

function validateRouteRule(
  rule: PassiveBrowserRouteRule,
  dateValueFormat: 'iso-date' | 'mm/dd/yyyy',
  expectedDate: string | undefined,
): ValidatedRouteRule {
  const template = rule.pathTemplate;
  if (
    typeof template !== 'string' ||
    template.length < 1 ||
    template.length > 512 ||
    !template.startsWith('/') ||
    template.startsWith('//') ||
    /[\\\u0000-\u001f]/u.test(template) ||
    (template.match(/\{date\}/g)?.length ?? 0) > 1 ||
    /\{(?!date\})|(?<!\{date)\}/u.test(template)
  ) {
    throw new Error('browser-route-rules-invalid');
  }
  new URL(
    template.replace(
      '{date}',
      formatDateValue(expectedDate ?? '2035-04-13', dateValueFormat),
    ),
    'https://synthetic.invalid',
  );
  return { pathTemplate: template };
}

function matchesRule(
  url: URL,
  rules: readonly ValidatedRouteRule[],
  includeFragment: boolean,
  dateValueFormat: 'iso-date' | 'mm/dd/yyyy',
  expectedDate: string | undefined,
): boolean {
  const actual = `${url.pathname}${url.search}${includeFragment ? url.hash : ''}`;
  return rules.some((rule) =>
    matchesPathTemplate(
      actual,
      includeFragment ? rule.pathTemplate : rule.pathTemplate.split('#', 1)[0]!,
      dateValueFormat,
      expectedDate,
    ),
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

function ruleKey(rule: ValidatedRouteRule): string {
  return rule.pathTemplate;
}

function isPassiveResourceType(
  value: string,
): value is PassiveBrowserResourceType {
  return ['fetch', 'font', 'image', 'script', 'stylesheet', 'xhr'].includes(
    value,
  );
}

function safeOrigin(input: string): string | undefined {
  try {
    return new URL(input).origin;
  } catch {
    return undefined;
  }
}
