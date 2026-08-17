import type { IsoDate, IsoInstant, OpaqueId } from '../contracts/v1/common.js';
import type { DayPlanMeeting } from '../contracts/v1/day-plan.js';
import {
  courseKeyFromSectionCode,
  type ClassId,
  type RoomId,
  type ScreenId,
} from '../domain/identities.js';
import type {
  DisplayCard,
  ScopedDisplayOverride,
} from '../domain/overrides.js';
import type { EffectiveDayPlan } from '../domain/plans.js';
import { isIsoDate, isIsoInstant } from '../domain/runtime-validation.js';
import {
  type FixtureBackedDisplayController,
  DisplayRuntimeInputError,
} from '../application/display/controller.js';
import type { DisplayTargetResult } from '../application/display/contracts.js';
import type { HoldSnapshot } from '../application/display/contracts.js';
import { qrPng } from '../application/display/qr-png.js';
import type {
  ClassroomHttpController,
  ClassroomHttpControllerRequest,
  ClassroomHttpControllerResult,
} from '../infrastructure/http/types.js';
import {
  displayDateLabel,
  displayDocumentTitle,
  renderDisplayPage,
  renderDisplayScene,
  renderOperatorHoldPage,
  renderOperatorOverridePage,
  renderOperatorPreviewPage,
  type DisplayPresentationModel,
  type OperatorScopeModel,
  type PresentationCard,
  type PresentationMeeting,
} from '../presentation/index.js';

const defaultInstant = '2035-04-13T08:00:00Z';

export interface MvpRuntimeClock {
  now(): IsoInstant;
}

function asInstant(value: string | undefined): IsoInstant | undefined {
  if (value === undefined) return undefined;
  const normalized = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/u.test(value)
    ? `${value.length === 16 ? `${value}:00` : value}Z`
    : value;
  return isIsoInstant(normalized) ? normalized : undefined;
}

function evaluatedAt(
  request: ClassroomHttpControllerRequest,
  clock: MvpRuntimeClock,
): IsoInstant {
  const preview =
    request.kind === 'preview' ||
    request.kind === 'preview-data' ||
    (request.kind === 'target' && request.simulation === true);
  if (!preview) {
    if (request.query.now !== undefined || request.query.preview !== undefined)
      throw new DisplayRuntimeInputError('preview-query-not-allowed');
    return clock.now();
  }
  const value = asInstant(request.query.now);
  if (request.query.now !== undefined && value === undefined)
    throw new DisplayRuntimeInputError('instant-invalid');
  if (value !== undefined) return value;
  const date = request.query.date;
  if (date !== undefined) {
    if (!isIsoDate(date)) throw new DisplayRuntimeInputError('date-invalid');
    return `${date}T08:00:00Z`;
  }
  return defaultInstant;
}

export function presentationCourseLabel(meeting: DayPlanMeeting): string {
  const labels: Readonly<Record<string, string>> = {
    'course-a': 'Web Design',
    'course-b': 'Robotics',
  };
  const fixtureLabel = labels[meeting.courseKey];
  if (fixtureLabel !== undefined) return fixtureLabel;
  const parenthesized = /^(.*?)\s+\(([^()]+)\)$/u.exec(meeting.blockLabel);
  if (
    parenthesized !== null &&
    parenthesized[1]!.trim().length > 0 &&
    courseKeyFromSectionCode(parenthesized[2]) === meeting.courseKey
  )
    return parenthesized[1]!.trim();
  return courseKeyFromSectionCode(meeting.blockLabel) === meeting.courseKey
    ? meeting.courseKey
    : meeting.blockLabel;
}

function presentationMeeting(meeting: DayPlanMeeting): PresentationMeeting {
  return {
    meetingId: meeting.meetingId,
    courseLabel: presentationCourseLabel(meeting),
    blockLabel: meeting.blockLabel,
    checkInOpensAt: meeting.checkInOpensAt,
    officialStartsAt: meeting.officialStartsAt,
    contentStartsAt: meeting.contentStartsAt,
    dismissalStartsAt: meeting.dismissalStartsAt,
    officialEndsAt: meeting.officialEndsAt,
  };
}

export function presentationCard(card: DisplayCard): PresentationCard {
  const type =
    card.type === 'announcement' ||
    card.type === 'bellringer' ||
    card.type === 'objective' ||
    card.type === 'vocabulary'
      ? card.type
      : 'generic';
  const accent =
    card.accent === 'warm' ||
    card.accent === 'calm' ||
    card.accent === 'bright' ||
    card.accent === 'ink'
      ? card.accent
      : 'ink';
  const lines = card.lines ?? (card.body === undefined ? [] : [card.body]);
  const structuredObjectiveLines =
    card.type === 'objective' &&
    card.featured !== undefined &&
    card.details !== undefined &&
    lines.length === card.details.length + 1 &&
    lines[0] === card.featured &&
    card.details.every((detail, index) => lines[index + 1] === detail);
  return {
    cardId: card.cardId,
    type,
    title: card.title,
    lines: structuredObjectiveLines ? [] : lines,
    ...(card.featured === undefined ? {} : { featured: card.featured }),
    ...(card.details === undefined ? {} : { details: card.details }),
    accent,
    ...(card.durationSeconds === undefined
      ? {}
      : { durationSeconds: card.durationSeconds }),
    ...(card.vocabulary === undefined
      ? {}
      : { vocabulary: structuredClone(card.vocabulary) }),
  };
}

function findMeeting(
  plan: EffectiveDayPlan,
  meetingId: OpaqueId | undefined,
): DayPlanMeeting | undefined {
  return meetingId === undefined
    ? undefined
    : plan.meetings.find((meeting) => meeting.meetingId === meetingId);
}

function requirePresentation(
  target: DisplayTargetResult,
  basePath: '' | '/classroom-screen' = '',
  dismissalMediaAvailable = true,
): DisplayPresentationModel {
  if (target.plan === undefined || target.state === undefined)
    throw new DisplayRuntimeInputError('display-unavailable');
  const current = findMeeting(target.plan, target.state.currentMeetingId);
  const next = findMeeting(target.plan, target.state.nextMeetingId);
  const attendanceUrl = target.qrTarget;
  return {
    basePath,
    screenId: target.plan.screenId,
    planId: target.plan.effectivePlanId,
    date: target.plan.date,
    timeZone: target.plan.timeZone,
    evaluatedAt: target.evaluatedAt,
    state: target.state.state,
    dismissalMediaAvailable,
    meetings: target.plan.meetings.map(presentationMeeting),
    cards: target.content.cards.map(presentationCard),
    ...(current === undefined
      ? {}
      : { currentMeeting: presentationMeeting(current) }),
    ...(next === undefined ? {} : { nextMeeting: presentationMeeting(next) }),
    ...(attendanceUrl === undefined &&
    target.attendanceClassCode === undefined &&
    target.attendance === undefined
      ? {}
      : {
          attendance: {
            ...(attendanceUrl === undefined || target.meetingId === undefined
              ? {}
              : {
                  checkInUrl: attendanceUrl,
                  qrUrl: `${basePath}/qr/${encodeURIComponent(target.plan.screenId)}/${encodeURIComponent(target.meetingId)}.png?date=${encodeURIComponent(target.plan.date)}`,
                }),
            ...(target.attendanceClassCode === undefined
              ? {}
              : { classCode: target.attendanceClassCode }),
            ...(target.attendance?.responseCount === undefined
              ? {}
              : { responseCount: target.attendance.responseCount }),
            ...(target.attendance?.rosterCount === undefined
              ? {}
              : { rosterCount: target.attendance.rosterCount }),
            ...(target.attendance?.presentCount === undefined
              ? {}
              : { presentCount: target.attendance.presentCount }),
            ...(target.attendance?.tardyCount === undefined
              ? {}
              : { tardyCount: target.attendance.tardyCount }),
            ...(target.attendance?.absentCount === undefined
              ? {}
              : { absentCount: target.attendance.absentCount }),
          },
        }),
    ...(target.content.announcement === undefined
      ? {}
      : {
          announcement:
            target.content.announcement.lines?.join(' ') ??
            target.content.announcement.title,
        }),
    ...(target.content.dismissalMessage === undefined
      ? {}
      : { dismissalMessage: target.content.dismissalMessage }),
    ...(target.hold === undefined
      ? {}
      : {
          hold: {
            status: target.hold.record.data.status,
            meetingId: target.hold.record.scope.meetingId ?? '',
            reasonCode: target.hold.record.data.reasonCode,
            revision: target.hold.revision,
            ...(target.hold.record.data.expiresAt === undefined
              ? {}
              : { expiresAt: target.hold.record.data.expiresAt }),
          },
        }),
    nextClassDayLabel: target.nextClassDayLabel ?? 'Next Class Day',
    ...(target.nextClassDayPlan === undefined
      ? {}
      : {
          nextClassDayDate: target.nextClassDayPlan.date,
          nextClassDayMeetings:
            target.nextClassDayPlan.meetings.map(presentationMeeting),
        }),
    degraded: target.degraded,
    diagnostics: target.diagnostics,
  };
}

function presentationHold(snapshot: HoldSnapshot) {
  return {
    status: snapshot.record.data.status,
    meetingId: snapshot.record.scope.meetingId ?? '',
    reasonCode: snapshot.record.data.reasonCode,
    revision: snapshot.revision,
    ...(snapshot.record.data.expiresAt === undefined
      ? {}
      : { expiresAt: snapshot.record.data.expiresAt }),
  } as const;
}

function json(value: unknown, status?: number): ClassroomHttpControllerResult {
  return { kind: 'json', value, ...(status === undefined ? {} : { status }) };
}

function html(value: string): ClassroomHttpControllerResult {
  return { kind: 'html', value };
}

function resultStatus(value: unknown): number {
  return typeof value === 'object' &&
    value !== null &&
    'status' in value &&
    value.status === 'rejected'
    ? 409
    : 200;
}

export class B407MvpHttpController implements ClassroomHttpController {
  constructor(
    private readonly display: FixtureBackedDisplayController,
    private readonly mediaReady: boolean,
    private readonly clock: MvpRuntimeClock = { now: () => defaultInstant },
    private readonly basePath: '' | '/classroom-screen' = '',
  ) {}

  async handle(
    request: ClassroomHttpControllerRequest,
    context: { readonly signal: AbortSignal },
  ): Promise<ClassroomHttpControllerResult | undefined> {
    if (context.signal.aborted)
      return json({ error: { code: 'aborted' } }, 503);
    try {
      return await this.dispatch(request);
    } catch (error) {
      if (!(error instanceof DisplayRuntimeInputError)) throw error;
      const status =
        error.code === 'screen-not-found' ||
        error.code === 'display-unavailable' ||
        error.code === 'hold-not-active'
          ? 404
          : error.code.includes('conflict')
            ? 409
            : 400;
      return json(
        { error: { code: error.code, message: 'Request rejected.' } },
        status,
      );
    }
  }

  private async dispatch(
    request: ClassroomHttpControllerRequest,
  ): Promise<ClassroomHttpControllerResult | undefined> {
    if (request.kind === 'displays') return json(this.display.listDisplays());
    if (request.kind === 'manifest')
      return {
        kind: 'binary',
        value: Buffer.from(
          JSON.stringify({
            name: 'Chalkwright',
            short_name: 'Chalkwright',
            start_url: `${this.basePath}/tv`,
            display: 'standalone',
            background_color: '#101827',
            theme_color: '#101827',
            icons: [
              {
                src: `${this.basePath}/assets/chalkwright.svg`,
                sizes: 'any',
                type: 'image/svg+xml',
                purpose: 'any maskable',
              },
            ],
          }),
        ),
        contentType: 'application/manifest+json; charset=utf-8',
      };
    if (request.kind === 'health')
      return json(this.display.health(evaluatedAt(request, this.clock)));
    if (request.kind === 'readiness') {
      const readiness = await this.display.readiness(
        evaluatedAt(request, this.clock),
      );
      const ready = readiness.ready;
      return json(
        {
          ...readiness,
          ready,
          dependencies: {
            fixturePlans: readiness.ready,
            dismissalMedia: this.mediaReady,
          },
        },
        ready ? 200 : 503,
      );
    }

    if ('screenId' in request) {
      const screenId = request.screenId as ScreenId;
      const at = evaluatedAt(request, this.clock);
      if (request.kind === 'day-plan') {
        const date = request.query.date ?? at.slice(0, 10);
        if (!isIsoDate(date))
          throw new DisplayRuntimeInputError('date-invalid');
        return json(await this.display.getPlan(screenId, date));
      }
      if (request.kind === 'display' || request.kind === 'target') {
        const target = await this.display.getTarget(screenId, at);
        const model = requirePresentation(
          target,
          this.basePath,
          this.mediaReady,
        );
        if (request.kind === 'display') return html(renderDisplayPage(model));
        return json({
          ...target,
          stateCase: target.state,
          state: target.state?.state ?? '',
          presentationHtml: renderDisplayScene(model),
          meetingId: target.meetingId ?? '',
          courseLabel:
            model.currentMeeting?.courseLabel ??
            model.nextMeeting?.courseLabel ??
            '',
          bellEndsAt:
            model.state === 'in_class_content'
              ? (model.currentMeeting?.officialEndsAt ?? '')
              : '',
          dateLabel: displayDateLabel(model.date, model.timeZone),
          documentTitle: displayDocumentTitle(model),
          degraded: target.degraded === true,
        });
      }
      if (request.kind === 'preview') {
        const proposed = request.query.override;
        if (proposed !== undefined)
          throw new DisplayRuntimeInputError('preview-override-query-invalid');
        const preview = await this.display.getPreview(screenId, at);
        const model = requirePresentation(
          preview,
          this.basePath,
          this.mediaReady,
        );
        if (request.query.view === 'display')
          return html(renderDisplayPage({ ...model, pinnedAt: at }));
        return html(
          renderOperatorPreviewPage({
            basePath: this.basePath,
            screenId,
            date: model.date,
            pinnedAt: at,
            display: { ...model, pinnedAt: at },
            originalPlan: preview.originalPlan ?? null,
            effectivePlan: preview.effectivePlan ?? null,
            timeline: preview.timeline.flatMap((item) => [
              ...(item.startsAt === ''
                ? []
                : [{ label: `${item.state} starts`, at: item.startsAt }]),
              ...(item.endsAt === ''
                ? []
                : [{ label: `${item.state} ends`, at: item.endsAt }]),
            ]),
            diagnostics: preview.diagnostics,
          }),
        );
      }
      if (request.kind === 'preview-data') {
        if (request.query.override !== undefined)
          throw new DisplayRuntimeInputError('preview-override-query-invalid');
        return json(await this.display.getPreview(screenId, at));
      }
      if (request.kind === 'overrides.read') {
        const date = request.query.date ?? at.slice(0, 10);
        if (!isIsoDate(date))
          throw new DisplayRuntimeInputError('date-invalid');
        const value = await this.display.getOverride(screenId, date);
        if (request.query.view !== 'operator') return json(value ?? null);
        const target = await this.display.getTarget(
          screenId,
          `${date}T08:00:00Z`,
        );
        return html(
          renderOperatorOverridePage(
            this.operatorModel(
              requirePresentation(target, this.basePath, this.mediaReady),
              target,
              {
                ...(value === undefined
                  ? {}
                  : { overrideSummary: 'A scoped override is active.' }),
              },
            ),
          ),
        );
      }
      if (request.kind === 'overrides.write') {
        const value = request.body as ScopedDisplayOverride;
        if (value?.screenId !== screenId)
          throw new DisplayRuntimeInputError('override-scope-mismatch');
        const stored = await this.display.putOverride(value);
        return json(stored);
      }
      if (request.kind === 'overrides.delete') {
        const date = request.query.date;
        if (!isIsoDate(date))
          throw new DisplayRuntimeInputError('date-invalid');
        return json({
          deleted: await this.display.deleteOverride(screenId, date),
        });
      }
      if (request.kind === 'hold.read') {
        const target = await this.display.getTarget(screenId, at);
        if (request.query.view !== 'operator') return json(target.hold ?? null);
        const model = requirePresentation(
          target,
          this.basePath,
          this.mediaReady,
        );
        const current =
          target.plan === undefined ||
          target.meetingId === undefined ||
          target.classId === undefined
            ? undefined
            : await this.display.getHold({
                date: target.plan.date,
                screenId,
                roomId: target.plan.roomId,
                classId: target.classId as ClassId,
                meetingId: target.meetingId,
                planId: target.plan.effectivePlanId,
              });
        return html(
          renderOperatorHoldPage(
            this.operatorModel(model, target, {
              ...(current === undefined
                ? {}
                : { activeHold: presentationHold(current) }),
            }),
          ),
        );
      }
      if (request.kind === 'hold.write') {
        const body = request.body as Parameters<
          FixtureBackedDisplayController['hold']
        >[0];
        if (body?.screenId !== screenId)
          throw new DisplayRuntimeInputError('hold-scope-mismatch');
        const result = await this.display.hold(body);
        return json(result, resultStatus(result));
      }
      if (request.kind === 'hold.delete') {
        const result = await this.display.releaseHold({
          date: request.query.date ?? '',
          screenId,
          roomId: (request.query.roomId ?? '') as RoomId,
          classId: (request.query.classId ?? '') as ClassId,
          meetingId: request.query.meetingId ?? '',
          planId: request.query.planId ?? '',
          expectedRevision: request.query.expectedRevision ?? '',
          releasedAt: request.query.releasedAt ?? '',
          reasonCode: request.query.reasonCode ?? 'operator-release',
        });
        return json(result, resultStatus(result));
      }
      if (request.kind === 'qr') {
        const date = request.query.date ?? at.slice(0, 10);
        if (!isIsoDate(date))
          throw new DisplayRuntimeInputError('date-invalid');
        const target = await this.display.qrTarget(
          screenId,
          date,
          request.meetingId,
        );
        return target === undefined
          ? undefined
          : {
              kind: 'binary',
              value: qrPng(target),
              contentType: 'image/png',
            };
      }
      if (request.kind === 'attendance.current') {
        const target = await this.display.getTarget(screenId, at);
        return json({
          screenId,
          meetingId: target.meetingId ?? null,
          attendance: target.attendance ?? null,
          checkInUrl: target.qrTarget ?? null,
        });
      }
    }

    if (request.kind === 'attendance.class')
      return json({
        classId: request.classId,
        source: 'synthetic',
        studentData: false,
      });
    if (request.kind === 'attendance.diagnostics')
      return json({ classId: request.classId, diagnostics: [] });
    if (request.kind === 'attendance.redirect') {
      if (request.target !== 'check-in') return undefined;
      const meetingId =
        request.classId === 'class-b407-b'
          ? 'meeting-b407-b'
          : request.classId === 'class-b407-a'
            ? 'meeting-b407-a'
            : undefined;
      if (meetingId === undefined) return undefined;
      const target = await this.display.qrTarget(
        'screen-b407' as ScreenId,
        '2035-04-13',
        meetingId,
      );
      return target === undefined
        ? undefined
        : { kind: 'redirect', location: target, status: 302 };
    }
    return undefined;
  }

  private operatorModel(
    model: DisplayPresentationModel,
    target: DisplayTargetResult,
    extra: Partial<OperatorScopeModel> = {},
  ): OperatorScopeModel {
    return {
      basePath: this.basePath,
      screenId: model.screenId,
      date: model.date,
      planId: model.planId,
      effectiveAt: model.evaluatedAt,
      ...(target.plan?.roomId === undefined
        ? {}
        : { roomId: target.plan.roomId }),
      ...(target.classId === undefined ? {} : { classId: target.classId }),
      ...(target.meetingId === undefined
        ? {}
        : { meetingId: target.meetingId }),
      ...(model.hold === undefined ? {} : { activeHold: model.hold }),
      ...extra,
    };
  }
}
