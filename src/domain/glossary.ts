import type { IsoInstant, OpaqueId } from '../contracts/v1/common.js';
import type { ClassId } from './identities.js';

export type GlossarySourceFormat = 'csv' | 'manual';
export type GlossaryOrigin = 'teacher' | 'machine';
export type GlossaryReviewStatus = 'unreviewed' | 'reviewed' | 'rejected';
export type GlossaryMediaRole =
  | 'term-pronunciation'
  | 'definition-pronunciation'
  | 'translated-term-pronunciation'
  | 'translated-definition-pronunciation'
  | 'illustration'
  | 'supplementary';

/** A source glossary is a class-scoped, immutable import boundary. */
export interface GlossarySource {
  readonly sourceGlossaryId: OpaqueId;
  readonly classId: ClassId;
  readonly academicYear: string;
  readonly sourceReference: string;
  readonly sourceFormat: GlossarySourceFormat;
  readonly contentHash: string;
  readonly importedAt: IsoInstant;
  readonly className?: string;
  readonly unitKey?: string;
  readonly lessonTopic?: string;
}

/** Teacher-authored text remains the canonical entry and is never overwritten by a translation. */
export interface GlossaryEntry {
  readonly entryId: OpaqueId;
  readonly sourceGlossaryId: OpaqueId;
  readonly sourceRowKey: string;
  readonly sourceLanguage: string;
  readonly term: string;
  readonly definition: string;
  readonly createdAt: IsoInstant;
  readonly partOfSpeech?: string;
  readonly example?: string;
  readonly pronunciation?: string;
}

export interface GlossaryTranslation {
  readonly translationId: OpaqueId;
  readonly entryId: OpaqueId;
  readonly languageCode: string;
  readonly origin: GlossaryOrigin;
  readonly reviewStatus: GlossaryReviewStatus;
  readonly createdAt: IsoInstant;
  readonly translatedTerm?: string;
  readonly translatedDefinition?: string;
  readonly translatedPartOfSpeech?: string;
  readonly translatedExample?: string;
  /** Non-secret model/prompt revision reference when origin is machine. */
  readonly generatorReference?: string;
}

/** Binary content is deliberately part of the offline SQLite catalog, not a filesystem pointer. */
export interface GlossaryMedia {
  readonly mediaId: OpaqueId;
  readonly entryId: OpaqueId;
  readonly languageCode: string;
  readonly role: GlossaryMediaRole;
  readonly mimeType: string;
  readonly content: Uint8Array;
  readonly contentSha256: string;
  readonly origin: GlossaryOrigin;
  readonly reviewStatus: GlossaryReviewStatus;
  readonly createdAt: IsoInstant;
  readonly translationId?: OpaqueId;
  readonly attribution?: string;
  readonly licenseReference?: string;
}

export interface GlossaryCatalogImport {
  readonly importId: OpaqueId;
  readonly source: GlossarySource;
  readonly entries: readonly GlossaryEntry[];
  readonly translations: readonly GlossaryTranslation[];
  readonly media: readonly GlossaryMedia[];
}
