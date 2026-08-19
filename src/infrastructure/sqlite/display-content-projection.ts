import { createHash } from 'node:crypto';

import { isContinuityImportRecord } from '../../application/persistence/continuity-importer.js';
import type { IsoDate, OpaqueId } from '../../contracts/v1/common.js';
import type { ContentCard, StaticClassContent } from '../../domain/content.js';
import type { ClassId } from '../../domain/identities.js';
import type { DisplayCard } from '../../domain/overrides.js';
import { stableId, stableSerialize } from '../../domain/pure-values.js';
import type { SqliteDatabase } from './database.js';

interface ContinuityRow {
  readonly collection: 'contentSnapshots' | 'vocabularySelections';
  readonly identity: string;
  readonly checksum: string;
  readonly record_json: string;
}

export interface LocalContentProjection {
  readonly staticContent: StaticClassContent;
  readonly vocabularyCard?: DisplayCard;
}

function verifiedValue(row: ContinuityRow): Readonly<Record<string, unknown>> {
  let value: unknown;
  try {
    value = JSON.parse(row.record_json);
  } catch {
    throw new Error('display-content-row-invalid');
  }
  if (
    createHash('sha256').update(stableSerialize(value)).digest('hex') !==
      row.checksum ||
    !isContinuityImportRecord(row.collection, row.identity, value)
  )
    throw new Error('display-content-row-invalid');
  return value as Readonly<Record<string, unknown>>;
}

function vocabularyCard(value: Readonly<Record<string, unknown>>): DisplayCard {
  const vietnamese = value.vietnamese as
    | {
        readonly term?: string;
        readonly definition?: string;
        readonly example?: string;
      }
    | undefined;
  const term = value.term as string;
  const definition = value.definition as string;
  return {
    cardId: stableId('vocabulary', value.selectionId),
    type: 'vocabulary',
    title: 'Word of the day',
    lines: [],
    accent: typeof value.accent === 'string' ? value.accent : 'calm',
    ...(typeof value.durationSeconds === 'number'
      ? { durationSeconds: value.durationSeconds }
      : {}),
    vocabulary: {
      term,
      definition,
      ...(typeof value.pronunciation === 'string'
        ? { pronunciation: value.pronunciation }
        : {}),
      ...(typeof value.partOfSpeech === 'string'
        ? { partOfSpeech: value.partOfSpeech }
        : {}),
      ...(typeof value.example === 'string' ? { example: value.example } : {}),
      ...(vietnamese === undefined ? {} : { vietnamese }),
    },
  };
}

/** Provider-free projection over copied, validated Chalkwright continuity data. */
export class SqliteDisplayContentProjection {
  constructor(private readonly database: SqliteDatabase) {}

  read(
    classId: ClassId,
    date: IsoDate,
    meetingId?: OpaqueId,
  ): LocalContentProjection {
    const rows = this.database.connection
      .prepare(
        `SELECT collection, identity, checksum, record_json
           FROM continuity_records
          WHERE collection IN ('contentSnapshots', 'vocabularySelections')
          ORDER BY imported_at DESC, identity ASC
          LIMIT 1001`,
      )
      .all() as unknown as readonly ContinuityRow[];
    if (rows.length > 1000) throw new Error('display-content-budget-exceeded');

    let staticContent: StaticClassContent = {};
    let staticRefreshedAt: string | undefined;
    let selectedVocabulary: DisplayCard | undefined;
    for (const row of rows) {
      const value = verifiedValue(row);
      if (value.classId !== classId || value.date !== date) continue;
      if (row.collection === 'contentSnapshots') {
        const refreshedAt = value.refreshedAt as string;
        if (
          staticRefreshedAt !== undefined &&
          refreshedAt === staticRefreshedAt
        )
          throw new Error('display-content-ambiguous');
        if (staticRefreshedAt !== undefined && refreshedAt < staticRefreshedAt)
          continue;
        staticRefreshedAt = refreshedAt;
        staticContent = {
          items: structuredClone(value.items as readonly ContentCard[]),
        };
        continue;
      }
      if (meetingId === undefined || value.meetingKey !== meetingId) continue;
      if (selectedVocabulary !== undefined)
        throw new Error('display-vocabulary-ambiguous');
      selectedVocabulary = vocabularyCard(value);
    }
    return {
      staticContent,
      ...(selectedVocabulary === undefined
        ? {}
        : { vocabularyCard: selectedVocabulary }),
    };
  }
}
