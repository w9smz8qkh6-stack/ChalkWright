import type {
  IsoDate,
  IsoInstant,
  OpaqueId,
} from '../../contracts/v1/common.js';
import {
  displayStates,
  type DisplayStateCase,
} from '../../contracts/v1/display.js';
import type { ClassId, ScreenId } from '../../domain/identities.js';
import {
  applyScopedOverride,
  type DisplayContentModel,
  type ScopedDisplayOverride,
} from '../../domain/overrides.js';
import type { EffectiveDayPlan } from '../../domain/plans.js';
import { resolveAttendanceLink } from '../../domain/attendance.js';
import {
  isIsoDate,
  isIsoInstant,
  isNonEmptyString,
  isScopedDisplayOverride,
} from '../../domain/runtime-validation.js';
import { composePreview } from '../read-only/composition.js';
import {
  selectDisplayState,
  selectNextClassDay,
} from '../read-only/state-machine.js';
import type {
  AssetMetadata,
  DisplayDescriptor,
  DisplayAttendanceSource,
  DisplayContentSource,
  DisplayFixtureData,
  DisplayHoldStore,
  DisplayOverrideStore,
  DisplayPlanResult,
  DisplayPlanSource,
  DisplayPlanStore,
  DisplayNextClassDaySource,
  DisplayPreviewResult,
  DisplayTargetResult,
  HoldCommand,
  HoldReleaseCommand,
  HoldScope,
  HoldSnapshot,
  MediaMetadata,
  RuntimeHealth,
  RuntimeReadiness,
} from './contracts.js';

const emptyContent: DisplayContentModel = {
  cards: [],
  assignmentsVisible: true,
};

function diagnostic(code: string, message: string) {
  return { code, severity: 'warning' as const, message };
}

function scopeMatchesPlan(scope: HoldScope, plan: EffectiveDayPlan): boolean {
  return (
    scope.date === plan.date &&
    scope.screenId === plan.screenId &&
    scope.roomId === plan.roomId &&
    scope.planId === plan.effectivePlanId &&
    plan.meetings.some((meeting) => meeting.meetingId === scope.meetingId)
  );
}

function isHoldScope(value: HoldScope): boolean {
  return (
    isIsoDate(value.date) &&
    isNonEmptyString(value.screenId) &&
    isNonEmptyString(value.roomId) &&
    isNonEmptyString(value.classId) &&
    isNonEmptyString(value.meetingId) &&
    isNonEmptyString(value.planId)
  );
}

export class DisplayRuntimeInputError extends Error {
  constructor(readonly code: string) {
    super(`Display runtime request rejected: ${code}`);
    this.name = 'DisplayRuntimeInputError';
  }
}

/** Transport-neutral B407 application controller; HTTP owns authentication and serialization. */
export class FixtureBackedDisplayController {
  private readonly degradedScreens = new Set<ScreenId>();

  constructor(
    private readonly dependencies: {
      readonly data: DisplayFixtureData;
      readonly plans: DisplayPlanSource;
      readonly planStore: DisplayPlanStore;
      readonly overrides: DisplayOverrideStore;
      readonly holds: DisplayHoldStore;
      readonly content?: DisplayContentSource;
      readonly attendance?: DisplayAttendanceSource;
      readonly nextClassDays?: DisplayNextClassDaySource;
      readonly dateForInstant?: (instant: IsoInstant) => IsoDate;
    },
  ) {}

  listDisplays(): readonly DisplayDescriptor[] {
    return structuredClone(this.dependencies.data.displays);
  }

  async getPlan(screenId: ScreenId, date: IsoDate): Promise<DisplayPlanResult> {
    return this.resolvePlan(screenId, date, true);
  }

  private async resolvePlan(
    screenId: ScreenId,
    date: IsoDate,
    persistCurrent: boolean,
  ): Promise<DisplayPlanResult> {
    const display = this.requireDisplay(screenId);
    if (!isIsoDate(date)) throw new DisplayRuntimeInputError('date-invalid');
    try {
      const plan = await this.dependencies.plans.read(screenId, date);
      if (
        plan.screenId !== screenId ||
        plan.roomId !== display.roomId ||
        plan.date !== date
      )
        throw new Error('synthetic-plan-scope-mismatch');
      if (persistCurrent) {
        const written = await this.dependencies.planStore.write(plan);
        if (written.status === 'rejected')
          throw new Error('synthetic-plan-persistence-rejected');
        this.degradedScreens.delete(screenId);
      }
      return {
        plan: structuredClone(plan),
        source: 'current',
        degraded: false,
        diagnostics: [],
      };
    } catch (error) {
      if (error instanceof DisplayRuntimeInputError) throw error;
      const prior = await this.dependencies.planStore.read({
        screenId,
        roomId: display.roomId,
        date,
      });
      if (persistCurrent) this.degradedScreens.add(screenId);
      return prior === undefined
        ? {
            source: 'missing',
            degraded: true,
            diagnostics: [
              diagnostic(
                'display-plan-unavailable',
                'No current or last-known-good plan is available.',
              ),
            ],
          }
        : {
            plan: structuredClone(prior),
            source: 'last-known-good',
            degraded: true,
            diagnostics: [
              diagnostic(
                'display-plan-last-known-good',
                'The last-known-good plan is serving while fixture acquisition is unavailable.',
              ),
            ],
          };
    }
  }

  async getTarget(
    screenId: ScreenId,
    evaluatedAt: IsoInstant,
  ): Promise<DisplayTargetResult> {
    if (!isIsoInstant(evaluatedAt))
      throw new DisplayRuntimeInputError('instant-invalid');
    this.dependencies.holds.expire(evaluatedAt);
    const result = await this.getPlan(screenId, this.dateFor(evaluatedAt));
    if (result.plan === undefined)
      return { ...result, evaluatedAt, content: structuredClone(emptyContent) };
    const naturalState = selectDisplayState(result.plan, evaluatedAt, {
      showCheckIn: true,
      morningOverviewUntil: '07:30',
    });
    const override = await this.dependencies.overrides.read(
      screenId,
      result.plan.date,
    );
    const state = this.effectiveState(naturalState, override, result.plan);
    const meetingId = state.currentMeetingId ?? state.nextMeetingId;
    const classId =
      meetingId === undefined
        ? undefined
        : this.dependencies.data.classByMeeting[meetingId];
    const base = await this.contentFor(
      meetingId,
      classId,
      result.plan.date,
      evaluatedAt,
    );
    const overridden = applyScopedOverride({
      model: base,
      screenId,
      date: result.plan.date,
      ...(override === undefined ? {} : { override }),
      ...(classId === undefined ? {} : { classId }),
      ...(meetingId === undefined ? {} : { meetingId }),
    });
    const hold =
      meetingId === undefined || classId === undefined
        ? undefined
        : await this.activeHold(
            {
              date: result.plan.date,
              screenId,
              roomId: result.plan.roomId,
              classId,
              meetingId,
              planId: result.plan.effectivePlanId,
            },
            evaluatedAt,
          );
    const attendanceContext = await this.attendanceFor(
      meetingId,
      classId,
      result.plan.date,
    );
    const links = attendanceContext?.links;
    const qrTarget =
      links === undefined ? undefined : resolveAttendanceLink(links).url;
    const attendanceClassCode = attendanceContext?.classCode;
    const nextClassDay = await this.nextClassDayFor(result.plan);
    return {
      ...result,
      evaluatedAt,
      state,
      ...(meetingId === undefined ? {} : { meetingId }),
      ...(classId === undefined ? {} : { classId }),
      content: overridden.model,
      ...(attendanceContext?.summary === undefined
        ? {}
        : {
            attendance: structuredClone(attendanceContext.summary),
          }),
      ...(qrTarget === undefined ? {} : { qrTarget }),
      ...(attendanceClassCode === undefined ? {} : { attendanceClassCode }),
      ...(hold === undefined ? {} : { hold }),
      nextClassDayLabel: nextClassDay.label,
      ...(nextClassDay.plan === undefined
        ? {}
        : { nextClassDayPlan: structuredClone(nextClassDay.plan) }),
      diagnostics: [...result.diagnostics, ...overridden.diagnostics],
    };
  }

  async getPreview(
    screenId: ScreenId,
    evaluatedAt: IsoInstant,
    proposedOverride?: ScopedDisplayOverride,
  ): Promise<DisplayPreviewResult> {
    if (!isIsoInstant(evaluatedAt))
      throw new DisplayRuntimeInputError('instant-invalid');
    if (
      proposedOverride !== undefined &&
      !isScopedDisplayOverride(proposedOverride)
    )
      throw new DisplayRuntimeInputError('override-invalid');
    const result = await this.resolvePlan(
      screenId,
      this.dateFor(evaluatedAt),
      false,
    );
    if (result.plan === undefined)
      return {
        ...result,
        evaluatedAt,
        content: structuredClone(emptyContent),
        timeline: [],
      };
    const naturalState = selectDisplayState(result.plan, evaluatedAt, {
      showCheckIn: true,
      morningOverviewUntil: '07:30',
    });
    const saved =
      proposedOverride ??
      (await this.dependencies.overrides.read(screenId, result.plan.date));
    const state = this.effectiveState(naturalState, saved, result.plan);
    const meetingId = state.currentMeetingId ?? state.nextMeetingId;
    const classId =
      meetingId === undefined
        ? undefined
        : this.dependencies.data.classByMeeting[meetingId];
    const base = await this.contentFor(
      meetingId,
      classId,
      result.plan.date,
      evaluatedAt,
    );
    const preview = composePreview({
      plans: [result.plan],
      screenId,
      evaluatedAt,
      content: base,
      ...(classId === undefined ? {} : { classId }),
      ...(meetingId === undefined ? {} : { meetingId }),
      ...(saved === undefined ? {} : { override: saved }),
      statePolicy: { showCheckIn: true, morningOverviewUntil: '07:30' },
    });
    const overridden = applyScopedOverride({
      model: base,
      screenId,
      date: result.plan.date,
      ...(saved === undefined ? {} : { override: saved }),
      ...(classId === undefined ? {} : { classId }),
      ...(meetingId === undefined ? {} : { meetingId }),
    });
    const attendanceContext = await this.attendanceFor(
      meetingId,
      classId,
      result.plan.date,
    );
    const links = attendanceContext?.links;
    const qrTarget =
      links === undefined ? undefined : resolveAttendanceLink(links).url;
    const attendanceClassCode = attendanceContext?.classCode;
    const nextClassDay = await this.nextClassDayFor(result.plan);
    return {
      ...result,
      evaluatedAt,
      state,
      ...(meetingId === undefined ? {} : { meetingId }),
      ...(classId === undefined ? {} : { classId }),
      content: overridden.model,
      timeline: preview.timeline,
      ...(preview.originalPlan === undefined
        ? {}
        : { originalPlan: preview.originalPlan }),
      ...(preview.effectivePlan === undefined
        ? {}
        : { effectivePlan: preview.effectivePlan }),
      forcedTarget: state,
      nextClassDayLabel: nextClassDay.label,
      ...(nextClassDay.plan === undefined
        ? {}
        : { nextClassDayPlan: structuredClone(nextClassDay.plan) }),
      ...(attendanceContext?.summary === undefined
        ? {}
        : {
            attendance: structuredClone(attendanceContext.summary),
          }),
      ...(qrTarget === undefined ? {} : { qrTarget }),
      ...(attendanceClassCode === undefined ? {} : { attendanceClassCode }),
      diagnostics: [
        ...result.diagnostics,
        ...preview.diagnostics,
        ...overridden.diagnostics,
      ],
    };
  }

  private dateFor(instant: IsoInstant): IsoDate {
    const date =
      this.dependencies.dateForInstant?.(instant) ?? instant.slice(0, 10);
    if (!isIsoDate(date)) throw new DisplayRuntimeInputError('date-invalid');
    return date as IsoDate;
  }

  private async contentFor(
    meetingId: OpaqueId | undefined,
    classId: ClassId | undefined,
    date: IsoDate,
    observedAt: IsoInstant,
  ): Promise<DisplayContentModel> {
    if (meetingId === undefined) return structuredClone(emptyContent);
    if (classId !== undefined && this.dependencies.content !== undefined) {
      try {
        const dynamic = await this.dependencies.content.read(
          classId,
          date,
          observedAt,
        );
        if (dynamic !== undefined) return structuredClone(dynamic);
      } catch {
        // A corrupt/unavailable enrichment cache degrades to local static content.
      }
    }
    return structuredClone(
      this.dependencies.data.contentByMeeting[meetingId] ?? emptyContent,
    );
  }

  private async attendanceFor(
    meetingId: OpaqueId | undefined,
    classId: ClassId | undefined,
    date: IsoDate,
  ) {
    if (meetingId === undefined) return undefined;
    const local = {
      ...(this.dependencies.data.attendanceByMeeting[meetingId] === undefined
        ? {}
        : { summary: this.dependencies.data.attendanceByMeeting[meetingId] }),
      ...(this.dependencies.data.attendanceLinksByMeeting[meetingId] ===
      undefined
        ? {}
        : {
            links: this.dependencies.data.attendanceLinksByMeeting[meetingId],
          }),
      ...(this.dependencies.data.attendanceClassCodeByMeeting[meetingId] ===
      undefined
        ? {}
        : {
            classCode:
              this.dependencies.data.attendanceClassCodeByMeeting[meetingId],
          }),
    };
    if (this.dependencies.attendance !== undefined) {
      try {
        const dynamic = await this.dependencies.attendance.read(
          meetingId,
          classId,
          date,
        );
        if (dynamic !== undefined)
          return structuredClone({ ...local, ...dynamic });
      } catch {
        // A corrupt/unavailable aggregate degrades only the attendance elements.
      }
    }
    return Object.keys(local).length === 0 ? undefined : structuredClone(local);
  }

  private async nextClassDayFor(plan: EffectiveDayPlan) {
    const local = selectNextClassDay(
      plan.date,
      plan.screenId,
      this.dependencies.data.nextClassDayPlans,
    );
    if (
      local.plan !== undefined ||
      this.dependencies.nextClassDays === undefined
    )
      return local;
    try {
      const dynamic = await this.dependencies.nextClassDays.readAfter(
        plan.screenId,
        plan.roomId,
        plan.date,
      );
      return selectNextClassDay(
        plan.date,
        plan.screenId,
        dynamic === undefined ? [] : [dynamic],
      );
    } catch {
      return local;
    }
  }

  getOverride(screenId: ScreenId, date: IsoDate) {
    this.requireDisplay(screenId);
    if (!isIsoDate(date)) throw new DisplayRuntimeInputError('date-invalid');
    return this.dependencies.overrides.read(screenId, date);
  }

  async putOverride(
    value: ScopedDisplayOverride,
  ): Promise<ScopedDisplayOverride> {
    if (!isScopedDisplayOverride(value))
      throw new DisplayRuntimeInputError('override-invalid');
    this.requireDisplay(value.screenId);
    await this.dependencies.overrides.write(structuredClone(value));
    return structuredClone(value);
  }

  deleteOverride(screenId: ScreenId, date: IsoDate): Promise<boolean> {
    this.requireDisplay(screenId);
    if (!isIsoDate(date)) throw new DisplayRuntimeInputError('date-invalid');
    return this.dependencies.overrides.delete(screenId, date);
  }

  async hold(command: HoldCommand) {
    if (
      !isHoldScope(command) ||
      !isIsoInstant(command.heldAt) ||
      !isNonEmptyString(command.reasonCode) ||
      (command.expiresAt !== undefined &&
        (!isIsoInstant(command.expiresAt) ||
          Date.parse(command.expiresAt) < Date.parse(command.heldAt)))
    )
      throw new DisplayRuntimeInputError('hold-invalid');
    this.requireDisplay(command.screenId);
    const plan = await this.getPlan(command.screenId, command.date);
    if (
      plan.plan === undefined ||
      !scopeMatchesPlan(command, plan.plan) ||
      this.dependencies.data.classByMeeting[command.meetingId] !==
        command.classId
    )
      throw new DisplayRuntimeInputError('hold-scope-mismatch');
    const record = {
      kind: 'hold' as const,
      recordKey: `hold:${command.date}:${command.screenId}:${command.meetingId}:${command.planId}`,
      scope: {
        date: command.date,
        screenId: command.screenId,
        roomId: command.roomId,
        classId: command.classId,
        meetingId: command.meetingId,
        planId: command.planId,
      },
      data: {
        status: 'held' as const,
        heldAt: command.heldAt,
        ...(command.expiresAt === undefined
          ? {}
          : { expiresAt: command.expiresAt }),
        reasonCode: command.reasonCode,
      },
      ...(command.expiresAt === undefined
        ? {}
        : { expiresAt: command.expiresAt }),
    };
    const current = await this.dependencies.holds.read(command);
    const result =
      current === undefined
        ? await this.dependencies.holds.create(record)
        : command.expectedRevision === undefined
          ? {
              status: 'rejected' as const,
              error: {
                category: 'conflict' as const,
                code: 'hold-revision-required',
                message: 'The current hold revision is required.',
                retryable: false,
                diagnostics: [],
              },
            }
          : this.dependencies.holds.transition(
              record,
              command.expectedRevision,
            );
    return result;
  }

  async releaseHold(command: HoldReleaseCommand) {
    if (
      !isHoldScope(command) ||
      !isIsoInstant(command.releasedAt) ||
      !isNonEmptyString(command.reasonCode) ||
      !isNonEmptyString(command.expectedRevision)
    )
      throw new DisplayRuntimeInputError('hold-release-invalid');
    this.requireDisplay(command.screenId);
    const current = await this.dependencies.holds.read(command);
    if (current === undefined || current.record.data.status !== 'held')
      throw new DisplayRuntimeInputError('hold-not-active');
    const { expiresAt: _expiry, ...base } = current.record;
    return this.dependencies.holds.transition(
      {
        ...base,
        data: {
          ...current.record.data,
          status: 'released',
          releasedAt: command.releasedAt,
          reasonCode: command.reasonCode,
        },
      },
      command.expectedRevision,
    );
  }

  expireHolds(at: IsoInstant): number {
    if (!isIsoInstant(at))
      throw new DisplayRuntimeInputError('instant-invalid');
    return this.dependencies.holds.expire(at);
  }

  async getHold(scope: HoldScope): Promise<HoldSnapshot | undefined> {
    if (!isHoldScope(scope))
      throw new DisplayRuntimeInputError('hold-scope-invalid');
    this.requireDisplay(scope.screenId);
    return this.dependencies.holds.read(scope);
  }

  async qrTarget(
    screenId: ScreenId,
    date: IsoDate,
    meetingId: OpaqueId,
  ): Promise<string | undefined> {
    this.requireDisplay(screenId);
    if (!isIsoDate(date) || !isNonEmptyString(meetingId))
      throw new DisplayRuntimeInputError('qr-scope-invalid');
    const plan = await this.getPlan(screenId, date);
    if (
      plan.plan === undefined ||
      !plan.plan.meetings.some((meeting) => meeting.meetingId === meetingId)
    )
      throw new DisplayRuntimeInputError('qr-scope-mismatch');
    const links = (
      await this.attendanceFor(
        meetingId,
        this.dependencies.data.classByMeeting[meetingId],
        date,
      )
    )?.links;
    return links === undefined ? undefined : resolveAttendanceLink(links).url;
  }

  listAssets(): readonly AssetMetadata[] {
    return structuredClone(this.dependencies.data.assets);
  }

  listMedia(): readonly MediaMetadata[] {
    return structuredClone(this.dependencies.data.media);
  }

  health(checkedAt: IsoInstant): RuntimeHealth {
    if (!isIsoInstant(checkedAt))
      throw new DisplayRuntimeInputError('instant-invalid');
    return {
      status: this.degradedScreens.size > 0 ? 'degraded' : 'ok',
      checkedAt,
      displays: this.dependencies.data.displays.length,
      diagnostics:
        this.degradedScreens.size > 0
          ? [
              diagnostic(
                'fixture-source-degraded',
                'Fixture acquisition is degraded; last-known-good state may be serving.',
              ),
            ]
          : [],
    };
  }

  async readiness(checkedAt: IsoInstant): Promise<RuntimeReadiness> {
    if (!isIsoInstant(checkedAt))
      throw new DisplayRuntimeInputError('instant-invalid');
    const date = checkedAt.slice(0, 10);
    const missing: ScreenId[] = [];
    const degraded: ScreenId[] = [];
    for (const display of this.dependencies.data.displays) {
      const result = await this.getPlan(display.screenId, date);
      if (result.plan === undefined) missing.push(display.screenId);
      else if (result.degraded) degraded.push(display.screenId);
    }
    return {
      ready: missing.length === 0 && degraded.length === 0,
      checkedAt,
      missingScreens: missing,
      degradedScreens: degraded,
    };
  }

  private requireDisplay(screenId: ScreenId): DisplayDescriptor {
    const display = this.dependencies.data.displays.find(
      (entry) => entry.screenId === screenId,
    );
    if (display === undefined)
      throw new DisplayRuntimeInputError('screen-not-found');
    return display;
  }

  private effectiveState(
    state: DisplayStateCase,
    override: ScopedDisplayOverride | undefined,
    plan: EffectiveDayPlan,
  ): DisplayStateCase {
    const forced = override?.simulator?.forcedState;
    if (
      forced === undefined ||
      !displayStates.includes(forced as (typeof displayStates)[number])
    )
      return state;
    const forcedMeetingId = override?.simulator?.forcedMeetingId;
    if (
      forcedMeetingId !== undefined &&
      !plan.meetings.some((meeting) => meeting.meetingId === forcedMeetingId)
    )
      throw new DisplayRuntimeInputError('override-forced-meeting-invalid');
    const { currentMeetingId: _current, nextMeetingId: _next, ...base } = state;
    if (forcedMeetingId === undefined)
      return { ...state, state: forced as (typeof displayStates)[number] };
    const usesCurrent =
      forced === 'pre_checkin' ||
      forced === 'in_class_content' ||
      forced === 'dismissal_warning' ||
      forced === 'post_end';
    return {
      ...base,
      state: forced as (typeof displayStates)[number],
      ...(usesCurrent
        ? { currentMeetingId: forcedMeetingId }
        : { nextMeetingId: forcedMeetingId }),
    };
  }

  private async activeHold(
    scope: HoldScope,
    at: IsoInstant,
  ): Promise<HoldSnapshot | undefined> {
    const hold = await this.dependencies.holds.read(scope);
    if (hold?.record.data.status !== 'held') return undefined;
    return hold.record.data.expiresAt !== undefined &&
      Date.parse(hold.record.data.expiresAt) <= Date.parse(at)
      ? undefined
      : hold;
  }
}
