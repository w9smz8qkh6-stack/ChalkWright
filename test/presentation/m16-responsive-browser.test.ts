import assert from 'node:assert/strict';
import test from 'node:test';

import { chromium } from 'playwright-core';

import { startFixtureBackedMvp } from '../../src/app/mvp-server.js';
import { b407StateInstants } from '../../src/infrastructure/fixture/b407.js';

const supportedChromeBuild = /^150\.0\.7871\.\d+$/u;
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
    assert.match(browser.version(), supportedChromeBuild);
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
        const displayedClock = await page.locator('[data-clock]').textContent();
        assert.match(displayedClock ?? '', /^\d{1,2}:\d{2} [AP]M$/u);
        if (state === 'in_class_content') {
          assert.doesNotMatch(
            await page.locator('body').innerText(),
            /Dismissal begins/u,
          );
          const objective = await page
            .locator('[data-carousel-card][data-card-id="objective-b407-a"]')
            .evaluate((card) => {
              const icons = [
                ...card.querySelectorAll<HTMLElement>(
                  '[data-objective-detail-icon]',
                ),
              ];
              const list = card.querySelector<HTMLElement>(
                '.objective-detail-list',
              );
              const badge = card.querySelector<HTMLElement>('.date-badge');
              if (!list || !badge)
                throw new Error('objective-detail-layout-missing');
              const badgeRectangle = badge.getBoundingClientRect();
              return {
                icons: icons.map((icon) => icon.textContent),
                iconsDecorative: icons.every(
                  (icon) => icon.getAttribute('aria-hidden') === 'true',
                ),
                month:
                  badge.querySelector('.date-badge-month')?.textContent ?? '',
                day: badge.querySelector('.date-badge-day')?.textContent ?? '',
                badgeDecorative: badge.getAttribute('aria-hidden') === 'true',
                badgeWidth: badgeRectangle.width,
                badgeHeight: badgeRectangle.height,
                listPaddingLeft: getComputedStyle(list).paddingLeft,
                listStyleType: getComputedStyle(list).listStyleType,
              };
            });
          assert.deepEqual(
            objective.icons,
            ['👉', '✅'],
            `${viewport.name}:objective-icons`,
          );
          assert.equal(objective.iconsDecorative, true, viewport.name);
          assert.equal(objective.month, 'APRIL', viewport.name);
          assert.equal(objective.day, '17', viewport.name);
          assert.equal(objective.badgeDecorative, true, viewport.name);
          assert.ok(objective.badgeWidth > 0, viewport.name);
          assert.ok(objective.badgeHeight > 0, viewport.name);
          assert.equal(objective.listPaddingLeft, '0px', viewport.name);
          assert.equal(objective.listStyleType, 'none', viewport.name);
        }
        const bell = await page
          .locator('[data-header-bell]')
          .evaluate((element) => ({
            hidden: (element as HTMLElement).hidden,
            value:
              element.querySelector('[data-header-bell-number]')?.textContent ??
              '',
            label: element.getAttribute('aria-label'),
          }));
        if (state === 'in_class_content') {
          assert.deepEqual(bell, {
            hidden: false,
            value: '60',
            label: '60 minutes until bell',
          });
        } else {
          assert.equal(bell.hidden, true, `${viewport.name}:${state}:bell`);
        }
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

test('during-class bell remains visible without horizontal overflow at tablet and mobile widths', async () => {
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
    assert.match(browser.version(), supportedChromeBuild);
    for (const viewport of [
      { name: 'tablet', width: 768, height: 1_024 },
      { name: 'mobile', width: 390, height: 844 },
    ] as const) {
      const context = await browser.newContext({
        viewport,
        reducedMotion: 'reduce',
      });
      const page = await context.newPage();
      const response = await page.goto(
        `${application.origin}/classroom-screen/preview/b407?view=display&now=${encodeURIComponent(b407StateInstants.in_class_content)}`,
        { waitUntil: 'domcontentloaded' },
      );
      assert.equal(response?.status(), 200, viewport.name);
      const result = await page.locator('.header-status').evaluate((status) => {
        const bell = status.querySelector<HTMLElement>('[data-header-bell]');
        const bellIcon = status.querySelector<HTMLElement>('.header-bell-icon');
        const bellNumber = status.querySelector<HTMLElement>(
          '[data-header-bell-number]',
        );
        const date = status.querySelector<HTMLElement>('[data-display-date]');
        const clock = status.querySelector<HTMLElement>('[data-clock]');
        if (!bell || !bellIcon || !bellNumber || !date || !clock)
          throw new Error('header-status-invalid');
        const rectangle = bell.getBoundingClientRect();
        const iconRectangle = bellIcon.getBoundingClientRect();
        const numberRectangle = bellNumber.getBoundingClientRect();
        const dateRectangle = date.getBoundingClientRect();
        const clockRectangle = clock.getBoundingClientRect();
        const numberStyle = getComputedStyle(bellNumber);
        return {
          hidden: bell.hidden,
          value:
            bell.querySelector('[data-header-bell-number]')?.textContent ?? '',
          left: rectangle.left,
          right: rectangle.right,
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth,
          reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
          dateRight: dateRectangle.right,
          clockLeft: clockRectangle.left,
          clockCenter: clockRectangle.top + clockRectangle.height / 2,
          bellCenter: rectangle.top + rectangle.height / 2,
          iconNumberGap: numberRectangle.left - iconRectangle.right,
          clusterCenter:
            iconRectangle.left +
            (numberRectangle.right - iconRectangle.left) / 2,
          badgeCenter: rectangle.left + rectangle.width / 2,
          numberJustification: numberStyle.justifyContent,
          numberTextAlignment: numberStyle.textAlign,
        };
      });
      assert.equal(result.hidden, false, viewport.name);
      assert.equal(result.value, '60', viewport.name);
      assert.ok(result.left >= 0, viewport.name);
      assert.ok(result.right <= result.innerWidth, viewport.name);
      assert.ok(result.scrollWidth <= result.innerWidth, viewport.name);
      assert.equal(result.reducedMotion, true, viewport.name);
      assert.ok(
        result.dateRight <= result.clockLeft,
        `${viewport.name}:date-order`,
      );
      assert.ok(
        Math.abs(result.clockCenter - result.bellCenter) <= 1,
        `${viewport.name}:bell-clock-alignment`,
      );
      assert.ok(
        result.iconNumberGap >= 0 && result.iconNumberGap <= 4.1,
        `${viewport.name}:bell-number-gap`,
      );
      assert.ok(
        Math.abs(result.clusterCenter - result.badgeCenter) <= 1,
        `${viewport.name}:bell-content-centering`,
      );
      assert.equal(result.numberJustification, 'center', viewport.name);
      assert.equal(result.numberTextAlignment, 'center', viewport.name);
      await context.close();
    }
  } finally {
    await browser.close();
    await application.close();
  }
});
