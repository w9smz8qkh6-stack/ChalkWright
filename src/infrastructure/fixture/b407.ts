import { contractVersion, type IsoDate } from '../../contracts/v1/common.js';
import type { DisplayState } from '../../contracts/v1/display.js';
import type { ClassId, RoomId, ScreenId } from '../../domain/identities.js';
import type { ScopedDisplayOverride } from '../../domain/overrides.js';
import type { EffectiveDayPlan } from '../../domain/plans.js';
import type { SafeStateRecord } from '../../ports/application-state.js';
import type { PersistenceWriteResult } from '../../ports/persistence-write.js';
import type {
  DisplayFixtureData,
  DisplayHoldStore,
  DisplayOverrideStore,
  DisplayPlanSource,
  DisplayPlanStore,
  HoldScope,
  HoldSnapshot,
} from '../../application/display/contracts.js';
import type { SqliteDatabase } from '../sqlite/database.js';
import type { SqliteApplicationStateRepository } from '../sqlite/repository.js';

export const b407Date = '2035-04-13' as IsoDate;
export const b407Screen = 'screen-b407' as ScreenId;
export const b407SecondaryScreen = 'screen-b407-secondary' as ScreenId;
export const b407Room = 'room-b407' as RoomId;
export const b407ClassA = 'class-b407-a' as ClassId;
export const b407ClassB = 'class-b407-b' as ClassId;

function meeting(
  id: string,
  block: string,
  opens: string,
  starts: string,
  dismissal: string,
  ends: string,
) {
  return {
    meetingId: id,
    courseKey: `course-${block.toLowerCase()}`,
    blockLabel: block,
    checkInOpensAt: `${b407Date}T${opens}Z`,
    officialStartsAt: `${b407Date}T${starts}Z`,
    checkInClosesAt: `${b407Date}T${starts}Z`,
    contentStartsAt: `${b407Date}T${starts}Z`,
    dismissalStartsAt: `${b407Date}T${dismissal}Z`,
    officialEndsAt: `${b407Date}T${ends}Z`,
  };
}

export const b407Plan: EffectiveDayPlan = {
  contractVersion,
  effectivePlanId: 'effective-b407',
  canonicalPlanId: 'canonical-b407',
  date: b407Date,
  timeZone: 'Etc/UTC',
  roomId: b407Room,
  screenId: b407Screen,
  verification: 'synthetic',
  meetings: [
    meeting(
      'meeting-b407-a',
      'A',
      '07:55:00',
      '08:00:00',
      '08:55:00',
      '09:00:00',
    ),
    meeting(
      'meeting-b407-b',
      'B',
      '09:55:00',
      '10:00:00',
      '10:55:00',
      '11:00:00',
    ),
  ],
  diagnostics: [],
};

export const b407SecondaryPlan: EffectiveDayPlan = {
  ...b407Plan,
  effectivePlanId: 'effective-b407-secondary',
  screenId: b407SecondaryScreen,
};

export const b407NoClassesPlan: EffectiveDayPlan = {
  ...b407Plan,
  effectivePlanId: 'effective-b407-empty',
  canonicalPlanId: 'canonical-b407-empty',
  date: '2035-04-14',
  meetings: [],
};

export const b407NextClassPlan: EffectiveDayPlan = {
  ...b407Plan,
  effectivePlanId: 'effective-b407-next-class',
  canonicalPlanId: 'canonical-b407-next-class',
  date: '2035-04-16',
  meetings: b407Plan.meetings.map((entry) => ({
    ...entry,
    checkInOpensAt: entry.checkInOpensAt.replace(b407Date, '2035-04-16'),
    officialStartsAt: entry.officialStartsAt.replace(b407Date, '2035-04-16'),
    checkInClosesAt: entry.checkInClosesAt.replace(b407Date, '2035-04-16'),
    contentStartsAt: entry.contentStartsAt.replace(b407Date, '2035-04-16'),
    dismissalStartsAt: entry.dismissalStartsAt.replace(b407Date, '2035-04-16'),
    officialEndsAt: entry.officialEndsAt.replace(b407Date, '2035-04-16'),
  })),
};

export const b407StateInstants: Readonly<Record<DisplayState, string>> = {
  no_classes: '2035-04-14T08:00:00Z',
  morning_overview: `${b407Date}T07:00:00Z`,
  idle: `${b407Date}T07:40:00Z`,
  pre_checkin: `${b407Date}T07:55:00Z`,
  in_class_content: `${b407Date}T08:00:00Z`,
  dismissal_warning: `${b407Date}T08:55:00Z`,
  post_end: `${b407Date}T09:00:00Z`,
  day_complete: `${b407Date}T11:00:00Z`,
};

export const b407FixtureData: DisplayFixtureData = {
  displays: [
    { screenId: b407Screen, roomId: b407Room, label: 'B407 Classroom Display' },
    {
      screenId: b407SecondaryScreen,
      roomId: b407Room,
      label: 'B407 Secondary Display',
    },
  ],
  classByMeeting: {
    'meeting-b407-a': b407ClassA,
    'meeting-b407-b': b407ClassB,
  },
  contentByMeeting: {
    'meeting-b407-a': {
      assignmentsVisible: true,
      cards: [
        {
          cardId: 'objective-b407-a',
          type: 'objective',
          title: "Today's objective",
          lines: ['Explain a deterministic state transition.'],
          durationSeconds: 12,
        },
        {
          cardId: 'coursework-b407-a',
          type: 'coursework',
          title: 'Synthetic coursework',
          lines: ['Complete the fixture-backed comparison.'],
          durationSeconds: 12,
        },
        {
          cardId: 'vocabulary-b407-a',
          type: 'vocabulary',
          title: 'Idempotent',
          lines: ['A repeated operation produces the same durable result.'],
          durationSeconds: 12,
        },
      ],
    },
    'meeting-b407-b': {
      assignmentsVisible: true,
      cards: [
        {
          cardId: 'objective-b407-b',
          type: 'objective',
          title: "Today's objective",
          lines: ['Verify an isolated display scope.'],
          durationSeconds: 12,
        },
      ],
    },
  },
  attendanceByMeeting: {
    'meeting-b407-a': {
      rosterCount: 24,
      presentCount: 20,
      tardyCount: 1,
      absentCount: 3,
      responseCount: 21,
    },
    'meeting-b407-b': { rosterCount: 18, responseCount: 0 },
  },
  attendanceLinksByMeeting: {
    'meeting-b407-a': {
      directPrefilled: 'https://fixture.example.invalid/attendance/b407-a',
      classroom: 'https://fixture.example.invalid/classroom/b407-a',
    },
    'meeting-b407-b': {
      wrapper: 'https://fixture.example.invalid/attendance/b407-b',
    },
  },
  attendanceClassCodeByMeeting: {
    'meeting-b407-a': 'WD-A',
    'meeting-b407-b': 'RB-B',
  },
  assets: [
    {
      assetId: 'asset-display-css',
      path: '/assets/display.css',
      contentType: 'text/css; charset=utf-8',
      byteLength: 2048,
      cacheControl: 'public, max-age=3600',
    },
    {
      assetId: 'asset-display-js',
      path: '/assets/display.js',
      contentType: 'text/javascript; charset=utf-8',
      byteLength: 4096,
      cacheControl: 'public, max-age=3600',
    },
  ],
  media: [
    {
      assetId: 'media-b407-loop',
      path: '/media/dismissal',
      contentType: 'video/mp4',
      byteLength: 4591479,
      cacheControl: 'private, max-age=300',
      acceptsRanges: true,
    },
  ],
  nextClassDayPlans: [b407NextClassPlan],
};

function planKey(screenId: ScreenId, date: IsoDate): string {
  return `${screenId}\u0000${date}`;
}

export class MutableFixturePlanSource implements DisplayPlanSource {
  private available = true;
  private readonly plans = new Map<string, EffectiveDayPlan>();

  constructor(plans: readonly EffectiveDayPlan[]) {
    for (const plan of plans) this.setPlan(plan);
  }

  setAvailable(available: boolean): void {
    this.available = available;
  }

  setPlan(plan: EffectiveDayPlan): void {
    this.plans.set(planKey(plan.screenId, plan.date), structuredClone(plan));
  }

  async read(screenId: ScreenId, date: IsoDate): Promise<EffectiveDayPlan> {
    if (!this.available) throw new Error('synthetic-fixture-unavailable');
    const plan = this.plans.get(planKey(screenId, date));
    if (plan === undefined) throw new Error('synthetic-fixture-plan-missing');
    return structuredClone(plan);
  }
}

export class MemoryFixtureOverrideStore implements DisplayOverrideStore {
  private readonly values = new Map<string, ScopedDisplayOverride>();

  async read(screenId: ScreenId, date: IsoDate) {
    const value = this.values.get(planKey(screenId, date));
    return value === undefined ? undefined : structuredClone(value);
  }

  async write(value: ScopedDisplayOverride): Promise<void> {
    this.values.set(
      planKey(value.screenId, value.date),
      structuredClone(value),
    );
  }

  async delete(screenId: ScreenId, date: IsoDate): Promise<boolean> {
    return this.values.delete(planKey(screenId, date));
  }
}

export class SqliteFixtureOverrideStore implements DisplayOverrideStore {
  constructor(private readonly repository: SqliteApplicationStateRepository) {}

  async read(screenId: ScreenId, date: IsoDate) {
    const record = await this.repository.findRecord({
      kind: 'override',
      recordKey: this.recordKey(screenId, date),
      screenId,
      date,
    });
    return record?.kind !== 'override' || record.active === false
      ? undefined
      : structuredClone(record.data.override);
  }

  async write(value: ScopedDisplayOverride): Promise<void> {
    const result = await this.repository.storeRecord({
      kind: 'override',
      recordKey: this.recordKey(value.screenId, value.date),
      scope: { screenId: value.screenId, date: value.date },
      data: { override: structuredClone(value) },
      active: true,
    });
    if (result.status === 'rejected')
      throw new Error('synthetic-override-storage-failed');
  }

  async delete(screenId: ScreenId, date: IsoDate): Promise<boolean> {
    const current = await this.repository.findRecord({
      kind: 'override',
      recordKey: this.recordKey(screenId, date),
      screenId,
      date,
    });
    if (current?.kind !== 'override' || current.active === false) return false;
    const result = await this.repository.storeRecord({
      ...current,
      active: false,
    });
    if (result.status === 'rejected')
      throw new Error('synthetic-override-storage-failed');
    return true;
  }

  private recordKey(screenId: ScreenId, date: IsoDate): string {
    return `override:${date}:${screenId}`;
  }
}

/** Fixture adapter exposes repository revisions without leaking SQLite into application code. */
export class SqliteFixtureDisplayStore
  implements DisplayPlanStore, DisplayHoldStore
{
  constructor(
    private readonly database: SqliteDatabase,
    private readonly repository: SqliteApplicationStateRepository,
  ) {}

  write(plan: EffectiveDayPlan): Promise<PersistenceWriteResult> {
    return this.repository.storeEffective(plan);
  }

  read(options: {
    readonly screenId: ScreenId;
    readonly roomId: RoomId;
    readonly date: IsoDate;
  }): Promise<EffectiveDayPlan | undefined>;
  read(scope: HoldScope): Promise<HoldSnapshot | undefined>;
  async read(
    options:
      | HoldScope
      | {
          readonly screenId: ScreenId;
          readonly roomId: RoomId;
          readonly date: IsoDate;
        },
  ): Promise<EffectiveDayPlan | HoldSnapshot | undefined> {
    if ('meetingId' in options) {
      const recordKey = `hold:${options.date}:${options.screenId}:${options.meetingId}:${options.planId}`;
      const record = await this.repository.findRecord({
        kind: 'hold',
        recordKey,
        ...options,
      });
      if (record?.kind !== 'hold') return undefined;
      const revision = this.database.connection
        .prepare(
          `SELECT revision FROM application_records
            WHERE record_kind = 'hold' AND record_key = ? AND date_scope = ?
                  AND screen_id = ? AND room_id = ? AND class_id = ?
                  AND meeting_id = ? AND plan_id = ? AND superseded_at IS NULL`,
        )
        .get(
          recordKey,
          options.date,
          options.screenId,
          options.roomId,
          options.classId,
          options.meetingId,
          options.planId,
        ) as unknown as { readonly revision?: string } | undefined;
      return revision?.revision === undefined
        ? undefined
        : { record, revision: revision.revision };
    }
    return this.repository.findEffective(options);
  }

  create(record: Extract<SafeStateRecord, { readonly kind: 'hold' }>) {
    return this.repository.storeRecord(record);
  }

  transition(
    record: Extract<SafeStateRecord, { readonly kind: 'hold' }>,
    expectedRevision: string,
  ) {
    return this.repository.storeHoldTransition(record, expectedRevision);
  }

  expire(at: string): number {
    return this.repository.pruneExpired(at);
  }
}
