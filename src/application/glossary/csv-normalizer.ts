import { createHash } from 'node:crypto';

import type {
  GlossaryCatalogImport,
  GlossaryEntry,
} from '../../domain/glossary.js';
import { compactText, stableId } from '../../domain/pure-values.js';

const maximumCsvBytes = 1_000_000;
const maximumRows = 2_000;

export interface GlossaryCsvImportRequest {
  readonly importId: string;
  readonly source: Omit<
    GlossaryCatalogImport['source'],
    'contentHash' | 'sourceFormat'
  >;
  readonly csv: Uint8Array;
  readonly defaultLanguage: string;
}

/** Converts teacher CSV glossaries to the one normalized local catalog shape. */
export function normalizeGlossaryCsv(
  request: GlossaryCsvImportRequest,
): GlossaryCatalogImport {
  if (
    request.csv.byteLength === 0 ||
    request.csv.byteLength > maximumCsvBytes ||
    !languageCode(request.defaultLanguage)
  )
    throw new Error('glossary-csv-input-invalid');
  const rows = csvRows(
    new TextDecoder('utf-8', { fatal: true }).decode(request.csv),
  );
  if (rows.length < 2 || rows.length > maximumRows + 1)
    throw new Error('glossary-csv-row-count-invalid');
  const headers = headerIndexes(rows[0] ?? []);
  const terms = rows
    .slice(1)
    .map((row, ordinal) => entryFromRow(row, ordinal + 2, headers, request));
  if (new Set(terms.map((entry) => entry.entryId)).size !== terms.length)
    throw new Error('glossary-csv-duplicate-entry');
  const contentHash = digest(request.csv);
  return {
    importId: request.importId,
    source: { ...request.source, sourceFormat: 'csv', contentHash },
    entries: terms,
    translations: [],
    media: [],
  };
}

interface HeaderIndexes {
  readonly term: number;
  readonly definition: number;
  readonly language?: number;
  readonly partOfSpeech?: number;
  readonly example?: number;
  readonly pronunciation?: number;
}

function headerIndexes(headers: readonly string[]): HeaderIndexes {
  const values = headers.map((value) => normalizeHeader(value));
  const required = (names: readonly string[]): number => {
    const index = values.findIndex((value) => names.includes(value));
    if (index === -1) throw new Error('glossary-csv-required-column-missing');
    return index;
  };
  const optional = (names: readonly string[]): number | undefined => {
    const index = values.findIndex((value) => names.includes(value));
    return index === -1 ? undefined : index;
  };
  const term = required(['term', 'word', 'vocabulary', 'vocab']);
  const definition = required(['definition', 'meaning', 'description']);
  if (term === definition)
    throw new Error('glossary-csv-required-column-missing');
  const language = optional(['language', 'language code', 'source language']);
  const partOfSpeech = optional(['part of speech', 'partofspeech', 'pos']);
  const example = optional(['example', 'example sentence']);
  const pronunciation = optional(['pronunciation', 'phonetic']);
  return {
    term,
    definition,
    ...(language === undefined ? {} : { language }),
    ...(partOfSpeech === undefined ? {} : { partOfSpeech }),
    ...(example === undefined ? {} : { example }),
    ...(pronunciation === undefined ? {} : { pronunciation }),
  };
}

function entryFromRow(
  row: readonly string[],
  line: number,
  indexes: HeaderIndexes,
  request: GlossaryCsvImportRequest,
): GlossaryEntry {
  const value = (index: number | undefined): string | undefined =>
    index === undefined ? undefined : nonEmpty(row[index]);
  const term = value(indexes.term);
  const definition = value(indexes.definition);
  const sourceLanguage = value(indexes.language) ?? request.defaultLanguage;
  if (
    term === undefined ||
    definition === undefined ||
    term.length > 512 ||
    definition.length > 8_192 ||
    !languageCode(sourceLanguage)
  )
    throw new Error(`glossary-csv-row-invalid-${line}`);
  const partOfSpeech = value(indexes.partOfSpeech);
  const example = value(indexes.example);
  const pronunciation = value(indexes.pronunciation);
  if (
    (partOfSpeech !== undefined && partOfSpeech.length > 128) ||
    (example !== undefined && example.length > 8_192) ||
    (pronunciation !== undefined && pronunciation.length > 512)
  )
    throw new Error(`glossary-csv-row-invalid-${line}`);
  return {
    entryId: stableId(
      'glossary-entry',
      request.source.sourceGlossaryId,
      String(line),
      term,
      definition,
    ),
    sourceGlossaryId: request.source.sourceGlossaryId,
    sourceRowKey: `csv-line-${line}`,
    sourceLanguage,
    term,
    definition,
    createdAt: request.source.importedAt,
    ...(partOfSpeech === undefined ? {} : { partOfSpeech }),
    ...(example === undefined ? {} : { example }),
    ...(pronunciation === undefined ? {} : { pronunciation }),
  };
}

function csvRows(text: string): readonly (readonly string[])[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else value += character;
      continue;
    }
    if (character === '"') {
      if (value.length !== 0) throw new Error('glossary-csv-quote-invalid');
      quoted = true;
    } else if (character === ',') {
      row.push(value);
      value = '';
    } else if (character === '\n') {
      row.push(value.replace(/\r$/u, ''));
      rows.push(row);
      row = [];
      value = '';
    } else if (character !== '\r') value += character;
  }
  if (quoted) throw new Error('glossary-csv-quote-invalid');
  if (value.length > 0 || row.length > 0) {
    row.push(value);
    rows.push(row);
  }
  return rows;
}

function normalizeHeader(value: string): string {
  return compactText(value).toLowerCase().replace(/[_-]+/gu, ' ');
}

function nonEmpty(value: string | undefined): string | undefined {
  const normalized = compactText(value);
  return normalized.length === 0 ? undefined : normalized;
}

function languageCode(value: string): boolean {
  return /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u.test(value);
}

function digest(value: Uint8Array): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
