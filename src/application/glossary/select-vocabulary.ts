import { isDeepStrictEqual } from 'node:util';

import type { IsoInstant } from '../../contracts/v1/common.js';
import type { GoogleDriveGlossaryCourseConfig } from '../../config/google-drive-glossary.js';
import type { VocabularyCandidate } from '../../domain/vocabulary.js';
import {
  selectVocabulary,
  vocabularyHistoryRecordKey,
  vocabularySelectionRecordKey,
} from '../../domain/vocabulary.js';
import {
  sectionCodeContainsCourseKey,
  type ClassId,
} from '../../domain/identities.js';
import type { EffectiveDayPlan } from '../../domain/plans.js';
import type { ShadowCourseMapping } from '../../config/shadow.js';
import type { SqliteClassroomEnrichmentCache } from '../../infrastructure/sqlite/classroom-cache.js';
import type { SqliteApplicationStateRepository } from '../../infrastructure/sqlite/repository.js';
import type { GlossaryCatalog } from '../../ports/glossary-catalog.js';
import type { SafeStateRecord } from '../../ports/application-state.js';

export interface GlossaryVocabularySelectionResult {
  readonly selected: number;
  readonly unchanged: number;
  readonly unavailable: number;
}

/** Selects stable meeting words exclusively from the imported local catalog. */
export async function selectGlossaryVocabularyForPlan(options: {
  readonly plan: EffectiveDayPlan;
  readonly observedAt: IsoInstant;
  readonly academicYear: string;
  readonly academicYearEnd: string;
  readonly courseConfigs: readonly GoogleDriveGlossaryCourseConfig[];
  readonly courseMappings: readonly ShadowCourseMapping[];
  readonly catalog: GlossaryCatalog;
  readonly classroomCache: SqliteClassroomEnrichmentCache;
  readonly state: SqliteApplicationStateRepository;
}): Promise<GlossaryVocabularySelectionResult> {
  let selected = 0;
  let unchanged = 0;
  let unavailable = 0;
  for (const meeting of options.plan.meetings) {
    const mapping = options.courseMappings.find((candidate) =>
      sectionCodeContainsCourseKey(candidate.sectionCode, meeting.courseKey),
    );
    if (mapping === undefined) {
      unavailable += 1;
      continue;
    }
    const courseConfig = options.courseConfigs.find(
      (course) => course.classId === mapping.classId,
    );
    if (courseConfig === undefined) {
      unavailable += 1;
      continue;
    }
    const selectionKey = vocabularySelectionRecordKey(
      mapping.classId,
      meeting.meetingId,
    );
    const candidates = await candidatesForClass(
      options.catalog,
      courseConfig,
      mapping.classId,
      options.academicYear,
    );
    const existing = await options.state.findRecord({
      kind: 'vocabulary-selection',
      recordKey: selectionKey,
      date: options.plan.date,
      classId: mapping.classId,
      meetingId: meeting.meetingId,
    });
    if (
      existing?.kind === 'vocabulary-selection' &&
      existing.data.selection.candidate !== undefined
    ) {
      const current = candidates.find(
        (candidate) =>
          candidate.term.toLowerCase() ===
          existing.data.selection.candidate!.term.toLowerCase(),
      );
      if (
        current === undefined ||
        isDeepStrictEqual(current, existing.data.selection.candidate)
      ) {
        unchanged += 1;
        continue;
      }
    }
    const historyKey = vocabularyHistoryRecordKey(mapping.classId);
    const historyRecord = await options.state.findRecord({
      kind: 'vocabulary-history',
      recordKey: historyKey,
      classId: mapping.classId,
    });
    const history =
      historyRecord?.kind === 'vocabulary-history'
        ? historyRecord.data.entries
        : [];
    const cache = await options.classroomCache.load(
      mapping.classId,
      options.plan.date,
      options.observedAt,
    );
    const selection = selectVocabulary({
      classId: mapping.classId,
      subject: courseConfig.subject,
      courseName: courseConfig.courseName,
      blockLabel: meeting.blockLabel,
      meetingKey: meeting.meetingId,
      date: options.plan.date,
      candidates,
      history,
      providerCourseKey: mapping.providerCourseKey,
      coursework:
        cache?.enrichment === undefined
          ? []
          : [...cache.enrichment.recent, ...cache.enrichment.upcoming],
    });
    if (selection.candidate === undefined) {
      unavailable += 1;
      continue;
    }
    const records: SafeStateRecord[] = [
      {
        kind: 'vocabulary-selection',
        recordKey: selectionKey,
        scope: {
          date: options.plan.date,
          classId: mapping.classId,
          meetingId: meeting.meetingId,
        },
        data: { selection },
        academicYearEnd: options.academicYearEnd,
      },
    ];
    if (selection.historyIntent !== undefined) {
      const nextHistory = [
        ...history.filter((entry) => entry.meetingKey !== meeting.meetingId),
        selection.historyIntent.entry,
      ].sort(
        (left, right) =>
          left.date.localeCompare(right.date) ||
          left.meetingKey.localeCompare(right.meetingKey),
      );
      records.push({
        kind: 'vocabulary-history',
        recordKey: historyKey,
        scope: { classId: mapping.classId },
        data: { entries: nextHistory },
        academicYearEnd: options.academicYearEnd,
      });
    }
    const writes = options.state.storeRecordsAtomically(records);
    if (writes.some((write) => write.status === 'rejected'))
      throw new Error('glossary-vocabulary-storage-failed');
    if (writes[0]?.status === 'unchanged') unchanged += 1;
    else selected += 1;
  }
  return { selected, unchanged, unavailable };
}

async function candidatesForClass(
  catalog: GlossaryCatalog,
  courseConfig: GoogleDriveGlossaryCourseConfig,
  classId: ClassId,
  academicYear: string,
): Promise<readonly VocabularyCandidate[]> {
  const available = await catalog.listClassSources({ classId, academicYear });
  const result: VocabularyCandidate[] = [];
  for (const source of available) {
    const snapshot = await catalog.loadSource(source.sourceGlossaryId);
    if (snapshot === undefined) continue;
    for (const entry of snapshot.entries) {
      const languageOrder = ['vi', 'ko', 'zh-Hans'] as const;
      const translations = languageOrder.flatMap((languageCode) => {
        const translation = entry.translations.find(
          (candidate) =>
            candidate.languageCode.toLowerCase() ===
              languageCode.toLowerCase() &&
            candidate.reviewStatus === 'reviewed',
        );
        if (translation === undefined) return [];
        const value = {
          languageCode,
          ...(translation.translatedTerm === undefined
            ? {}
            : { term: translation.translatedTerm }),
          ...(translation.translatedDefinition === undefined
            ? {}
            : { definition: translation.translatedDefinition }),
          ...(translation.translatedExample === undefined
            ? {}
            : { example: translation.translatedExample }),
        };
        return Object.keys(value).length === 1 ? [] : [value];
      });
      const vietnamese = translations.find(
        (translation) => translation.languageCode === 'vi',
      );
      result.push({
        term: entry.term,
        definition: entry.definition,
        source: 'class',
        classIds: [classId],
        subjects: [courseConfig.subject],
        keywords: [source.unitKey, source.lessonTopic].filter(
          (value): value is string => value !== undefined,
        ),
        ...(entry.pronunciation === undefined
          ? {}
          : { pronunciation: entry.pronunciation }),
        ...(entry.partOfSpeech === undefined
          ? {}
          : { partOfSpeech: entry.partOfSpeech }),
        ...(entry.example === undefined ? {} : { example: entry.example }),
        ...(vietnamese === undefined
          ? {}
          : {
              vietnamese: {
                ...(vietnamese.term === undefined
                  ? {}
                  : { term: vietnamese.term }),
                ...(vietnamese.definition === undefined
                  ? {}
                  : { definition: vietnamese.definition }),
                ...(vietnamese.example === undefined
                  ? {}
                  : { example: vietnamese.example }),
              },
            }),
        ...(translations.length === 0 ? {} : { translations }),
      });
    }
  }
  return result;
}
