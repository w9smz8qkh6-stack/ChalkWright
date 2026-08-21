import { createHash } from 'node:crypto';

import { isContinuityImportRecord } from '../../application/persistence/continuity-importer.js';
import type { IsoDate, OpaqueId } from '../../contracts/v1/common.js';
import type { ContentCard, StaticClassContent } from '../../domain/content.js';
import type { ClassId } from '../../domain/identities.js';
import type { DisplayCard } from '../../domain/overrides.js';
import { stableId, stableSerialize } from '../../domain/pure-values.js';
import {
  vocabularySelectionRecordKey,
  type VocabularySelection,
} from '../../domain/vocabulary.js';
import type { SqliteDatabase } from './database.js';
import { isSafeStateRecord } from './state-validation.js';

interface ContinuityRow {
  readonly collection: 'contentSnapshots' | 'vocabularySelections';
  readonly identity: string;
  readonly checksum: string;
  readonly record_json: string;
}

interface NativeSelectionRow {
  readonly payload_json: string;
  readonly semantic_hash: string;
  readonly record_key: string;
  readonly date_scope: string;
  readonly class_id: string;
  readonly meeting_id: string;
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

function legacyVocabularyCard(
  value: Readonly<Record<string, unknown>>,
): DisplayCard {
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

function nativeVocabularyCard(
  selection: VocabularySelection,
  selectionId: string,
): DisplayCard | undefined {
  const candidate = selection.candidate;
  if (candidate === undefined) return undefined;
  return {
    cardId: stableId('vocabulary', selectionId),
    type: 'vocabulary',
    title: 'Word of the day',
    lines: [],
    accent: selection.accent ?? candidate.accent ?? 'calm',
    ...(selection.durationSeconds === undefined
      ? {}
      : { durationSeconds: selection.durationSeconds }),
    vocabulary: {
      term: candidate.term,
      definition: candidate.definition,
      ...(candidate.pronunciation === undefined
        ? {}
        : { pronunciation: candidate.pronunciation }),
      ...(candidate.partOfSpeech === undefined
        ? {}
        : { partOfSpeech: candidate.partOfSpeech }),
      ...(candidate.example === undefined
        ? {}
        : { example: candidate.example }),
      ...(candidate.vietnamese === undefined
        ? {}
        : { vietnamese: candidate.vietnamese }),
      ...(candidate.translations === undefined
        ? {}
        : { translations: candidate.translations }),
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
    const nativeVocabulary =
      meetingId === undefined
        ? undefined
        : this.readNativeVocabulary(classId, date, meetingId);
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
    let selectedVocabulary: DisplayCard | undefined = nativeVocabulary;
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
      if (
        nativeVocabulary !== undefined ||
        meetingId === undefined ||
        value.meetingKey !== meetingId
      )
        continue;
      if (selectedVocabulary !== undefined)
        throw new Error('display-vocabulary-ambiguous');
      selectedVocabulary = legacyVocabularyCard(value);
    }
    return {
      staticContent,
      ...(selectedVocabulary === undefined
        ? {}
        : { vocabularyCard: selectedVocabulary }),
    };
  }

  private readNativeVocabulary(
    classId: ClassId,
    date: IsoDate,
    meetingId: OpaqueId,
  ): DisplayCard | undefined {
    const recordKey = vocabularySelectionRecordKey(classId, meetingId);
    const rows = this.database.connection
      .prepare(
        `SELECT payload_json, semantic_hash, record_key, date_scope, class_id,
                meeting_id
           FROM application_records
          WHERE record_kind = 'vocabulary-selection' AND record_key = ?
                AND date_scope = ? AND class_id = ? AND meeting_id = ?
                AND screen_id = '' AND room_id = '' AND plan_id = ''
                AND superseded_at IS NULL
          ORDER BY created_at DESC, rowid DESC
          LIMIT 2`,
      )
      .all(
        recordKey,
        date,
        classId,
        meetingId,
      ) as unknown as NativeSelectionRow[];
    if (rows.length > 1) throw new Error('display-vocabulary-ambiguous');
    const row = rows[0];
    if (row === undefined) return undefined;
    let value: unknown;
    try {
      value = JSON.parse(row.payload_json);
    } catch {
      throw new Error('display-content-row-invalid');
    }
    if (
      createHash('sha256').update(stableSerialize(value)).digest('hex') !==
        row.semantic_hash ||
      !isSafeStateRecord(value) ||
      value.kind !== 'vocabulary-selection' ||
      value.recordKey !== row.record_key ||
      value.scope.date !== row.date_scope ||
      value.scope.classId !== row.class_id ||
      value.scope.meetingId !== row.meeting_id
    )
      throw new Error('display-content-row-invalid');
    return nativeVocabularyCard(value.data.selection, value.recordKey);
  }
}
