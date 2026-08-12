import type {
  ContractDiagnostic,
  IsoDate,
  OpaqueId,
} from '../contracts/v1/common.js';
import type { ScreenId } from './identities.js';
import { compactText, diagnostic, stableId } from './pure-values.js';

export interface DisplayCard {
  readonly cardId: OpaqueId;
  readonly type?: string;
  readonly title: string;
  readonly body?: string;
  readonly lines?: readonly string[];
  readonly accent?: string;
  readonly durationSeconds?: number;
}

export interface ClassDisplayOverride {
  readonly cards?: readonly DisplayCard[];
  readonly cardsMode?: 'append' | 'replace';
  readonly hideAssignments?: boolean;
  readonly dismissalMessage?: string;
}

export interface ScopedDisplayOverride {
  readonly screenId: ScreenId;
  readonly date: IsoDate;
  readonly announcement?: DisplayCard | string;
  readonly simulator?: {
    readonly forcedState?: string;
    readonly forcedMeetingId?: OpaqueId;
  };
  /** Keys may be meeting IDs or class IDs; meeting lookup wins. */
  readonly classes?: Readonly<Record<string, ClassDisplayOverride>>;
}

export interface DisplayContentModel {
  readonly announcement?: DisplayCard;
  readonly cards: readonly DisplayCard[];
  readonly assignmentsVisible: boolean;
  readonly dismissalMessage?: string;
  readonly simulator?: {
    readonly forcedState: string;
    readonly forcedMeetingId: OpaqueId | '';
  };
}

function announcementCard(
  value: DisplayCard | string,
): DisplayCard | undefined {
  if (typeof value !== 'string') return structuredClone(value);
  const text = compactText(value);
  return text.length === 0
    ? undefined
    : {
        cardId: stableId('announcement', text),
        type: 'announcement',
        title: 'Announcement',
        lines: [text],
        accent: 'warm',
        durationSeconds: 12,
      };
}

/** Apply one display/date scope; meeting overrides precede class overrides. */
export function applyScopedOverride(options: {
  readonly model: DisplayContentModel;
  readonly override?: ScopedDisplayOverride;
  readonly screenId: ScreenId;
  readonly date: IsoDate;
  readonly classId?: OpaqueId;
  readonly meetingId?: OpaqueId;
}): {
  readonly model: DisplayContentModel;
  readonly diagnostics: readonly ContractDiagnostic[];
} {
  const override = options.override;
  const base = structuredClone(options.model);
  if (override === undefined) return { model: base, diagnostics: [] };
  if (
    override.screenId !== options.screenId ||
    override.date !== options.date
  ) {
    return {
      model: base,
      diagnostics: [
        diagnostic(
          'override-scope-mismatch',
          'warning',
          'The override did not match the display and date scope.',
        ),
      ],
    };
  }

  const classes = override.classes ?? {};
  const classOverride =
    (options.meetingId === undefined
      ? undefined
      : classes[options.meetingId]) ??
    (options.classId === undefined ? undefined : classes[options.classId]) ??
    {};
  const announcement =
    override.announcement === undefined
      ? undefined
      : announcementCard(override.announcement);
  const classCards = classOverride.cards ?? [];
  const scopedCards =
    classOverride.cardsMode === 'replace'
      ? classCards
      : [...base.cards, ...classCards];
  const visibleCards =
    classOverride.hideAssignments === true
      ? scopedCards.filter((card) => {
          const type = compactText(card.type).toLowerCase();
          const title = compactText(card.title).toLowerCase();
          return (
            type !== 'objective' &&
            title !== "today's objective" &&
            title !== "today's objectives"
          );
        })
      : scopedCards;
  const cards = [
    ...(announcement === undefined ? [] : [announcement]),
    ...visibleCards,
  ];
  return {
    model: {
      ...base,
      ...(announcement === undefined ? {} : { announcement }),
      cards,
      assignmentsVisible:
        classOverride.hideAssignments === true
          ? false
          : base.assignmentsVisible,
      ...(compactText(classOverride.dismissalMessage).length === 0
        ? {}
        : {
            dismissalMessage: compactText(classOverride.dismissalMessage),
          }),
      ...(override.simulator === undefined
        ? {}
        : {
            simulator: {
              forcedState: compactText(override.simulator.forcedState),
              forcedMeetingId:
                override.simulator.forcedMeetingId === undefined
                  ? ''
                  : override.simulator.forcedMeetingId,
            },
          }),
    },
    diagnostics: [],
  };
}
