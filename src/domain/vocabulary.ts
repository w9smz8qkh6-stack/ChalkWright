import type {
  ContractDiagnostic,
  IsoDate,
  OpaqueId,
} from '../contracts/v1/common.js';
import {
  assignmentUnitLabel,
  type NormalizedCourseworkItem,
} from './coursework.js';
import type { ClassId } from './identities.js';
import { compactText, diagnostic, stableId } from './pure-values.js';

export interface VocabularyCandidate {
  readonly term: string;
  readonly definition: string;
  readonly source: 'class' | 'subject' | 'codehs';
  readonly subjects?: readonly string[];
  readonly classIds?: readonly ClassId[];
  readonly keywords?: readonly string[];
  readonly codeHsUnits?: readonly string[];
  readonly pronunciation?: string;
  readonly partOfSpeech?: string;
  readonly example?: string;
  readonly vietnamese?: {
    readonly term?: string;
    readonly definition?: string;
    readonly example?: string;
  };
  readonly translations?: readonly VocabularyDisplayTranslation[];
  readonly accent?: string;
  readonly durationSeconds?: number;
}

export interface VocabularyDisplayTranslation {
  readonly languageCode: 'vi' | 'ko' | 'zh-Hans';
  readonly term?: string;
  readonly definition?: string;
  readonly example?: string;
}

export interface VocabularySelectionContext {
  readonly assignmentRefs: readonly {
    readonly courseWorkId: OpaqueId;
    readonly title: string;
    readonly timing: 'recent' | 'upcoming';
    readonly dueDate?: IsoDate;
    readonly updateTime: string;
  }[];
  readonly classroomCourseId: OpaqueId | '';
  readonly meetingDate: IsoDate;
  readonly vocabularyPolicy:
    | 'recorded_same_meeting'
    | 'unused_focused'
    | 'unused_best_available'
    | 'exhausted_best_available';
  readonly vocabularyReuse:
    'recorded_same_meeting' | 'new' | 'repeat_after_exhaustion';
  readonly candidateCount: number;
  readonly usedCandidateCount: number;
  readonly unusedCandidateCount: number;
}

export interface VocabularyHistoryEntry {
  readonly classId: ClassId;
  readonly meetingKey: OpaqueId;
  readonly date: IsoDate;
  readonly term: string;
  readonly definition?: string;
  readonly source?: VocabularyCandidate['source'];
  readonly pronunciation?: string;
  readonly partOfSpeech?: string;
  readonly example?: string;
  readonly vietnamese?: VocabularyCandidate['vietnamese'];
  readonly translations?: readonly VocabularyDisplayTranslation[];
  readonly accent?: string;
  readonly durationSeconds?: number;
  readonly selectionContext?: VocabularySelectionContext;
}

export interface VocabularyHistoryIntent {
  readonly kind: 'record-selection';
  readonly intentId: OpaqueId;
  readonly entry: VocabularyHistoryEntry;
}

export interface VocabularySelection {
  readonly candidate?: VocabularyCandidate;
  readonly repeated?: boolean;
  readonly accent?: string;
  readonly durationSeconds?: number;
  readonly lines?: readonly string[];
  readonly selectionContext?: VocabularySelectionContext;
  readonly historyIntent?: VocabularyHistoryIntent;
  readonly diagnostics: readonly ContractDiagnostic[];
}

export function vocabularySelectionRecordKey(
  classId: ClassId,
  meetingKey: OpaqueId,
): OpaqueId {
  return stableId('vocabulary-selection', classId, meetingKey);
}

export function vocabularyHistoryRecordKey(classId: ClassId): OpaqueId {
  return stableId('vocabulary-history', classId);
}

function stableIndex(seed: string, length: number): number {
  if (length === 0) return 0;
  let hash = 2_166_136_261;
  for (const character of seed) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16_777_619);
  }
  return Math.abs(hash) % length;
}

function rotationIndex(
  classId: ClassId,
  date: IsoDate,
  blockLabel: string,
  length: number,
): number {
  if (length === 0) return 0;
  const [year, month, day] = date.split('-').map(Number);
  const dateNumber =
    year && month && day
      ? Math.floor(Date.UTC(year, month - 1, day) / 86_400_000)
      : 0;
  const textNumber = [...classId].reduce(
    (total, character, index) => total + character.charCodeAt(0) * (index + 1),
    0,
  );
  const blockNumber = [...blockLabel].reduce(
    (total, character) =>
      total +
      (/\d/.test(character) ? Number(character) : character.charCodeAt(0) % 10),
    0,
  );
  return Math.abs(dateNumber + textNumber + blockNumber) % length;
}

/** Class candidates win case-insensitive de-duplication, then subject, then CodeHS. */
export function deduplicateVocabularyCandidates(
  candidates: readonly VocabularyCandidate[],
): readonly VocabularyCandidate[] {
  const sourceOrder = { class: 0, subject: 1, codehs: 2 } as const;
  const ordered = candidates
    .map((candidate, index) => ({ candidate, index }))
    .sort(
      (left, right) =>
        sourceOrder[left.candidate.source] -
          sourceOrder[right.candidate.source] || left.index - right.index,
    );
  const seen = new Set<string>();
  return ordered.flatMap(({ candidate }) => {
    const term = compactText(candidate.term);
    const definition = compactText(candidate.definition);
    const key = term.toLowerCase();
    if (term.length === 0 || definition.length === 0 || seen.has(key))
      return [];
    seen.add(key);
    return [{ ...candidate, term, definition }];
  });
}

function codeHsActive(context: string): boolean {
  return (
    context.toLowerCase().includes('codehs') ||
    /\b(quiz|exercise|response|project|lesson|unit)\s+\d|\b\d+\.\d+(?:\.\d+)?\b/i.test(
      context,
    )
  );
}

function scoreCandidate(
  candidate: VocabularyCandidate,
  context: string,
  activeCodeHs: boolean,
): number {
  const word = candidate.term.toLowerCase();
  let score =
    candidate.source === 'codehs' ? 14 : candidate.source === 'subject' ? 2 : 1;
  if (activeCodeHs && candidate.source !== 'codehs') score -= 4;
  if (context.includes(word)) score += 8;
  for (const keyword of candidate.keywords ?? []) {
    if (
      compactText(keyword).length > 0 &&
      context.includes(keyword.toLowerCase())
    )
      score += 5;
  }
  for (const token of word
    .split(/[^a-z0-9]+/)
    .filter((part) => part.length >= 4)) {
    if (context.includes(token)) score += 2;
  }
  return score;
}

function focusedPool<
  T extends { candidate: VocabularyCandidate; score: number },
>(scored: readonly T[], activeCodeHs: boolean): readonly T[] {
  const max = scored[0]?.score ?? 0;
  const relevant = scored
    .filter(
      (item) =>
        item.score >= max - 1 &&
        (!activeCodeHs || item.candidate.source === 'codehs'),
    )
    .slice(0, 5);
  return relevant.length >= 2
    ? relevant
    : scored.slice(0, Math.min(3, scored.length));
}

function topScorePool<T extends { score: number }>(
  items: readonly T[],
): readonly T[] {
  const best = items[0]?.score;
  return best === undefined
    ? []
    : items.filter((item) => item.score >= best - 1).slice(0, 5);
}

function displayLines(candidate: VocabularyCandidate): readonly string[] {
  return [
    compactText(candidate.pronunciation),
    candidate.definition,
    compactText(candidate.example),
    compactText(candidate.vietnamese?.term),
    compactText(candidate.vietnamese?.definition),
    compactText(candidate.vietnamese?.example),
    ...(candidate.translations ?? []).flatMap((translation) => [
      compactText(translation.term),
      compactText(translation.definition),
      compactText(translation.example),
    ]),
  ].filter(Boolean);
}

function assignmentRefs(items: readonly NormalizedCourseworkItem[]) {
  return [...items]
    .sort((left, right) =>
      left.bucket === right.bucket ? 0 : left.bucket === 'upcoming' ? -1 : 1,
    )
    .slice(0, 6)
    .map((item) => ({
      courseWorkId: item.providerItemKey,
      title: item.title,
      timing: item.bucket,
      ...(item.dueDate === undefined ? {} : { dueDate: item.dueDate }),
      updateTime: item.updateTime,
    }));
}

function candidateFromHistory(
  entry: VocabularyHistoryEntry,
): VocabularyCandidate | undefined {
  if (
    compactText(entry.term).length === 0 ||
    compactText(entry.definition).length === 0
  )
    return undefined;
  return {
    term: entry.term,
    definition: entry.definition ?? '',
    source: entry.source ?? 'class',
    ...(entry.pronunciation === undefined
      ? {}
      : { pronunciation: entry.pronunciation }),
    ...(entry.partOfSpeech === undefined
      ? {}
      : { partOfSpeech: entry.partOfSpeech }),
    ...(entry.example === undefined ? {} : { example: entry.example }),
    ...(entry.vietnamese === undefined ? {} : { vietnamese: entry.vietnamese }),
    ...(entry.translations === undefined
      ? {}
      : { translations: entry.translations }),
    ...(entry.accent === undefined ? {} : { accent: entry.accent }),
    ...(entry.durationSeconds === undefined
      ? {}
      : { durationSeconds: entry.durationSeconds }),
  };
}

/** Exact legacy pools, repeat avoidance, and deterministic class/date/block rotation. */
export function selectVocabulary(options: {
  readonly classId: ClassId;
  readonly subject: string;
  readonly courseName?: string;
  readonly blockLabel: string;
  readonly meetingKey: OpaqueId;
  readonly date: IsoDate;
  readonly candidates: readonly VocabularyCandidate[];
  readonly history: readonly VocabularyHistoryEntry[];
  readonly coursework?: readonly NormalizedCourseworkItem[];
  readonly objectiveLines?: readonly string[];
  readonly providerCourseKey?: OpaqueId;
}): VocabularySelection {
  const coursework = options.coursework ?? [];
  const codeHsUnits = new Set(
    coursework
      .map((item) => assignmentUnitLabel(`${item.title} ${item.description}`))
      .filter((unit): unit is string => unit !== undefined),
  );
  const codeHsContext = compactText(
    coursework
      .flatMap((item) => [
        item.title,
        item.description,
        item.alternateLink,
        ...item.materials.flatMap((material) => [material.title, material.url]),
      ])
      .join(' '),
  );
  const activeCodeHs = codeHsActive(codeHsContext);
  const subjectKeys = new Set(
    [options.subject, options.courseName]
      .map((value) => compactText(value).toLowerCase())
      .filter(Boolean),
  );
  const candidates = deduplicateVocabularyCandidates(
    options.candidates.filter(
      (candidate) =>
        (candidate.classIds === undefined ||
          candidate.classIds.includes(options.classId)) &&
        (candidate.subjects === undefined ||
          candidate.subjects.some((subject) =>
            subjectKeys.has(compactText(subject).toLowerCase()),
          )) &&
        (candidate.source !== 'codehs' ||
          (activeCodeHs &&
            (candidate.codeHsUnits === undefined ||
              candidate.codeHsUnits.some((unit) => codeHsUnits.has(unit))))),
    ),
  );
  const sameMeeting = options.history.find(
    (entry) =>
      entry.classId === options.classId &&
      (options.meetingKey.length > 0
        ? entry.meetingKey === options.meetingKey
        : entry.date === options.date),
  );
  if (sameMeeting !== undefined) {
    const candidate =
      candidates.find(
        (item) => item.term.toLowerCase() === sameMeeting.term.toLowerCase(),
      ) ?? candidateFromHistory(sameMeeting);
    if (candidate === undefined) {
      return {
        diagnostics: [
          diagnostic(
            'vocabulary-reuse-missing',
            'warning',
            'The recorded meeting selection lacks display metadata.',
          ),
        ],
      };
    }
    const selectionContext = sameMeeting.selectionContext ?? {
      assignmentRefs: [],
      classroomCourseId: options.providerCourseKey ?? '',
      meetingDate: options.date,
      vocabularyPolicy: 'recorded_same_meeting',
      vocabularyReuse: 'recorded_same_meeting',
      candidateCount: candidates.length,
      usedCandidateCount: 0,
      unusedCandidateCount: candidates.length,
    };
    const accent =
      sameMeeting.accent ??
      candidate.accent ??
      ['ink', 'warm', 'calm'][stableIndex(candidate.term, 3)];
    return {
      candidate,
      repeated: false,
      ...(accent === undefined ? {} : { accent }),
      durationSeconds:
        sameMeeting.durationSeconds ?? candidate.durationSeconds ?? 12,
      lines: displayLines(candidate),
      selectionContext: {
        ...selectionContext,
        vocabularyPolicy: 'recorded_same_meeting',
        vocabularyReuse: 'recorded_same_meeting',
      },
      diagnostics: [],
    };
  }
  if (candidates.length === 0) {
    return {
      diagnostics: [
        diagnostic(
          'vocabulary-candidates-missing',
          'warning',
          'No applicable vocabulary candidate exists.',
        ),
      ],
    };
  }
  const context = compactText(
    [
      options.courseName,
      options.subject,
      options.blockLabel,
      ...coursework.flatMap((item) => [
        item.title,
        item.description,
        item.workType,
        ...item.materials.flatMap((material) => [material.title, material.url]),
      ]),
      ...(options.objectiveLines ?? []),
    ].join(' '),
  ).toLowerCase();
  const scored = candidates
    .map((candidate, index) => ({
      candidate,
      index,
      score: scoreCandidate(candidate, context, activeCodeHs),
    }))
    .sort(
      (left, right) => right.score - left.score || left.index - right.index,
    );
  const prior = options.history
    .filter(
      (entry) =>
        entry.classId === options.classId &&
        entry.meetingKey !== options.meetingKey,
    )
    .sort(
      (left, right) =>
        left.date.localeCompare(right.date) ||
        left.meetingKey.localeCompare(right.meetingKey),
    );
  const used = new Set(
    prior.map((entry) => entry.term.toLowerCase()).filter(Boolean),
  );
  const focused = focusedPool(scored, activeCodeHs);
  const unusedFocused = focused.filter(
    (item) => !used.has(item.candidate.term.toLowerCase()),
  );
  const unused = scored.filter(
    (item) => !used.has(item.candidate.term.toLowerCase()),
  );
  const choice =
    unusedFocused.length > 0
      ? {
          pool: unusedFocused,
          policy: 'unused_focused' as const,
          reuse: 'new' as const,
        }
      : unused.length > 0
        ? {
            pool: topScorePool(unused),
            policy: 'unused_best_available' as const,
            reuse: 'new' as const,
          }
        : {
            pool: focused,
            policy: 'exhausted_best_available' as const,
            reuse: 'repeat_after_exhaustion' as const,
          };
  const previousWord = prior.at(-1)?.term.toLowerCase();
  const nonRepeating =
    previousWord === undefined
      ? choice.pool
      : choice.pool.filter(
          (item) => item.candidate.term.toLowerCase() !== previousWord,
        );
  const pool = nonRepeating.length > 0 ? nonRepeating : choice.pool;
  const chosen =
    pool[
      rotationIndex(
        options.classId,
        options.date,
        options.blockLabel,
        pool.length,
      )
    ]?.candidate;
  if (chosen === undefined)
    return {
      diagnostics: [
        diagnostic(
          'vocabulary-selection-empty',
          'warning',
          'No vocabulary selection could be made.',
        ),
      ],
    };
  const candidateWords = new Set(
    candidates.map((candidate) => candidate.term.toLowerCase()),
  );
  const usedCount = [...candidateWords].filter((word) => used.has(word)).length;
  const selectionContext: VocabularySelectionContext = {
    assignmentRefs: assignmentRefs(coursework),
    classroomCourseId: options.providerCourseKey ?? '',
    meetingDate: options.date,
    vocabularyPolicy: choice.policy,
    vocabularyReuse: choice.reuse,
    candidateCount: candidateWords.size,
    usedCandidateCount: usedCount,
    unusedCandidateCount: Math.max(0, candidateWords.size - usedCount),
  };
  const accent =
    chosen.accent ?? ['ink', 'warm', 'calm'][stableIndex(chosen.term, 3)];
  const durationSeconds = chosen.durationSeconds ?? 12;
  const historyEntry: VocabularyHistoryEntry = {
    classId: options.classId,
    meetingKey: options.meetingKey,
    date: options.date,
    term: chosen.term,
    definition: chosen.definition,
    source: chosen.source,
    ...(chosen.pronunciation === undefined
      ? {}
      : { pronunciation: chosen.pronunciation }),
    ...(chosen.partOfSpeech === undefined
      ? {}
      : { partOfSpeech: chosen.partOfSpeech }),
    ...(chosen.example === undefined ? {} : { example: chosen.example }),
    ...(chosen.vietnamese === undefined
      ? {}
      : { vietnamese: chosen.vietnamese }),
    ...(chosen.translations === undefined
      ? {}
      : { translations: chosen.translations }),
    ...(accent === undefined ? {} : { accent }),
    durationSeconds,
    selectionContext,
  };
  return {
    candidate: chosen,
    repeated: choice.reuse === 'repeat_after_exhaustion',
    ...(accent === undefined ? {} : { accent }),
    durationSeconds,
    lines: displayLines(chosen),
    selectionContext,
    historyIntent: {
      kind: 'record-selection',
      intentId: stableId(
        'vocabulary-history',
        options.classId,
        options.meetingKey,
        chosen.term,
      ),
      entry: historyEntry,
    },
    diagnostics: [],
  };
}
