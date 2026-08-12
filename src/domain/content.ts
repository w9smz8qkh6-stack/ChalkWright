import type { ContractDiagnostic, IsoDate } from '../contracts/v1/common.js';
import type { ClassId } from './identities.js';
import {
  assignmentUnitLabel,
  type NormalizedCourseworkItem,
} from './coursework.js';
import { compactText, diagnostic } from './pure-values.js';

export type ContentCardType =
  | 'announcement'
  | 'bellringer'
  | 'objective'
  | 'agenda'
  | 'assessment_prompt'
  | 'reminder'
  | 'card'
  | 'vocabulary'
  | 'generic';

export interface ContentCard {
  readonly type: ContentCardType;
  readonly title: string;
  readonly lines: readonly string[];
  readonly featured?: string;
  readonly details?: readonly string[];
  readonly accent?: string;
  readonly durationSeconds?: number;
  readonly dueDate?: IsoDate;
}

export interface StaticClassContent {
  readonly items?: readonly ContentCard[];
}

export interface ContentConfiguration {
  readonly defaults?: Readonly<Record<string, StaticClassContent>>;
  /** Supports both date -> class and legacy class -> date nesting. */
  readonly dateOverrides?: Readonly<
    Record<string, Readonly<Record<string, StaticClassContent>>>
  >;
  readonly legacyDateOverrides?: Readonly<
    Record<string, Readonly<Record<string, StaticClassContent>>>
  >;
}

export interface ResolvedClassContent {
  readonly items: readonly ContentCard[];
  readonly source: 'default' | 'date-override' | 'coursework';
  readonly diagnostics: readonly ContractDiagnostic[];
}

const hiddenTypes = new Set<ContentCardType>([
  'agenda',
  'reminder',
  'assessment_prompt',
]);
const hiddenTitles = new Set([
  'agenda',
  'reminder',
  'reminders',
  'assessment focus',
]);
const classroomFollowUp = 'Open Classroom for full directions.';

export function normalizeContentCards(cards: readonly ContentCard[]): {
  readonly cards: readonly ContentCard[];
  readonly diagnostics: readonly ContractDiagnostic[];
} {
  const diagnostics: ContractDiagnostic[] = [];
  const normalized = cards.flatMap((card, index) => {
    const title = compactText(card.title);
    const lines = card.lines.map(compactText).filter(Boolean);
    if (
      (title.length === 0 && lines.length === 0) ||
      (card.durationSeconds !== undefined &&
        (!Number.isFinite(card.durationSeconds) || card.durationSeconds <= 0))
    ) {
      diagnostics.push(
        diagnostic(
          'content-card-invalid',
          'warning',
          `Content card ${index + 1} is invalid.`,
        ),
      );
      return [];
    }
    return [
      {
        ...card,
        title:
          title || (card.type === 'announcement' ? 'Announcement' : 'Card'),
        lines,
        ...(card.featured === undefined
          ? {}
          : { featured: compactText(card.featured) }),
        ...(card.details === undefined
          ? {}
          : { details: card.details.map(compactText).filter(Boolean) }),
      },
    ];
  });
  return { cards: normalized, diagnostics };
}

export function compactDirections(value: string): readonly string[] {
  const description = compactText(value);
  if (description.length === 0) return [];
  return description
    .split(/(?<=[.!?])\s+/)
    .map((line) =>
      /^give stitch reference material to produce your own website design layout\.?$/i.test(
        compactText(line),
      )
        ? 'Use references to design your website layout.'
        : compactText(line),
    )
    .filter(Boolean)
    .slice(0, 2);
}

function objectiveCard(
  item: NormalizedCourseworkItem,
  title: string,
): ContentCard {
  const unit = assignmentUnitLabel(item.title);
  const details = [
    ...(unit === undefined ? [] : [`Unit ${unit} focus.`]),
    ...compactDirections(item.description),
    classroomFollowUp,
    ...(item.dueLabel === undefined || item.dueLabel.length === 0
      ? []
      : [`Due ${item.dueLabel}.`]),
  ];
  return {
    type: 'objective',
    title,
    featured: item.title || 'Upcoming Classroom assignment',
    details,
    accent: 'warm',
    durationSeconds: 12,
    ...(item.dueDate === undefined ? {} : { dueDate: item.dueDate }),
    lines: [item.title || 'Upcoming Classroom assignment', ...details],
  };
}

/** Legacy objective selection: strongest unit group (max three), else first two. */
export function objectiveCardsForCoursework(
  coursework: readonly NormalizedCourseworkItem[],
): readonly ContentCard[] {
  const upcoming = coursework.filter((item) => item.bucket === 'upcoming');
  if (upcoming.length === 0) return [];
  const groups = new Map<
    string,
    {
      readonly label: string;
      readonly firstIndex: number;
      readonly items: NormalizedCourseworkItem[];
      readonly titles: Set<string>;
    }
  >();
  for (const [index, item] of upcoming.entries()) {
    const unit = assignmentUnitLabel(item.title);
    if (unit === undefined) continue;
    const key = unit.toLowerCase();
    const group = groups.get(key) ?? {
      label: unit,
      firstIndex: index,
      items: [],
      titles: new Set<string>(),
    };
    if (!group.titles.has(item.title)) {
      group.titles.add(item.title);
      group.items.push(item);
    }
    groups.set(key, group);
  }
  const selected =
    [...groups.values()]
      .sort(
        (left, right) =>
          right.titles.size - left.titles.size ||
          left.firstIndex - right.firstIndex,
      )[0]
      ?.items.slice(0, 3) ?? upcoming.slice(0, 2);
  const multiple = selected.length > 1;
  return selected.map((item, index) =>
    objectiveCard(
      item,
      multiple ? `Objective ${index + 1}` : "Today's objective",
    ),
  );
}

function isStaticObjective(card: ContentCard): boolean {
  const title = compactText(card.title).toLowerCase();
  return (
    card.type === 'objective' &&
    (title === "today's objective" || title === "today's objectives")
  );
}

/** Resolve ordered static cards, generated objectives, and final vocabulary. */
export function resolveClassContent(options: {
  readonly configuration: ContentConfiguration;
  readonly date: IsoDate;
  readonly classId: ClassId;
  readonly coursework?: readonly NormalizedCourseworkItem[];
  readonly courseworkFresh?: boolean;
  readonly vocabularyCard?: ContentCard;
}): ResolvedClassContent {
  const key = options.classId as string;
  const defaults = options.configuration.defaults?.[key]?.items ?? [];
  const byDate = options.configuration.dateOverrides?.[options.date]?.[key];
  const byLegacyNesting =
    options.configuration.dateOverrides?.[key]?.[options.date];
  const legacy =
    options.configuration.legacyDateOverrides?.[key]?.[options.date];
  const override = byDate ?? byLegacyNesting ?? legacy;
  const staticCards = [...defaults, ...(override?.items ?? [])];
  const fresh = options.courseworkFresh === true;
  const generated = fresh
    ? objectiveCardsForCoursework(options.coursework ?? [])
    : [];
  const stale = options.coursework !== undefined && !fresh;
  const preserved = staticCards.filter((card) => {
    const type = card.type;
    const title = compactText(card.title).toLowerCase();
    if (hiddenTypes.has(type) || hiddenTitles.has(title)) return false;
    if (isStaticObjective(card) && (generated.length > 0 || stale))
      return false;
    return true;
  });
  const normalized = normalizeContentCards([
    ...generated,
    ...preserved,
    ...(options.vocabularyCard === undefined ? [] : [options.vocabularyCard]),
  ]);
  return {
    items: normalized.cards,
    source:
      generated.length > 0
        ? 'coursework'
        : override === undefined
          ? 'default'
          : 'date-override',
    diagnostics: [
      ...normalized.diagnostics,
      ...(stale
        ? [
            diagnostic(
              'content-coursework-not-fresh',
              'warning',
              'Stale coursework did not generate objectives.',
            ),
          ]
        : []),
    ],
  };
}
