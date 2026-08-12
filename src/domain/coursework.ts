import type {
  ContractDiagnostic,
  FreshnessState,
  IsoDate,
  IsoInstant,
  OpaqueId,
} from '../contracts/v1/common.js';
import type { ClassId } from './identities.js';
import {
  addDateDays,
  compactText,
  diagnostic,
  epoch,
  isIsoDate,
} from './pure-values.js';

export interface RawCourseworkMaterial {
  readonly title?: unknown;
  readonly url?: unknown;
  readonly link?: {
    readonly title?: unknown;
    readonly name?: unknown;
    readonly url?: unknown;
    readonly alternateLink?: unknown;
  };
  readonly driveFile?: {
    readonly driveFile?: {
      readonly title?: unknown;
      readonly name?: unknown;
      readonly url?: unknown;
      readonly alternateLink?: unknown;
    };
  };
  readonly youtubeVideo?: {
    readonly title?: unknown;
    readonly name?: unknown;
    readonly url?: unknown;
    readonly alternateLink?: unknown;
  };
  readonly form?: {
    readonly title?: unknown;
    readonly name?: unknown;
    readonly url?: unknown;
    readonly alternateLink?: unknown;
    readonly formUrl?: unknown;
  };
}

export interface RawCourseworkItem {
  readonly providerCourseKey: OpaqueId;
  readonly providerItemKey?: OpaqueId;
  readonly title?: unknown;
  readonly dueAt?: unknown;
  readonly dueDate?: unknown;
  readonly directions?: unknown;
  readonly description?: unknown;
  readonly alternateLink?: unknown;
  readonly state?: unknown;
  readonly workType?: unknown;
  readonly materials?: readonly RawCourseworkMaterial[];
  readonly updateTime?: unknown;
  readonly creationTime?: unknown;
  readonly assignedCount?: unknown;
  readonly submittedCount?: unknown;
}

export interface CourseMapping {
  readonly providerCourseKey: OpaqueId;
  readonly classId: ClassId;
}

export interface NormalizedCourseworkMaterial {
  readonly title: string;
  readonly url?: string;
}

export interface NormalizedCourseworkItem {
  readonly itemId: OpaqueId;
  readonly providerCourseKey: OpaqueId;
  readonly providerItemKey: OpaqueId;
  readonly classId: ClassId;
  readonly title: string;
  readonly description: string;
  readonly materials: readonly NormalizedCourseworkMaterial[];
  readonly workType: string;
  readonly state: string;
  readonly assignedCount: number;
  readonly submittedCount: number;
  readonly updateTime: IsoInstant | '';
  readonly dueDate?: IsoDate;
  readonly dueAt?: IsoInstant;
  readonly dueLabel?: string;
  readonly alternateLink?: string;
  readonly bucket: 'recent' | 'upcoming';
}

export interface CourseworkItemsResult {
  readonly items: readonly NormalizedCourseworkItem[];
  readonly metadata?: CourseworkMetadata;
  readonly diagnostics: readonly ContractDiagnostic[];
}

export interface CourseworkMetadata {
  readonly meetingDate: IsoDate;
  readonly refreshedAt: IsoInstant;
  readonly provenanceReference?: string;
}

export interface CourseworkNormalization extends CourseworkItemsResult {
  readonly meetingDate: IsoDate;
  readonly refreshedAt: IsoInstant;
  readonly recent: readonly NormalizedCourseworkItem[];
  readonly upcoming: readonly NormalizedCourseworkItem[];
  readonly metadata: CourseworkMetadata;
}

export function assignmentUnitLabel(title: unknown): string | undefined {
  const text = compactText(title);
  const unit = text.match(/\bunit\s+(\d+[a-z]?)\b/i)?.[1];
  if (unit !== undefined) return unit.toUpperCase();
  return text.match(/\b(\d+)(?:\.\d+){1,3}\b/)?.[1];
}

function safeHttpUrl(value: unknown): string | undefined {
  const text = compactText(value);
  try {
    const url = new URL(text);
    return (url.protocol === 'https:' || url.protocol === 'http:') &&
      url.username.length === 0 &&
      url.password.length === 0
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

function dueDate(value: unknown, dueAt: unknown): IsoDate | undefined {
  if (value !== null && typeof value === 'object') {
    const parts = value as { year?: unknown; month?: unknown; day?: unknown };
    const candidate = `${String(parts.year ?? '').padStart(4, '0')}-${String(parts.month ?? '').padStart(2, '0')}-${String(parts.day ?? '').padStart(2, '0')}`;
    if (isIsoDate(candidate)) return candidate as IsoDate;
  }
  const text = compactText(value);
  if (isIsoDate(text)) return text as IsoDate;
  const instant = compactText(dueAt);
  return epoch(instant) === undefined
    ? undefined
    : (new Date(epoch(instant)!).toISOString().slice(0, 10) as IsoDate);
}

function dueLabel(date: IsoDate): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'long',
    day: 'numeric',
  }).format(new Date(`${date}T00:00:00Z`));
}

function count(value: unknown): number {
  const numeric = Number(value ?? 0);
  return Number.isInteger(numeric) && numeric >= 0 ? numeric : 0;
}

function normalizedMaterials(
  materials: readonly RawCourseworkMaterial[] | undefined,
): readonly NormalizedCourseworkMaterial[] {
  return (materials ?? []).flatMap((material) => {
    const nested =
      material.link ??
      material.driveFile?.driveFile ??
      material.youtubeVideo ??
      material.form;
    const title = compactText(material.title ?? nested?.title ?? nested?.name);
    const nestedUrl =
      nested?.url ?? nested?.alternateLink ?? material.form?.formUrl;
    const url = safeHttpUrl(material.url ?? nestedUrl);
    if (title.length === 0 && url === undefined) return [];
    return [{ title, ...(url === undefined ? {} : { url }) }];
  });
}

type UnbucketedItem = Omit<NormalizedCourseworkItem, 'bucket'>;

function legacyRecentOrder(
  left: UnbucketedItem,
  right: UnbucketedItem,
): number {
  const leftDate = left.dueDate ?? left.updateTime.slice(0, 10);
  const rightDate = right.dueDate ?? right.updateTime.slice(0, 10);
  return (
    rightDate.localeCompare(leftDate) ||
    right.updateTime.localeCompare(left.updateTime)
  );
}

function legacyUpcomingOrder(
  left: UnbucketedItem,
  right: UnbucketedItem,
): number {
  return (
    (left.dueDate ?? '9999-12-31').localeCompare(
      right.dueDate ?? '9999-12-31',
    ) || right.updateTime.localeCompare(left.updateTime)
  );
}

/** Port of the legacy meeting-date-relative cache normalization, without I/O. */
export function normalizeCoursework(options: {
  readonly items: readonly RawCourseworkItem[];
  readonly mappings: readonly CourseMapping[];
  readonly meetingDate: IsoDate;
  readonly refreshedAt: IsoInstant;
  readonly provenanceReference?: string;
  readonly recentDays?: number;
  readonly upcomingDays?: number;
}): CourseworkNormalization {
  const diagnostics: ContractDiagnostic[] = [];
  const metadata: CourseworkMetadata = {
    meetingDate: options.meetingDate,
    refreshedAt: options.refreshedAt,
    ...(compactText(options.provenanceReference).length === 0
      ? {}
      : { provenanceReference: compactText(options.provenanceReference) }),
  };
  if (!isIsoDate(options.meetingDate)) {
    return {
      meetingDate: options.meetingDate,
      refreshedAt: options.refreshedAt,
      recent: [],
      upcoming: [],
      items: [],
      metadata,
      diagnostics: [
        diagnostic(
          'coursework-meeting-date-invalid',
          'error',
          'The coursework meeting date is invalid.',
        ),
      ],
    };
  }
  if (epoch(options.refreshedAt) === undefined) {
    diagnostics.push(
      diagnostic(
        'coursework-refresh-time-invalid',
        'warning',
        'The refresh timestamp is invalid and was retained only as provenance.',
      ),
    );
  }
  const recentDays = options.recentDays ?? 7;
  const upcomingDays = options.upcomingDays ?? 21;
  if (
    !Number.isInteger(recentDays) ||
    recentDays < 0 ||
    !Number.isInteger(upcomingDays) ||
    upcomingDays < 0
  ) {
    return {
      meetingDate: options.meetingDate,
      refreshedAt: options.refreshedAt,
      recent: [],
      upcoming: [],
      items: [],
      metadata,
      diagnostics: [
        ...diagnostics,
        diagnostic(
          'coursework-window-invalid',
          'error',
          'Coursework windows must be non-negative whole days.',
        ),
      ],
    };
  }
  const lookback = addDateDays(options.meetingDate, -recentDays)!;
  const lookahead = addDateDays(options.meetingDate, upcomingDays)!;
  const normalized = options.items.flatMap((item, index): UnbucketedItem[] => {
    const mappings = options.mappings.filter(
      (mapping) => mapping.providerCourseKey === item.providerCourseKey,
    );
    if (mappings.length !== 1) {
      diagnostics.push(
        diagnostic(
          'coursework-class-mapping-invalid',
          'error',
          `Course ${item.providerCourseKey} does not have exactly one class mapping.`,
        ),
      );
      return [];
    }
    const providerItemKey = compactText(item.providerItemKey);
    const title = compactText(item.title);
    if (providerItemKey.length === 0 || title.length === 0) {
      diagnostics.push(
        diagnostic(
          'coursework-item-malformed',
          'warning',
          `Coursework item ${index + 1} requires a provider ID and title.`,
        ),
      );
      return [];
    }
    const state = compactText(item.state) || 'PUBLISHED';
    if (state.toUpperCase() === 'DELETED') return [];
    const mapping = mappings[0]!;
    const date = dueDate(item.dueDate, item.dueAt);
    const dueAtText = compactText(item.dueAt);
    const alternateLink = safeHttpUrl(item.alternateLink);
    if (
      compactText(item.alternateLink).length > 0 &&
      alternateLink === undefined
    ) {
      diagnostics.push(
        diagnostic(
          'coursework-link-invalid',
          'warning',
          `Coursework item ${index + 1} has an invalid link.`,
        ),
      );
    }
    const updateTime = compactText(item.updateTime ?? item.creationTime);
    return [
      {
        itemId: providerItemKey,
        providerCourseKey: item.providerCourseKey,
        providerItemKey,
        classId: mapping.classId,
        title,
        description: compactText(item.description ?? item.directions),
        materials: normalizedMaterials(item.materials),
        workType: compactText(item.workType),
        state,
        assignedCount: count(item.assignedCount),
        submittedCount: count(item.submittedCount),
        updateTime:
          epoch(updateTime) === undefined ? '' : (updateTime as IsoInstant),
        ...(date === undefined
          ? {}
          : {
              dueDate: date,
              dueLabel: dueLabel(date),
              ...(epoch(dueAtText) === undefined
                ? {}
                : { dueAt: dueAtText as IsoInstant }),
            }),
        ...(alternateLink === undefined ? {} : { alternateLink }),
      },
    ];
  });

  const recent: NormalizedCourseworkItem[] = [];
  const upcoming: NormalizedCourseworkItem[] = [];
  const classIds = [...new Set(normalized.map((item) => item.classId))].sort();
  for (const classId of classIds) {
    const classItems = normalized.filter((item) => item.classId === classId);
    const classUpcoming = classItems
      .filter((item) =>
        item.dueDate !== undefined
          ? item.dueDate >= options.meetingDate && item.dueDate <= lookahead
          : item.updateTime.slice(0, 10) >= lookback,
      )
      .sort(legacyUpcomingOrder)
      .slice(0, 3);
    const upcomingIds = new Set(
      classUpcoming.map((item) => item.providerItemKey),
    );
    const classRecent = classItems
      .filter((item) =>
        item.dueDate !== undefined
          ? item.dueDate < options.meetingDate && item.dueDate >= lookback
          : !upcomingIds.has(item.providerItemKey),
      )
      .sort(legacyRecentOrder)
      .slice(0, 3);
    recent.push(
      ...classRecent.map((item): NormalizedCourseworkItem => ({
        ...item,
        bucket: 'recent',
      })),
    );
    upcoming.push(
      ...classUpcoming.map((item): NormalizedCourseworkItem => ({
        ...item,
        bucket: 'upcoming',
      })),
    );
  }
  return {
    meetingDate: options.meetingDate,
    refreshedAt: options.refreshedAt,
    recent,
    upcoming,
    items: [...recent, ...upcoming],
    metadata,
    diagnostics,
  };
}

export interface CourseworkEnrichment {
  readonly observedForDate: IsoDate;
  readonly classId: ClassId;
  readonly freshness: FreshnessState;
  readonly recent: readonly NormalizedCourseworkItem[];
  readonly upcoming: readonly NormalizedCourseworkItem[];
  readonly refreshedAt: IsoInstant;
  readonly provenanceReference?: string;
}

export function overlayCoursework(options: {
  readonly planDate: IsoDate;
  readonly classId: ClassId;
  readonly enrichment?: CourseworkEnrichment;
}): CourseworkItemsResult {
  const enrichment = options.enrichment;
  if (enrichment === undefined) return { items: [], diagnostics: [] };
  if (enrichment.observedForDate !== options.planDate) {
    return {
      items: [],
      diagnostics: [
        diagnostic(
          'enrichment-date-mismatch',
          'warning',
          'Coursework enrichment is for another date.',
        ),
      ],
    };
  }
  if (enrichment.classId !== options.classId) {
    return {
      items: [],
      diagnostics: [
        diagnostic(
          'enrichment-class-mismatch',
          'warning',
          'Coursework enrichment is for another class.',
        ),
      ],
    };
  }
  if (enrichment.freshness !== 'fresh') {
    return {
      items: [],
      diagnostics: [
        diagnostic(
          'enrichment-not-fresh',
          'warning',
          'Coursework enrichment is not fresh.',
        ),
      ],
    };
  }
  return {
    items: [...enrichment.recent, ...enrichment.upcoming].filter(
      (item) => item.classId === options.classId,
    ),
    metadata: {
      meetingDate: enrichment.observedForDate,
      refreshedAt: enrichment.refreshedAt,
      ...(enrichment.provenanceReference === undefined
        ? {}
        : { provenanceReference: enrichment.provenanceReference }),
    },
    diagnostics: [],
  };
}
