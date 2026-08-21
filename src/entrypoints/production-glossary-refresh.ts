import { randomUUID } from 'node:crypto';

import { importDriveGlossaryCourse } from '../application/glossary/import-drive.js';
import { selectGlossaryVocabularyForPlan } from '../application/glossary/select-vocabulary.js';
import { loadGoogleDriveGlossaryConfig } from '../config/google-drive-glossary.js';
import { loadProductionServerConfig } from '../config/production.js';
import type { IsoDate } from '../contracts/v1/common.js';
import { GoogleDriveGlossaryError } from '../infrastructure/google-drive/contracts.js';
import { loadOfficialDriveGlossaryTransport } from '../infrastructure/google-drive/official-client.js';
import { SqliteClassroomEnrichmentCache } from '../infrastructure/sqlite/classroom-cache.js';
import { SqliteDatabase } from '../infrastructure/sqlite/database.js';
import { SqliteGlossaryCatalog } from '../infrastructure/sqlite/glossary-catalog.js';
import { SqliteApplicationStateRepository } from '../infrastructure/sqlite/repository.js';
import type { DriveGlossaryReadTransport } from '../infrastructure/google-drive/contracts.js';
import { isDirectEntrypoint } from './direct-invocation.js';
import { rejectAmbientProductionAuthority } from './production-job-runtime.js';

export interface ProductionGlossaryRefreshOutput {
  readonly exitCode: number;
  readonly status: 'succeeded' | 'degraded' | 'repair-required' | 'rejected';
  readonly code?: string;
  readonly imported: number;
  readonly unchangedImports: number;
  readonly selected: number;
  readonly unchangedSelections: number;
  readonly unavailableSelections: number;
}

/** Refreshes the local glossary and meeting selections without exposing Drive to display runtime. */
export async function runProductionGlossaryRefresh(options: {
  readonly arguments: readonly string[];
  readonly environment?: NodeJS.ProcessEnv;
  readonly signal?: AbortSignal;
  readonly now?: () => string;
  readonly transportForRun?: () => DriveGlossaryReadTransport;
}): Promise<ProductionGlossaryRefreshOutput> {
  const empty = {
    imported: 0,
    unchangedImports: 0,
    selected: 0,
    unchangedSelections: 0,
    unavailableSelections: 0,
  } as const;
  if (options.arguments.length !== 0)
    return {
      ...empty,
      exitCode: 64,
      status: 'rejected',
      code: 'production-glossary-usage-invalid',
    };
  const environment = options.environment ?? process.env;
  let database: SqliteDatabase | undefined;
  try {
    rejectAmbientProductionAuthority(environment, [
      'CLASSROOM_HUB_POWERSCHOOL_',
      'CLASSROOM_HUB_CLASSROOM_',
      'CLASSROOM_HUB_CALENDAR_',
      'CLASSROOM_HUB_M15_',
      'CLASSROOM_HUB_ALERT_DELIVERY_REFERENCE',
    ]);
    const productionReference =
      environment.CLASSROOM_HUB_PRODUCTION_CONFIG_REFERENCE;
    const glossaryReference =
      environment.CLASSROOM_HUB_GLOSSARY_CONFIG_REFERENCE;
    if (!productionReference || !glossaryReference)
      throw new Error('production-glossary-config-required');
    const production = loadProductionServerConfig(productionReference);
    const glossary = loadGoogleDriveGlossaryConfig(glossaryReference);
    const mappedClasses = new Set(
      production.courseMappings.map((mapping) => mapping.classId),
    );
    if (glossary.courses.some((course) => !mappedClasses.has(course.classId)))
      throw new Error('production-glossary-mapping-mismatch');
    const observedAt = (options.now ?? (() => new Date().toISOString()))();
    const date = localDate(observedAt, production.timeZone);
    database = new SqliteDatabase(production.databasePath, {
      migration: { appliedAt: observedAt },
    });
    let revision = 0;
    const state = new SqliteApplicationStateRepository(database, {
      clock: { now: () => observedAt },
      nextRevision: () => `glossary-${++revision}-${randomUUID()}`,
      academicYearEndForDate: () => production.academicYearEnd,
    });
    const catalog = new SqliteGlossaryCatalog(database);
    const transport =
      options.transportForRun?.() ??
      loadOfficialDriveGlossaryTransport(glossary.credentialReferencePath);
    let imported = 0;
    let unchangedImports = 0;
    const failures: string[] = [];
    for (const course of glossary.courses) {
      try {
        const results = await importDriveGlossaryCourse({
          course,
          academicYear: glossary.academicYear,
          academicYearFolderId: glossary.academicYearFolderId,
          importedAt: observedAt,
          transport,
          catalog,
          requestTimeoutMs: glossary.requestTimeoutMs,
          maximumPages: glossary.maximumPagesPerSource,
          maximumFiles: glossary.maximumFilesPerCourse,
          signal: options.signal ?? new AbortController().signal,
        });
        for (const result of results) {
          if (result.status === 'imported') imported += 1;
          else unchangedImports += 1;
        }
      } catch (error: unknown) {
        failures.push(sanitizedFailure(error));
      }
    }
    const plan = await state.findEffective({
      screenId: production.screenId,
      roomId: production.roomId,
      date,
    });
    const selection =
      plan === undefined
        ? { selected: 0, unchanged: 0, unavailable: 0 }
        : await selectGlossaryVocabularyForPlan({
            plan,
            observedAt,
            academicYear: glossary.academicYear,
            academicYearEnd: production.academicYearEnd,
            courseConfigs: glossary.courses,
            courseMappings: production.courseMappings,
            catalog,
            classroomCache: new SqliteClassroomEnrichmentCache(database),
            state,
          });
    const resultCounts = {
      imported,
      unchangedImports,
      selected: selection.selected,
      unchangedSelections: selection.unchanged,
      unavailableSelections: selection.unavailable,
    };
    if (failures.length > 0) {
      const code = failures.includes('drive-authentication-required')
        ? 'drive-authentication-required'
        : failures[0]!;
      return {
        ...resultCounts,
        exitCode: code === 'drive-authentication-required' ? 3 : 2,
        status:
          code === 'drive-authentication-required'
            ? 'repair-required'
            : 'degraded',
        code,
      };
    }
    if (plan === undefined)
      return {
        ...resultCounts,
        exitCode: 0,
        status: 'degraded',
        code: 'glossary-plan-unavailable',
      };
    return { ...resultCounts, exitCode: 0, status: 'succeeded' };
  } catch {
    return {
      ...empty,
      exitCode: 1,
      status: 'rejected',
      code: 'production-glossary-startup-failed',
    };
  } finally {
    database?.close();
  }
}

const safeFailures = new Set([
  'drive-authentication-required',
  'drive-authorization-denied',
  'drive-file-not-found',
  'drive-rate-limited',
  'drive-request-timeout',
  'drive-read-unavailable',
  'glossary-drive-course-folder-missing',
  'glossary-drive-course-folder-ambiguous',
  'glossary-drive-glossaries-folder-missing',
  'glossary-drive-glossaries-folder-ambiguous',
  'glossary-drive-file-missing',
  'glossary-drive-file-ambiguous',
  'glossary-drive-file-budget-exceeded',
  'glossary-drive-file-type-invalid',
  'glossary-drive-pagination-invalid',
  'glossary-drive-page-budget-exceeded',
  'glossary-catalog-write-rejected',
]);

function sanitizedFailure(error: unknown): string {
  const code =
    error instanceof GoogleDriveGlossaryError
      ? error.code
      : error instanceof Error
        ? error.message
        : '';
  if (code.startsWith('glossary-csv-')) return 'glossary-csv-invalid';
  return safeFailures.has(code) ? code : 'glossary-refresh-unavailable';
}

function localDate(instant: string, timeZone: string): IsoDate {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(instant));
  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}` as IsoDate;
}

async function main(): Promise<void> {
  const output = await runProductionGlossaryRefresh({
    arguments: process.argv.slice(2),
    signal: AbortSignal.timeout(300_000),
  });
  process.stdout.write(`${JSON.stringify(output)}\n`);
  process.exitCode = output.exitCode;
}

if (isDirectEntrypoint(import.meta.url, process.argv[1])) void main();
