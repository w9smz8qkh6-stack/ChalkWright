import { contractVersion } from '../../contracts/v1/common.js';
import type {
  ContractDiagnostic,
  FreshnessState,
  IsoDate,
  IsoInstant,
  Provenance,
} from '../../contracts/v1/common.js';
import type {
  ScheduleKind,
  ScheduleObservation,
} from '../../contracts/v1/schedule.js';
import {
  courseKeyFromSectionCode,
  roomIdFromLocation,
} from '../../domain/identities.js';
import {
  compactText,
  diagnostic,
  epoch,
  isIsoDate,
  stableId,
} from '../../domain/pure-values.js';

const timeToken = '(\\d{1,2}:\\d{2}\\s*(?:AM|PM)?)';
const timeRangePattern = new RegExp(
  `${timeToken}\\s*(?:-|–|—|to)\\s*${timeToken}`,
  'i',
);
const scheduleHint =
  /\b(bell schedule|schedule|regular day|late start|early release|half day|day \d|a day|b day|rotation)\b/i;
const labelHint =
  /\b(period|block|advisory|assembly|break|lunch|homeroom|tutorial|club|activity|recess)\b/i;
const dayNames = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;
const dayNameByAetIndex: Readonly<Record<string, string>> = {
  '1': 'Sunday',
  '2': 'Monday',
  '3': 'Tuesday',
  '4': 'Wednesday',
  '5': 'Thursday',
  '6': 'Friday',
  '7': 'Saturday',
};

export interface BellScheduleCapture {
  readonly title: string;
  readonly html: string;
  readonly text: string;
  readonly capturedAt: IsoInstant;
  readonly sourceReference: string;
  readonly method: Extract<
    Provenance['method'],
    'session-http' | 'browser-read' | 'fixture'
  >;
}

export interface ExtractedBellPeriod {
  readonly label: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly code?: string;
  readonly notes?: string;
}

export interface ExtractedBellDay {
  readonly dayName?: string;
  readonly effectiveDate?: IsoDate;
  readonly scheduleLabel?: string;
  readonly periods: readonly ExtractedBellPeriod[];
}

export interface BellScheduleExtraction {
  readonly status: 'extracted' | 'rejected';
  readonly days: readonly ExtractedBellDay[];
  readonly diagnostics: readonly ContractDiagnostic[];
}

interface MutableBellDay {
  dayName?: string;
  effectiveDate?: IsoDate;
  scheduleLabel?: string;
  periods: ExtractedBellPeriod[];
}

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function htmlLines(value: string): string[] {
  return decodeHtml(value)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>|<\/div>|<\/li>|<\/h\d>|<\/td>|<\/th>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .split(/\r?\n/)
    .map(compactText)
    .filter(Boolean);
}

function inlineHtml(value: string): string {
  return compactText(htmlLines(value).join(' '));
}

function attribute(attributes: string, name: string): string | undefined {
  const match = attributes.match(
    new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i'),
  );
  return match?.[1];
}

function hasClass(attributes: string, className: string): boolean {
  return String(attribute(attributes, 'class') ?? '')
    .split(/\s+/)
    .includes(className);
}

function normalizeDate(value: unknown): IsoDate | undefined {
  const text = compactText(value);
  if (isIsoDate(text)) return text as IsoDate;
  const slash = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (slash !== null) {
    const year = Number(slash[3]?.length === 2 ? `20${slash[3]}` : slash[3]);
    const month = Number(slash[1]);
    const day = Number(slash[2]);
    const candidate = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return isIsoDate(candidate) ? (candidate as IsoDate) : undefined;
  }
  const monthDate = text.match(
    /\b(?:Jan|January|Feb|February|Mar|March|Apr|April|May|Jun|June|Jul|July|Aug|August|Sep|Sept|September|Oct|October|Nov|November|Dec|December)\s+\d{1,2},\s+\d{4}\b/i,
  )?.[0];
  if (monthDate === undefined) return undefined;
  const parsed = Date.parse(`${monthDate} UTC`);
  return Number.isFinite(parsed)
    ? new Date(parsed).toISOString().slice(0, 10)
    : undefined;
}

function effectiveDateFromText(value: string): IsoDate | undefined {
  const slash = value.match(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/)?.[0];
  if (slash !== undefined) return normalizeDate(slash);
  const month = value.match(
    /\b(?:Jan|January|Feb|February|Mar|March|Apr|April|May|Jun|June|Jul|July|Aug|August|Sep|Sept|September|Oct|October|Nov|November|Dec|December)\s+\d{1,2},\s+\d{4}\b/i,
  )?.[0];
  return normalizeDate(month);
}

function normalizeTime(value: unknown): string | undefined {
  const text = compactText(value);
  const twentyFour = text.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (twentyFour !== null) {
    const hour = Number(twentyFour[1]);
    const minute = Number(twentyFour[2]);
    if (hour <= 23 && minute <= 59) {
      return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    }
  }
  const meridiem = text.match(/^(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?$/i);
  if (meridiem === null) return undefined;
  let hour = Number(meridiem[1]);
  const minute = Number(meridiem[2] ?? 0);
  if (hour < 1 || hour > 12 || minute > 59) return undefined;
  if (meridiem[3]?.toLowerCase() === 'p' && hour !== 12) hour += 12;
  if (meridiem[3]?.toLowerCase() === 'a' && hour === 12) hour = 0;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function parseRange(
  value: string,
): { startTime: string; endTime: string } | undefined {
  const match = value.match(timeRangePattern);
  if (match === null) return undefined;
  const startTime = normalizeTime(match[1]);
  const endTime = normalizeTime(match[2]);
  return startTime === undefined || endTime === undefined
    ? undefined
    : { startTime, endTime };
}

function codeFromLabel(label: string): string | undefined {
  const parenthetical = label.match(/\(([^)]+)\)/)?.[1];
  if (parenthetical !== undefined) return compactText(parenthetical);
  const explicit = label.match(
    /\b(?:period|block|pd)\s*([A-Za-z0-9]+)\b/i,
  )?.[1];
  return explicit?.toUpperCase();
}

function periodFromParts(
  cells: readonly string[],
): ExtractedBellPeriod | undefined {
  const joined = compactText(cells.join(' | '));
  const range = parseRange(joined);
  let startTime = range?.startTime;
  let endTime = range?.endTime;
  if (range === undefined && cells[0] !== undefined && cells[1] !== undefined) {
    startTime = normalizeTime(cells[0]);
    endTime = normalizeTime(cells[1]);
  }
  if (startTime === undefined || endTime === undefined) return undefined;
  const nonTime = cells
    .map(compactText)
    .filter(
      (cell) =>
        cell.length > 0 &&
        parseRange(cell) === undefined &&
        normalizeTime(cell) === undefined,
    );
  const label =
    nonTime.find((candidate) => labelHint.test(candidate)) ?? nonTime[0];
  if (label === undefined) return undefined;
  const notes = nonTime.filter((candidate) => candidate !== label).join(' | ');
  const code = codeFromLabel(label);
  return {
    label,
    startTime,
    endTime,
    ...(code === undefined ? {} : { code }),
    ...(notes.length === 0 ? {} : { notes }),
  };
}

function sortAndDedupe(
  periods: readonly ExtractedBellPeriod[],
): ExtractedBellPeriod[] {
  const unique = new Map<string, ExtractedBellPeriod>();
  for (const period of periods) {
    const key = `${period.label}|${period.startTime}|${period.endTime}`;
    if (!unique.has(key)) unique.set(key, period);
  }
  return [...unique.values()].sort(
    (left, right) =>
      left.startTime.localeCompare(right.startTime) ||
      left.label.localeCompare(right.label),
  );
}

function periodsFromTables(html: string): ExtractedBellPeriod[] {
  return [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].flatMap((row) => {
    const cells = [
      ...(row[1] ?? '').matchAll(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi),
    ].map((cell) => inlineHtml(cell[1] ?? ''));
    const period = periodFromParts(cells);
    return period === undefined ? [] : [period];
  });
}

function periodsFromBlocks(html: string): ExtractedBellPeriod[] {
  return [
    ...html.matchAll(/<(li|article|div)\b([^>]*)>([\s\S]*?)<\/\1>/gi),
  ].flatMap((block) => {
    const tag = block[1]?.toLowerCase();
    const attributes = block[2] ?? '';
    if (
      tag === 'div' &&
      !hasClass(attributes, 'card') &&
      !hasClass(attributes, 'period')
    ) {
      return [];
    }
    const text = inlineHtml(block[3] ?? '');
    const range = parseRange(text);
    if (range === undefined) return [];
    const label = compactText(text.replace(timeRangePattern, ' '));
    if (label.length < 2) return [];
    const code = codeFromLabel(label);
    return [{ label, ...range, ...(code === undefined ? {} : { code }) }];
  });
}

function periodsFromText(text: string): ExtractedBellPeriod[] {
  return text.split(/\r?\n/).flatMap((line) => {
    const range = parseRange(line);
    if (range === undefined) return [];
    const label = compactText(line.replace(timeRangePattern, ' '));
    if (label.length < 2) return [];
    const code = codeFromLabel(label);
    return [{ label, ...range, ...(code === undefined ? {} : { code }) }];
  });
}

function dayMetadata(
  html: string,
): ReadonlyMap<string, Omit<MutableBellDay, 'periods'>> {
  const metadata = new Map<string, Omit<MutableBellDay, 'periods'>>();
  for (const heading of html.matchAll(/<th\b([^>]*)>([\s\S]*?)<\/th>/gi)) {
    const dayIndex = attribute(heading[1] ?? '', 'dayindex');
    if (dayIndex === undefined) continue;
    const lines = htmlLines(heading[2] ?? '');
    const dayName = lines.find((line) => dayNames.some((day) => day === line));
    const effectiveDate = lines.map(normalizeDate).find(Boolean);
    const scheduleLabel = lines.find((line) => scheduleHint.test(line));
    metadata.set(dayIndex, {
      ...(dayName === undefined ? {} : { dayName }),
      ...(effectiveDate === undefined ? {} : { effectiveDate }),
      ...(scheduleLabel === undefined ? {} : { scheduleLabel }),
    });
  }
  return metadata;
}

function periodsFromAetSegment(segment: string): ExtractedBellPeriod[] {
  return [...segment.matchAll(/<div\b([^>]*)>([\s\S]*?)<\/div>/gi)].flatMap(
    (periodBlock) => {
      if (!hasClass(periodBlock[1] ?? '', 'aet_period')) return [];
      const lines = htmlLines(periodBlock[2] ?? '');
      const label = lines[0];
      const timeLine = lines.find((line) => parseRange(line) !== undefined);
      const range = timeLine === undefined ? undefined : parseRange(timeLine);
      if (label === undefined || range === undefined) return [];
      const notes = lines
        .slice(1)
        .filter((line) => line !== timeLine)
        .join(' | ');
      const code = codeFromLabel(label);
      return [
        {
          label,
          ...range,
          ...(code === undefined ? {} : { code }),
          ...(notes.length === 0 ? {} : { notes }),
        },
      ];
    },
  );
}

function aetDaysFromDom(html: string): MutableBellDay[] {
  const metadata = dayMetadata(html);
  const markers = [...html.matchAll(/<div\b([^>]*)>/gi)].filter(
    (match) =>
      hasClass(match[1] ?? '', 'aet_day') &&
      attribute(match[1] ?? '', 'dayindex') !== undefined,
  );
  return markers.flatMap((marker, index) => {
    const dayIndex = attribute(marker[1] ?? '', 'dayindex');
    const start = (marker.index ?? 0) + marker[0].length;
    const end = markers[index + 1]?.index ?? html.length;
    const periods = sortAndDedupe(
      periodsFromAetSegment(html.slice(start, end)),
    );
    if (dayIndex === undefined || periods.length === 0) return [];
    return [{ ...metadata.get(dayIndex), periods }];
  });
}

function timeFromSeconds(value: unknown): string | undefined {
  const total = Number(value);
  if (!Number.isFinite(total) || total < 0) return undefined;
  const hour = Math.floor(total / 3600) % 24;
  const minute = Math.floor((total % 3600) / 60);
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function aetDaysFromEmbedded(html: string): MutableBellDay[] {
  const metadata = dayMetadata(html);
  const buckets = new Map<string, MutableBellDay>();
  for (const match of html.matchAll(
    /periods\.push\(\s*(\{[\s\S]*?\})\s*\);/g,
  )) {
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(match[1] ?? '{}') as Record<string, unknown>;
    } catch {
      continue;
    }
    const dayIndex = String(entry.dow ?? '');
    if (dayIndex.length === 0) continue;
    const lines = htmlLines(
      String(entry.courses ?? '').replace(/\(br\)/gi, '<br>'),
    );
    const label = lines[0];
    const timeLine = lines.find((line) => parseRange(line) !== undefined);
    const range =
      (timeLine === undefined ? undefined : parseRange(timeLine)) ??
      (() => {
        const startTime = timeFromSeconds(entry.start_time);
        const endTime = timeFromSeconds(entry.end_time);
        return startTime === undefined || endTime === undefined
          ? undefined
          : { startTime, endTime };
      })();
    if (label === undefined || range === undefined) continue;
    const meta = metadata.get(dayIndex);
    const scheduleName = compactText(entry.bell_schedule);
    const cycle = compactText(entry.cycle_day);
    const scheduleLabel =
      meta?.scheduleLabel ??
      (scheduleName.length > 0
        ? `${scheduleName}${cycle.length > 0 ? ` (${cycle})` : ''}`
        : undefined);
    const effectiveDate =
      meta?.effectiveDate ??
      normalizeDate(entry.pretty_date ?? entry.date_value);
    const fallbackDayName = dayNameByAetIndex[dayIndex];
    const dayName = meta?.dayName ?? fallbackDayName;
    const bucket = buckets.get(dayIndex) ?? {
      ...(dayName === undefined ? {} : { dayName }),
      ...(effectiveDate === undefined ? {} : { effectiveDate }),
      ...(scheduleLabel === undefined ? {} : { scheduleLabel }),
      periods: [],
    };
    const notes = lines
      .slice(1)
      .filter((line) => line !== timeLine)
      .join(' | ');
    const code = codeFromLabel(label);
    bucket.periods.push({
      label,
      ...range,
      ...(code === undefined ? {} : { code }),
      ...(notes.length === 0 ? {} : { notes }),
    });
    buckets.set(dayIndex, bucket);
  }
  return [...buckets.entries()]
    .sort(([left], [right]) => Number(left) - Number(right))
    .map(([, day]) => ({ ...day, periods: sortAndDedupe(day.periods) }));
}

function primaryMetadata(capture: BellScheduleCapture) {
  const lines = [
    capture.title,
    ...capture.text.split(/\r?\n/).slice(0, 40),
  ].map(compactText);
  const joined = lines.join('\n');
  return {
    dayName: dayNames.find((day) =>
      new RegExp(`\\b${day}\\b`, 'i').test(joined),
    ),
    effectiveDate: effectiveDateFromText(joined),
    scheduleLabel: lines.find((line) => scheduleHint.test(line)),
  };
}

function verifiedEmptyAetDayForDate(
  capture: BellScheduleCapture,
  requestedDate: IsoDate,
): ExtractedBellDay | undefined {
  const matchingMetadata = [...dayMetadata(capture.html).entries()].filter(
    ([, metadata]) => metadata.effectiveDate === requestedDate,
  );
  if (matchingMetadata.length !== 1) return undefined;
  const [dayIndex, metadata] = matchingMetadata[0]!;
  const matchingDayContainers = [
    ...capture.html.matchAll(/<div\b([^>]*)>([\s\S]*?)<\/div>/gi),
  ].filter(
    (match) =>
      hasClass(match[1] ?? '', 'aet_day') &&
      attribute(match[1] ?? '', 'dayindex') === dayIndex,
  );
  if (matchingDayContainers.length !== 1) return undefined;
  const containerBody = (matchingDayContainers[0]?.[2] ?? '')
    .replace(/<!--[\s\S]*?-->/gu, '')
    .trim();
  if (containerBody.length !== 0 || /periods\.push\s*\(/u.test(capture.html)) {
    return undefined;
  }
  return {
    ...metadata,
    periods: [],
  };
}

export function extractBellScheduleCapture(
  capture: BellScheduleCapture,
): BellScheduleExtraction {
  const domDays = aetDaysFromDom(capture.html);
  const embeddedDays =
    domDays.length > 0 ? [] : aetDaysFromEmbedded(capture.html);
  const aetDays = domDays.length > 0 ? domDays : embeddedDays;
  if (aetDays.length > 0)
    return { status: 'extracted', days: aetDays, diagnostics: [] };
  const candidates = [
    periodsFromTables(capture.html),
    periodsFromBlocks(capture.html),
    periodsFromText(capture.text),
  ].map(sortAndDedupe);
  const periods =
    candidates.sort((left, right) => right.length - left.length)[0] ?? [];
  if (periods.length === 0) {
    return {
      status: 'rejected',
      days: [],
      diagnostics: [
        diagnostic(
          'bell-schedule-periods-missing',
          'error',
          'No valid bell periods were extracted.',
        ),
      ],
    };
  }
  const metadata = primaryMetadata(capture);
  return {
    status: 'extracted',
    days: [
      {
        ...(metadata.dayName === undefined
          ? {}
          : { dayName: metadata.dayName }),
        ...(metadata.effectiveDate === undefined
          ? {}
          : { effectiveDate: metadata.effectiveDate }),
        ...(metadata.scheduleLabel === undefined
          ? {}
          : { scheduleLabel: metadata.scheduleLabel }),
        periods,
      },
    ],
    diagnostics: [],
  };
}

export type BellScheduleNormalization =
  | {
      readonly status: 'normalized';
      readonly observation: ScheduleObservation;
      readonly diagnostics: readonly ContractDiagnostic[];
    }
  | {
      readonly status: 'rejected';
      readonly diagnostics: readonly ContractDiagnostic[];
    };

/** Shared M-07 normalization path used by both approved passive transports. */
export function normalizeBellScheduleCapture(options: {
  readonly capture: BellScheduleCapture;
  readonly requestedDate: IsoDate;
  readonly utcOffset: 'Z' | `${'+' | '-'}${string}`;
  readonly freshness: FreshnessState;
  /**
   * Set only after the transport has verified the authenticated bell-page
   * marker. On that exact page, an empty schedule means no classes.
   */
  readonly verifiedEmptyScheduleIsNoClasses?: boolean;
}): BellScheduleNormalization {
  const extraction = extractBellScheduleCapture(options.capture);
  const verifiedEmptyDay =
    options.verifiedEmptyScheduleIsNoClasses === true
      ? verifiedEmptyAetDayForDate(options.capture, options.requestedDate)
      : undefined;
  if (extraction.status === 'rejected') {
    if (verifiedEmptyDay !== undefined) {
      return normalizeExtractedBellDay({
        capture: options.capture,
        day: verifiedEmptyDay,
        requestedDate: options.requestedDate,
        utcOffset: options.utcOffset,
        freshness: options.freshness,
        verifiedEmptyScheduleIsNoClasses: true,
      });
    }
    return { status: 'rejected', diagnostics: extraction.diagnostics };
  }
  const day =
    extraction.days.find(
      (candidate) => candidate.effectiveDate === options.requestedDate,
    ) ??
    verifiedEmptyDay ??
    extraction.days[0];
  if (day === undefined) {
    return { status: 'rejected', diagnostics: extraction.diagnostics };
  }
  return normalizeExtractedBellDay({
    capture: options.capture,
    day,
    requestedDate: options.requestedDate,
    utcOffset: options.utcOffset,
    freshness: options.freshness,
    ...(day === verifiedEmptyDay
      ? { verifiedEmptyScheduleIsNoClasses: true }
      : {}),
  });
}

export function normalizeExtractedBellDay(options: {
  readonly capture: BellScheduleCapture;
  readonly day: ExtractedBellDay;
  readonly requestedDate: IsoDate;
  readonly utcOffset: 'Z' | `${'+' | '-'}${string}`;
  readonly freshness: FreshnessState;
  readonly verifiedEmptyScheduleIsNoClasses?: boolean;
}): BellScheduleNormalization {
  const diagnostics: ContractDiagnostic[] = [];
  if (!isIsoDate(options.requestedDate)) {
    return {
      status: 'rejected',
      diagnostics: [
        diagnostic(
          'schedule-date-invalid',
          'error',
          'The requested date is invalid.',
        ),
      ],
    };
  }
  if (options.day.effectiveDate === undefined) {
    return {
      status: 'rejected',
      diagnostics: [
        diagnostic(
          'schedule-date-metadata-missing',
          'error',
          'The extracted schedule has no effective-date metadata.',
        ),
      ],
    };
  }
  if (options.day.effectiveDate !== options.requestedDate) {
    return {
      status: 'rejected',
      diagnostics: [
        diagnostic(
          'schedule-date-mismatch',
          'error',
          'The extracted schedule date does not match the requested date.',
        ),
      ],
    };
  }
  const periods = options.day.periods.flatMap((period, index) => {
    const localStartsAt = `${options.requestedDate}T${period.startTime}:00${options.utcOffset}`;
    const localEndsAt = `${options.requestedDate}T${period.endTime}:00${options.utcOffset}`;
    const start = epoch(localStartsAt);
    const end = epoch(localEndsAt);
    if (start === undefined || end === undefined || start >= end) {
      diagnostics.push(
        diagnostic(
          'schedule-period-invalid',
          'error',
          `Extracted period ${index + 1} has an invalid interval.`,
        ),
      );
      return [];
    }
    const startsAt = new Date(start).toISOString();
    const endsAt = new Date(end).toISOString();
    const roomKey =
      period.notes !== undefined && /^[A-Z]\d{2,4}$/i.test(period.notes)
        ? roomIdFromLocation(period.notes)
        : undefined;
    const sectionCode = period.code ?? period.label;
    return [
      {
        periodId: stableId(
          'period',
          options.requestedDate,
          sectionCode,
          index + 1,
        ),
        courseKey: courseKeyFromSectionCode(sectionCode)!,
        blockLabel: period.label,
        ...(roomKey === undefined ? {} : { roomKey }),
        startsAt,
        endsAt,
      },
    ];
  });
  const verifiedEmptySchedule =
    options.verifiedEmptyScheduleIsNoClasses === true &&
    options.day.periods.length === 0;
  if (periods.length === 0 && !verifiedEmptySchedule) {
    return {
      status: 'rejected',
      diagnostics: [
        ...diagnostics,
        diagnostic(
          'schedule-periods-invalid',
          'error',
          'The schedule contains no valid ordered periods.',
        ),
      ],
    };
  }
  if (periods.length === 0) {
    diagnostics.push(
      diagnostic(
        'schedule-no-classes',
        'info',
        'The verified schedule contains no classes for the requested date.',
      ),
    );
  }
  if (options.freshness !== 'fresh') {
    diagnostics.push(
      diagnostic(
        'schedule-observation-not-fresh',
        'warning',
        'The normalized schedule is explicitly not fresh.',
      ),
    );
  }
  const kind: ScheduleKind =
    periods.length === 0
      ? 'no-classes'
      : /special|late|early|half|advisory/i.test(
            options.day.scheduleLabel ?? '',
          )
        ? 'special'
        : 'normal';
  const verification =
    options.freshness === 'fresh' ? 'verified' : 'unverified';
  const observation: ScheduleObservation = {
    contractVersion,
    observationId: stableId(
      'observation',
      options.requestedDate,
      options.capture.sourceReference,
    ),
    observedForDate: options.requestedDate,
    kind,
    verification,
    periods,
    provenance: {
      source: 'powerschool',
      method: options.capture.method,
      observedAt: options.capture.capturedAt,
      verification,
      sourceReference: options.capture.sourceReference,
    },
    freshness: {
      state: options.freshness,
      observedAt: options.capture.capturedAt,
    },
    diagnostics,
  };
  return { status: 'normalized', observation, diagnostics };
}
