import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import { chromium } from 'playwright-core';

import { renderDisplayPage } from '../../src/presentation/html.js';
import type { DisplayPresentationModel } from '../../src/presentation/models.js';

const model: DisplayPresentationModel = {
  screenId: 'screen-glossary',
  planId: 'plan-glossary',
  date: '2035-04-13',
  timeZone: 'Etc/UTC',
  evaluatedAt: '2035-04-13T08:30:00Z',
  state: 'in_class_content',
  currentMeeting: {
    meetingId: 'meeting-glossary',
    courseLabel: 'Web Design',
    blockLabel: 'A',
    checkInOpensAt: '2035-04-13T07:55:00Z',
    officialStartsAt: '2035-04-13T08:00:00Z',
    contentStartsAt: '2035-04-13T08:00:00Z',
    dismissalStartsAt: '2035-04-13T08:55:00Z',
    officialEndsAt: '2035-04-13T09:00:00Z',
  },
  cards: [
    {
      cardId: 'card-glossary',
      type: 'vocabulary',
      title: 'Word of the day',
      lines: [],
      vocabulary: {
        term: 'Responsive Web Design',
        definition:
          'A way to make a website adapt clearly to different screen sizes.',
        example: 'Responsive web design keeps the navigation usable.',
        translations: [
          {
            languageCode: 'vi',
            term: 'Thiết kế web đáp ứng',
            definition:
              'Cách làm cho trang web thích ứng rõ ràng với các kích thước màn hình khác nhau.',
            example: 'Thiết kế web đáp ứng giúp điều hướng dễ sử dụng.',
          },
          {
            languageCode: 'ko',
            term: '반응형 웹 디자인',
            definition:
              '웹사이트가 다양한 화면 크기에 명확하게 맞도록 만드는 방법입니다.',
            example: '반응형 웹 디자인은 탐색을 사용하기 쉽게 유지합니다.',
          },
          {
            languageCode: 'zh-Hans',
            term: '响应式网页设计',
            definition: '一种让网站清晰适应不同屏幕尺寸的方法。',
            example: '响应式网页设计使导航保持易用。',
          },
        ],
      },
    },
  ],
  diagnostics: [],
  pinnedAt: '2035-04-13T08:30:00Z',
};

async function startVocabularyServer(): Promise<{
  readonly origin: string;
  readonly close: () => Promise<void>;
}> {
  const html = renderDisplayPage(model);
  const css = readFileSync('public/display.css');
  const client = readFileSync('dist/client/display-client.js');
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://fixture.invalid').pathname;
    if (path === '/') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(html);
      return;
    }
    if (path === '/assets/display.css') {
      response.writeHead(200, { 'content-type': 'text/css; charset=utf-8' });
      response.end(css);
      return;
    }
    if (path === '/assets/display.js') {
      response.writeHead(200, {
        'content-type': 'text/javascript; charset=utf-8',
      });
      response.end(client);
      return;
    }
    if (path === '/manifest.webmanifest') {
      response.writeHead(200, {
        'content-type': 'application/manifest+json; charset=utf-8',
      });
      response.end('{}');
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) =>
          error === undefined ? resolve() : reject(error),
        );
      }),
  };
}

test('multilingual vocabulary keeps English anchored while the panel flips through three translations', async () => {
  const fixture = await startVocabularyServer();
  const browser = await chromium.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: true,
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 1_920, height: 1_080 },
      reducedMotion: 'no-preference',
    });
    const page = await context.newPage();
    await page.addInitScript(() => {
      const originalSetTimeout = window.setTimeout.bind(window);
      const vocabularyCallbacks: Array<() => void> = [];
      (
        window as unknown as { __advanceVocabulary: () => void }
      ).__advanceVocabulary = () => vocabularyCallbacks.shift()?.();
      window.setTimeout = ((
        handler: TimerHandler,
        timeout?: number,
        ...arguments_: unknown[]
      ) => {
        if (timeout === 6000 && typeof handler === 'function') {
          vocabularyCallbacks.push(() => handler(...arguments_));
          return 900_000 + vocabularyCallbacks.length;
        }
        return originalSetTimeout(handler, timeout, ...arguments_);
      }) as typeof window.setTimeout;
    });
    await page.goto(fixture.origin, { waitUntil: 'domcontentloaded' });
    const labels = await page
      .locator('.vocabulary-panel-face')
      .evaluateAll((faces) =>
        faces.map((face) => face.getAttribute('aria-label')),
      );
    assert.deepEqual(labels, [
      'English vocabulary',
      'Vietnamese vocabulary',
      'Korean vocabulary',
      'Simplified Chinese vocabulary',
    ]);

    const anchoredTerm = await page
      .locator('.vocabulary-anchor h2')
      .innerText();
    const activeLabels: (string | null)[] = [];
    for (let index = 0; index < labels.length; index += 1) {
      activeLabels.push(
        await page
          .locator('.vocabulary-panel-face.is-active')
          .getAttribute('aria-label'),
      );
      assert.equal(
        await page.locator('.vocabulary-anchor h2').innerText(),
        anchoredTerm,
      );
      assert.equal(
        await page.locator('.vocabulary-panel-face.is-active').count(),
        1,
      );
      if (index < labels.length - 1)
        await page.evaluate(() =>
          (
            window as unknown as { __advanceVocabulary: () => void }
          ).__advanceVocabulary(),
        );
    }
    assert.deepEqual(activeLabels, labels);

    const layout = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
    }));
    assert.ok(layout.width <= layout.innerWidth, 'horizontal-overflow');
    assert.ok(layout.height <= layout.innerHeight, 'vertical-overflow');
    await context.close();
  } finally {
    await browser.close();
    await fixture.close();
  }
});

test('reduced motion preserves one readable vocabulary face without overflow', async () => {
  const fixture = await startVocabularyServer();
  const browser = await chromium.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: true,
  });
  try {
    for (const viewport of [
      { width: 1_920, height: 1_080 },
      { width: 1_366, height: 768 },
      { width: 768, height: 1_024 },
    ]) {
      const context = await browser.newContext({
        viewport,
        reducedMotion: 'reduce',
      });
      const page = await context.newPage();
      await page.goto(fixture.origin, { waitUntil: 'domcontentloaded' });
      const result = await page
        .locator('.vocabulary-stage')
        .evaluate((stage) => ({
          faceCount: stage.querySelectorAll('.vocabulary-panel-face').length,
          visibleCount: [
            ...stage.querySelectorAll('.vocabulary-panel-face'),
          ].filter((face) => getComputedStyle(face).opacity === '1').length,
          stageBottom: stage.getBoundingClientRect().bottom,
          viewportHeight: window.innerHeight,
          scrollWidth: document.documentElement.scrollWidth,
          viewportWidth: window.innerWidth,
          scrollHeight: document.documentElement.scrollHeight,
          bodyMargin: getComputedStyle(document.body).margin,
        }));
      assert.equal(result.faceCount, 4);
      assert.equal(result.visibleCount, 1);
      assert.equal(result.bodyMargin, '0px');
      assert.ok(
        result.stageBottom <= result.viewportHeight,
        `stage-bounds:${JSON.stringify({ viewport, result })}`,
      );
      assert.ok(
        result.scrollWidth <= result.viewportWidth,
        `horizontal-overflow:${JSON.stringify({ viewport, result })}`,
      );
      assert.ok(
        result.scrollHeight <= result.viewportHeight,
        `vertical-overflow:${JSON.stringify({ viewport, result })}`,
      );
      await context.close();
    }
  } finally {
    await browser.close();
    await fixture.close();
  }
});
