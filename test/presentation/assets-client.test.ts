import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  dismissalMediaContract,
  presentationAsset,
  presentationAssetRegistry,
} from '../../src/presentation/assets.js';

function source(path: string): string {
  return readFileSync(path, 'utf8');
}

test('asset registry is closed, repository-local, and resolves every declared file', () => {
  assert.deepEqual(Object.keys(presentationAssetRegistry).sort(), [
    '/assets/chalkwright.svg',
    '/assets/classroom-hub.svg',
    '/assets/dismissal-poster.svg',
    '/assets/display.css',
    '/assets/display.js',
  ]);
  for (const [publicPath, asset] of Object.entries(presentationAssetRegistry)) {
    assert.equal(asset.publicPath, publicPath);
    if (publicPath === '/assets/display.js') {
      assert.equal(asset.repositoryPath, 'dist/client/display-client.js');
    } else {
      assert.match(asset.repositoryPath, /^public\/[a-z0-9./-]+$/u);
    }
    assert.ok(source(asset.repositoryPath).length > 0);
    assert.deepEqual(presentationAsset(publicPath), asset);
  }
  assert.equal(presentationAsset('/assets/../package.json'), undefined);
  assert.equal(presentationAsset('/assets/unknown.js'), undefined);
});

test('dismissal media contract retains routes and fallback without bundling video', () => {
  assert.deepEqual(dismissalMediaContract, {
    publicPath: '/media/dismissal',
    compatibilityPath: '/media/horse.mp4',
    contentType: 'video/mp4',
    posterAssetPath: '/assets/dismissal-poster.svg',
    playableRepositoryFileIncluded: false,
    requirePlayableFileForApplicationReadiness: false,
    fallbackRevealMs: 2000,
  });
});

test('browser client preserves exact polling, timeout, backoff, and retained-DOM contracts', () => {
  const script = source('src/presentation/display-client.ts');
  assert.match(script, /requestTimeoutMs: 10000/u);
  assert.match(script, /healthyIntervalMs: 30000/u);
  assert.match(script, /initialRetryMs: 5000/u);
  assert.match(script, /maximumRetryMs: 120000/u);
  assert.match(script, /new AbortController\(\)/u);
  assert.match(script, /main\.innerHTML = html/u);
  assert.doesNotMatch(script, /applyTargetPayload\(lastGoodPayload\)/u);
  assert.match(script, /initialRetryMs \* 2 \*\*/u);
  assert.match(script, /Math\.min\(/u);
  assert.match(script, /cache: 'no-store'/u);
});

test('browser client includes countdown, carousel, swipe, hold, and media behavior', () => {
  const script = source('src/presentation/display-client.ts');
  for (const pattern of [
    /setInterval\(updateClock, 1000\)/u,
    /data-countdown-target/u,
    /revealAwareDuration/u,
    /data-carousel-pause/u,
    /pointerdown/u,
    /pointerup/u,
    /serverHeld/u,
    /meetingId/u,
    /data-media-scene/u,
    /canplay/u,
    /window\.setTimeout\(reveal, 2000\)/u,
    /video\.muted = true/u,
    /video\.preload = 'auto'/u,
  ])
    assert.match(script, pattern);
});

test('operator authorization remains closure-local and never enters URLs or browser storage', () => {
  const script = source('src/presentation/display-client.ts');
  assert.match(script, /let operatorAuthorization = ''/u);
  assert.match(script, /Authorization: `Bearer \$\{operatorAuthorization\}`/u);
  assert.match(
    script,
    /window\.prompt\('Operator authorization for this page'\)/u,
  );
  assert.doesNotMatch(
    script,
    /localStorage|sessionStorage|URLSearchParams\([^)]*operatorAuthorization/u,
  );
});

test('operator requests use exact JSON mutation methods and unsuffixed routes', () => {
  const script = source('src/presentation/display-client.ts');
  assert.match(script, /const method = form\.dataset\.httpMethod/u);
  assert.match(script, /kind === 'override'/u);
  assert.match(script, /kind === 'hold'/u);
  assert.match(script, /'Content-Type': 'application\/json'/u);
  assert.match(script, /body: JSON\.stringify\(request\.body\)/u);
  assert.match(script, /values\.effectiveAt/u);
  assert.match(script, /syntheticOperatorNow/u);
  assert.match(script, /heldAt: heldAt\.toISOString\(\)/u);
  assert.match(script, /expiresAt: new Date/u);
  assert.doesNotMatch(
    script,
    /application\/x-www-form-urlencoded|\/delete|\/release/u,
  );
});

test('pinned display clocks use the effective fixture instant and never poll without a target', () => {
  const script = source('src/presentation/display-client.ts');
  assert.match(script, /root\?\.dataset\.pinnedAt/u);
  assert.match(script, /serverClockAnchor/u);
  assert.match(script, /browserClockAnchor/u);
  assert.match(script, /if \(root\?\.dataset\.targetUrl\) schedulePoll\(0\)/u);
});

test('styles provide focus visibility, reduced motion, reflow, and bounded content', () => {
  const css = source('public/display.css');
  assert.match(css, /:focus-visible/u);
  assert.match(css, /outline:/u);
  assert.match(css, /prefers-reduced-motion: reduce/u);
  assert.match(
    css,
    /\.skip-link:focus-visible \{\s*transform: none !important/u,
  );
  assert.match(css, /@media \(max-width: 64rem\)/u);
  assert.match(css, /@media \(max-width: 32rem\)/u);
  assert.match(css, /overflow-wrap: anywhere/u);
  assert.match(css, /max-height: 66vh/u);
  assert.match(css, /\.scene-coming-up/u);
  assert.match(css, /\.state-idle \.meeting-label/u);
  assert.match(css, /\.state-day_complete \.meeting-label/u);
  assert.match(css, /\.media-layers\.mirrored/u);
  assert.match(css, /\.scene-countdown-footer/u);
  assert.match(css, /\.checkin-display-grid/u);
  assert.match(
    css,
    /grid-template-columns: repeat\(5, minmax\(5\.625rem, 1fr\)\)/u,
  );
  assert.match(css, /\.next-day-schedule/u);
  assert.match(css, /\.next-day-schedule \{\s*width: 100%/u);
  assert.match(css, /\.next-day-row/u);
  assert.doesNotMatch(css, /@import|https?:\/\//u);
});

test('SVG assets are offline and repository-owned', () => {
  for (const path of ['public/chalkwright.svg', 'public/dismissal-poster.svg'])
    assert.doesNotMatch(source(path), /(?:href|src)=["']https?:\/\//u);
});
