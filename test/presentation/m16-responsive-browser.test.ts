import assert from 'node:assert/strict';
import test from 'node:test';

import { chromium } from 'playwright-core';

import { startFixtureBackedMvp } from '../../src/app/mvp-server.js';
import { b407StateInstants } from '../../src/infrastructure/fixture/b407.js';

const expectedChrome = '150.0.7871.114';
const viewports = [
  { name: 'hikvision-native-output', width: 3_840, height: 2_160 },
  { name: 'legacy-large', width: 1_920, height: 1_080 },
  { name: 'legacy-laptop', width: 1_366, height: 768 },
] as const;

test('renders every accepted display state across the bounded kiosk viewport envelope', async () => {
  const application = await startFixtureBackedMvp(
    {
      nodeEnv: 'test',
      logLevel: 'warn',
      host: '127.0.0.1',
      port: 0,
    },
    process.cwd(),
    { legacyRouteCompatibility: true },
  );
  const browser = await chromium.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: true,
  });
  try {
    assert.equal(browser.version(), expectedChrome);
    for (const viewport of viewports) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        reducedMotion: 'reduce',
      });
      const page = await context.newPage();
      const consoleErrors: string[] = [];
      const pageErrors: string[] = [];
      const foreignRequests: string[] = [];
      const httpFailures: string[] = [];
      page.on('console', (message) => {
        if (message.type() === 'error') consoleErrors.push(message.text());
      });
      page.on('pageerror', (error) => pageErrors.push(error.name));
      page.on('request', (request) => {
        if (!request.url().startsWith(application.origin))
          foreignRequests.push(request.url().split('?')[0] ?? 'foreign');
      });
      page.on('response', (response) => {
        if (response.status() >= 400)
          httpFailures.push(
            `${response.status()}:${new URL(response.url()).pathname}`,
          );
      });

      for (const [state, now] of Object.entries(b407StateInstants)) {
        const response = await page.goto(
          `${application.origin}/classroom-screen/preview/b407?view=display&now=${encodeURIComponent(now)}`,
          { waitUntil: 'domcontentloaded' },
        );
        assert.equal(response?.status(), 200, `${viewport.name}:${state}`);
        await page.locator(`body.state-${state}`).waitFor();
        const layout = await page.evaluate(() => {
          const rectangle = document.body.getBoundingClientRect();
          return {
            innerWidth: window.innerWidth,
            innerHeight: window.innerHeight,
            scrollWidth: document.documentElement.scrollWidth,
            scrollHeight: document.documentElement.scrollHeight,
            left: rectangle.left,
            top: rectangle.top,
            right: rectangle.right,
            bottom: rectangle.bottom,
            reducedMotion: matchMedia('(prefers-reduced-motion: reduce)')
              .matches,
          };
        });
        assert.equal(layout.innerWidth, viewport.width);
        assert.equal(layout.innerHeight, viewport.height);
        assert.ok(
          layout.scrollWidth <= viewport.width,
          `${viewport.name}:${state}:horizontal-overflow`,
        );
        assert.ok(
          layout.scrollHeight <= viewport.height,
          `${viewport.name}:${state}:vertical-overflow`,
        );
        assert.ok(layout.left >= 0 && layout.top >= 0);
        assert.ok(
          layout.right <= viewport.width && layout.bottom <= viewport.height,
          `${viewport.name}:${state}:screen-bounds`,
        );
        assert.equal(layout.reducedMotion, true);
      }

      await page.keyboard.press('Tab');
      await page.waitForFunction(() => {
        const active = document.activeElement;
        return (
          active instanceof HTMLElement &&
          active.classList.contains('skip-link') &&
          active.getBoundingClientRect().top >= 0
        );
      });
      const focus = await page.evaluate(() => {
        const active = document.activeElement;
        if (!(active instanceof HTMLElement)) return undefined;
        const rectangle = active.getBoundingClientRect();
        return {
          className: active.className,
          left: rectangle.left,
          top: rectangle.top,
          right: rectangle.right,
          bottom: rectangle.bottom,
          outlineStyle: getComputedStyle(active).outlineStyle,
          transform: getComputedStyle(active).transform,
          focus: active.matches(':focus'),
          focusVisible: active.matches(':focus-visible'),
          focusRule: [...document.styleSheets].some((sheet) => {
            try {
              return [...sheet.cssRules].some(
                (rule) =>
                  rule instanceof CSSStyleRule &&
                  rule.selectorText.includes('.skip-link:focus'),
              );
            } catch {
              return false;
            }
          }),
        };
      });
      assert.match(focus?.className ?? '', /(?:^|\s)skip-link(?:\s|$)/u);
      assert.equal(focus?.focus, true);
      assert.equal(focus?.focusVisible, true);
      assert.equal(focus?.focusRule, true);
      assert.notEqual(focus?.outlineStyle, 'none');
      assert.equal(focus?.transform, 'none');
      assert.ok(
        focus !== undefined &&
          focus.left >= 0 &&
          focus.top >= 0 &&
          focus.right <= viewport.width &&
          focus.bottom <= viewport.height,
        `${viewport.name}:focused-skip-link:${JSON.stringify(focus)}`,
      );
      assert.ok((await page.screenshot()).byteLength > 10_000);
      assert.deepEqual(httpFailures, [], viewport.name);
      assert.deepEqual(consoleErrors, [], viewport.name);
      assert.deepEqual(pageErrors, [], viewport.name);
      assert.deepEqual(foreignRequests, [], viewport.name);
      await context.close();
    }
  } finally {
    await browser.close();
    await application.close();
  }
});
