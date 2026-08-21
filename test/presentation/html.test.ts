import assert from 'node:assert/strict';
import test from 'node:test';

import { displayStates } from '../../src/contracts/v1/display.js';
import type {
  DisplayPresentationModel,
  PresentationMeeting,
} from '../../src/presentation/models.js';
import {
  renderDisplayPage,
  renderDisplayScene,
  renderOperatorHoldPage,
  renderOperatorOverridePage,
  renderOperatorPreviewPage,
  stateSceneNames,
} from '../../src/presentation/html.js';

const meeting: PresentationMeeting = {
  meetingId: 'meeting-alpha',
  courseLabel: 'Synthetic Computing',
  blockLabel: 'A',
  checkInOpensAt: '2035-04-13T07:55:00Z',
  officialStartsAt: '2035-04-13T08:00:00Z',
  contentStartsAt: '2035-04-13T08:00:00Z',
  dismissalStartsAt: '2035-04-13T08:55:00Z',
  officialEndsAt: '2035-04-13T09:00:00Z',
};

function model(
  state: DisplayPresentationModel['state'],
): DisplayPresentationModel {
  return {
    screenId: 'screen-alpha',
    planId: 'plan-alpha',
    date: '2035-04-13',
    timeZone: 'Etc/UTC',
    evaluatedAt: '2035-04-13T08:30:00Z',
    state,
    currentMeeting: meeting,
    nextMeeting: { ...meeting, meetingId: 'meeting-beta', blockLabel: 'B' },
    meetings: [meeting],
    cards: [
      {
        cardId: 'card-alpha',
        type: 'objective',
        title: 'Synthetic objective',
        lines: [],
        featured: 'Build one safe fixture.',
        details: [
          'Explain the boundary.',
          'Open Classroom for full directions.',
          'Due Tue, April 17.',
        ],
        durationSeconds: 12,
      },
      {
        cardId: 'card-beta',
        type: 'vocabulary',
        title: 'Word of the day',
        lines: [],
        vocabulary: {
          term: 'Invariant',
          definition: 'A condition that remains true.',
          pronunciation: 'in-VAIR-ee-uhnt',
          partOfSpeech: 'noun',
          example: 'The safety invariant remains true.',
          translations: [
            {
              languageCode: 'vi',
              term: 'bất biến',
              definition: 'Một điều kiện luôn đúng.',
              example: 'Điều kiện an toàn luôn đúng.',
            },
            {
              languageCode: 'ko',
              term: '불변 조건',
              definition: '항상 참인 조건입니다.',
            },
            {
              languageCode: 'zh-Hans',
              term: '不变量',
              definition: '始终为真的条件。',
            },
          ],
        },
      },
    ],
    attendance: {
      checkInUrl: 'https://fixture.example.invalid/check-in',
      qrUrl: '/qr/screen-alpha/meeting-alpha.png?date=2035-04-13',
      classCode: 'C509',
      responseCount: 3,
      rosterCount: 8,
      presentCount: 2,
      tardyCount: 1,
      absentCount: 5,
    },
    announcement: 'Synthetic notice',
    dismissalMessage: 'Finish strong.',
    nextClassDayLabel: 'Tomorrow',
    nextClassDayDate: '2035-04-16',
    nextClassDayMeetings: [
      {
        ...meeting,
        meetingId: 'meeting-gamma',
        courseLabel: 'Synthetic Design',
        blockLabel: 'C',
        checkInOpensAt: '2035-04-16T07:55:00Z',
        officialStartsAt: '2035-04-16T08:00:00Z',
        contentStartsAt: '2035-04-16T08:00:00Z',
        dismissalStartsAt: '2035-04-16T08:55:00Z',
        officialEndsAt: '2035-04-16T09:00:00Z',
      },
    ],
    diagnostics: [],
  };
}

test('all eight display states render their semantic scenes with the intentional shared Coming Up treatment', () => {
  const labels = stateSceneNames();
  assert.deepEqual(Object.keys(labels), [...displayStates]);
  const pages = new Set<string>();
  for (const state of displayStates) {
    const html = renderDisplayPage(model(state));
    assert.match(html, /^<!doctype html>/u);
    assert.match(html, /<html lang="en">/u);
    assert.match(html, /<header class="display-header">/u);
    assert.match(html, /<main id="display-main" tabindex="-1">/u);
    assert.match(html, new RegExp(`data-state="${state}"`, 'u'));
    assert.match(html, /data-evaluated-at="2035-04-13T08:30:00Z"/u);
    assert.match(html, /role="status" aria-live="polite"/u);
    assert.match(html, /href="#display-main">Skip to display content/u);
    pages.add(html.match(/<main[^>]*>([\s\S]*?)<\/main>/u)?.[1] ?? '');
    assert.equal(
      html.includes(renderDisplayScene(model(state))),
      true,
      `server fragment for ${state}`,
    );
  }
  assert.equal(pages.size, displayStates.length - 1);
  assert.equal(
    renderDisplayScene(model('idle')),
    renderDisplayScene(model('post_end')),
  );
});

test('class content includes accessible carousel controls, hold state, and reveal timing hooks', () => {
  const html = renderDisplayPage({
    ...model('in_class_content'),
    hold: {
      status: 'held',
      meetingId: meeting.meetingId,
      reasonCode: 'operator-review',
    },
  });
  assert.match(html, /aria-roledescription="carousel"/u);
  assert.match(html, /data-carousel-dot="0"/u);
  assert.match(html, /data-carousel-pause aria-pressed="false"/u);
  assert.match(html, /data-server-held="true"/u);
  assert.match(html, /data-reveal/u);
  assert.match(html, /data-duration-ms="12000"/u);
  assert.match(html, /Held by operator/u);
});

test('objective details preserve the legacy pointer, Classroom checkmark, and due-date badge', () => {
  const html = renderDisplayPage(model('in_class_content'));
  assert.match(
    html,
    /data-objective-detail-icon aria-hidden="true">👉<\/span><span class="objective-detail-text">Explain the boundary\.<\/span>/u,
  );
  assert.match(
    html,
    /data-objective-detail-icon aria-hidden="true">✅<\/span><span class="objective-detail-text">Open Classroom for full directions\.<\/span>/u,
  );
  assert.match(
    html,
    /class="date-badge" aria-hidden="true"><span class="date-badge-month">APRIL<\/span><span class="date-badge-day">17<\/span>/u,
  );
  assert.match(html, />Due Tue, April 17\.<\/span>/u);

  const invalidDate = renderDisplayPage({
    ...model('in_class_content'),
    cards: [
      {
        cardId: 'card-invalid-date',
        type: 'objective',
        title: 'Synthetic objective',
        lines: [],
        details: ['Due 2035-00-17.'],
      },
    ],
  });
  assert.doesNotMatch(invalidDate, /class="date-badge"/u);
  assert.match(invalidDate, />👉<\/span>/u);
});

test('vocabulary renders every multilingual face without flattening semantic text', () => {
  const html = renderDisplayPage(model('in_class_content'));
  assert.match(html, /class="vocabulary-stage vocabulary-multilingual"/u);
  assert.match(html, /aria-label="English vocabulary"/u);
  assert.match(html, />Invariant<\/h2>/u);
  assert.match(html, />noun · in-VAIR-ee-uhnt<\/p>/u);
  assert.match(html, /The safety invariant remains true\./u);
  assert.match(html, /aria-label="Vietnamese vocabulary"/u);
  assert.match(html, />bất biến<\/h2>/u);
  assert.match(html, /Một điều kiện luôn đúng\./u);
  assert.match(html, /aria-label="Korean vocabulary"/u);
  assert.match(html, />불변 조건<\/h2>/u);
  assert.match(html, /aria-label="Simplified Chinese vocabulary"/u);
  assert.match(html, />不变量<\/h2>/u);
  assert.match(html, /vocabulary-multilingual/u);
  assert.match(
    html,
    /--vocabulary-face-delay:0s;--vocabulary-cycle-duration:24s;animation:vocabulary-face-cycle 24s linear 0s infinite;z-index:1;opacity:1/u,
  );
  assert.match(
    html,
    /--vocabulary-face-delay:18s;--vocabulary-cycle-duration:24s;animation:vocabulary-face-cycle 24s linear 18s infinite/u,
  );
  assert.match(html, /data-duration-ms="24000"/u);
});

test('bellringer removes only the redundant legacy title prefix', () => {
  const html = renderDisplayPage({
    ...model('in_class_content'),
    cards: [
      {
        cardId: 'bellringer-alpha',
        type: 'bellringer',
        title: 'Bellringer: Sketch the drivetrain',
        lines: ['Label each moving part.'],
      },
    ],
  });
  assert.match(html, /<h2>Sketch the drivetrain<\/h2>/u);
  assert.doesNotMatch(html, /<h2>Bellringer:/u);
});

test('class content renders the legacy minutes-until-bell header contract', () => {
  const inClass = renderDisplayPage(model('in_class_content'));
  assert.match(inClass, /class="header-status"/u);
  assert.match(
    inClass,
    /class="clock-group">\s*<span class="date-label"[^>]*>[^<]+<\/span>\s*<time class="clock"/u,
  );
  assert.match(
    inClass,
    /class="header-bell-countdown" data-header-bell data-bell-target="2035-04-13T09:00:00Z" hidden aria-label="Minutes until bell"/u,
  );
  assert.match(inClass, /class="header-bell-icon"/u);
  assert.match(inClass, /data-header-bell-number/u);
  assert.doesNotMatch(inClass, /Dismissal begins in/u);

  const checkIn = renderDisplayPage(model('pre_checkin'));
  assert.match(
    checkIn,
    /class="header-bell-countdown" data-header-bell hidden/u,
  );
  assert.doesNotMatch(checkIn, /data-bell-target=/u);
});

test('dismissal scene uses two muted preloaded local media layers and a reveal fallback hook', () => {
  const html = renderDisplayPage(model('dismissal_warning'));
  assert.equal((html.match(/data-media-layer/gmu) ?? []).length, 2);
  assert.equal(
    (html.match(/ muted playsinline preload="auto"/gmu) ?? []).length,
    2,
  );
  assert.match(html, /src="\/media\/dismissal"/u);
  assert.match(html, /data-dismissal-scene/u);
  assert.match(html, /data-media-reveal/u);
  assert.doesNotMatch(html, /https?:\/\//u);
});

test('idle and post-end reuse the legacy Coming Up scene with mirrored media and both countdowns', () => {
  for (const state of ['idle', 'post_end'] as const) {
    const html = renderDisplayPage(model(state));
    assert.match(html, /class="scene scene-coming-up media-pending"/u);
    assert.match(html, /class="media-layers mirrored"/u);
    assert.match(html, /data-coming-up-scene/u);
    assert.match(html, />Coming Up:</u);
    assert.match(html, /<h1 id="scene-title">Synthetic Computing<\/h1>/u);
    assert.match(html, />until check-in opens</u);
    assert.match(html, />until class starts</u);
    assert.equal((html.match(/data-media-layer/gmu) ?? []).length, 2);
    assert.equal(
      (html.match(/class="scene-countdown countdown"/gmu) ?? []).length,
      2,
    );
    assert.doesNotMatch(html, /Class complete/u);
  }
});

test('check-in scene renders the legacy class code, full link, QR, and five attendance totals', () => {
  const html = renderDisplayPage(model('pre_checkin'));
  assert.match(html, /class="checkin-display"/u);
  assert.match(html, /Synthetic Computing - A - <time/u);
  assert.match(html, /<span>Class Code<\/span>C509/u);
  assert.match(html, /class="checkin-link-box"/u);
  assert.match(html, /https:\/\/fixture\.example\.invalid\/check-in/u);
  for (const [label, value] of [
    ['Roster', '8'],
    ['Present', '2'],
    ['Tardy', '1'],
    ['Absent', '5'],
    ['Responses', '3'],
  ]) {
    assert.match(
      html,
      new RegExp(
        `checkin-stat-label">${label}<\\/span><strong class="checkin-stat-value">${value}`,
        'u',
      ),
    );
  }
});

test('day-complete scene renders the next class day date, count, and schedule rows', () => {
  const html = renderDisplayPage(model('day_complete'));
  assert.match(html, /class="next-day-schedule"/u);
  assert.match(html, />Tomorrow<\/p>/u);
  assert.match(html, /Monday, April 16/u);
  assert.match(html, />1 class<\/p>/u);
  assert.match(html, />Synthetic Design<\/span>/u);
  assert.match(html, />C<\/span>/u);
});

test('display values are escaped and bootstrap JSON cannot close its script', () => {
  const html = renderDisplayPage({
    ...model('in_class_content'),
    announcement: '</script><script>alert(1)</script>',
    cards: [
      {
        cardId: 'card-safe',
        type: 'objective',
        title: '<img src=x onerror=alert(1)>',
        lines: ['& safe'],
        featured: '<strong>featured</strong>',
        details: ['Open Classroom <svg onload=alert(1)>'],
      },
    ],
    diagnostics: [
      { code: '</script>', severity: 'warning', message: 'Synthetic.' },
    ],
  });
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/u);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/u);
  assert.match(html, /&lt;strong&gt;featured&lt;\/strong&gt;/u);
  assert.match(html, /Open Classroom &lt;svg onload=alert\(1\)&gt;/u);
  assert.match(html, /\u003c\/script\u003e/u);
});

test('unsafe attendance links and traversal-like QR routes are not rendered', () => {
  const html = renderDisplayPage({
    ...model('pre_checkin'),
    attendance: {
      checkInUrl: 'javascript:alert(1)',
      qrUrl: '/qr/%2e%2e/private',
    },
  });
  assert.doesNotMatch(html, /javascript:|%2e%2e/iu);
  assert.doesNotMatch(html, /class="qr-card"/u);
});

test('bounded local QR routes retain their scoped query and render with a safe attendance link', () => {
  const html = renderDisplayPage(model('pre_checkin'));
  assert.match(
    html,
    /src="\/qr\/screen-alpha\/meeting-alpha\.png\?date=2035-04-13"/u,
  );
  assert.match(html, /href="https:\/\/fixture\.example\.invalid\/check-in"/u);
  assert.match(html, /alt="Attendance check-in QR code"/u);
});

test('operator preview is explicitly read-only and renders timeline and diagnostics', () => {
  const html = renderOperatorPreviewPage({
    screenId: 'screen-alpha',
    date: '2035-04-13',
    pinnedAt: '2035-04-13T08:30:00Z',
    display: model('pre_checkin'),
    originalPlan: { planId: 'plan-alpha' },
    effectivePlan: { effectivePlanId: 'effective-alpha' },
    timeline: [{ label: 'Official start', at: meeting.officialStartsAt }],
    diagnostics: [
      { code: 'synthetic-note', severity: 'info', message: 'Synthetic only.' },
    ],
  });
  assert.match(html, /Read-only: previews never invoke writer capabilities/u);
  assert.match(html, /sandbox srcdoc=/u);
  assert.match(html, /Official start/u);
  assert.match(html, /synthetic-note/u);
  assert.doesNotMatch(html, /data-operator-form=/u);
});

test('operator override and hold pages expose bounded scoped forms without credentials', () => {
  const scope = {
    screenId: 'screen-alpha',
    date: '2035-04-13',
    planId: 'plan-alpha',
    effectiveAt: '2035-04-13T08:30:00Z',
    roomId: 'room-alpha',
    classId: 'class-alpha',
    meetingId: 'meeting-alpha',
  };
  const override = renderOperatorOverridePage(scope);
  const hold = renderOperatorHoldPage({
    ...scope,
    activeHold: {
      status: 'held',
      meetingId: 'meeting-alpha',
      reasonCode: 'operator-review',
      revision: 'revision-alpha',
    },
  });
  assert.match(override, /maxlength="500"/u);
  assert.match(override, /data-operator-form="override"/u);
  assert.match(override, /data-http-method="PUT"/u);
  assert.match(
    override,
    /action="\/overrides\/screen-alpha" data-operator-form="override-delete" data-http-method="DELETE"/u,
  );
  assert.match(hold, /data-operator-form="hold"/u);
  assert.match(hold, /data-http-method="POST"/u);
  assert.match(
    hold,
    /action="\/hold\/screen-alpha" data-operator-form="hold-release" data-http-method="DELETE"/u,
  );
  assert.match(hold, /Until released/u);
  assert.match(hold, /Held: operator-review \(indefinite\)/u);
  for (const html of [override, hold]) {
    assert.doesNotMatch(
      html,
      /bearer|token|password|credential|authorization/iu,
    );
    assert.match(html, /role="status" aria-live="polite"/u);
  }
});

test('the exact legacy mount prefixes every browser-local display and operator URL', () => {
  const prefixedModel: DisplayPresentationModel = {
    ...model('pre_checkin'),
    basePath: '/classroom-screen',
    attendance: {
      ...model('pre_checkin').attendance,
      qrUrl:
        '/classroom-screen/qr/screen-alpha/meeting-alpha.png?date=2035-04-13',
    },
  };
  const display = renderDisplayPage(prefixedModel);
  for (const expected of [
    'href="/classroom-screen/manifest.webmanifest"',
    'href="/classroom-screen/assets/chalkwright.svg"',
    'href="/classroom-screen/assets/display.css"',
    'src="/classroom-screen/assets/display.js"',
    'data-target-url="/classroom-screen/target/screen-alpha"',
    'src="/classroom-screen/qr/screen-alpha/meeting-alpha.png?date=2035-04-13"',
  ]) {
    assert.equal(display.includes(expected), true, expected);
  }

  const dismissal = renderDisplayPage({
    ...prefixedModel,
    state: 'dismissal_warning',
  });
  assert.match(dismissal, /src="\/classroom-screen\/media\/dismissal"/u);
  assert.match(
    dismissal,
    /poster="\/classroom-screen\/assets\/dismissal-poster\.svg"/u,
  );

  const scope = {
    basePath: '/classroom-screen' as const,
    screenId: 'screen-alpha',
    date: '2035-04-13',
    planId: 'plan-alpha',
    effectiveAt: '2035-04-13T08:30:00Z',
    roomId: 'room-alpha',
    classId: 'class-alpha',
    meetingId: 'meeting-alpha',
  };
  assert.match(
    renderOperatorOverridePage(scope),
    /action="\/classroom-screen\/overrides\/screen-alpha"/u,
  );
  assert.match(
    renderOperatorHoldPage(scope),
    /action="\/classroom-screen\/hold\/screen-alpha"/u,
  );
  assert.match(
    renderOperatorPreviewPage({
      basePath: '/classroom-screen',
      screenId: 'screen-alpha',
      date: '2035-04-13',
      display: prefixedModel,
      originalPlan: null,
      effectivePlan: null,
      timeline: [],
      diagnostics: [],
    }),
    /action="\/classroom-screen\/preview\/screen-alpha"/u,
  );
});
