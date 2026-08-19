import { createHash } from 'node:crypto';

import type {
  GlossaryCatalogImport,
  GlossaryEntry,
  GlossaryMedia,
  GlossarySource,
  GlossaryTranslation,
} from '../../domain/glossary.js';
import { isIsoInstant } from '../../domain/runtime-validation.js';
import type {
  GlossaryCatalog,
  GlossaryCatalogSnapshot,
} from '../../ports/glossary-catalog.js';
import type { SqliteDatabase } from './database.js';

const maxCatalogMediaBytes = 20 * 1024 * 1024;
const maxSourceEntries = 2_000;

interface SourceRow {
  readonly source_glossary_id: string;
  readonly class_id: string;
  readonly class_name: string | null;
  readonly academic_year: string;
  readonly unit_key: string | null;
  readonly lesson_topic: string | null;
  readonly source_reference: string;
  readonly source_format: 'csv' | 'manual';
  readonly content_hash: string;
  readonly imported_at: string;
}

interface EntryRow {
  readonly entry_id: string;
  readonly source_glossary_id: string;
  readonly source_row_key: string;
  readonly source_language: string;
  readonly term: string;
  readonly definition: string;
  readonly part_of_speech: string | null;
  readonly example: string | null;
  readonly pronunciation: string | null;
  readonly created_at: string;
}

interface TranslationRow {
  readonly translation_id: string;
  readonly entry_id: string;
  readonly language_code: string;
  readonly translated_term: string | null;
  readonly translated_definition: string | null;
  readonly translated_part_of_speech: string | null;
  readonly translated_example: string | null;
  readonly origin: 'teacher' | 'machine';
  readonly review_status: 'unreviewed' | 'reviewed' | 'rejected';
  readonly generator_reference: string | null;
  readonly created_at: string;
}

interface MediaRow {
  readonly media_id: string;
  readonly entry_id: string;
  readonly translation_id: string | null;
  readonly language_code: string;
  readonly media_role: GlossaryMedia['role'];
  readonly mime_type: string;
  readonly byte_length: number;
  readonly content_sha256: string;
  readonly content: Uint8Array;
  readonly origin: 'teacher' | 'machine';
  readonly review_status: 'unreviewed' | 'reviewed' | 'rejected';
  readonly attribution: string | null;
  readonly license_reference: string | null;
  readonly created_at: string;
}

export class SqliteGlossaryCatalog implements GlossaryCatalog {
  constructor(private readonly database: SqliteDatabase) {}

  async replaceSource(input: GlossaryCatalogImport) {
    if (!validImport(input)) return rejected();
    const existing = this.database.connection
      .prepare(
        'SELECT content_hash FROM glossary_sources WHERE source_glossary_id = ?',
      )
      .get(input.source.sourceGlossaryId) as
      { readonly content_hash: string } | undefined;
    if (existing?.content_hash === input.source.contentHash) {
      this.recordRun(input, 'unchanged', input.entries.length, 0);
      return {
        status: 'unchanged' as const,
        acceptedCount: input.entries.length,
        rejectedCount: 0,
      };
    }
    this.database.transaction(() => {
      this.database.connection
        .prepare('DELETE FROM glossary_entries WHERE source_glossary_id = ?')
        .run(input.source.sourceGlossaryId);
      this.insertSource(input.source);
      for (const entry of input.entries) this.insertEntry(entry);
      for (const translation of input.translations)
        this.insertTranslation(translation);
      for (const media of input.media) this.insertMedia(media);
      this.recordRun(input, 'imported', input.entries.length, 0);
    });
    return {
      status: 'imported' as const,
      acceptedCount: input.entries.length,
      rejectedCount: 0,
    };
  }

  async listClassSources(options: {
    readonly classId: GlossarySource['classId'];
    readonly academicYear: string;
  }) {
    const rows = this.database.connection
      .prepare(
        `SELECT source_glossary_id, class_id, class_name, academic_year, unit_key,
              lesson_topic, source_reference, source_format, content_hash, imported_at
         FROM glossary_sources
        WHERE class_id = ? AND academic_year = ?
        ORDER BY unit_key, source_glossary_id`,
      )
      .all(options.classId, options.academicYear) as unknown as SourceRow[];
    return rows.map(sourceFromRow);
  }

  async loadSource(
    sourceGlossaryId: string,
  ): Promise<GlossaryCatalogSnapshot | undefined> {
    const sourceRow = this.database.connection
      .prepare(
        `SELECT source_glossary_id, class_id, class_name, academic_year, unit_key,
              lesson_topic, source_reference, source_format, content_hash, imported_at
         FROM glossary_sources WHERE source_glossary_id = ?`,
      )
      .get(sourceGlossaryId) as unknown as SourceRow | undefined;
    if (sourceRow === undefined) return undefined;
    const entries = this.database.connection
      .prepare(
        `SELECT entry_id, source_glossary_id, source_row_key, source_language, term,
              definition, part_of_speech, example, pronunciation, created_at
         FROM glossary_entries WHERE source_glossary_id = ? ORDER BY term, entry_id`,
      )
      .all(sourceGlossaryId) as unknown as EntryRow[];
    const translations = this.database.connection
      .prepare(
        `SELECT translation_id, entry_id, language_code, translated_term,
              translated_definition, translated_part_of_speech, translated_example, origin, review_status,
              generator_reference, created_at FROM glossary_translations
        WHERE entry_id IN (SELECT entry_id FROM glossary_entries WHERE source_glossary_id = ?)
        ORDER BY language_code, translation_id`,
      )
      .all(sourceGlossaryId) as unknown as TranslationRow[];
    const media = this.database.connection
      .prepare(
        `SELECT media_id, entry_id, translation_id, language_code, media_role, mime_type,
              byte_length, content_sha256, origin, review_status, attribution,
              license_reference, created_at FROM glossary_media
        WHERE entry_id IN (SELECT entry_id FROM glossary_entries WHERE source_glossary_id = ?)
        ORDER BY media_role, media_id`,
      )
      .all(sourceGlossaryId) as unknown as Omit<MediaRow, 'content'>[];
    return {
      source: sourceFromRow(sourceRow),
      entries: entries.map((entry) => ({
        ...entryFromRow(entry),
        translations: translations
          .filter((translation) => translation.entry_id === entry.entry_id)
          .map(translationFromRow),
        media: media
          .filter((item) => item.entry_id === entry.entry_id)
          .map((item) => mediaFromRow(item)),
      })),
    };
  }

  async loadMedia(mediaId: string): Promise<GlossaryMedia | undefined> {
    const row = this.database.connection
      .prepare(
        `SELECT media_id, entry_id, translation_id, language_code, media_role, mime_type,
              byte_length, content_sha256, content, origin, review_status, attribution,
              license_reference, created_at FROM glossary_media WHERE media_id = ?`,
      )
      .get(mediaId) as unknown as MediaRow | undefined;
    return row === undefined ? undefined : mediaFromRow(row, true);
  }

  private insertSource(source: GlossarySource): void {
    this.database.connection
      .prepare(
        `INSERT INTO glossary_sources(source_glossary_id, class_id, class_name, academic_year,
        unit_key, lesson_topic, source_reference, source_format, content_hash, imported_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(source_glossary_id) DO UPDATE SET
         class_id = excluded.class_id,
         class_name = excluded.class_name,
         academic_year = excluded.academic_year,
         unit_key = excluded.unit_key,
         lesson_topic = excluded.lesson_topic,
         source_reference = excluded.source_reference,
         source_format = excluded.source_format,
         content_hash = excluded.content_hash,
         imported_at = excluded.imported_at`,
      )
      .run(
        source.sourceGlossaryId,
        source.classId,
        source.className ?? null,
        source.academicYear,
        source.unitKey ?? null,
        source.lessonTopic ?? null,
        source.sourceReference,
        source.sourceFormat,
        source.contentHash,
        source.importedAt,
      );
  }

  private insertEntry(entry: GlossaryEntry): void {
    this.database.connection
      .prepare(
        `INSERT INTO glossary_entries(entry_id, source_glossary_id, source_row_key, source_language,
        term, definition, part_of_speech, example, pronunciation, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.entryId,
        entry.sourceGlossaryId,
        entry.sourceRowKey,
        entry.sourceLanguage,
        entry.term,
        entry.definition,
        entry.partOfSpeech ?? null,
        entry.example ?? null,
        entry.pronunciation ?? null,
        entry.createdAt,
      );
  }

  private insertTranslation(translation: GlossaryTranslation): void {
    this.database.connection
      .prepare(
        `INSERT INTO glossary_translations(translation_id, entry_id, language_code,
        translated_term, translated_definition, translated_part_of_speech, translated_example, origin, review_status,
        generator_reference, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        translation.translationId,
        translation.entryId,
        translation.languageCode,
        translation.translatedTerm ?? null,
        translation.translatedDefinition ?? null,
        translation.translatedPartOfSpeech ?? null,
        translation.translatedExample ?? null,
        translation.origin,
        translation.reviewStatus,
        translation.generatorReference ?? null,
        translation.createdAt,
      );
  }

  private insertMedia(media: GlossaryMedia): void {
    this.database.connection
      .prepare(
        `INSERT INTO glossary_media(media_id, entry_id, translation_id, language_code, media_role,
        mime_type, byte_length, content_sha256, content, origin, review_status, attribution,
        license_reference, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        media.mediaId,
        media.entryId,
        media.translationId ?? null,
        media.languageCode,
        media.role,
        media.mimeType,
        media.content.byteLength,
        media.contentSha256,
        media.content,
        media.origin,
        media.reviewStatus,
        media.attribution ?? null,
        media.licenseReference ?? null,
        media.createdAt,
      );
  }

  private recordRun(
    input: GlossaryCatalogImport,
    status: 'imported' | 'unchanged',
    accepted: number,
    rejectedCount: number,
  ): void {
    this.database.connection
      .prepare(
        `INSERT INTO glossary_import_runs(import_id, source_glossary_id, content_hash, status,
         accepted_count, rejected_count, imported_at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(import_id) DO NOTHING`,
      )
      .run(
        input.importId,
        input.source.sourceGlossaryId,
        input.source.contentHash,
        status,
        accepted,
        rejectedCount,
        input.source.importedAt,
      );
  }
}

function rejected() {
  return { status: 'rejected' as const, acceptedCount: 0, rejectedCount: 1 };
}

function validImport(input: GlossaryCatalogImport): boolean {
  try {
    if (
      !isSource(input.source) ||
      !bounded(input.importId, 256) ||
      input.entries.length > maxSourceEntries
    )
      return false;
    const entryIds = new Set(input.entries.map((entry) => entry.entryId));
    const mediaBytes = input.media.reduce(
      (total, media) => total + media.content.byteLength,
      0,
    );
    return (
      input.entries.every((entry) =>
        isEntry(entry, input.source.sourceGlossaryId),
      ) &&
      input.translations.every((translation) =>
        isTranslation(translation, entryIds),
      ) &&
      mediaBytes <= maxCatalogMediaBytes &&
      input.media.every((media) => isMedia(media, entryIds, input.translations))
    );
  } catch {
    return false;
  }
}

function isSource(value: GlossarySource): boolean {
  return (
    bounded(value.sourceGlossaryId, 256) &&
    bounded(value.classId, 128) &&
    bounded(value.academicYear, 32) &&
    bounded(value.sourceReference, 2048) &&
    value.sourceFormat !== undefined &&
    hash(value.contentHash) &&
    isIsoInstant(value.importedAt) &&
    optional(value.className, 256) &&
    optional(value.unitKey, 128) &&
    optional(value.lessonTopic, 512)
  );
}
function isEntry(value: GlossaryEntry, sourceId: string): boolean {
  return (
    value.sourceGlossaryId === sourceId &&
    bounded(value.entryId, 256) &&
    bounded(value.sourceRowKey, 256) &&
    language(value.sourceLanguage) &&
    bounded(value.term, 512) &&
    bounded(value.definition, 8192) &&
    isIsoInstant(value.createdAt) &&
    optional(value.partOfSpeech, 128) &&
    optional(value.example, 8192) &&
    optional(value.pronunciation, 512)
  );
}
function isTranslation(
  value: GlossaryTranslation,
  entryIds: Set<string>,
): boolean {
  return (
    bounded(value.translationId, 256) &&
    entryIds.has(value.entryId) &&
    language(value.languageCode) &&
    ['teacher', 'machine'].includes(value.origin) &&
    ['unreviewed', 'reviewed', 'rejected'].includes(value.reviewStatus) &&
    isIsoInstant(value.createdAt) &&
    (bounded(value.translatedTerm, 512) ||
      bounded(value.translatedDefinition, 8192) ||
      bounded(value.translatedPartOfSpeech, 128) ||
      bounded(value.translatedExample, 8192)) &&
    optional(value.translatedTerm, 512) &&
    optional(value.translatedDefinition, 8192) &&
    optional(value.translatedPartOfSpeech, 128) &&
    optional(value.translatedExample, 8192) &&
    optional(value.generatorReference, 512) &&
    (value.origin !== 'teacher' || value.generatorReference === undefined)
  );
}
function isMedia(
  value: GlossaryMedia,
  entryIds: Set<string>,
  translations: readonly GlossaryTranslation[],
): boolean {
  const translated =
    value.role === 'translated-term-pronunciation' ||
    value.role === 'translated-definition-pronunciation';
  return (
    bounded(value.mediaId, 256) &&
    entryIds.has(value.entryId) &&
    language(value.languageCode) &&
    [
      'term-pronunciation',
      'definition-pronunciation',
      'translated-term-pronunciation',
      'translated-definition-pronunciation',
      'illustration',
      'supplementary',
    ].includes(value.role) &&
    bounded(value.mimeType, 128) &&
    value.content.byteLength > 0 &&
    value.content.byteLength <= 5 * 1024 * 1024 &&
    hash(value.contentSha256) &&
    createHash('sha256').update(value.content).digest('hex') ===
      value.contentSha256.slice(7) &&
    ['teacher', 'machine'].includes(value.origin) &&
    ['unreviewed', 'reviewed', 'rejected'].includes(value.reviewStatus) &&
    isIsoInstant(value.createdAt) &&
    optional(value.attribution, 2048) &&
    optional(value.licenseReference, 2048) &&
    (translated
      ? value.translationId !== undefined &&
        translations.some(
          (translation) =>
            translation.translationId === value.translationId &&
            translation.entryId === value.entryId,
        )
      : value.translationId === undefined)
  );
}
function bounded(value: unknown, maximum: number): value is string {
  return (
    typeof value === 'string' && value.length > 0 && value.length <= maximum
  );
}
function optional(value: unknown, maximum: number): boolean {
  return value === undefined || bounded(value, maximum);
}
function language(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u.test(value)
  );
}
function hash(value: unknown): value is string {
  return typeof value === 'string' && /^sha256:[0-9a-f]{64}$/u.test(value);
}
function sourceFromRow(row: SourceRow): GlossarySource {
  return {
    sourceGlossaryId: row.source_glossary_id,
    classId: row.class_id as GlossarySource['classId'],
    academicYear: row.academic_year,
    sourceReference: row.source_reference,
    sourceFormat: row.source_format,
    contentHash: row.content_hash,
    importedAt: row.imported_at,
    ...(row.class_name === null ? {} : { className: row.class_name }),
    ...(row.unit_key === null ? {} : { unitKey: row.unit_key }),
    ...(row.lesson_topic === null ? {} : { lessonTopic: row.lesson_topic }),
  };
}
function entryFromRow(row: EntryRow): GlossaryEntry {
  return {
    entryId: row.entry_id,
    sourceGlossaryId: row.source_glossary_id,
    sourceRowKey: row.source_row_key,
    sourceLanguage: row.source_language,
    term: row.term,
    definition: row.definition,
    createdAt: row.created_at,
    ...(row.part_of_speech === null
      ? {}
      : { partOfSpeech: row.part_of_speech }),
    ...(row.example === null ? {} : { example: row.example }),
    ...(row.pronunciation === null ? {} : { pronunciation: row.pronunciation }),
  };
}
function translationFromRow(row: TranslationRow): GlossaryTranslation {
  return {
    translationId: row.translation_id,
    entryId: row.entry_id,
    languageCode: row.language_code,
    origin: row.origin,
    reviewStatus: row.review_status,
    createdAt: row.created_at,
    ...(row.translated_term === null
      ? {}
      : { translatedTerm: row.translated_term }),
    ...(row.translated_definition === null
      ? {}
      : { translatedDefinition: row.translated_definition }),
    ...(row.translated_part_of_speech === null
      ? {}
      : { translatedPartOfSpeech: row.translated_part_of_speech }),
    ...(row.translated_example === null
      ? {}
      : { translatedExample: row.translated_example }),
    ...(row.generator_reference === null
      ? {}
      : { generatorReference: row.generator_reference }),
  };
}
function mediaFromRow(
  row: Omit<MediaRow, 'content'>,
): Omit<GlossaryMedia, 'content'>;
function mediaFromRow(row: MediaRow, includeContent: true): GlossaryMedia;
function mediaFromRow(
  row: Omit<MediaRow, 'content'> | MediaRow,
  includeContent = false,
): Omit<GlossaryMedia, 'content'> | GlossaryMedia {
  const base = {
    mediaId: row.media_id,
    entryId: row.entry_id,
    languageCode: row.language_code,
    role: row.media_role,
    mimeType: row.mime_type,
    contentSha256: row.content_sha256,
    origin: row.origin,
    reviewStatus: row.review_status,
    createdAt: row.created_at,
    ...(row.translation_id === null
      ? {}
      : { translationId: row.translation_id }),
    ...(row.attribution === null ? {} : { attribution: row.attribution }),
    ...(row.license_reference === null
      ? {}
      : { licenseReference: row.license_reference }),
  };
  return includeContent
    ? { ...base, content: new Uint8Array((row as MediaRow).content) }
    : base;
}
