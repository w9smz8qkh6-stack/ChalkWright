import { createHash } from 'node:crypto';

import { contractVersion, type IsoInstant } from '../../contracts/v1/common.js';
import {
  normalizeCoursework,
  type CourseMapping,
  type CourseworkEnrichment,
  type RawCourseworkItem,
  type RawCourseworkMaterial,
} from '../../domain/coursework.js';
import { stableSerialize } from '../../domain/pure-values.js';
import { isIsoDate, isIsoInstant } from '../../domain/runtime-validation.js';
import type { EnrichmentObservation } from '../../domain/observations.js';
import type {
  EnrichmentObservationRequest,
  EnrichmentObservationSource,
  ObservationReadResult,
} from '../../ports/read-sources.js';
import {
  GoogleClassroomTransportError,
  type ClassroomCourseWorkListTransport,
} from './contracts.js';

export interface GoogleClassroomCourseworkSourceOptions {
  readonly mappings: readonly CourseMapping[];
  readonly requestTimeoutMs: number;
  readonly maximumPagesPerCourse: number;
  readonly maximumItemsPerCourse: number;
  readonly transport: ClassroomCourseWorkListTransport;
  readonly now?: () => string;
  readonly signal?: AbortSignal;
}

/** Read-only published-coursework adapter with no roster/submission capability. */
export class GoogleClassroomCourseworkSource implements EnrichmentObservationSource<CourseworkEnrichment> {
  constructor(
    private readonly options: GoogleClassroomCourseworkSourceOptions,
  ) {}

  async readEnrichment(
    request: EnrichmentObservationRequest,
  ): Promise<
    ObservationReadResult<EnrichmentObservation<CourseworkEnrichment>>
  > {
    if (!isIsoDate(request.date) || !boundedId(request.classId))
      return failure('invalid-input', 'classroom-read-request-invalid', false);
    const matches = this.options.mappings.filter(
      (mapping) => mapping.classId === request.classId,
    );
    if (matches.length !== 1)
      return failure(
        'invalid-input',
        'classroom-course-mapping-invalid',
        false,
      );
    if (
      !Number.isSafeInteger(this.options.requestTimeoutMs) ||
      this.options.requestTimeoutMs < 1 ||
      this.options.requestTimeoutMs > 60_000 ||
      !Number.isSafeInteger(this.options.maximumPagesPerCourse) ||
      this.options.maximumPagesPerCourse < 1 ||
      this.options.maximumPagesPerCourse > 10 ||
      !Number.isSafeInteger(this.options.maximumItemsPerCourse) ||
      this.options.maximumItemsPerCourse < 1 ||
      this.options.maximumItemsPerCourse > 500
    )
      return failure(
        'unsafe-configuration',
        'classroom-read-policy-invalid',
        false,
      );

    const signal = AbortSignal.any(
      [
        AbortSignal.timeout(this.options.requestTimeoutMs),
        this.options.signal,
        request.signal,
      ].filter((value): value is AbortSignal => value !== undefined),
    );
    const mapping = matches[0]!;
    const items: RawCourseworkItem[] = [];
    const seenTokens = new Set<string>();
    let providerItemCount = 0;
    let pageToken: string | undefined;
    try {
      for (let page = 0; page < this.options.maximumPagesPerCourse; page += 1) {
        const response = await this.options.transport.listPublishedCourseWork({
          providerCourseKey: mapping.providerCourseKey,
          ...(pageToken === undefined ? {} : { pageToken }),
          timeoutMs: this.options.requestTimeoutMs,
          signal,
        });
        for (const value of response.items) {
          providerItemCount += 1;
          if (providerItemCount > this.options.maximumItemsPerCourse)
            return failure(
              'unavailable',
              'classroom-item-budget-exceeded',
              false,
            );
          const item = toRawCoursework(value, mapping.providerCourseKey);
          if (item !== undefined) items.push(item);
        }
        const nextPageToken: unknown = response.nextPageToken;
        if (
          nextPageToken !== undefined &&
          (typeof nextPageToken !== 'string' ||
            nextPageToken.length < 1 ||
            nextPageToken.length > 2_048)
        )
          return failure('unavailable', 'classroom-pagination-invalid', false);
        pageToken = nextPageToken as string | undefined;
        if (pageToken === undefined) break;
        if (seenTokens.has(pageToken))
          return failure('unavailable', 'classroom-pagination-invalid', false);
        seenTokens.add(pageToken);
        if (page + 1 === this.options.maximumPagesPerCourse)
          return failure(
            'unavailable',
            'classroom-page-budget-exceeded',
            false,
          );
      }
    } catch (error: unknown) {
      return transportFailure(error, signal);
    }

    const observedAt = this.options.now?.() ?? new Date().toISOString();
    if (!isIsoInstant(observedAt))
      return failure('internal', 'classroom-clock-invalid', false);
    const normalized = normalizeCoursework({
      items,
      mappings: [mapping],
      meetingDate: request.date,
      refreshedAt: observedAt as IsoInstant,
      provenanceReference: `google-classroom:${request.classId}`,
    });
    const enrichment: CourseworkEnrichment = {
      observedForDate: request.date,
      classId: request.classId,
      freshness: 'fresh',
      recent: normalized.recent,
      upcoming: normalized.upcoming,
      refreshedAt: observedAt,
      provenanceReference: `google-classroom:${request.classId}`,
    };
    const observationId = createHash('sha256')
      .update(stableSerialize(enrichment))
      .digest('hex')
      .slice(0, 32);
    return {
      status: 'observed' as const,
      observation: {
        contractVersion,
        observationId: `classroom-${observationId}`,
        observedForDate: request.date,
        classId: request.classId,
        value: enrichment,
        provenance: {
          source: 'google-classroom' as const,
          method: 'api-read' as const,
          observedAt,
          verification: 'verified' as const,
          sourceReference: `google-classroom:${request.classId}`,
        },
        freshness: {
          state: 'fresh' as const,
          observedAt,
          lastSuccessfulAt: observedAt,
        },
        verification: 'verified' as const,
        diagnostics: normalized.diagnostics,
      },
    };
  }
}

function toRawCoursework(
  value: unknown,
  providerCourseKey: string,
): RawCourseworkItem | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return undefined;
  const item = value as Record<string, unknown>;
  const id = text(item.id, 256);
  const title = text(item.title, 3_000);
  const state = text(item.state, 32).toUpperCase();
  if (id.length === 0 || title.length === 0 || state !== 'PUBLISHED')
    return undefined;
  return {
    providerCourseKey,
    providerItemKey: id,
    title,
    description: text(item.description, 30_000),
    dueDate: dateParts(item.dueDate),
    dueAt: dueInstant(item.dueDate, item.dueTime),
    alternateLink: text(item.alternateLink, 2_048),
    state,
    workType: text(item.workType, 64),
    materials: materials(item.materials),
    updateTime: text(item.updateTime, 64),
    creationTime: text(item.creationTime, 64),
    assignedCount: 0,
    submittedCount: 0,
  };
}

function materials(value: unknown): readonly RawCourseworkMaterial[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).flatMap((entry): RawCourseworkMaterial[] => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry))
      return [];
    const material = entry as Record<string, unknown>;
    return [
      {
        title: text(material.title, 1_000),
        ...(nestedMaterial(material.link, 'link') ?? {}),
        ...(nestedMaterial(material.driveFile, 'driveFile') ?? {}),
        ...(nestedMaterial(material.youtubeVideo, 'youtubeVideo') ?? {}),
        ...(nestedMaterial(material.form, 'form') ?? {}),
      },
    ];
  });
}

function nestedMaterial(
  value: unknown,
  kind: 'driveFile' | 'form' | 'link' | 'youtubeVideo',
): RawCourseworkMaterial | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return undefined;
  const record = value as Record<string, unknown>;
  const normalized = {
    title: text(record.title, 1_000),
    name: text(record.name, 1_000),
    url: text(record.url, 2_048),
    alternateLink: text(record.alternateLink, 2_048),
    formUrl: text(record.formUrl, 2_048),
  };
  if (kind === 'driveFile') {
    const nested = record.driveFile;
    if (typeof nested !== 'object' || nested === null || Array.isArray(nested))
      return undefined;
    const file = nested as Record<string, unknown>;
    return {
      driveFile: {
        driveFile: {
          title: text(file.title, 1_000),
          name: text(file.name, 1_000),
          url: text(file.url, 2_048),
          alternateLink: text(file.alternateLink, 2_048),
        },
      },
    };
  }
  return { [kind]: normalized };
}

function dateParts(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return undefined;
  const record = value as Record<string, unknown>;
  return { year: record.year, month: record.month, day: record.day };
}

function dueInstant(date: unknown, time: unknown): string | undefined {
  if (
    typeof date !== 'object' ||
    date === null ||
    Array.isArray(date) ||
    typeof time !== 'object' ||
    time === null ||
    Array.isArray(time)
  )
    return undefined;
  const day = date as Record<string, unknown>;
  const clock = time as Record<string, unknown>;
  const values = [day.year, day.month, day.day, clock.hours, clock.minutes];
  if (!values.every((entry) => Number.isInteger(entry))) return undefined;
  const instant = new Date(
    Date.UTC(
      Number(day.year),
      Number(day.month) - 1,
      Number(day.day),
      Number(clock.hours),
      Number(clock.minutes),
      Number.isInteger(clock.seconds) ? Number(clock.seconds) : 0,
    ),
  ).toISOString();
  return instant.slice(0, 10) ===
    `${String(day.year).padStart(4, '0')}-${String(day.month).padStart(2, '0')}-${String(day.day).padStart(2, '0')}`
    ? instant
    : undefined;
}

function text(value: unknown, maximum: number): string {
  return typeof value === 'string'
    ? value.replace(/\s+/gu, ' ').trim().slice(0, maximum)
    : '';
}

function boundedId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value);
}

function transportFailure(
  error: unknown,
  signal: AbortSignal,
): ObservationReadResult<EnrichmentObservation<CourseworkEnrichment>> {
  const code =
    error instanceof GoogleClassroomTransportError
      ? error.code
      : signal.aborted
        ? 'classroom-request-timeout'
        : 'classroom-read-unavailable';
  if (code === 'classroom-authentication-required')
    return failure(
      'authentication-repair-required',
      code,
      false,
      'repair-required',
    );
  if (code === 'classroom-authorization-denied')
    return failure('authorization-denied', code, false);
  if (code === 'classroom-course-not-found')
    return failure('not-found', code, false, 'not-found');
  if (code === 'classroom-request-timeout')
    return failure('timeout', code, true);
  return failure('unavailable', code, true);
}

function failure(
  category:
    | 'authentication-repair-required'
    | 'authorization-denied'
    | 'internal'
    | 'invalid-input'
    | 'not-found'
    | 'timeout'
    | 'unavailable'
    | 'unsafe-configuration',
  code: string,
  retryable: boolean,
  status: 'failed' | 'not-found' | 'repair-required' = 'failed',
): ObservationReadResult<EnrichmentObservation<CourseworkEnrichment>> {
  if (status === 'not-found')
    return {
      status,
      diagnostics: [
        {
          code,
          severity: 'warning' as const,
          message: 'The mapped Classroom course was not available.',
        },
      ],
    };
  if (status === 'repair-required') {
    return {
      status,
      error: {
        category: 'authentication-repair-required',
        code,
        message: 'Google Classroom authorization requires operator repair.',
        retryable,
        diagnostics: [],
      },
    };
  }
  return {
    status: 'failed',
    error: {
      category,
      code,
      message:
        category === 'authentication-repair-required'
          ? 'Google Classroom authorization requires operator repair.'
          : 'Google Classroom read failed safely.',
      retryable,
      diagnostics: [],
    },
  };
}
