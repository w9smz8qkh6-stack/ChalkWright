import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { afterEach } from 'node:test';

import type { GlossaryCatalogImport } from '../../../src/domain/glossary.js';
import { SqliteGlossaryCatalog } from '../../../src/infrastructure/sqlite/glossary-catalog.js';
import { SqliteDatabase } from '../../../src/infrastructure/sqlite/database.js';

const roots: string[] = [];
const importedAt = '2035-04-13T01:00:00.000Z';

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

test('offline glossary catalog atomically replaces a source and keeps binary pronunciation content in SQLite', async () => {
  const root = temporaryRoot();
  using database = new SqliteDatabase(join(root, 'state.sqlite'), {
    migration: { appliedAt: importedAt },
  });
  const catalog = new SqliteGlossaryCatalog(database);
  const input = sampleImport();

  assert.deepEqual(await catalog.replaceSource(input), {
    status: 'imported',
    acceptedCount: 1,
    rejectedCount: 0,
  });
  assert.deepEqual(
    await catalog.listClassSources({
      classId: input.source.classId,
      academicYear: '2026-27',
    }),
    [input.source],
  );

  const snapshot = await catalog.loadSource(input.source.sourceGlossaryId);
  assert.equal(snapshot?.entries[0]?.term, 'semantic HTML');
  assert.equal(
    snapshot?.entries[0]?.translations[0]?.translatedDefinition,
    'HTML có ý nghĩa rõ ràng.',
  );
  assert.equal(
    snapshot?.entries[0]?.translations[0]?.translatedPartOfSpeech,
    'cụm danh từ',
  );
  assert.equal('content' in (snapshot?.entries[0]?.media[0] ?? {}), false);
  assert.equal(
    new TextDecoder().decode(
      (await catalog.loadMedia('media-term-a'))?.content,
    ),
    'synthetic-audio',
  );

  assert.deepEqual(await catalog.replaceSource(input), {
    status: 'unchanged',
    acceptedCount: 1,
    rejectedCount: 0,
  });
  assert.equal(
    (
      database.connection
        .prepare('SELECT count(*) AS value FROM glossary_import_runs')
        .get() as { value: number }
    ).value,
    1,
  );

  const replacement = sampleImport({
    source: { ...input.source, contentHash: digest('replacement') },
    entries: [{ ...input.entries[0]!, term: 'semantic markup' }],
    translations: [],
    media: [],
  });
  assert.equal((await catalog.replaceSource(replacement)).status, 'imported');
  assert.equal(
    (await catalog.loadSource(input.source.sourceGlossaryId))?.entries[0]?.term,
    'semantic markup',
  );
  assert.equal(await catalog.loadMedia('media-term-a'), undefined);
  assert.deepEqual(database.integrityCheck(), {
    ok: true,
    integrityMessages: ['ok'],
    foreignKeyViolations: 0,
  });
});

test('catalog rejects inconsistent binary media before it changes a source', async () => {
  const root = temporaryRoot();
  using database = new SqliteDatabase(join(root, 'state.sqlite'), {
    migration: { appliedAt: importedAt },
  });
  const catalog = new SqliteGlossaryCatalog(database);
  const input = sampleImport();
  assert.equal((await catalog.replaceSource(input)).status, 'imported');
  const bad = sampleImport({
    source: { ...input.source, contentHash: digest('bad-import') },
    media: [{ ...input.media[0]!, contentSha256: digest('different-bytes') }],
  });
  assert.deepEqual(await catalog.replaceSource(bad), {
    status: 'rejected',
    acceptedCount: 0,
    rejectedCount: 1,
  });
  assert.equal(
    (await catalog.loadSource(input.source.sourceGlossaryId))?.entries[0]?.term,
    'semantic HTML',
  );
});

function sampleImport(
  overrides: Partial<GlossaryCatalogImport> = {},
): GlossaryCatalogImport {
  const audio = Buffer.from('synthetic-audio');
  return {
    importId: 'glossary-import-a',
    source: {
      sourceGlossaryId: 'web-design-unit-1',
      classId: 'web-design-a' as GlossaryCatalogImport['source']['classId'],
      className: 'Web Design',
      academicYear: '2026-27',
      unitKey: '1',
      lessonTopic: 'HTML foundations',
      sourceReference: 'drive:file-synthetic',
      sourceFormat: 'csv',
      contentHash: digest('source-a'),
      importedAt,
    },
    entries: [
      {
        entryId: 'glossary-entry-a',
        sourceGlossaryId: 'web-design-unit-1',
        sourceRowKey: 'row-1',
        sourceLanguage: 'en',
        term: 'semantic HTML',
        definition: 'HTML that conveys meaning.',
        partOfSpeech: 'noun phrase',
        pronunciation: '/sɪˈmæntɪk eɪtʃ tiː ɛm ɛl/',
        createdAt: importedAt,
      },
    ],
    translations: [
      {
        translationId: 'translation-vietnamese-a',
        entryId: 'glossary-entry-a',
        languageCode: 'vi',
        translatedTerm: 'HTML ngữ nghĩa',
        translatedDefinition: 'HTML có ý nghĩa rõ ràng.',
        translatedPartOfSpeech: 'cụm danh từ',
        translatedExample: 'Dùng phần tử main.',
        origin: 'teacher',
        reviewStatus: 'reviewed',
        createdAt: importedAt,
      },
    ],
    media: [
      {
        mediaId: 'media-term-a',
        entryId: 'glossary-entry-a',
        languageCode: 'en',
        role: 'term-pronunciation',
        mimeType: 'audio/mpeg',
        content: audio,
        contentSha256: digest(audio),
        origin: 'teacher',
        reviewStatus: 'reviewed',
        createdAt: importedAt,
      },
    ],
    ...overrides,
  };
}

function digest(value: string | Uint8Array): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'chalkwright-glossary-catalog-'));
  roots.push(root);
  return root;
}
