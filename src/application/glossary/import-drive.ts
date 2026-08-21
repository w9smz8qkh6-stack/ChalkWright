import type { IsoInstant } from '../../contracts/v1/common.js';
import type { GoogleDriveGlossaryCourseConfig } from '../../config/google-drive-glossary.js';
import { compactText, stableId } from '../../domain/pure-values.js';
import type { GlossaryCatalog } from '../../ports/glossary-catalog.js';
import {
  GoogleDriveGlossaryError,
  type DriveGlossaryFile,
  type DriveGlossaryReadTransport,
} from '../../infrastructure/google-drive/contracts.js';
import { normalizeGlossaryCsv } from './csv-normalizer.js';

const csvMimeType = 'text/csv';
const folderMimeType = 'application/vnd.google-apps.folder';

export interface DriveGlossaryImportResult {
  readonly sourceGlossaryId: string;
  readonly status: 'imported' | 'unchanged';
  readonly acceptedCount: number;
}

/** Imports every bounded CSV at one exact configured path below a course. */
export async function importDriveGlossaryCourse(options: {
  readonly course: GoogleDriveGlossaryCourseConfig;
  readonly academicYearFolderId: string;
  readonly academicYear: string;
  readonly importedAt: IsoInstant;
  readonly transport: DriveGlossaryReadTransport;
  readonly catalog: GlossaryCatalog;
  readonly requestTimeoutMs: number;
  readonly maximumPages: number;
  readonly maximumFiles: number;
  readonly signal: AbortSignal;
}): Promise<readonly DriveGlossaryImportResult[]> {
  const courseFolderId = await exactFolder(options, {
    parentId: options.academicYearFolderId,
    name: options.course.courseName,
    missingCode: 'glossary-drive-course-folder-missing',
    ambiguousCode: 'glossary-drive-course-folder-ambiguous',
  });
  let glossaryFolderId = courseFolderId;
  for (const name of options.course.glossaryFolderPath ?? ['Glossaries']) {
    glossaryFolderId = await exactFolder(options, {
      parentId: glossaryFolderId,
      name,
      missingCode: 'glossary-drive-glossaries-folder-missing',
      ambiguousCode: 'glossary-drive-glossaries-folder-ambiguous',
    });
  }
  const children = await listAllChildren(options, glossaryFolderId);
  const csvFiles = children
    .filter(
      (file) =>
        file.mimeType === csvMimeType &&
        file.name.toLowerCase().endsWith('.csv'),
    )
    .sort(
      (left, right) =>
        left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
    );
  if (csvFiles.length === 0) throw new Error('glossary-drive-file-missing');
  if (csvFiles.length > options.maximumFiles)
    throw new Error('glossary-drive-file-budget-exceeded');
  if (new Set(csvFiles.map((file) => file.name)).size !== csvFiles.length)
    throw new Error('glossary-drive-file-ambiguous');

  const results: DriveGlossaryImportResult[] = [];
  for (const file of csvFiles) {
    const sourceGlossaryId = stableId(
      'drive-glossary',
      options.course.classId,
      file.id,
    );
    const csv = await options.transport.downloadCsv({
      fileId: file.id,
      signal: options.signal,
      timeoutMs: options.requestTimeoutMs,
    });
    const lessonTopic = compactText(file.name.replace(/\.csv$/iu, ''));
    const unitKey = file.name.match(/\bunit[\s_-]+(\d+[A-Za-z]?)\b/iu)?.[1];
    const normalized = normalizeGlossaryCsv({
      importId: stableId(
        'glossary-import',
        sourceGlossaryId,
        options.importedAt,
      ),
      source: {
        sourceGlossaryId,
        classId: options.course.classId,
        academicYear: options.academicYear,
        sourceReference: `google-drive:${glossaryFolderId}/${file.id}`,
        importedAt: options.importedAt,
        className: options.course.className ?? options.course.courseName,
        ...(unitKey === undefined ? {} : { unitKey }),
        ...(lessonTopic.length === 0 ? {} : { lessonTopic }),
      },
      csv,
      defaultLanguage: options.course.defaultLanguage,
    });
    const stored = await options.catalog.replaceSource(normalized);
    if (stored.status === 'rejected')
      throw new Error('glossary-catalog-write-rejected');
    results.push({
      sourceGlossaryId,
      status: stored.status,
      acceptedCount: stored.acceptedCount,
    });
  }
  return results;
}

async function exactFolder(
  options: {
    readonly transport: DriveGlossaryReadTransport;
    readonly requestTimeoutMs: number;
    readonly maximumPages: number;
    readonly signal: AbortSignal;
  },
  expected: {
    readonly parentId: string;
    readonly name: string;
    readonly missingCode: string;
    readonly ambiguousCode: string;
  },
): Promise<string> {
  const children = await listAllChildren(options, expected.parentId);
  const named = children.filter((file) => file.name === expected.name);
  if (named.length === 0) throw new Error(expected.missingCode);
  if (named.length !== 1) throw new Error(expected.ambiguousCode);
  const match = named[0]!;
  if (match.mimeType !== folderMimeType) throw new Error(expected.missingCode);
  return match.id;
}

async function listAllChildren(
  options: {
    readonly transport: DriveGlossaryReadTransport;
    readonly requestTimeoutMs: number;
    readonly maximumPages: number;
    readonly signal: AbortSignal;
  },
  parentId: string,
): Promise<readonly DriveGlossaryFile[]> {
  const files: DriveGlossaryFile[] = [];
  const pageTokens = new Set<string>();
  let pageToken: string | undefined;
  for (let page = 0; page < options.maximumPages; page += 1) {
    if (options.signal.aborted)
      throw new GoogleDriveGlossaryError('drive-request-timeout');
    const response = await options.transport.listChildren({
      parentId,
      signal: options.signal,
      timeoutMs: options.requestTimeoutMs,
      ...(pageToken === undefined ? {} : { pageToken }),
    });
    files.push(...response.files);
    if (response.nextPageToken === undefined) {
      pageToken = undefined;
      break;
    }
    if (pageTokens.has(response.nextPageToken))
      throw new Error('glossary-drive-pagination-invalid');
    pageTokens.add(response.nextPageToken);
    pageToken = response.nextPageToken;
  }
  if (pageToken !== undefined)
    throw new Error('glossary-drive-page-budget-exceeded');
  return files;
}

export { csvMimeType, folderMimeType };
