import type {
  ContractDiagnostic,
  IsoDate,
  IsoInstant,
  OpaqueId,
} from '../../contracts/v1/common.js';
import type { DisplayStateCase } from '../../contracts/v1/display.js';
import type {
  AttendanceLinks,
  AttendanceSummary,
} from '../../domain/attendance.js';
import type {
  DisplayContentModel,
  ScopedDisplayOverride,
} from '../../domain/overrides.js';
import type { EffectiveDayPlan } from '../../domain/plans.js';
import type { ClassId, RoomId, ScreenId } from '../../domain/identities.js';
import type { SafeStateRecord } from '../../ports/application-state.js';
import type { PersistenceWriteResult } from '../../ports/persistence-write.js';

export interface DisplayDescriptor {
  readonly screenId: ScreenId;
  readonly roomId: RoomId;
  readonly label: string;
}

export interface DisplayPlanResult {
  readonly plan?: EffectiveDayPlan;
  readonly source: 'current' | 'last-known-good' | 'missing';
  readonly degraded: boolean;
  readonly diagnostics: readonly ContractDiagnostic[];
}

export interface DisplayTargetResult extends DisplayPlanResult {
  readonly evaluatedAt: IsoInstant;
  readonly state?: DisplayStateCase;
  readonly meetingId?: OpaqueId;
  readonly classId?: OpaqueId;
  readonly content: DisplayContentModel;
  readonly attendance?: AttendanceSummary;
  readonly qrTarget?: string;
  readonly attendanceClassCode?: string;
  readonly hold?: HoldSnapshot;
  readonly nextClassDayLabel?: 'Tomorrow' | 'Next Week' | 'Next Class Day';
  readonly nextClassDayPlan?: EffectiveDayPlan;
}

export interface DisplayPreviewResult extends DisplayTargetResult {
  readonly originalPlan?: EffectiveDayPlan;
  readonly effectivePlan?: EffectiveDayPlan;
  readonly forcedTarget?: DisplayStateCase;
  readonly timeline: readonly {
    readonly state: string;
    readonly meetingId: OpaqueId;
    readonly startsAt: IsoInstant;
    readonly endsAt: IsoInstant;
  }[];
}

export interface HoldScope {
  readonly date: IsoDate;
  readonly screenId: ScreenId;
  readonly roomId: RoomId;
  readonly classId: ClassId;
  readonly meetingId: OpaqueId;
  readonly planId: OpaqueId;
}

export interface HoldSnapshot {
  readonly record: Extract<SafeStateRecord, { readonly kind: 'hold' }>;
  readonly revision: OpaqueId;
}

export interface HoldCommand extends HoldScope {
  readonly heldAt: IsoInstant;
  readonly expiresAt?: IsoInstant;
  readonly reasonCode: string;
  readonly expectedRevision?: OpaqueId;
}

export interface HoldReleaseCommand extends HoldScope {
  readonly releasedAt: IsoInstant;
  readonly reasonCode: string;
  readonly expectedRevision: OpaqueId;
}

export interface DisplayPlanSource {
  read(screenId: ScreenId, date: IsoDate): Promise<EffectiveDayPlan>;
}

/** Optional local-cache content projection; it must never perform provider I/O. */
export interface DisplayContentSource {
  read(
    classId: ClassId,
    date: IsoDate,
    observedAt: IsoInstant,
  ): Promise<DisplayContentModel | undefined>;
}

/** Optional local-only attendance projection; it must never perform provider I/O. */
export interface DisplayAttendanceSource {
  read(
    meetingId: OpaqueId,
    classId: ClassId | undefined,
    date: IsoDate,
  ): Promise<
    | {
        readonly summary?: AttendanceSummary;
        readonly links?: AttendanceLinks;
        readonly classCode?: string;
      }
    | undefined
  >;
}

/** Optional local-only future-plan projection used by the day-complete scene. */
export interface DisplayNextClassDaySource {
  readAfter(
    screenId: ScreenId,
    roomId: RoomId,
    date: IsoDate,
  ): Promise<EffectiveDayPlan | undefined>;
}

export interface DisplayPlanStore {
  write(plan: EffectiveDayPlan): Promise<PersistenceWriteResult>;
  read(options: {
    readonly screenId: ScreenId;
    readonly roomId: RoomId;
    readonly date: IsoDate;
  }): Promise<EffectiveDayPlan | undefined>;
}

export interface DisplayOverrideStore {
  read(
    screenId: ScreenId,
    date: IsoDate,
  ): Promise<ScopedDisplayOverride | undefined>;
  write(value: ScopedDisplayOverride): Promise<void>;
  delete(screenId: ScreenId, date: IsoDate): Promise<boolean>;
}

export interface DisplayHoldStore {
  read(scope: HoldScope): Promise<HoldSnapshot | undefined>;
  create(
    record: Extract<SafeStateRecord, { readonly kind: 'hold' }>,
  ): Promise<PersistenceWriteResult>;
  transition(
    record: Extract<SafeStateRecord, { readonly kind: 'hold' }>,
    expectedRevision: OpaqueId,
  ): PersistenceWriteResult;
  expire(at: IsoInstant): number;
}

export interface DisplayFixtureData {
  readonly displays: readonly DisplayDescriptor[];
  readonly contentByMeeting: Readonly<Record<OpaqueId, DisplayContentModel>>;
  readonly classByMeeting: Readonly<Record<OpaqueId, ClassId>>;
  readonly attendanceByMeeting: Readonly<Record<OpaqueId, AttendanceSummary>>;
  readonly attendanceLinksByMeeting: Readonly<
    Record<OpaqueId, AttendanceLinks>
  >;
  readonly attendanceClassCodeByMeeting: Readonly<Record<OpaqueId, string>>;
  readonly assets: readonly AssetMetadata[];
  readonly media: readonly MediaMetadata[];
  readonly nextClassDayPlans: readonly EffectiveDayPlan[];
}

export interface AssetMetadata {
  readonly assetId: OpaqueId;
  readonly path: string;
  readonly contentType: string;
  readonly byteLength: number;
  readonly cacheControl: string;
}

export interface MediaMetadata extends AssetMetadata {
  readonly acceptsRanges: true;
}

export interface RuntimeHealth {
  readonly status: 'ok' | 'degraded';
  readonly checkedAt: IsoInstant;
  readonly displays: number;
  readonly diagnostics: readonly ContractDiagnostic[];
}

export interface RuntimeReadiness {
  readonly ready: boolean;
  readonly checkedAt: IsoInstant;
  readonly missingScreens: readonly ScreenId[];
  readonly degradedScreens: readonly ScreenId[];
}
