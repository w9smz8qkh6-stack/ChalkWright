(() => {
  'use strict';

  interface PollingContract {
    readonly requestTimeoutMs: number;
    readonly healthyIntervalMs: number;
    readonly initialRetryMs: number;
    readonly maximumRetryMs: number;
    readonly retryStrategy: string;
  }

  interface BootstrapContract {
    readonly polling?: Partial<PollingContract>;
    readonly timeZone?: string;
    readonly meetingId?: string;
  }

  interface TargetPayload {
    readonly presentationHtml?: unknown;
    readonly html?: unknown;
    readonly evaluatedAt?: unknown;
    readonly state?: unknown;
    readonly meetingId?: unknown;
    readonly courseLabel?: unknown;
    readonly dateLabel?: unknown;
    readonly documentTitle?: unknown;
    readonly degraded?: unknown;
  }

  interface CarouselSnapshot {
    meetingId: string;
    index: number;
    paused: boolean;
  }

  interface CarouselState extends CarouselSnapshot {
    carousel: HTMLElement;
    cards: HTMLElement[];
    dots: HTMLButtonElement[];
    serverHeld: boolean;
    timer: number | undefined;
    touchStartX: number | undefined;
  }

  interface OperatorRequest {
    readonly method: string;
    readonly url: string;
    readonly body?: unknown;
  }

  const root = document.querySelector<HTMLElement>('[data-display-root]');
  const bootstrapElement = document.querySelector('#presentation-bootstrap');
  let bootstrap: BootstrapContract = {};
  try {
    const parsed: unknown = bootstrapElement
      ? JSON.parse(bootstrapElement.textContent || '{}')
      : {};
    bootstrap =
      typeof parsed === 'object' && parsed !== null
        ? (parsed as BootstrapContract)
        : {};
  } catch {
    bootstrap = {};
  }

  const polling = {
    requestTimeoutMs: 10000,
    healthyIntervalMs: 30000,
    initialRetryMs: 5000,
    maximumRetryMs: 120000,
    retryStrategy: 'exponential',
    ...(bootstrap.polling || {}),
  };
  const timeZone = root?.dataset.timeZone || bootstrap.timeZone || 'Etc/UTC';
  let failureCount = 0;
  let pollTimer: number | undefined;
  let currentMeetingId = String(bootstrap.meetingId || '');
  let carouselState: CarouselState | undefined;
  let operatorAuthorization = '';
  let serverClockAnchor = Date.parse(root?.dataset.evaluatedAt || '');
  let browserClockAnchor = Date.now();

  function displayNow(): Date {
    const pinnedAt = root?.dataset.pinnedAt;
    if (pinnedAt) return new Date(pinnedAt);
    if (Number.isFinite(serverClockAnchor))
      return new Date(serverClockAnchor + (Date.now() - browserClockAnchor));
    return new Date();
  }

  function syntheticOperatorNow(reference: string | undefined): Date {
    const anchor = Date.parse(String(reference || ''));
    return new Date(anchor + (Date.now() - browserClockAnchor));
  }

  function announce(message: string): void {
    const region = document.querySelector<HTMLElement>('[data-announcer]');
    if (region) region.textContent = message;
  }

  function setConnectionDegraded(degraded: boolean): void {
    const status = document.querySelector<HTMLElement>(
      '[data-connection-status]',
    );
    if (!status) return;
    status.hidden = !degraded;
  }

  function updateClock(): void {
    const now = displayNow();
    for (const element of document.querySelectorAll<HTMLTimeElement>(
      '[data-clock]',
    )) {
      element.dateTime = now.toISOString();
      try {
        element.textContent = new Intl.DateTimeFormat('en-US', {
          timeZone,
          hour: 'numeric',
          minute: '2-digit',
          second: '2-digit',
        }).format(now);
      } catch {
        element.textContent = now.toISOString().slice(11, 19);
      }
    }
    for (const element of document.querySelectorAll<HTMLElement>(
      '[data-local-time]',
    )) {
      const instant = new Date(element.dataset.localTime || '');
      if (!Number.isFinite(instant.getTime())) continue;
      try {
        element.textContent = new Intl.DateTimeFormat('en-US', {
          timeZone,
          hour: 'numeric',
          minute: '2-digit',
        }).format(instant);
      } catch {
        element.textContent = instant.toISOString().slice(11, 16);
      }
    }
    updateCountdowns(now.getTime());
  }

  function updateCountdowns(now: number): void {
    for (const countdown of document.querySelectorAll<HTMLElement>(
      '[data-countdown-target]',
    )) {
      const target = Date.parse(countdown.dataset.countdownTarget || '');
      const value = countdown.querySelector('[data-countdown-value]');
      if (!value || !Number.isFinite(target)) continue;
      const remaining = Math.max(0, target - now);
      const totalSeconds = Math.ceil(remaining / 1000);
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;
      value.textContent =
        hours > 0
          ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
          : `${minutes}:${String(seconds).padStart(2, '0')}`;
    }
  }

  function stopCarouselTimer(): void {
    if (carouselState?.timer) window.clearTimeout(carouselState.timer);
    if (carouselState) carouselState.timer = undefined;
  }

  function initializeCarousel(previousState?: CarouselSnapshot): void {
    stopCarouselTimer();
    const carousel = document.querySelector<HTMLElement>('[data-carousel]');
    if (!carousel) {
      carouselState = undefined;
      return;
    }
    const cards = [
      ...carousel.querySelectorAll<HTMLElement>('[data-carousel-card]'),
    ];
    const dots = [
      ...carousel.querySelectorAll<HTMLButtonElement>('[data-carousel-dot]'),
    ];
    const meetingId = carousel.dataset.meetingId || '';
    const sameMeeting = previousState?.meetingId === meetingId;
    carouselState = {
      carousel,
      cards,
      dots,
      meetingId,
      index: sameMeeting ? Math.min(previousState.index, cards.length - 1) : 0,
      paused: sameMeeting ? previousState.paused : false,
      serverHeld: carousel.dataset.serverHeld === 'true',
      timer: undefined,
      touchStartX: undefined,
    };

    function show(index: number, userInitiated = false): void {
      if (!carouselState || cards.length === 0) return;
      stopCarouselTimer();
      carouselState.index = (index + cards.length) % cards.length;
      const state = carouselState;
      cards.forEach((card, cardIndex) => {
        card.hidden = cardIndex !== state.index;
        card.classList.remove('revealed');
      });
      dots.forEach((dot, dotIndex) => {
        dot.setAttribute('aria-selected', String(dotIndex === state.index));
      });
      const active = cards[state.index];
      if (userInitiated && active) {
        announce(`Showing card ${state.index + 1} of ${cards.length}`);
      }
      schedule(active);
    }

    function schedule(card: HTMLElement | undefined): void {
      if (
        !carouselState ||
        !card ||
        cards.length <= 1 ||
        carouselState.paused ||
        carouselState.serverHeld
      )
        return;
      const configured = Number(card.dataset.durationMs || 12000);
      const duration = Number.isFinite(configured)
        ? Math.max(5000, configured)
        : 12000;
      const reveal = card.querySelector('[data-reveal]');
      const revealAt = reveal ? Math.min(duration * 0.45, duration - 4000) : 0;
      if (reveal && revealAt > 0) {
        window.setTimeout(() => {
          if (carouselState?.cards[carouselState.index] === card)
            card.classList.add('revealed');
        }, revealAt);
      }
      const revealAwareDuration = reveal
        ? Math.max(duration, revealAt + 4000)
        : duration;
      carouselState.timer = window.setTimeout(() => {
        if (carouselState) show(carouselState.index + 1);
      }, revealAwareDuration);
    }

    carousel
      .querySelector('[data-carousel-previous]')
      ?.addEventListener('click', () => {
        if (carouselState) show(carouselState.index - 1, true);
      });
    carousel
      .querySelector('[data-carousel-next]')
      ?.addEventListener('click', () => {
        if (carouselState) show(carouselState.index + 1, true);
      });
    dots.forEach((dot, index) =>
      dot.addEventListener('click', () => show(index, true)),
    );
    const pause = carousel.querySelector<HTMLButtonElement>(
      '[data-carousel-pause]',
    );
    pause?.addEventListener('click', () => {
      if (!carouselState || carouselState.serverHeld) return;
      carouselState.paused = !carouselState.paused;
      pause.setAttribute('aria-pressed', String(carouselState.paused));
      pause.textContent = carouselState.paused ? 'Resume' : 'Pause';
      if (carouselState.paused) stopCarouselTimer();
      else schedule(cards[carouselState.index]);
      announce(carouselState.paused ? 'Carousel paused' : 'Carousel resumed');
    });
    if (carouselState.serverHeld && pause) {
      pause.disabled = true;
      pause.textContent = 'Held';
    } else if (pause && carouselState.paused) {
      pause.setAttribute('aria-pressed', 'true');
      pause.textContent = 'Resume';
    }
    carousel.addEventListener('pointerdown', (event) => {
      if (carouselState) carouselState.touchStartX = event.clientX;
    });
    carousel.addEventListener('pointerup', (event) => {
      if (!carouselState || carouselState.touchStartX === undefined) return;
      const distance = event.clientX - carouselState.touchStartX;
      carouselState.touchStartX = undefined;
      if (Math.abs(distance) < 45) return;
      show(carouselState.index + (distance < 0 ? 1 : -1), true);
    });
    show(carouselState.index);
  }

  function initializeSceneMedia(): void {
    const scene = document.querySelector<HTMLElement>('[data-media-scene]');
    if (!scene) return;
    const layers = [
      ...scene.querySelectorAll<HTMLVideoElement>('[data-media-layer]'),
    ];
    let revealed = false;
    let active = 0;
    const reveal = () => {
      if (revealed) return;
      revealed = true;
      scene.classList.remove('media-pending');
    };
    const fallback = window.setTimeout(reveal, 2000);
    const play = (video: HTMLVideoElement): void => {
      const result = video.play();
      if (result && typeof result.catch === 'function') result.catch(reveal);
    };
    layers.forEach((video, index) => {
      video.muted = true;
      video.preload = 'auto';
      video.addEventListener('canplay', () => {
        window.clearTimeout(fallback);
        reveal();
        if (index === active) play(video);
      });
      video.addEventListener('timeupdate', () => {
        if (
          index !== active ||
          !Number.isFinite(video.duration) ||
          video.duration - video.currentTime > 0.8 ||
          layers.length < 2
        )
          return;
        const next = (active + 1) % layers.length;
        const nextVideo = layers[next];
        if (!nextVideo) return;
        nextVideo.currentTime = 0;
        play(nextVideo);
        nextVideo.classList.add('active');
        video.classList.remove('active');
        active = next;
      });
      video.addEventListener('ended', () => {
        if (index !== active) return;
        video.currentTime = 0;
        play(video);
      });
      video.addEventListener('error', reveal);
    });
    if (layers[0]) play(layers[0]);
  }

  function applyTargetPayload(payload: TargetPayload): boolean {
    const html = payload?.presentationHtml ?? payload?.html;
    const main = document.querySelector<HTMLElement>('#display-main');
    if (typeof html !== 'string' || html.length === 0 || !main) return false;
    const previousState = carouselState
      ? {
          meetingId: carouselState.meetingId,
          index: carouselState.index,
          paused: carouselState.paused,
        }
      : undefined;
    main.innerHTML = html;
    const evaluatedAt = Date.parse(String(payload.evaluatedAt || ''));
    if (Number.isFinite(evaluatedAt) && !root?.dataset.pinnedAt) {
      serverClockAnchor = evaluatedAt;
      browserClockAnchor = Date.now();
      if (root) root.dataset.evaluatedAt = new Date(evaluatedAt).toISOString();
    }
    if (typeof payload.state === 'string' && root) {
      for (const name of [...document.body.classList]) {
        if (name.startsWith('state-')) document.body.classList.remove(name);
      }
      document.body.classList.add(`state-${payload.state}`);
      root.dataset.state = payload.state;
    }
    const nextMeetingId = String(payload.meetingId || '');
    if (nextMeetingId !== currentMeetingId) {
      currentMeetingId = nextMeetingId;
      if (previousState) previousState.paused = false;
    }
    const label = document.querySelector('[data-course-label]');
    if (label && typeof payload.courseLabel === 'string')
      label.textContent = payload.courseLabel;
    const dateLabel = document.querySelector('[data-display-date]');
    if (
      dateLabel &&
      typeof payload.dateLabel === 'string' &&
      payload.dateLabel.length <= 128
    )
      dateLabel.textContent = payload.dateLabel;
    if (
      typeof payload.documentTitle === 'string' &&
      payload.documentTitle.length <= 160
    )
      document.title = payload.documentTitle;
    setConnectionDegraded(payload.degraded === true);
    initializeCarousel(previousState);
    initializeSceneMedia();
    updateClock();
    return true;
  }

  function schedulePoll(delay: number): void {
    if (!root) return;
    if (pollTimer) window.clearTimeout(pollTimer);
    pollTimer = window.setTimeout(pollTarget, delay);
  }

  async function pollTarget(): Promise<void> {
    if (!root?.dataset.targetUrl) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(
      () => controller.abort(),
      polling.requestTimeoutMs,
    );
    try {
      const response = await fetch(root.dataset.targetUrl, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) throw new Error('target-unavailable');
      const payload: unknown = await response.json();
      if (payload === null || typeof payload !== 'object')
        throw new Error('target-invalid');
      if (!applyTargetPayload(payload as TargetPayload))
        throw new Error('target-invalid');
      failureCount = 0;
      schedulePoll(polling.healthyIntervalMs);
    } catch {
      failureCount += 1;
      setConnectionDegraded(true);
      const retry = Math.min(
        polling.maximumRetryMs,
        polling.initialRetryMs * 2 ** Math.max(0, failureCount - 1),
      );
      schedulePoll(retry);
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function formValues(form: HTMLFormElement): Record<string, string> {
    const values: Record<string, string> = {};
    for (const [key, value] of new FormData(form).entries()) {
      if (typeof value !== 'string') throw new Error('operator-file-rejected');
      values[key] = value;
    }
    return values;
  }

  function operatorRequest(form: HTMLFormElement): OperatorRequest {
    const values = formValues(form);
    const kind = form.dataset.operatorForm;
    const method = form.dataset.httpMethod || 'POST';
    if (kind === 'override') {
      const classOverride = {
        cardsMode: values.cardsMode,
        hideAssignments: values.hideAssignments === 'on',
        ...(values.dismissalMessage
          ? { dismissalMessage: values.dismissalMessage }
          : {}),
      };
      return {
        method,
        url: form.action,
        body: {
          screenId: values.screenId,
          date: values.date,
          ...(values.announcement ? { announcement: values.announcement } : {}),
          ...(values.meetingId
            ? { classes: { [values.meetingId]: classOverride } }
            : {}),
        },
      };
    }
    if (kind === 'hold') {
      const heldAt = syntheticOperatorNow(values.effectiveAt);
      const duration = Number(values.durationMinutes);
      return {
        method,
        url: form.action,
        body: {
          screenId: values.screenId,
          date: values.date,
          roomId: values.roomId,
          classId: values.classId,
          planId: values.planId,
          meetingId: values.meetingId,
          heldAt: heldAt.toISOString(),
          reasonCode: values.reasonCode,
          ...(Number.isFinite(duration) && duration > 0
            ? {
                expiresAt: new Date(
                  heldAt.getTime() + duration * 60000,
                ).toISOString(),
              }
            : {}),
          ...(values.expectedRevision
            ? { expectedRevision: values.expectedRevision }
            : {}),
        },
      };
    }
    const url = new URL(form.action, window.location.origin);
    for (const [key, value] of Object.entries(values)) {
      if (value) url.searchParams.set(key, value);
    }
    if (kind === 'hold-release')
      url.searchParams.set(
        'releasedAt',
        syntheticOperatorNow(values.effectiveAt).toISOString(),
      );
    return { method, url: url.href };
  }

  function initializeOperatorForms(): void {
    for (const form of document.querySelectorAll<HTMLFormElement>(
      '[data-operator-form]',
    )) {
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const status = document.querySelector('[data-form-status]');
        if (status) status.textContent = 'Saving…';
        if (!operatorAuthorization) {
          operatorAuthorization =
            window.prompt('Operator authorization for this page') || '';
        }
        if (!operatorAuthorization) {
          if (status) status.textContent = 'Authorization is required.';
          return;
        }
        const request = operatorRequest(form);
        const hasBody = request.body !== undefined;
        try {
          const response = await fetch(request.url, {
            method: request.method,
            headers: {
              Accept: 'application/json',
              ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
              Authorization: `Bearer ${operatorAuthorization}`,
            },
            ...(hasBody ? { body: JSON.stringify(request.body) } : {}),
            cache: 'no-store',
          });
          if (!response.ok) {
            if (response.status === 401) operatorAuthorization = '';
            throw new Error('operator-request-failed');
          }
          if (status) status.textContent = 'Saved.';
        } catch {
          if (status)
            status.textContent =
              'The change was not saved. Review authorization and try again.';
        }
      });
    }
  }

  updateClock();
  window.setInterval(updateClock, 1000);
  initializeCarousel();
  initializeSceneMedia();
  initializeOperatorForms();
  if (root?.dataset.targetUrl) schedulePoll(0);
})();
