import assert from 'node:assert/strict';
import test from 'node:test';

import {
  extractBellScheduleCapture,
  normalizeBellScheduleCapture,
  normalizeExtractedBellDay,
  type BellScheduleCapture,
} from '../../../src/application/normalization/bell-schedule.js';
import { legacyBellCaptures } from '../../fixtures/m03-legacy-golden.js';

function capture(
  html: string,
  text: string,
  title = 'Bell Schedule',
): BellScheduleCapture {
  return {
    html,
    text,
    title,
    capturedAt: '2035-04-13T05:00:00Z',
    sourceReference: 'synthetic-bell-capture',
    method: 'fixture',
  };
}

test('extracts five sanitized repository-owned legacy bell shapes', () => {
  for (const scenario of legacyBellCaptures) {
    const result = extractBellScheduleCapture(
      capture(scenario.html, scenario.text, scenario.title),
    );
    assert.equal(result.status, 'extracted', scenario.id);
    assert.deepEqual(
      result.days[0]?.periods.map((period) => period.label),
      scenario.expectedLabels,
      scenario.id,
    );
  }
  const missingFixture = legacyBellCaptures.find(
    (scenario) => scenario.id === 'missing-metadata',
  );
  assert.ok(missingFixture);
  const missing = extractBellScheduleCapture(
    capture(missingFixture.html, missingFixture.text, missingFixture.title),
  );
  assert.equal(missing.days[0]?.effectiveDate, undefined);
});

test('extracts hydrated and embedded weekly AET schedules byte-stably', () => {
  const hydrated = capture(
    '<table><tr><th dayindex="2">Monday<br>04/13/2035<br>MSHS Bell Schedule Normal (F)</th><th dayindex="3">Tuesday<br>04/14/2035<br>MSHS Bell Schedule Normal (G)</th></tr></table><div class="aet_day" dayindex="2"><div class="aet_period"><b>Web Design (811.2)</b><br>B407<br>07:45 AM - 09:05 AM</div></div><div dayindex="3" class="aet_day"><div class="aet_period"><b>Robotics (506.2)</b><br>B407<br>10:45 AM - 12:05 PM</div></div>',
    'Bell Schedule',
  );
  const embedded = capture(
    '<table><tr><th dayindex="2">Monday<br>04/13/2035<br>MSHS Bell Schedule Normal (F)</th></tr></table><div class="aet_day" dayindex="2"></div><script>periods.push({"dow":2,"date_value":"2035-04-13","pretty_date":"04/13/2035","cycle_day":"F","bell_schedule":"MSHS Bell Schedule Normal","start_time":27900,"end_time":32700,"courses":"<b>Web Design (811.2)<\\/b>(br)B407(br)07:45 AM - 09:05 AM"});</script>',
    'Bell Schedule',
  );

  const hydratedResult = extractBellScheduleCapture(hydrated);
  assert.equal(hydratedResult.days.length, 2);
  assert.equal(hydratedResult.days[1]?.periods[0]?.label, 'Robotics (506.2)');
  assert.equal(hydratedResult.days[0]?.periods[0]?.notes, 'B407');

  const first = extractBellScheduleCapture(embedded);
  const second = extractBellScheduleCapture(embedded);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.equal(first.days[0]?.periods[0]?.startTime, '07:45');
  assert.equal(first.days[0]?.periods[0]?.code, '811.2');

  const normalized = normalizeExtractedBellDay({
    capture: hydrated,
    day: hydratedResult.days[0]!,
    requestedDate: '2035-04-13',
    utcOffset: 'Z',
    freshness: 'fresh',
  });
  assert.equal(normalized.status, 'normalized');
  if (normalized.status === 'normalized') {
    assert.equal(normalized.observation.periods[0]?.courseKey, '811-2');
    assert.equal(normalized.observation.periods[0]?.roomKey, 'room-b407');
  }

  const vietnam = normalizeExtractedBellDay({
    capture: hydrated,
    day: hydratedResult.days[0]!,
    requestedDate: '2035-04-13',
    utcOffset: '+07:00',
    freshness: 'fresh',
  });
  assert.equal(vietnam.status, 'normalized');
  if (vietnam.status === 'normalized') {
    assert.equal(
      vietnam.observation.periods[0]?.startsAt,
      '2035-04-13T00:45:00.000Z',
    );
    assert.equal(
      vietnam.observation.periods[0]?.endsAt,
      '2035-04-13T02:05:00.000Z',
    );
  }
});

test('normalizes matching dates and diagnoses missing, mismatched, stale, and malformed input', () => {
  const tableCapture = capture(
    '<table><tr><td>Period 1</td><td>8:00 AM - 9:00 AM</td></tr></table>',
    'Monday, April 13, 2035\nPeriod 1 8:00 AM - 9:00 AM',
  );
  const extracted = extractBellScheduleCapture(tableCapture);
  const day = extracted.days[0];
  assert.ok(day);
  const normalized = normalizeExtractedBellDay({
    capture: tableCapture,
    day,
    requestedDate: '2035-04-13',
    utcOffset: 'Z',
    freshness: 'fresh',
  });
  assert.equal(normalized.status, 'normalized');
  if (normalized.status === 'normalized') {
    assert.equal(
      normalized.observation.periods[0]?.startsAt,
      '2035-04-13T08:00:00.000Z',
    );
    assert.equal(normalized.observation.verification, 'verified');
  }

  const missing = normalizeExtractedBellDay({
    capture: tableCapture,
    day: { periods: day.periods },
    requestedDate: '2035-04-13',
    utcOffset: 'Z',
    freshness: 'fresh',
  });
  assert.equal(missing.status, 'rejected');
  assert.equal(missing.diagnostics[0]?.code, 'schedule-date-metadata-missing');

  const mismatch = normalizeExtractedBellDay({
    capture: tableCapture,
    day: { ...day, effectiveDate: '2035-04-14' },
    requestedDate: '2035-04-13',
    utcOffset: 'Z',
    freshness: 'fresh',
  });
  assert.equal(mismatch.status, 'rejected');
  assert.equal(mismatch.diagnostics[0]?.code, 'schedule-date-mismatch');

  const stale = normalizeExtractedBellDay({
    capture: tableCapture,
    day,
    requestedDate: '2035-04-13',
    utcOffset: 'Z',
    freshness: 'stale',
  });
  assert.equal(stale.status, 'normalized');
  if (stale.status === 'normalized')
    assert.equal(stale.observation.verification, 'unverified');

  const malformed = extractBellScheduleCapture(
    capture('<main>Nothing useful</main>', 'No periods'),
  );
  assert.equal(malformed.status, 'rejected');
  assert.equal(malformed.diagnostics[0]?.code, 'bell-schedule-periods-missing');
});

test('normalizes only a transport-verified empty schedule for the exact date as no classes', () => {
  const empty = capture(
    '<main id="bell-ready"><table><tr><th dayindex="6">Friday<br>04/13/2035<br>Synthetic Academy Bell Schedule</th></tr></table><div class="aet_day" dayindex="6"></div></main>',
    'Synthetic Academy\nMonday, April 13, 2035\nBell Schedule',
    'Synthetic Academy Bell Schedule Monday, April 13, 2035',
  );
  const unverified = normalizeBellScheduleCapture({
    capture: empty,
    requestedDate: '2035-04-13',
    utcOffset: 'Z',
    freshness: 'fresh',
  });
  assert.equal(unverified.status, 'rejected');

  const normalized = normalizeBellScheduleCapture({
    capture: empty,
    requestedDate: '2035-04-13',
    utcOffset: 'Z',
    freshness: 'fresh',
    verifiedEmptyScheduleIsNoClasses: true,
  });
  assert.equal(normalized.status, 'normalized');
  if (normalized.status === 'normalized') {
    assert.equal(normalized.observation.kind, 'no-classes');
    assert.deepEqual(normalized.observation.periods, []);
    assert.equal(normalized.observation.verification, 'verified');
    assert.equal(normalized.diagnostics[0]?.code, 'schedule-no-classes');
  }

  const wrongDate = normalizeBellScheduleCapture({
    capture: empty,
    requestedDate: '2035-04-14',
    utcOffset: 'Z',
    freshness: 'fresh',
    verifiedEmptyScheduleIsNoClasses: true,
  });
  assert.equal(wrongDate.status, 'rejected');
  assert.equal(wrongDate.diagnostics[0]?.code, 'bell-schedule-periods-missing');

  const missingDate = normalizeBellScheduleCapture({
    capture: capture(
      '<main id="bell-ready">Synthetic Academy Bell Schedule</main>',
      'Synthetic Academy Bell Schedule',
      'Synthetic Academy Bell Schedule',
    ),
    requestedDate: '2035-04-13',
    utcOffset: 'Z',
    freshness: 'fresh',
    verifiedEmptyScheduleIsNoClasses: true,
  });
  assert.equal(missingDate.status, 'rejected');
  assert.equal(
    missingDate.diagnostics[0]?.code,
    'bell-schedule-periods-missing',
  );

  const genericEmpty = normalizeBellScheduleCapture({
    capture: capture(
      '<main id="bell-ready">Synthetic Academy Bell Schedule</main>',
      'Synthetic Academy\nMonday, April 13, 2035\nBell Schedule',
      'Synthetic Academy Bell Schedule Monday, April 13, 2035',
    ),
    requestedDate: '2035-04-13',
    utcOffset: 'Z',
    freshness: 'fresh',
    verifiedEmptyScheduleIsNoClasses: true,
  });
  assert.equal(genericEmpty.status, 'rejected');
  assert.equal(
    genericEmpty.diagnostics[0]?.code,
    'bell-schedule-periods-missing',
  );

  const malformedPeriod = normalizeBellScheduleCapture({
    capture: capture(
      '<main id="bell-ready"><table><tr><th dayindex="6">Friday<br>04/13/2035<br>Synthetic Academy Bell Schedule</th></tr></table><div class="aet_day" dayindex="6"><div class="aet_period">Period 1<br>not a valid interval</div></div></main>',
      'Synthetic Academy\nFriday, April 13, 2035\nBell Schedule\nPeriod 1\nnot a valid interval',
      'Synthetic Academy Bell Schedule Friday, April 13, 2035',
    ),
    requestedDate: '2035-04-13',
    utcOffset: 'Z',
    freshness: 'fresh',
    verifiedEmptyScheduleIsNoClasses: true,
  });
  assert.equal(malformedPeriod.status, 'rejected');
  assert.equal(
    malformedPeriod.diagnostics[0]?.code,
    'bell-schedule-periods-missing',
  );

  const changedMarkup = normalizeBellScheduleCapture({
    capture: capture(
      '<main id="bell-ready"><table><tr><th dayindex="6">Friday<br>04/13/2035<br>Synthetic Academy Bell Schedule</th></tr></table><div class="aet_day" dayindex="6"><div class="replacement-period">Period 1<br>08:00 AM until 08:45 AM</div></div></main>',
      'Synthetic Academy\nFriday, April 13, 2035\nBell Schedule\nPeriod 1\n08:00 AM until 08:45 AM',
      'Synthetic Academy Bell Schedule Friday, April 13, 2035',
    ),
    requestedDate: '2035-04-13',
    utcOffset: 'Z',
    freshness: 'fresh',
    verifiedEmptyScheduleIsNoClasses: true,
  });
  assert.equal(changedMarkup.status, 'rejected');
  assert.equal(
    changedMarkup.diagnostics[0]?.code,
    'bell-schedule-periods-missing',
  );

  const invalidNonemptyDay = normalizeExtractedBellDay({
    capture: empty,
    day: {
      effectiveDate: '2035-04-13',
      periods: [
        {
          label: 'Period 1',
          startTime: '10:00',
          endTime: '09:00',
        },
      ],
    },
    requestedDate: '2035-04-13',
    utcOffset: 'Z',
    freshness: 'fresh',
    verifiedEmptyScheduleIsNoClasses: true,
  });
  assert.equal(invalidNonemptyDay.status, 'rejected');
  assert.ok(
    invalidNonemptyDay.diagnostics.some(
      (item) => item.code === 'schedule-periods-invalid',
    ),
  );
});
