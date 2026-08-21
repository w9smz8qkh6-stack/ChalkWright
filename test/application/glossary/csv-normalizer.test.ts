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

test('imports teacher-supplied Vietnamese columns as reviewed translations', () => {
  const result = normalizeGlossaryCsv({
    importId: 'import-b',
    source: {
      sourceGlossaryId: 'web-design-unit-2',
      classId: 'web-design-a' as never,
      academicYear: '2026-27',
      sourceReference: 'drive:file-synthetic',
      importedAt,
    },
    defaultLanguage: 'en',
    csv: new TextEncoder().encode(
      'Term,Definition,Vietnamese Word,Vietnamese Definition,VI Example\niteration,A repeated process,sự lặp lại,Một quá trình lặp lại,Mỗi vòng cải thiện thiết kế.\n',
    ),
  });
  assert.deepEqual(result.translations, [
    {
      translationId: 'glossary-translation-web-design-unit-2-2-vi',
      entryId:
        'glossary-entry-web-design-unit-2-2-iteration-a-repeated-process',
      languageCode: 'vi',
      origin: 'teacher',
      reviewStatus: 'reviewed',
      createdAt: importedAt,
      translatedTerm: 'sự lặp lại',
      translatedDefinition: 'Một quá trình lặp lại',
      translatedExample: 'Mỗi vòng cải thiện thiết kế.',
    },
  ]);
});

test('imports the live compact Web Design multilingual schema', () => {
  const result = normalizeGlossaryCsv({
    importId: 'import-c',
    source: {
      sourceGlossaryId: 'web-design-unit-3',
      classId: 'web-design-a' as never,
      academicYear: '2026-27',
      sourceReference: 'drive:file-synthetic',
      importedAt,
    },
    defaultLanguage: 'en',
    csv: new TextEncoder().encode(
      'term,definition,language,lessons,sample_sentence_en,term_vi,definition_vi,sample_sentence_vi,term_ko,definition_ko,sample_sentence_ko,term_zh,definition_zh,sample_sentence_zh\nHTML Tag,A markup label,en,3,Use the tag in a page.,Thẻ HTML,Nhãn đánh dấu,Dùng thẻ trong trang.,HTML 태그,마크업 레이블,페이지에서 태그를 사용하세요.,HTML 标签,标记标签,在页面中使用该标签。\n',
    ),
  });
  assert.equal(result.entries[0]?.example, 'Use the tag in a page.');
  assert.deepEqual(
    result.translations.map((translation) => ({
      languageCode: translation.languageCode,
      term: translation.translatedTerm,
      definition: translation.translatedDefinition,
      example: translation.translatedExample,
    })),
    [
      {
        languageCode: 'vi',
        term: 'Thẻ HTML',
        definition: 'Nhãn đánh dấu',
        example: 'Dùng thẻ trong trang.',
      },
      {
        languageCode: 'ko',
        term: 'HTML 태그',
        definition: '마크업 레이블',
        example: '페이지에서 태그를 사용하세요.',
      },
      {
        languageCode: 'zh-Hans',
        term: 'HTML 标签',
        definition: '标记标签',
        example: '在页面中使用该标签。',
      },
    ],
  );
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
