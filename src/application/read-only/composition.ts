import type {
  ContractDiagnostic,
  IsoInstant,
  OpaqueId,
} from '../../contracts/v1/common.js';
import type {
  DisplayState,
  DisplayStateCase,
} from '../../contracts/v1/display.js';
import type { ScreenId } from '../../domain/identities.js';
import type {
  DisplayContentModel,
  ScopedDisplayOverride,
} from '../../domain/overrides.js';
import { applyScopedOverride } from '../../domain/overrides.js';
import type { EffectiveDayPlan } from '../../domain/plans.js';
import {
  selectDisplayState,
  type StateSelectionPolicy,
} from './state-machine.js';

export interface PreviewComposition {
  readonly plan?: EffectiveDayPlan;
  readonly originalPlan?: EffectiveDayPlan;
  readonly effectivePlan?: EffectiveDayPlan;
  readonly state?: DisplayStateCase;
  readonly forcedTarget?: DisplayStateCase;
  readonly timeline: readonly {
    readonly state: DisplayState;
    readonly meetingId: OpaqueId;
    readonly startsAt: IsoInstant;
    readonly endsAt: IsoInstant;
  }[];
  readonly content: DisplayContentModel;
  readonly diagnostics: readonly ContractDiagnostic[];
}

function previewTimeline(
  plan: EffectiveDayPlan,
  showCheckIn: boolean,
): PreviewComposition['timeline'] {
  if (plan.meetings.length === 0) {
    return [{ state: 'no_classes', meetingId: '', startsAt: '', endsAt: '' }];
  }
  const first = plan.meetings[0];
  if (first === undefined) return [];
  const timeline: Array<PreviewComposition['timeline'][number]> = [
    {
      state: 'idle',
      meetingId: '',
      startsAt: '',
      endsAt: first.checkInOpensAt,
    },
  ];
  for (const [index, meeting] of plan.meetings.entries()) {
    const next = plan.meetings[index + 1];
    if (showCheckIn) {
      timeline.push({
        state: 'pre_checkin',
        meetingId: meeting.meetingId,
        startsAt: meeting.checkInOpensAt,
        endsAt: meeting.contentStartsAt,
      });
    }
    timeline.push(
      {
        state: 'in_class_content',
        meetingId: meeting.meetingId,
        startsAt: showCheckIn
          ? meeting.contentStartsAt
          : meeting.checkInOpensAt,
        endsAt: meeting.dismissalStartsAt,
      },
      {
        state: 'dismissal_warning',
        meetingId: meeting.meetingId,
        startsAt: meeting.dismissalStartsAt,
        endsAt: meeting.officialEndsAt,
      },
      {
        state: 'post_end',
        meetingId: meeting.meetingId,
        startsAt: meeting.officialEndsAt,
        endsAt:
          next === undefined
            ? ''
            : showCheckIn
              ? next.checkInOpensAt
              : next.contentStartsAt,
      },
    );
  }
  timeline.push({
    state: 'day_complete',
    meetingId: '',
    startsAt: plan.meetings.at(-1)?.officialEndsAt ?? '',
    endsAt: '',
  });
  return timeline;
}

/** Pure preview composition accepts values only and therefore has no mutation capability. */
export function composePreview(options: {
  readonly plans: readonly EffectiveDayPlan[];
  readonly screenId: ScreenId;
  readonly evaluatedAt: IsoInstant;
  readonly classId?: OpaqueId;
  readonly meetingId?: OpaqueId;
  readonly content: DisplayContentModel;
  readonly override?: ScopedDisplayOverride;
  readonly statePolicy: StateSelectionPolicy;
}): PreviewComposition {
  const plan = options.plans.find(
    (candidate) =>
      candidate.screenId === options.screenId &&
      candidate.date === options.evaluatedAt.slice(0, 10),
  );
  if (plan === undefined)
    return {
      content: structuredClone(options.content),
      timeline: [],
      diagnostics: [
        {
          code: 'preview-plan-missing',
          severity: 'warning',
          message: 'No plan matches the requested screen and date.',
        },
      ],
    };
  const overridden = applyScopedOverride({
    model: options.content,
    screenId: options.screenId,
    date: plan.date,
    ...(options.override === undefined ? {} : { override: options.override }),
    ...(options.classId === undefined ? {} : { classId: options.classId }),
    ...(options.meetingId === undefined
      ? {}
      : { meetingId: options.meetingId }),
  });
  const state = selectDisplayState(
    plan,
    options.evaluatedAt,
    options.statePolicy,
  );
  const cloned = structuredClone(plan);
  return {
    plan: cloned,
    originalPlan: structuredClone(plan),
    effectivePlan: structuredClone(plan),
    state,
    forcedTarget: state,
    timeline: previewTimeline(plan, options.statePolicy.showCheckIn),
    content: overridden.model,
    diagnostics: [
      ...plan.diagnostics,
      ...(plan.meetings.length === 0
        ? [
            {
              code: 'preview-plan-empty',
              severity: 'warning' as const,
              message: 'No classes are scheduled for this display and date.',
            },
          ]
        : []),
      ...overridden.diagnostics,
    ],
  };
}
