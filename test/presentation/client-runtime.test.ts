import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

class ClassList implements Iterable<string> {
  private readonly values = new Set<string>();

  constructor(...values: string[]) {
    for (const value of values) this.values.add(value);
  }

  add(value: string): void {
    this.values.add(value);
  }

  remove(value: string): void {
    this.values.delete(value);
  }

  [Symbol.iterator](): Iterator<string> {
    return this.values[Symbol.iterator]();
  }
}

function clientHarness(options: {
  readonly targetUrl: string;
  readonly pinnedAt?: string;
  readonly payload?: unknown;
  readonly payloads?: readonly (unknown | Error)[];
}) {
  const root = {
    dataset: {
      targetUrl: options.targetUrl,
      timeZone: 'Etc/UTC',
      state: 'in_class_content',
      evaluatedAt: '2035-04-13T08:00:00Z',
      ...(options.pinnedAt === undefined ? {} : { pinnedAt: options.pinnedAt }),
    },
  };
  const main = { innerHTML: '' };
  const clock = { dateTime: '', textContent: '' };
  const dateLabel = { textContent: 'Friday, April 13' };
  const connectionStatus = { hidden: true };
  const body = {
    classList: new ClassList('display-page', 'state-in_class_content'),
  };
  let fetchCalls = 0;
  let fakeNow = Date.parse('2026-08-08T12:00:00Z');
  class FakeDate extends Date {
    constructor(value?: string | number | Date) {
      super(value === undefined ? fakeNow : value.valueOf());
    }

    static override now(): number {
      return fakeNow;
    }
  }
  const document = {
    title: 'Web Design · A — Chalkwright',
    body,
    querySelector(selector: string) {
      if (selector === '[data-display-root]') return root;
      if (selector === '#presentation-bootstrap')
        return {
          textContent: JSON.stringify({
            meetingId: 'meeting-b407-a',
            timeZone: 'Etc/UTC',
          }),
        };
      if (selector === '#display-main') return main;
      if (selector === '[data-display-date]') return dateLabel;
      if (selector === '[data-connection-status]') return connectionStatus;
      return undefined;
    },
    querySelectorAll(selector: string) {
      if (selector === '[data-clock]') return [clock];
      return [];
    },
  };
  let timerId = 0;
  const timers = new Map<number, { callback: () => unknown; delay: number }>();
  let intervalCallback: (() => unknown) | undefined;
  const window = {
    location: { origin: 'http://127.0.0.1:4317' },
    setInterval(callback: () => unknown) {
      intervalCallback = callback;
      return ++timerId;
    },
    setTimeout(callback: () => unknown, delay: number) {
      timerId += 1;
      if (delay === 0) queueMicrotask(callback);
      else timers.set(timerId, { callback, delay });
      return timerId;
    },
    clearTimeout(id: number) {
      timers.delete(id);
    },
    prompt: () => '',
  };
  const context = {
    AbortController,
    Date: FakeDate,
    FormData,
    Intl,
    JSON,
    Math,
    Number,
    Object,
    String,
    URL,
    document,
    window,
    fetch: async () => {
      const index = fetchCalls++;
      const value = options.payloads?.[index] ?? options.payload;
      if (value instanceof Error) throw value;
      return {
        ok: true,
        json: async () => value,
      };
    },
    queueMicrotask,
  };
  vm.runInNewContext(
    readFileSync('dist/client/display-client.js', 'utf8'),
    context,
  );
  return {
    root,
    main,
    clock,
    dateLabel,
    connectionStatus,
    document,
    body,
    fetchCalls: () => fetchCalls,
    advance(milliseconds: number) {
      fakeNow += milliseconds;
    },
    tickClock() {
      intervalCallback?.();
    },
    async runTimeout(delay: number) {
      const selected = [...timers].find(([, timer]) => timer.delay === delay);
      assert.ok(selected);
      timers.delete(selected[0]);
      await selected[1].callback();
    },
  };
}

test('client applies cross-day state, labels, title, and degraded status after polling', async () => {
  const harness = clientHarness({
    targetUrl: '/target/screen-b407',
    payload: {
      presentationHtml: '<section>Dismissal</section>',
      state: 'dismissal_warning',
      meetingId: 'meeting-b407-a',
      courseLabel: 'Web Design · A',
      dateLabel: 'Saturday, April 14',
      documentTitle: 'Synthetic Computing · B — Chalkwright',
      degraded: true,
      evaluatedAt: '2035-04-14T08:02:00Z',
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.fetchCalls(), 1);
  assert.equal(harness.root.dataset.state, 'dismissal_warning');
  assert.deepEqual(
    [...harness.body.classList],
    ['display-page', 'state-dismissal_warning'],
  );
  assert.equal(harness.main.innerHTML, '<section>Dismissal</section>');
  assert.equal(harness.root.dataset.evaluatedAt, '2035-04-14T08:02:00.000Z');
  assert.equal(harness.dateLabel.textContent, 'Saturday, April 14');
  assert.equal(harness.document.title, 'Synthetic Computing · B — Chalkwright');
  assert.equal(harness.connectionStatus.hidden, false);
});

test('failed polls retain the last scene without rewinding the synthetic clock', async () => {
  const payload = {
    presentationHtml: '<section>Class content</section>',
    state: 'in_class_content',
    meetingId: 'meeting-b407-a',
    courseLabel: 'Web Design · A',
    evaluatedAt: '2035-04-13T08:02:00Z',
  };
  const harness = clientHarness({
    targetUrl: '/target/screen-b407',
    payloads: [payload, new Error('synthetic-poll-failure')],
  });
  await new Promise((resolve) => setImmediate(resolve));
  harness.advance(30_000);
  await harness.runTimeout(30_000);
  harness.tickClock();
  assert.equal(harness.fetchCalls(), 2);
  assert.equal(harness.main.innerHTML, '<section>Class content</section>');
  assert.equal(harness.clock.dateTime, '2035-04-13T08:02:30.000Z');
});

test('pinned client uses its fixture instant and performs no target polling', async () => {
  const pinnedAt = '2035-04-13T08:30:00Z';
  const harness = clientHarness({ targetUrl: '', pinnedAt });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.fetchCalls(), 0);
  assert.equal(harness.clock.dateTime, '2035-04-13T08:30:00.000Z');
});
