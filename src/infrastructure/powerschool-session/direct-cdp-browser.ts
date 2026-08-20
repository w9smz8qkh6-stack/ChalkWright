import { spawn, type ChildProcess } from 'node:child_process';
import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readFileSync,
  unlinkSync,
} from 'node:fs';
import { join } from 'node:path';

import { chromium, type Browser, type BrowserContext } from 'playwright-core';

import { sanitizedChromeEnvironment } from './browser-runtime.js';

export interface DirectCdpPowerSchoolSession {
  readonly context: BrowserContext;
  close(): Promise<void>;
}

/**
 * Starts Chrome directly and attaches the locked Playwright client over CDP.
 * This is reserved for the high-authority repair worker. Chrome starts on an
 * inert local page in a fresh profile; the caller must install its context-wide
 * network policy before the first application navigation.
 */
export async function launchDirectCdpPowerSchoolSession(options: {
  readonly profileDirectory: string;
  readonly chromeExecutablePath: string;
  readonly headless: boolean;
  readonly javaScriptEnabled: boolean;
  readonly timeoutMs: number;
  readonly environment?: NodeJS.ProcessEnv;
  readonly signal?: AbortSignal;
}): Promise<DirectCdpPowerSchoolSession> {
  clearStaleDevToolsEndpoint(options.profileDirectory);
  const arguments_ = [
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-sync',
    '--no-default-browser-check',
    '--no-first-run',
    '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=0',
    `--user-data-dir=${options.profileDirectory}`,
    ...(options.headless ? ['--headless'] : []),
    'about:blank',
  ];
  let child: ChildProcess;
  try {
    child = spawn(options.chromeExecutablePath, arguments_, {
      detached: false,
      env: sanitizedChromeEnvironment(options.environment ?? process.env),
      shell: false,
      stdio: 'ignore',
    });
  } catch {
    throw new Error('powerschool-direct-chrome-start-failed');
  }
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
    await terminateChromeChild(child, 2_000);
  };
  try {
    browser = await connectDirectCdpBrowser({
      child,
      profileDirectory: options.profileDirectory,
      timeoutMs: options.timeoutMs,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    context = await browser.newContext({
      acceptDownloads: false,
      javaScriptEnabled: options.javaScriptEnabled,
      serviceWorkers: 'block',
    });
    for (const existingContext of browser.contexts()) {
      if (existingContext === context) continue;
      for (const page of existingContext.pages()) {
        await page.close({ runBeforeUnload: false }).catch(() => undefined);
      }
    }
    return { context, close };
  } catch (error: unknown) {
    await close();
    if (options.signal?.aborted === true) throw options.signal.reason;
    throw error;
  }
}

function clearStaleDevToolsEndpoint(profileDirectory: string): void {
  const path = join(profileDirectory, 'DevToolsActivePort');
  let descriptor: number;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error: unknown) {
    if (isErrno(error, 'ENOENT')) return;
    throw new Error('powerschool-direct-chrome-endpoint-unsafe');
  }
  try {
    const state = fstatSync(descriptor);
    if (
      !state.isFile() ||
      state.nlink !== 1 ||
      state.uid !== effectiveUid() ||
      state.size < 3 ||
      state.size > 1_024
    ) {
      throw new Error('powerschool-direct-chrome-endpoint-unsafe');
    }
  } finally {
    closeSync(descriptor);
  }
  try {
    unlinkSync(path);
  } catch (error: unknown) {
    if (isErrno(error, 'ENOENT')) return;
    throw new Error('powerschool-direct-chrome-endpoint-unsafe');
  }
}

/**
 * Chrome writes DevToolsActivePort just before its loopback HTTP endpoint can
 * reliably accept a connection. The repair worker is deliberately detached,
 * which makes that brief race observable more often than an interactive
 * launch. Retry only a refused local connection; other CDP failures remain
 * fail-closed.
 */
async function connectDirectCdpBrowser(options: {
  readonly child: ChildProcess;
  readonly profileDirectory: string;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
}): Promise<Browser> {
  const startedAt = performance.now();
  let lastRefusal: unknown;
  while (performance.now() - startedAt < options.timeoutMs) {
    const remainingMs = Math.max(
      1,
      Math.floor(options.timeoutMs - (performance.now() - startedAt)),
    );
    const endpoint = await waitForDevToolsEndpoint({
      ...options,
      timeoutMs: remainingMs,
    });
    try {
      return await chromium.connectOverCDP(endpoint, {
        isLocal: true,
        // A refused local port must not consume the complete Chrome-startup
        // budget. Keep each readiness probe short while preserving the caller's
        // original overall deadline.
        timeout: Math.min(250, remainingMs),
      });
    } catch (error: unknown) {
      if (!isConnectionRefused(error)) throw error;
      lastRefusal = error;
      await new Promise<void>((resolveWait) => setTimeout(resolveWait, 25));
    }
  }
  throw lastRefusal ?? new Error('powerschool-direct-chrome-timeout');
}

async function waitForDevToolsEndpoint(options: {
  readonly child: ChildProcess;
  readonly profileDirectory: string;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
}): Promise<string> {
  let exited = options.child.exitCode !== null;
  let startFailed = false;
  const recordExit = (): void => {
    exited = true;
  };
  const recordError = (): void => {
    startFailed = true;
  };
  options.child.once('exit', recordExit);
  options.child.once('error', recordError);
  const startedAt = performance.now();
  try {
    while (performance.now() - startedAt < options.timeoutMs) {
      if (options.signal?.aborted === true)
        throw new Error('powerschool-direct-chrome-aborted');
      if (startFailed)
        throw new Error('powerschool-direct-chrome-start-failed');
      if (exited) throw new Error('powerschool-direct-chrome-exited');
      const endpoint = readDevToolsEndpoint(options.profileDirectory);
      if (endpoint !== undefined) return endpoint;
      await new Promise<void>((resolveWait) => setTimeout(resolveWait, 25));
    }
  } finally {
    options.child.removeListener('exit', recordExit);
    options.child.removeListener('error', recordError);
  }
  throw new Error('powerschool-direct-chrome-timeout');
}

function readDevToolsEndpoint(profileDirectory: string): string | undefined {
  const path = join(profileDirectory, 'DevToolsActivePort');
  let descriptor: number;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error: unknown) {
    if (isErrno(error, 'ENOENT')) return undefined;
    throw new Error('powerschool-direct-chrome-endpoint-unsafe');
  }
  try {
    const state = fstatSync(descriptor);
    if (
      !state.isFile() ||
      state.nlink !== 1 ||
      state.uid !== effectiveUid() ||
      state.size < 3 ||
      state.size > 1_024
    ) {
      throw new Error('powerschool-direct-chrome-endpoint-unsafe');
    }
    const lines = readFileSync(descriptor, 'utf8').trimEnd().split('\n');
    if (lines.length !== 2) {
      throw new Error('powerschool-direct-chrome-endpoint-unsafe');
    }
    const port = Number(lines[0]);
    if (
      !Number.isSafeInteger(port) ||
      port < 1 ||
      port > 65_535 ||
      !/^\/devtools\/browser\/[A-Za-z0-9-]{16,128}$/u.test(lines[1] ?? '')
    ) {
      throw new Error('powerschool-direct-chrome-endpoint-unsafe');
    }
    return `http://127.0.0.1:${port}`;
  } finally {
    closeSync(descriptor);
  }
}

async function terminateChromeChild(
  child: ChildProcess,
  graceMs: number,
): Promise<void> {
  if (child.pid === undefined) return;
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  if (await waitForChildExit(child, graceMs)) return;
  child.kill('SIGKILL');
  await waitForChildExit(child, 1_000);
}

async function waitForChildExit(
  child: ChildProcess,
  maximumMs: number,
): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  return await new Promise<boolean>((resolveWait) => {
    const timer = setTimeout(() => {
      child.removeListener('exit', onExit);
      resolveWait(false);
    }, maximumMs);
    const onExit = (): void => {
      clearTimeout(timer);
      resolveWait(true);
    };
    child.once('exit', onExit);
  });
}

function effectiveUid(): number {
  if (typeof process.geteuid === 'function') return process.geteuid();
  if (typeof process.getuid === 'function') return process.getuid();
  throw new Error('powerschool-direct-chrome-owner-unavailable');
}

function isErrno(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}

function isConnectionRefused(error: unknown): boolean {
  return error instanceof Error && /\bECONNREFUSED\b/u.test(error.message);
}
