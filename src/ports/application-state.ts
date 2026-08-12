import type {
  ContractDiagnostic,
  IsoDate,
  IsoInstant,
  OpaqueId,
} from '../contracts/v1/common.js';
import type { JobOutcome } from '../contracts/v1/operations.js';
import type { ScheduleObservation } from '../contracts/v1/schedule.js';
import type {
  AttendanceLinks,
  AttendanceSummary,
} from '../domain/attendance.js';
import type { StaticClassContent } from '../domain/content.js';
import type { ClassId, RoomId, ScreenId } from '../domain/identities.js';
import type { ScopedDisplayOverride } from '../domain/overrides.js';
import type {
  VocabularyHistoryEntry,
  VocabularySelection,
} from '../domain/vocabulary.js';
import type { PersistenceWriteResult } from './persistence-write.js';

export type SafeStateRecordKind =
  | 'schedule-observation'
  | 'configuration'
  | 'mapping'
  | 'content'
  | 'vocabulary-selection'
  | 'vocabulary-history'
  | 'attendance'
  | 'override'
  | 'hold'
  | 'calendar-ownership-candidate'
  | 'calendar-reconciliation-state'
  | 'alert-state'
  | 'job-run'
  | 'comparison-evidence'
  | 'temporary-operational-state';

export interface StateScope {
  readonly date?: IsoDate;
  readonly screenId?: ScreenId;
  readonly roomId?: RoomId;
  readonly classId?: ClassId;
  readonly meetingId?: OpaqueId;
  readonly planId?: OpaqueId;
}

interface StateRecordBase<Kind extends SafeStateRecordKind, Data> {
  readonly kind: Kind;
  readonly recordKey: OpaqueId;
  readonly scope: StateScope;
  readonly data: Data;
  readonly active?: boolean;
  readonly academicYearEnd?: IsoDate;
  readonly expiresAt?: IsoInstant;
}

export type SafeStateRecord =
  | StateRecordBase<
      'schedule-observation',
      { readonly observation: ScheduleObservation }
    >
  | StateRecordBase<
      'configuration',
      {
        readonly configurationVersion: string;
        readonly effectiveAt: IsoInstant;
        readonly timeZone: string;
        readonly morningCutoff: string;
        readonly showCheckIn: boolean;
        readonly checkInOpenMinutesBefore: number;
        readonly dismissalWarningMinutesBefore: number;
      }
    >
  | StateRecordBase<
      'mapping',
      {
        readonly classId: ClassId;
        readonly courseKey: OpaqueId;
        readonly roomId: RoomId;
        readonly screenId?: ScreenId;
        readonly periodId?: OpaqueId;
      }
    >
  | StateRecordBase<
      'content',
      {
        readonly classId: ClassId;
        readonly content: StaticClassContent;
      }
    >
  | StateRecordBase<
      'vocabulary-selection',
      { readonly selection: VocabularySelection }
    >
  | StateRecordBase<
      'vocabulary-history',
      { readonly entries: readonly VocabularyHistoryEntry[] }
    >
  | StateRecordBase<
      'attendance',
      {
        readonly links: AttendanceLinks;
        readonly summary: AttendanceSummary;
      }
    >
  | StateRecordBase<'override', { readonly override: ScopedDisplayOverride }>
  | StateRecordBase<
      'hold',
      {
        readonly status: 'held' | 'released' | 'expired';
        readonly heldAt: IsoInstant;
        readonly expiresAt?: IsoInstant;
        readonly releasedAt?: IsoInstant;
        readonly expiredAt?: IsoInstant;
        readonly reasonCode: string;
      }
    >
  | StateRecordBase<
      'calendar-ownership-candidate',
      {
        readonly scopeId: OpaqueId;
        readonly ownershipMarker: OpaqueId;
        readonly evidenceReference: OpaqueId;
        readonly status: 'candidate' | 'rejected' | 'superseded';
      }
    >
  | StateRecordBase<
      'calendar-reconciliation-state',
      {
        readonly scopeId: OpaqueId;
        readonly lastSuccessfulFingerprint: string;
        readonly completedAt: IsoInstant;
      }
    >
  | StateRecordBase<
      'alert-state',
      {
        readonly activeIssueFingerprints: readonly string[];
        readonly lastSuccessfulIssueFingerprints: readonly string[];
        readonly lastDecision:
          'new' | 'unchanged' | 'repeat' | 'recovery' | 'mixed' | 'no-send';
        readonly decidedAt: IsoInstant;
        /** May accompany an empty set after a successful recovery delivery. */
        readonly lastSuccessfulDeliveryAt?: IsoInstant;
        readonly deliveryMode: 'report-only' | 'fake';
        readonly deliveryState: 'not-attempted' | 'delivered' | 'failed';
      }
    >
  | StateRecordBase<
      'job-run',
      {
        readonly outcome: JobOutcome;
        readonly errorCodes: readonly string[];
        readonly incidentCodes: readonly string[];
        readonly requestedDates: readonly IsoDate[];
        readonly provenanceReferences: readonly OpaqueId[];
        readonly inputFingerprint?: string;
        readonly outputFingerprint?: string;
        readonly latestStateReference?: OpaqueId;
      }
    >
  | StateRecordBase<
      'comparison-evidence',
      {
        readonly comparedAt: IsoInstant;
        readonly equal: boolean;
        readonly differenceCodes: readonly string[];
        readonly diagnostics: readonly ContractDiagnostic[];
      }
    >
  | StateRecordBase<
      'temporary-operational-state',
      {
        readonly state: 'pending' | 'ready' | 'completed' | 'failed';
        readonly code: string;
        readonly observedAt: IsoInstant;
      }
    >;

export interface StateRecordQuery extends StateScope {
  readonly kind: SafeStateRecordKind;
  readonly recordKey: OpaqueId;
}

/** Provider- and database-neutral application-state read capability. */
export interface ApplicationStateReader {
  findRecord(query: StateRecordQuery): Promise<SafeStateRecord | undefined>;
}

/** Writes only the finite, explicitly safe M-04 application-state union. */
export interface ApplicationStateWriter {
  storeRecord(record: SafeStateRecord): Promise<PersistenceWriteResult>;
}
