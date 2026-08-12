import type { CalendarMutationIntent } from '../contracts/v1/calendar.js';
import type { IsoInstant, OpaqueId } from '../contracts/v1/common.js';

export interface CalendarWriterLease {
  readonly scopeId: OpaqueId;
  readonly leaseId: OpaqueId;
  readonly ownerId: OpaqueId;
  readonly acquiredAt: IsoInstant;
  readonly expiresAt: IsoInstant;
}

export type CalendarWriterLeaseAcquisition =
  | { readonly status: 'acquired'; readonly lease: CalendarWriterLease }
  | { readonly status: 'conflict' };

export interface CalendarExecutionStepRecord {
  readonly intentId: OpaqueId;
  readonly intentKind: CalendarMutationIntent['kind'];
  readonly status: 'pending' | 'attempted' | 'succeeded' | 'failed';
  readonly outcome?: 'no-op' | 'mutated' | 'already-converged' | 'refused';
  readonly providerReferenceHash?: string;
  readonly errorCode?: string;
}

export interface CalendarExecutionJournalRecord {
  readonly executionFingerprint: string;
  readonly manifestFingerprint: string;
  readonly scopeId: OpaqueId;
  readonly status: 'running' | 'succeeded' | 'failed';
  readonly startedAt: IsoInstant;
  readonly finishedAt?: IsoInstant;
  readonly steps: readonly CalendarExecutionStepRecord[];
}

/** Durable single-writer lease and sanitized execution journal boundary. */
export interface CalendarExecutionStatePort {
  acquireLease(request: {
    readonly scopeId: OpaqueId;
    readonly leaseId: OpaqueId;
    readonly ownerId: OpaqueId;
    readonly now: IsoInstant;
    readonly expiresAt: IsoInstant;
  }): Promise<CalendarWriterLeaseAcquisition>;
  releaseLease(request: {
    readonly scopeId: OpaqueId;
    readonly leaseId: OpaqueId;
    readonly ownerId: OpaqueId;
  }): Promise<void>;
  loadExecution(
    executionFingerprint: string,
  ): Promise<CalendarExecutionJournalRecord | undefined>;
  beginExecution(record: CalendarExecutionJournalRecord): Promise<void>;
  resumeExecution(request: {
    readonly executionFingerprint: string;
  }): Promise<void>;
  recordStep(request: {
    readonly executionFingerprint: string;
    readonly step: CalendarExecutionStepRecord;
  }): Promise<void>;
  finishExecution(request: {
    readonly executionFingerprint: string;
    readonly status: 'succeeded' | 'failed';
    readonly finishedAt: IsoInstant;
  }): Promise<void>;
}
