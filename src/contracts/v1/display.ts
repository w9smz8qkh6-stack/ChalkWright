import type { ContractEnvelope, IsoInstant, OpaqueId } from './common.js';

export const displayStates = [
  'no_classes',
  'morning_overview',
  'idle',
  'pre_checkin',
  'in_class_content',
  'dismissal_warning',
  'post_end',
  'day_complete',
] as const;

export type DisplayState = (typeof displayStates)[number];

/** A state-selection result shape only; M-01 does not implement selection logic. */
export interface DisplayStateCase extends ContractEnvelope {
  readonly caseId: OpaqueId;
  readonly screenId: OpaqueId;
  readonly planId: OpaqueId;
  readonly evaluatedAt: IsoInstant;
  readonly state: DisplayState;
  readonly currentMeetingId?: OpaqueId;
  readonly nextMeetingId?: OpaqueId;
}
