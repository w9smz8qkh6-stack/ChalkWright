import type {
  ContractDiagnostic,
  IsoDate,
  IsoInstant,
  OpaqueId,
} from '../contracts/v1/common.js';
import type { DisplayState } from '../contracts/v1/display.js';

export interface PresentationMeeting {
  readonly meetingId: OpaqueId;
  readonly courseLabel: string;
  readonly blockLabel: string;
  readonly checkInOpensAt: IsoInstant;
  readonly officialStartsAt: IsoInstant;
  readonly contentStartsAt: IsoInstant;
  readonly dismissalStartsAt: IsoInstant;
  readonly officialEndsAt: IsoInstant;
}

export interface PresentationCard {
  readonly cardId: OpaqueId;
  readonly type:
    'announcement' | 'bellringer' | 'objective' | 'vocabulary' | 'generic';
  readonly title: string;
  readonly lines: readonly string[];
  readonly featured?: string;
  readonly details?: readonly string[];
  readonly accent?: 'ink' | 'warm' | 'calm' | 'bright';
  readonly durationSeconds?: number;
  readonly vocabulary?: {
    readonly term: string;
    readonly definition: string;
    readonly pronunciation?: string;
    readonly partOfSpeech?: string;
    readonly example?: string;
    readonly vietnamese?: {
      readonly term?: string;
      readonly definition?: string;
      readonly example?: string;
    };
  };
}

export interface PresentationAttendance {
  readonly checkInUrl?: string;
  readonly qrUrl?: string;
  readonly classCode?: string;
  readonly responseCount?: number;
  readonly rosterCount?: number;
  readonly presentCount?: number;
  readonly tardyCount?: number;
  readonly absentCount?: number;
}

export interface PresentationHold {
  readonly status: 'held' | 'released' | 'expired';
  readonly meetingId: OpaqueId;
  readonly reasonCode: string;
  readonly expiresAt?: IsoInstant;
  readonly revision?: OpaqueId;
}

export interface DisplayPresentationModel {
  readonly basePath?: '' | '/classroom-screen';
  readonly screenId: OpaqueId;
  readonly planId: OpaqueId;
  readonly date: IsoDate;
  readonly timeZone: string;
  readonly evaluatedAt: IsoInstant;
  readonly state: DisplayState;
  readonly currentMeeting?: PresentationMeeting;
  readonly nextMeeting?: PresentationMeeting;
  readonly meetings?: readonly PresentationMeeting[];
  readonly cards?: readonly PresentationCard[];
  readonly attendance?: PresentationAttendance;
  readonly announcement?: string;
  readonly dismissalMessage?: string;
  /** False renders the local poster without requesting an optional MP4. */
  readonly dismissalMediaAvailable?: boolean;
  readonly nextClassDayLabel?: 'Tomorrow' | 'Next Week' | 'Next Class Day';
  readonly nextClassDayDate?: IsoDate;
  readonly nextClassDayMeetings?: readonly PresentationMeeting[];
  readonly hold?: PresentationHold;
  readonly degraded?: boolean;
  readonly diagnostics?: readonly ContractDiagnostic[];
  /** When present, the browser clock is fixed and polling is disabled. */
  readonly pinnedAt?: IsoInstant;
}

export interface PreviewPresentationModel {
  readonly basePath?: '' | '/classroom-screen';
  readonly screenId: OpaqueId;
  readonly date: IsoDate;
  readonly pinnedAt?: IsoInstant;
  readonly display: DisplayPresentationModel;
  readonly originalPlan: unknown;
  readonly effectivePlan: unknown;
  readonly timeline: readonly {
    readonly label: string;
    readonly at: IsoInstant;
  }[];
  readonly diagnostics: readonly ContractDiagnostic[];
}

export interface OperatorScopeModel {
  readonly basePath?: '' | '/classroom-screen';
  readonly screenId: OpaqueId;
  readonly date: IsoDate;
  readonly planId: OpaqueId;
  readonly effectiveAt: IsoInstant;
  readonly roomId?: OpaqueId;
  readonly classId?: OpaqueId;
  readonly meetingId?: OpaqueId;
  readonly activeHold?: PresentationHold;
  readonly overrideSummary?: string;
}
