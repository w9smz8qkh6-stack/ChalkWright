import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

import { startFixtureBackedMvp } from '../dist/app/mvp-server.js';
import { b407StateInstants } from '../dist/infrastructure/fixture/b407.js';

const expectedChrome = '150.0.7871.114';
const viewport = Object.freeze({ width: 1_920, height: 1_080 });
const state = 'pre_checkin';
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = join(repositoryRoot, 'docs', 'assets');
const imagePath = join(outputDirectory, 'classroom-hub-preview.png');
const manifestPath = join(outputDirectory, 'classroom-hub-preview.json');

if (process.argv.slice(2).join(' ') !== '--write') {
  process.stderr.write('public-preview-capture-usage-invalid\n');
  process.exitCode = 2;
} else {
  await capture();
}

async function capture() {
  const application = await startFixtureBackedMvp(
    {
      nodeEnv: 'test',
      logLevel: 'warn',
      host: '127.0.0.1',
      port: 0,
    },
    repositoryRoot,
    { legacyRouteCompatibility: true },
  );
  const browser = await chromium.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: true,
  });
  try {
    if (browser.version() !== expectedChrome)
      throw new Error('public-preview-capture-browser-drift');
    const context = await browser.newContext({
      viewport,
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    const failures = [];
    page.on('console', (message) => {
      if (message.type() === 'error') failures.push('console');
    });
    page.on('pageerror', () => failures.push('page'));
    page.on('request', (request) => {
      if (!request.url().startsWith(application.origin))
        failures.push('foreign');
    });
    page.on('response', (response) => {
      if (response.status() >= 400) failures.push('http');
    });
    const now = b407StateInstants[state];
    if (typeof now !== 'string')
      throw new Error('public-preview-capture-state-invalid');
    const response = await page.goto(
      `${application.origin}/classroom-screen/preview/b407?view=display&now=${encodeURIComponent(now)}`,
      { waitUntil: 'networkidle' },
    );
    if (response?.status() !== 200)
      throw new Error('public-preview-capture-response-invalid');
    await page.locator(`body.state-${state}`).waitFor();
    const layout = await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
    }));
    if (
      layout.width !== viewport.width ||
      layout.height !== viewport.height ||
      layout.scrollWidth > viewport.width ||
      layout.scrollHeight > viewport.height ||
      layout.reducedMotion !== true ||
      failures.length > 0
    )
      throw new Error('public-preview-capture-layout-invalid');

    mkdirSync(outputDirectory, { recursive: true });
    const temporaryImage = `${imagePath}.tmp`;
    await page.screenshot({
      path: temporaryImage,
      type: 'png',
      animations: 'disabled',
      caret: 'hide',
    });
    renameSync(temporaryImage, imagePath);
    const digest = createHash('sha256')
      .update(readFileSync(imagePath))
      .digest('hex');
    const manifest = {
      version: 1,
      source: 'repository-owned synthetic B407 fixture',
      state,
      instant: now,
      browser: `Google Chrome ${expectedChrome}`,
      viewport,
      reducedMotion: true,
      foreignRequests: 0,
      consoleErrors: 0,
      pageErrors: 0,
      httpFailures: 0,
      image: 'classroom-hub-preview.png',
      sha256: digest,
    };
    const temporaryManifest = `${manifestPath}.tmp`;
    writeFileSync(
      temporaryManifest,
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf8',
    );
    renameSync(temporaryManifest, manifestPath);
    process.stdout.write(
      `${JSON.stringify({ status: 'captured', state, valuesPrinted: 0 })}\n`,
    );
    await context.close();
  } finally {
    await browser.close();
    await application.close();
  }
}
