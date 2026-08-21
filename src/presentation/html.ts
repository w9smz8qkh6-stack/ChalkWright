import { displayPollingTiming } from '../contracts/v1/runtime.js';
import type { DisplayState } from '../contracts/v1/display.js';
import type {
  DisplayPresentationModel,
  OperatorScopeModel,
  PresentationCard,
  PresentationMeeting,
  PreviewPresentationModel,
} from './models.js';

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function safeJson(value: unknown): string {
  return JSON.stringify(value, undefined, 2)
    .replaceAll('&', '\\u0026')
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e');
}

function safeHttpHref(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  try {
    const parsed = new URL(value);
    return (parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
      parsed.username.length === 0 &&
      parsed.password.length === 0
      ? parsed.href
      : undefined;
  } catch {
    return undefined;
  }
}

function safeLocalRoute(value: string | undefined): string | undefined {
  if (
    value === undefined ||
    value.length > 512 ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    /%2e|%2f|%5c/iu.test(value) ||
    value.includes('\\')
  )
    return undefined;
  const [rawPath = '', rawQuery, ...extra] = value.split('?');
  if (
    extra.length !== 0 ||
    !/^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]+$/u.test(rawPath) ||
    rawPath.includes('//') ||
    rawPath.split('/').some((segment) => segment === '.' || segment === '..')
  )
    return undefined;
  try {
    const parsed = new URL(value, 'http://fixture.invalid');
    if (parsed.origin !== 'http://fixture.invalid' || parsed.hash !== '')
      return undefined;
    const seen = new Set<string>();
    for (const [key, item] of parsed.searchParams) {
      if (
        !/^[A-Za-z0-9_-]{1,40}$/u.test(key) ||
        !/^[A-Za-z0-9._~-]{0,200}$/u.test(item) ||
        seen.has(key)
      )
        return undefined;
      seen.add(key);
    }
    return `${parsed.pathname}${rawQuery === undefined ? '' : parsed.search}`;
  } catch {
    return undefined;
  }
}

function localPath(
  basePath: '' | '/classroom-screen' | undefined,
  path: string,
): string {
  return `${basePath ?? ''}${path}`;
}

export function displayDateLabel(date: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    }).format(new Date(`${date}T12:00:00Z`));
  } catch {
    return date;
  }
}

function documentShell(options: {
  readonly title: string;
  readonly bodyClass: string;
  readonly body: string;
  readonly bodyAttributes?: string;
  readonly includeClient?: boolean;
  readonly basePath?: '' | '/classroom-screen' | undefined;
}): string {
  const manifest = localPath(options.basePath, '/manifest.webmanifest');
  const icon = localPath(options.basePath, '/assets/chalkwright.svg');
  const stylesheet = localPath(options.basePath, '/assets/display.css');
  const client = localPath(options.basePath, '/assets/display.js');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark">
  <meta name="theme-color" content="#101827">
  <title>${escapeHtml(options.title)}</title>
  <link rel="manifest" href="${escapeHtml(manifest)}">
  <link rel="icon" href="${escapeHtml(icon)}" type="image/svg+xml">
  <link rel="stylesheet" href="${escapeHtml(stylesheet)}">
</head>
<body class="${escapeHtml(options.bodyClass)}" ${options.bodyAttributes ?? ''}>
${options.body}
${options.includeClient === false ? '' : `  <script src="${escapeHtml(client)}" defer></script>`}
</body>
</html>`;
}

function meetingLabel(meeting: PresentationMeeting | undefined): string {
  if (meeting === undefined) return '';
  return `${meeting.courseLabel} · ${meeting.blockLabel}`;
}

function header(model: DisplayPresentationModel): string {
  const icon = localPath(model.basePath, '/assets/chalkwright.svg');
  const bellTarget =
    model.state === 'in_class_content'
      ? model.currentMeeting?.officialEndsAt
      : undefined;
  return `<header class="display-header">
  <div class="brand"><img src="${escapeHtml(icon)}" alt="" width="44" height="44"><span>Chalkwright</span></div>
  <div class="meeting-label" data-course-label>${escapeHtml(meetingLabel(model.currentMeeting) || meetingLabel(model.nextMeeting))}</div>
  <div class="header-status">
    <div class="clock-group">
      <span class="date-label" data-display-date>${escapeHtml(displayDateLabel(model.date, model.timeZone))}</span>
      <time class="clock" data-clock datetime="${escapeHtml(model.evaluatedAt)}">--:--</time>
    </div>
    <div class="header-bell-countdown" data-header-bell${bellTarget === undefined ? '' : ` data-bell-target="${escapeHtml(bellTarget)}"`} hidden aria-label="Minutes until bell">
      <svg class="header-bell-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M10.3 21a2 2 0 0 0 3.4 0"></path>
        <path d="M4.7 17h14.6"></path>
        <path d="M18 17v-5.4a6 6 0 0 0-12 0V17"></path>
        <path d="M9 5.1V4a3 3 0 0 1 6 0v1.1"></path>
      </svg>
      <span class="header-bell-number" data-header-bell-number></span>
    </div>
  </div>
</header>`;
}

function countdown(target: string | undefined, label: string): string {
  return target === undefined
    ? ''
    : `<p class="countdown" data-countdown-target="${escapeHtml(target)}"><span class="countdown-label">${escapeHtml(label)}</span> <strong data-countdown-value>--:--</strong></p>`;
}

function meetingList(meetings: readonly PresentationMeeting[]): string {
  return `<ol class="meeting-list">${meetings
    .map(
      (meeting) => `<li>
  <span class="block-badge">${escapeHtml(meeting.blockLabel)}</span>
  <span>${escapeHtml(meeting.courseLabel)}</span>
  <time datetime="${escapeHtml(meeting.officialStartsAt)}" data-local-time="${escapeHtml(meeting.officialStartsAt)}"></time>
</li>`,
    )
    .join('')}</ol>`;
}

function meetingWindow(meeting: PresentationMeeting | undefined): string {
  return meeting === undefined
    ? 'Time TBD'
    : `<time datetime="${escapeHtml(meeting.officialStartsAt)}" data-local-time="${escapeHtml(meeting.officialStartsAt)}"></time> – <time datetime="${escapeHtml(meeting.officialEndsAt)}" data-local-time="${escapeHtml(meeting.officialEndsAt)}"></time>`;
}

const dueDateMonths: Readonly<Record<string, string>> = {
  jan: 'JANUARY',
  january: 'JANUARY',
  feb: 'FEBRUARY',
  february: 'FEBRUARY',
  mar: 'MARCH',
  march: 'MARCH',
  apr: 'APRIL',
  april: 'APRIL',
  may: 'MAY',
  jun: 'JUNE',
  june: 'JUNE',
  jul: 'JULY',
  july: 'JULY',
  aug: 'AUGUST',
  august: 'AUGUST',
  sep: 'SEPTEMBER',
  sept: 'SEPTEMBER',
  september: 'SEPTEMBER',
  oct: 'OCTOBER',
  october: 'OCTOBER',
  nov: 'NOVEMBER',
  november: 'NOVEMBER',
  dec: 'DECEMBER',
  december: 'DECEMBER',
};

interface DueDateMarker {
  readonly month: string;
  readonly day: string;
}

function dueDateMarker(text: string): DueDateMarker | undefined {
  if (!/(?:^|\b)(?:due|due dates?|date|deadline|by)\b/iu.test(text))
    return undefined;
  const monthName =
    '(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t|tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
  const monthFirst = new RegExp(
    `\\b${monthName}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`,
    'iu',
  ).exec(text);
  const dayFirst = new RegExp(
    `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${monthName}\\.?\\b`,
    'iu',
  ).exec(text);
  const isoDate = /\b\d{4}-(\d{1,2})-(\d{1,2})\b/u.exec(text);
  const slashDate = /\b(\d{1,2})[/-](\d{1,2})(?:[/-](?:\d{2}|\d{4}))?\b/u.exec(
    text,
  );
  const month =
    monthFirst?.[1] ?? dayFirst?.[2] ?? isoDate?.[1] ?? slashDate?.[1];
  const day =
    monthFirst?.[2] ?? dayFirst?.[1] ?? isoDate?.[2] ?? slashDate?.[2];
  if (month === undefined || day === undefined) return undefined;
  const numericDay = Number(day);
  if (!Number.isInteger(numericDay) || numericDay < 1 || numericDay > 31)
    return undefined;
  const numericMonth = Number(month);
  const monthLabel =
    Number.isInteger(numericMonth) && numericMonth >= 1 && numericMonth <= 12
      ? [
          '',
          'JANUARY',
          'FEBRUARY',
          'MARCH',
          'APRIL',
          'MAY',
          'JUNE',
          'JULY',
          'AUGUST',
          'SEPTEMBER',
          'OCTOBER',
          'NOVEMBER',
          'DECEMBER',
        ][numericMonth]
      : Number.isNaN(numericMonth)
        ? dueDateMonths[month.replaceAll('.', '').toLowerCase()]
        : undefined;
  return monthLabel === undefined
    ? undefined
    : { month: monthLabel, day: String(numericDay) };
}

function objectiveDetailMarkup(detail: string): string {
  const date = dueDateMarker(detail);
  if (date !== undefined) {
    return `<li class="due-date-detail"><span class="date-badge" aria-hidden="true"><span class="date-badge-month">${escapeHtml(date.month)}</span><span class="date-badge-day">${escapeHtml(date.day)}</span></span><span class="objective-detail-text">${escapeHtml(detail)}</span></li>`;
  }
  const icon = detail.trim().toLowerCase().includes('open classroom')
    ? '✅'
    : '👉';
  return `<li><span class="objective-detail-icon" data-objective-detail-icon aria-hidden="true">${icon}</span><span class="objective-detail-text">${escapeHtml(detail)}</span></li>`;
}

function cardDetailsMarkup(card: PresentationCard): string {
  const details = card.details ?? [];
  if (details.length === 0) return '';
  if (card.type === 'objective') {
    return `<div class="card-details" data-reveal><ul class="objective-detail-list">${details.map(objectiveDetailMarkup).join('')}</ul></div>`;
  }
  return `<div class="card-details" data-reveal>${details.map((line) => `<p>${escapeHtml(line)}</p>`).join('')}</div>`;
}

function vocabularyPanelFace(
  language: string,
  className: string,
  value: {
    readonly term?: string;
    readonly definition?: string;
    readonly example?: string;
  },
  active = false,
): string {
  return `<section class="vocabulary-panel-face vocabulary-${className}${active ? ' is-active' : ''}" data-vocabulary-face aria-label="${language} vocabulary" aria-hidden="${String(!active)}">
    <p class="vocabulary-language">${language}</p>
    ${value.term === undefined ? '' : `<h3 class="vocabulary-translation-term">${escapeHtml(value.term)}</h3>`}
    <p class="vocabulary-definition">${escapeHtml(value.definition ?? '')}</p>
    ${value.example === undefined ? '' : `<p class="vocabulary-example">${escapeHtml(value.example)}</p>`}
  </section>`;
}

function vocabularyMarkup(card: PresentationCard): string | undefined {
  const vocabulary = card.vocabulary;
  if (vocabulary === undefined) return undefined;
  const metadata = [vocabulary.partOfSpeech, vocabulary.pronunciation]
    .filter((value): value is string => value !== undefined)
    .map(escapeHtml)
    .join(' · ');
  const translations = (
    vocabulary.translations ??
    (vocabulary.vietnamese === undefined
      ? []
      : [{ languageCode: 'vi' as const, ...vocabulary.vietnamese }])
  ).filter((translation) =>
    [translation.term, translation.definition, translation.example].some(
      (value) => value !== undefined && value.trim().length > 0,
    ),
  );
  const english = vocabularyPanelFace(
    'English',
    'english',
    {
      definition: vocabulary.definition,
      ...(vocabulary.example === undefined
        ? {}
        : { example: vocabulary.example }),
    },
    true,
  );
  const language = {
    vi: { label: 'Vietnamese', className: 'vietnamese' },
    ko: { label: 'Korean', className: 'korean' },
    'zh-Hans': { label: 'Simplified Chinese', className: 'chinese' },
  } as const;
  const translated = translations
    .map((translation) => {
      const presentation = language[translation.languageCode];
      return vocabularyPanelFace(
        presentation.label,
        presentation.className,
        translation,
      );
    })
    .join('');
  return `<div class="vocabulary-stage${translated === '' ? ' single-face' : ' vocabulary-multilingual'}" data-vocabulary-stage>
    <header class="vocabulary-anchor">
      <p class="vocabulary-language">English</p>
      <h2>${escapeHtml(vocabulary.term)}</h2>
      ${metadata.length === 0 ? '' : `<p class="vocabulary-metadata">${metadata}</p>`}
    </header>
    <div class="vocabulary-panel" data-vocabulary-panel>
      <div class="vocabulary-panel-flip">${english}${translated}</div>
    </div>
  </div>`;
}

function vocabularyFaceCount(card: PresentationCard): number {
  const vocabulary = card.vocabulary;
  if (vocabulary === undefined) return 0;
  if (vocabulary.translations !== undefined)
    return 1 + vocabulary.translations.length;
  return vocabulary.vietnamese === undefined ? 1 : 2;
}

function cardMarkup(card: PresentationCard, index: number): string {
  const configuredDurationSeconds =
    Number.isFinite(card.durationSeconds) && (card.durationSeconds ?? 0) > 0
      ? (card.durationSeconds ?? 12)
      : 12;
  const durationSeconds = Math.max(
    configuredDurationSeconds,
    vocabularyFaceCount(card) * 6,
  );
  const vocabulary = vocabularyMarkup(card);
  const title =
    card.type === 'bellringer'
      ? card.title.replace(/^bellringer\s*:\s*/iu, '')
      : card.title;
  return `<article class="carousel-card card-${escapeHtml(card.type)} accent-${escapeHtml(card.accent ?? 'ink')}" data-carousel-card data-card-id="${escapeHtml(card.cardId)}" data-duration-ms="${Math.max(5, durationSeconds) * 1000}" ${index === 0 ? '' : 'hidden'}>
  <p class="card-type">${escapeHtml(card.type.replaceAll('_', ' '))}</p>
  ${vocabulary === undefined ? `<h2>${escapeHtml(title)}</h2>` : vocabulary}
  ${card.featured === undefined ? '' : `<p class="featured">${escapeHtml(card.featured)}</p>`}
  ${vocabulary !== undefined || card.lines.length === 0 ? '' : `<ul>${card.lines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>`}
  ${cardDetailsMarkup(card)}
</article>`;
}

function carousel(model: DisplayPresentationModel): string {
  const cards = model.cards ?? [];
  if (cards.length === 0) {
    return `<section class="empty-card" aria-labelledby="empty-card-title"><h2 id="empty-card-title">Ready for class</h2><p>Instructions will appear here.</p></section>`;
  }
  const held = model.hold?.status === 'held';
  return `<section class="carousel" aria-roledescription="carousel" aria-label="Class content" data-carousel data-meeting-id="${escapeHtml(model.currentMeeting?.meetingId)}" data-server-held="${String(held)}">
  <div class="carousel-stage">${cards.map(cardMarkup).join('')}</div>
  <nav class="carousel-controls" aria-label="Carousel controls">
    <button type="button" data-carousel-previous aria-label="Previous card">‹</button>
    <div class="carousel-dots" role="tablist" aria-label="Choose a card">${cards
      .map(
        (card, index) =>
          `<button type="button" role="tab" data-carousel-dot="${index}" aria-label="Card ${index + 1}: ${escapeHtml(card.title)}" aria-selected="${String(index === 0)}"></button>`,
      )
      .join('')}</div>
    <button type="button" data-carousel-next aria-label="Next card">›</button>
    <button type="button" data-carousel-pause aria-pressed="false">Pause</button>
  </nav>
  <p class="hold-status" data-hold-status ${held ? '' : 'hidden'}><strong>Held by operator</strong>${model.hold?.expiresAt === undefined ? '' : ` until <time datetime="${escapeHtml(model.hold.expiresAt)}" data-local-time="${escapeHtml(model.hold.expiresAt)}"></time>`}</p>
</section>`;
}

function mediaLayers(
  basePath: '' | '/classroom-screen' | undefined,
  mirrored = false,
  available = true,
): string {
  const poster = localPath(basePath, '/assets/dismissal-poster.svg');
  if (!available)
    return `<div class="media-layers poster-only${mirrored ? ' mirrored' : ''}" aria-hidden="true"><img class="dismissal-media active" src="${escapeHtml(poster)}" alt=""></div>`;
  const media = localPath(basePath, '/media/dismissal');
  return `<div class="media-layers${mirrored ? ' mirrored' : ''}" aria-hidden="true">
    <video class="dismissal-media active" data-media-layer muted playsinline preload="auto" poster="${escapeHtml(poster)}"><source src="${escapeHtml(media)}" type="video/mp4"></video>
    <video class="dismissal-media" data-media-layer muted playsinline preload="auto" poster="${escapeHtml(poster)}"><source src="${escapeHtml(media)}" type="video/mp4"></video>
  </div>`;
}

function sceneCountdown(target: string | undefined, detail: string): string {
  return target === undefined
    ? ''
    : `<p class="scene-countdown countdown" data-countdown-target="${escapeHtml(target)}"><strong data-countdown-value>--:--</strong><span>${escapeHtml(detail)}</span></p>`;
}

function comingUpScene(model: DisplayPresentationModel): string {
  const next = model.nextMeeting;
  return `<section class="scene scene-coming-up media-pending" aria-labelledby="scene-title" data-media-scene data-coming-up-scene>
  ${mediaLayers(model.basePath, true, model.dismissalMediaAvailable !== false)}
  <div class="coming-up-panel" data-media-reveal>
    <p class="eyebrow">Coming Up:</p>
    <h1 id="scene-title">${escapeHtml(next?.courseLabel ?? 'Upcoming class')}</h1>
    <p class="coming-up-window">${meetingWindow(next)}</p>
  </div>
  <div class="scene-countdown-footer" data-media-reveal>
    ${sceneCountdown(next?.checkInOpensAt, 'until check-in opens')}
    ${sceneCountdown(next?.officialStartsAt, 'until class starts')}
  </div>
</section>`;
}

function dismissalScene(model: DisplayPresentationModel): string {
  return `<section class="scene scene-dismissal media-pending" aria-labelledby="dismissal-title" data-media-scene data-dismissal-scene>
  ${mediaLayers(model.basePath, false, model.dismissalMediaAvailable !== false)}
  <div class="scene-copy" data-media-reveal>
    <p class="eyebrow">Dismissal begins soon</p>
    <h1 id="dismissal-title">${escapeHtml(model.dismissalMessage ?? 'Finish strong and leave your space ready.')}</h1>
    ${countdown(model.currentMeeting?.officialEndsAt, 'Class ends in')}
  </div>
</section>`;
}

function attendanceStat(label: string, value: number | undefined): string {
  return `<div class="checkin-stat"><span class="checkin-stat-label">${escapeHtml(label)}</span><strong class="checkin-stat-value">${value === undefined ? '—' : value}</strong></div>`;
}

function checkInScene(model: DisplayPresentationModel): string {
  const current = model.currentMeeting;
  const attendance = model.attendance;
  const qrUrl = safeLocalRoute(attendance?.qrUrl);
  const checkInUrl = safeHttpHref(attendance?.checkInUrl);
  const qr =
    qrUrl === undefined || checkInUrl === undefined
      ? ''
      : `<a class="checkin-qr" href="${escapeHtml(checkInUrl)}" aria-label="Open attendance check-in"><img src="${escapeHtml(qrUrl)}" alt="Attendance check-in QR code" width="320" height="320"></a>`;
  const classLabel =
    current === undefined
      ? ''
      : [current.courseLabel, current.blockLabel].filter(Boolean).join(' - ');
  return `<section class="checkin-display" aria-labelledby="scene-title">
  <div class="checkin-display-top"><div><p class="eyebrow">Attendance window open</p><h1 id="scene-title">Check In</h1><p class="checkin-display-subtitle">${escapeHtml(classLabel)} - ${meetingWindow(current)}</p></div>${qr}</div>
  <div class="checkin-display-grid">
    <div class="checkin-code"><span>Class Code</span>${escapeHtml(attendance?.classCode ?? '----')}</div>
    <div class="checkin-callout"><h2>Attendance window open</h2><p>Use the QR code or the class check-in link.</p>${checkInUrl === undefined ? '<p class="checkin-link-missing">Check-in link unavailable.</p>' : `<a class="checkin-link-box" href="${escapeHtml(checkInUrl)}">${escapeHtml(checkInUrl)}</a>`}${countdown(current?.contentStartsAt, 'Class begins in')}</div>
  </div>
  <div class="checkin-stats" aria-label="Attendance summary">
    ${attendanceStat('Roster', attendance?.rosterCount)}
    ${attendanceStat('Present', attendance?.presentCount)}
    ${attendanceStat('Tardy', attendance?.tardyCount)}
    ${attendanceStat('Absent', attendance?.absentCount)}
    ${attendanceStat('Responses', attendance?.responseCount)}
  </div>
</section>`;
}

function nextClassDayScene(model: DisplayPresentationModel): string {
  const meetings = model.nextClassDayMeetings ?? [];
  const visible = meetings.slice(0, 6);
  const extra = meetings.length - visible.length;
  const dateLabel =
    model.nextClassDayDate === undefined
      ? 'No schedule found yet'
      : displayDateLabel(model.nextClassDayDate, model.timeZone);
  const rows =
    visible.length === 0
      ? '<li class="next-day-row"><span class="next-day-time">Standby</span><span class="next-day-course">Waiting for the next imported schedule</span><span class="next-day-block">Synced</span></li>'
      : visible
          .map(
            (meeting) =>
              `<li class="next-day-row"><span class="next-day-time">${meetingWindow(meeting)}</span><span class="next-day-course">${escapeHtml(meeting.courseLabel)}</span><span class="next-day-block">${escapeHtml(meeting.blockLabel)}</span></li>`,
          )
          .join('');
  const count = `${meetings.length} ${meetings.length === 1 ? 'class' : 'classes'}${extra > 0 ? ` · +${extra} more` : ''}`;
  return `<section class="scene scene-day-complete" aria-labelledby="scene-title"><div class="next-day-schedule"><header><div><p class="eyebrow">${escapeHtml(model.nextClassDayLabel ?? 'Next Class Day')}</p><h1 id="scene-title">${escapeHtml(dateLabel)}</h1></div><p class="next-day-count">${escapeHtml(count)}</p></header><ol>${rows}</ol></div></section>`;
}

function mainScene(model: DisplayPresentationModel): string {
  const current = model.currentMeeting;
  const next = model.nextMeeting;
  const meetings = model.meetings ?? [];
  switch (model.state) {
    case 'no_classes':
      return `<section class="scene scene-no-classes" aria-labelledby="scene-title"><p class="eyebrow">${escapeHtml(displayDateLabel(model.date, model.timeZone))}</p><h1 id="scene-title">No classes scheduled</h1><p>Enjoy the day.</p></section>`;
    case 'morning_overview':
      return `<section class="scene scene-overview" aria-labelledby="scene-title"><p class="eyebrow">Good morning</p><h1 id="scene-title">Today in this room</h1>${meetingList(meetings)}${countdown(next?.checkInOpensAt, 'Check-in opens in')}</section>`;
    case 'idle':
      return comingUpScene(model);
    case 'pre_checkin':
      return checkInScene(model);
    case 'in_class_content':
      return `<section class="content-layout" aria-labelledby="scene-title"><h1 id="scene-title" class="visually-hidden">${escapeHtml(meetingLabel(current))} content</h1>${model.announcement === undefined ? '' : `<aside class="announcement" aria-label="Announcement">${escapeHtml(model.announcement)}</aside>`}${carousel(model)}</section>`;
    case 'dismissal_warning':
      return dismissalScene(model);
    case 'post_end':
      return next === undefined
        ? nextClassDayScene(model)
        : comingUpScene(model);
    case 'day_complete':
      return nextClassDayScene(model);
  }
}

/** Server-rendered fragment returned by target polling responses. */
export function renderDisplayScene(model: DisplayPresentationModel): string {
  return mainScene(model);
}

export function renderDisplayPage(model: DisplayPresentationModel): string {
  const targetUrl =
    model.pinnedAt === undefined
      ? localPath(
          model.basePath,
          `/target/${encodeURIComponent(model.screenId)}`,
        )
      : '';
  const diagnosticCodes = (model.diagnostics ?? []).map((item) => item.code);
  const body = `  <a class="skip-link" href="#display-main">Skip to display content</a>
  ${header(model)}
  <main id="display-main" tabindex="-1">${renderDisplayScene(model)}</main>
  <div class="connection-status" role="status" aria-live="polite" data-connection-status ${model.degraded === true ? '' : 'hidden'}>Updates are delayed. Showing the last successful display.</div>
  <div class="visually-hidden" aria-live="polite" data-announcer></div>
  <script type="application/json" id="presentation-bootstrap">${safeJson({
    screenId: model.screenId,
    planId: model.planId,
    meetingId: model.currentMeeting?.meetingId ?? '',
    timeZone: model.timeZone,
    state: model.state,
    diagnosticCodes,
    polling: displayPollingTiming,
  })}</script>`;
  return documentShell({
    title: displayDocumentTitle(model),
    bodyClass: `display-page state-${model.state}`,
    body,
    basePath: model.basePath,
    bodyAttributes: `data-display-root data-state="${escapeHtml(model.state)}" data-target-url="${escapeHtml(targetUrl)}" data-time-zone="${escapeHtml(model.timeZone)}" data-evaluated-at="${escapeHtml(model.evaluatedAt)}"${model.pinnedAt === undefined ? '' : ` data-pinned-at="${escapeHtml(model.pinnedAt)}"`}`,
  });
}

export function displayDocumentTitle(model: DisplayPresentationModel): string {
  return `${meetingLabel(model.currentMeeting) || 'Classroom display'} — Chalkwright`;
}

function diagnosticList(
  diagnostics: PreviewPresentationModel['diagnostics'],
): string {
  if (diagnostics.length === 0)
    return '<p class="operator-success">No preview diagnostics.</p>';
  return `<ul class="diagnostic-list">${diagnostics
    .map(
      (diagnostic) =>
        `<li class="severity-${escapeHtml(diagnostic.severity)}"><code>${escapeHtml(diagnostic.code)}</code> ${escapeHtml(diagnostic.message)}</li>`,
    )
    .join('')}</ul>`;
}

function operatorHeader(
  title: string,
  subtitle: string,
  basePath: '' | '/classroom-screen' | undefined,
): string {
  const home = localPath(basePath, '/');
  const icon = localPath(basePath, '/assets/chalkwright.svg');
  return `<header class="operator-header"><a href="${escapeHtml(home)}" class="brand"><img src="${escapeHtml(icon)}" alt="" width="40" height="40"><span>Chalkwright</span></a><div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(subtitle)}</p></div></header>`;
}

export function renderOperatorPreviewPage(
  model: PreviewPresentationModel,
): string {
  const previewAction = localPath(
    model.basePath,
    `/preview/${encodeURIComponent(model.screenId)}`,
  );
  const body = `${operatorHeader('Display preview', 'Read-only: previews never invoke writer capabilities.', model.basePath)}
<main class="operator-main">
  <form class="operator-form preview-form" method="get" action="${escapeHtml(previewAction)}">
    <label>Date <input name="date" type="date" required value="${escapeHtml(model.date)}"></label>
    <label>Pin time <input name="now" type="datetime-local" value="${escapeHtml(model.pinnedAt?.replace(/Z$/u, ''))}"></label>
    <button type="submit">Refresh preview</button>
  </form>
  <section aria-labelledby="preview-result-title"><h2 id="preview-result-title">Rendered state: ${escapeHtml(model.display.state.replaceAll('_', ' '))}</h2><iframe title="Synthetic display preview" sandbox srcdoc="${escapeHtml(renderDisplayPage({ ...model.display, ...(model.pinnedAt === undefined ? {} : { pinnedAt: model.pinnedAt }) }))}"></iframe></section>
  <section aria-labelledby="timeline-title"><h2 id="timeline-title">Timeline</h2><ol class="timeline">${model.timeline.map((item) => `<li><span>${escapeHtml(item.label)}</span><time datetime="${escapeHtml(item.at)}">${escapeHtml(item.at)}</time></li>`).join('')}</ol></section>
  <section aria-labelledby="diagnostics-title"><h2 id="diagnostics-title">Diagnostics</h2>${diagnosticList(model.diagnostics)}</section>
  <details><summary>Original canonical plan</summary><pre>${escapeHtml(JSON.stringify(model.originalPlan, undefined, 2))}</pre></details>
  <details><summary>Effective screen plan</summary><pre>${escapeHtml(JSON.stringify(model.effectivePlan, undefined, 2))}</pre></details>
</main>`;
  return documentShell({
    title: 'Display preview — Chalkwright',
    bodyClass: 'operator-page',
    body,
    basePath: model.basePath,
  });
}

export function renderOperatorOverridePage(model: OperatorScopeModel): string {
  const overrideAction = localPath(
    model.basePath,
    `/overrides/${encodeURIComponent(model.screenId)}`,
  );
  const body = `${operatorHeader('Display override', 'Changes are limited to the selected screen and date.', model.basePath)}
<main class="operator-main">
  <section class="scope-summary" aria-labelledby="scope-title"><h2 id="scope-title">Scope</h2><dl><dt>Screen</dt><dd>${escapeHtml(model.screenId)}</dd><dt>Date</dt><dd>${escapeHtml(model.date)}</dd><dt>Plan</dt><dd>${escapeHtml(model.planId)}</dd></dl></section>
  ${model.overrideSummary === undefined ? '' : `<p role="status">Current override: ${escapeHtml(model.overrideSummary)}</p>`}
  <form class="operator-form" method="post" action="${escapeHtml(overrideAction)}" data-operator-form="override" data-http-method="PUT">
    <input type="hidden" name="screenId" value="${escapeHtml(model.screenId)}">
    <input type="hidden" name="date" value="${escapeHtml(model.date)}">
    <input type="hidden" name="meetingId" value="${escapeHtml(model.meetingId)}">
    <label>Announcement <textarea name="announcement" maxlength="500" rows="4"></textarea></label>
    <label>Card behavior <select name="cardsMode"><option value="append">Append</option><option value="replace">Replace</option></select></label>
    <label class="check-label"><input name="hideAssignments" type="checkbox"> Hide assignment cards</label>
    <label>Dismissal message <input name="dismissalMessage" maxlength="240"></label>
    <button type="submit">Save scoped override</button>
  </form>
  <form class="operator-form compact-form" method="post" action="${escapeHtml(overrideAction)}" data-operator-form="override-delete" data-http-method="DELETE"><input type="hidden" name="date" value="${escapeHtml(model.date)}"><button class="danger" type="submit">Remove override</button></form>
  <p class="form-status" role="status" aria-live="polite" data-form-status></p>
</main>`;
  return documentShell({
    title: 'Display override — Chalkwright',
    bodyClass: 'operator-page',
    body,
    basePath: model.basePath,
  });
}

export function renderOperatorHoldPage(model: OperatorScopeModel): string {
  const active = model.activeHold?.status === 'held';
  const canHold =
    model.meetingId !== undefined &&
    model.roomId !== undefined &&
    model.classId !== undefined;
  const holdAction = localPath(
    model.basePath,
    `/hold/${encodeURIComponent(model.screenId)}`,
  );
  const body = `${operatorHeader('Carousel hold', 'Holds are scoped to this screen, plan, and meeting.', model.basePath)}
<main class="operator-main">
  <section class="scope-summary" aria-labelledby="scope-title"><h2 id="scope-title">Scope</h2><dl><dt>Screen</dt><dd>${escapeHtml(model.screenId)}</dd><dt>Date</dt><dd>${escapeHtml(model.date)}</dd><dt>Plan</dt><dd>${escapeHtml(model.planId)}</dd><dt>Meeting</dt><dd>${escapeHtml(model.meetingId ?? 'No active meeting')}</dd></dl></section>
  <p class="hold-banner ${active ? 'active' : ''}" role="status">${active ? `Held: ${escapeHtml(model.activeHold?.reasonCode)}${model.activeHold?.expiresAt === undefined ? ' (indefinite)' : ` until ${escapeHtml(model.activeHold.expiresAt)}`}` : 'Carousel is not held.'}</p>
  <form class="operator-form" method="post" action="${escapeHtml(holdAction)}" data-operator-form="hold" data-http-method="POST">
    <input type="hidden" name="screenId" value="${escapeHtml(model.screenId)}"><input type="hidden" name="date" value="${escapeHtml(model.date)}"><input type="hidden" name="roomId" value="${escapeHtml(model.roomId)}"><input type="hidden" name="classId" value="${escapeHtml(model.classId)}"><input type="hidden" name="planId" value="${escapeHtml(model.planId)}"><input type="hidden" name="meetingId" value="${escapeHtml(model.meetingId)}"><input type="hidden" name="effectiveAt" value="${escapeHtml(model.effectiveAt)}"><input type="hidden" name="expectedRevision" value="${escapeHtml(model.activeHold?.revision)}">
    <label>Reason <select name="reasonCode"><option value="operator-review">Operator review</option><option value="discussion">Class discussion</option><option value="accessibility">Accessibility support</option></select></label>
    <label>Duration <select name="durationMinutes"><option value="5">5 minutes</option><option value="15">15 minutes</option><option value="30">30 minutes</option><option value="indefinite">Until released</option></select></label>
    <button type="submit" ${canHold ? '' : 'disabled'}>Hold current card</button>
  </form>
  <form class="operator-form compact-form" method="post" action="${escapeHtml(holdAction)}" data-operator-form="hold-release" data-http-method="DELETE"><input type="hidden" name="date" value="${escapeHtml(model.date)}"><input type="hidden" name="roomId" value="${escapeHtml(model.roomId)}"><input type="hidden" name="classId" value="${escapeHtml(model.classId)}"><input type="hidden" name="planId" value="${escapeHtml(model.planId)}"><input type="hidden" name="meetingId" value="${escapeHtml(model.meetingId)}"><input type="hidden" name="effectiveAt" value="${escapeHtml(model.effectiveAt)}"><input type="hidden" name="expectedRevision" value="${escapeHtml(model.activeHold?.revision)}"><input type="hidden" name="reasonCode" value="operator-release"><button type="submit" ${active && model.activeHold?.revision !== undefined ? '' : 'disabled'}>Release hold</button></form>
  <p class="form-status" role="status" aria-live="polite" data-form-status></p>
</main>`;
  return documentShell({
    title: 'Carousel hold — Chalkwright',
    bodyClass: 'operator-page',
    body,
    basePath: model.basePath,
  });
}

export function stateSceneNames(): Readonly<Record<DisplayState, string>> {
  return {
    no_classes: 'No classes',
    morning_overview: 'Morning overview',
    idle: 'Coming up',
    pre_checkin: 'Check-in',
    in_class_content: 'Class content',
    dismissal_warning: 'Dismissal warning',
    post_end: 'Post-class',
    day_complete: 'Day complete',
  };
}
