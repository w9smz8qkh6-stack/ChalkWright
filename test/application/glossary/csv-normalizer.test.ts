import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeGlossaryCsv } from '../../../src/application/glossary/csv-normalizer.js';

const importedAt = '2035-04-13T01:00:00.000Z';

test('normalizes recognized teacher CSV headers and quoted source text', () => {
  const result = normalizeGlossaryCsv({
    importId: 'import-a',
    source: {
      sourceGlossaryId: 'web-design-unit-1',
      classId: 'web-design-a' as never,
      className: 'Web Design',
      academicYear: '2026-27',
      unitKey: '1',
      sourceReference: 'drive:file-synthetic',
      importedAt,
    },
    defaultLanguage: 'en',
    csv: new TextEncoder().encode(
      'Word,Meaning,Part of Speech,Example Sentence\n"semantic HTML","HTML, with meaning",noun,"Use <main>."\n',
    ),
  });
  assert.equal(result.source.sourceFormat, 'csv');
  assert.match(result.source.contentHash, /^sha256:[0-9a-f]{64}$/u);
  assert.deepEqual(result.entries[0], {
    entryId:
      'glossary-entry-web-design-unit-1-2-semantic-html-html-with-meaning',
    sourceGlossaryId: 'web-design-unit-1',
    sourceRowKey: 'csv-line-2',
    sourceLanguage: 'en',
    term: 'semantic HTML',
    definition: 'HTML, with meaning',
    partOfSpeech: 'noun',
    example: 'Use <main>.',
    createdAt: importedAt,
  });
});

test('fails closed for missing columns, malformed quote syntax, and invalid rows', () => {
  const base = {
    importId: 'import-a',
    source: {
      sourceGlossaryId: 'web-design-unit-1',
      classId: 'web-design-a' as never,
      academicYear: '2026-27',
      sourceReference: 'drive:file-synthetic',
      importedAt,
    },
    defaultLanguage: 'en',
  };
  for (const csv of [
    'Term\none\n',
    'Term,Definition\n"unclosed,value\n',
    'Term,Definition\n,missing term\n',
  ]) {
    assert.throws(
      () =>
        normalizeGlossaryCsv({ ...base, csv: new TextEncoder().encode(csv) }),
      /glossary-csv-/u,
    );
  }
});
