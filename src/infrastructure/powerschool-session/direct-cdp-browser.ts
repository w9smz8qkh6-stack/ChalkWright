import type { BrowserContext } from 'playwright-core';

import { launchPowerSchoolSessionContext } from './browser-runtime.js';

export interface DirectCdpPowerSchoolSession {
  readonly context: BrowserContext;
  close(): Promise<void>;
}

/**
 * Starts the protected repair browser through the sandboxed Playwright launch
 * path. The repair worker remains the short-lived process-group member that
 * owns and closes this context; no separately discovered DevTools HTTP port is
 * used for browser control.
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
  if (wasAborted(options.signal))
    throw new Error('powerschool-managed-chrome-aborted');
  const context = await launchPowerSchoolSessionContext({
    profileDirectory: options.profileDirectory,
    chromeExecutablePath: options.chromeExecutablePath,
    headless: options.headless,
    javaScriptEnabled: options.javaScriptEnabled,
    timeoutMs: options.timeoutMs,
    ...(options.environment === undefined
      ? {}
      : { environment: options.environment }),
  });
  if (wasAborted(options.signal)) {
    await context.close().catch(() => undefined);
    throw (
      options.signal?.reason ?? new Error('powerschool-managed-chrome-aborted')
    );
  }
  return { context, close: async (): Promise<void> => await context.close() };
}

function wasAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}
