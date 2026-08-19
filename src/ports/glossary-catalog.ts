import type {
  GlossaryCatalogImport,
  GlossaryEntry,
  GlossaryMedia,
  GlossarySource,
  GlossaryTranslation,
} from '../domain/glossary.js';
import type { ClassId } from '../domain/identities.js';

export interface GlossaryCatalogSnapshot {
  readonly source: GlossarySource;
  readonly entries: readonly (GlossaryEntry & {
    readonly translations: readonly GlossaryTranslation[];
    readonly media: readonly Omit<GlossaryMedia, 'content'>[];
  })[];
}

/** Local offline catalog; provider data and credentials never leave its import boundary. */
export interface GlossaryCatalog {
  replaceSource(input: GlossaryCatalogImport): Promise<{
    readonly status: 'imported' | 'unchanged' | 'rejected';
    readonly acceptedCount: number;
    readonly rejectedCount: number;
  }>;
  listClassSources(options: {
    readonly classId: ClassId;
    readonly academicYear: string;
  }): Promise<readonly GlossarySource[]>;
  loadSource(
    sourceGlossaryId: string,
  ): Promise<GlossaryCatalogSnapshot | undefined>;
  loadMedia(mediaId: string): Promise<GlossaryMedia | undefined>;
}
