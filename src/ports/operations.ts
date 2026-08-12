import type { IsoInstant } from '../contracts/v1/common.js';
import type { PersistenceWriteResult } from './persistence-write.js';
import type { SafeStateRecord } from './application-state.js';
import type { AlertDecision } from '../domain/operations/alerts.js';

export const alertDecisionKinds = [
  'new',
  'unchanged',
  'repeat',
  'recovery',
  'mixed',
  'no-send',
] as const;
export type AlertDecisionKind = (typeof alertDecisionKinds)[number];

export const alertDeliveryModes = ['report-only', 'fake'] as const;
export type AlertDeliveryMode = (typeof alertDeliveryModes)[number];

export const alertDeliveryStates = [
  'not-attempted',
  'delivered',
  'failed',
] as const;
export type AlertDeliveryState = (typeof alertDeliveryStates)[number];

/** Restart-safe, redacted state for transport-neutral alert decisions. */
export type AlertCheckpoint = Extract<
  SafeStateRecord,
  { readonly kind: 'alert-state' }
>['data'];

export type OperationsJobRunRecord = Extract<
  SafeStateRecord,
  { readonly kind: 'job-run' }
>;

/** A bounded, database-neutral run-ledger query. */
export interface OperationsRunLedgerQuery {
  readonly jobName?: string;
  readonly startedAtOrAfter?: IsoInstant;
  readonly limit: number;
}

export interface OperationsStateReader {
  loadAlertCheckpoint(): Promise<AlertCheckpoint | undefined>;
  listJobRuns(
    query: OperationsRunLedgerQuery,
  ): Promise<readonly OperationsJobRunRecord[]>;
}

export interface OperationsStateWriter {
  storeAlertCheckpoint(
    checkpoint: AlertCheckpoint,
  ): Promise<PersistenceWriteResult>;
  storeJobRun(record: OperationsJobRunRecord): Promise<PersistenceWriteResult>;
}

export type AlertTransportResult =
  | { readonly status: 'delivered' }
  | { readonly status: 'failed'; readonly code: string };

/** Transport sees only a validated, redacted decision; recipient policy is absent. */
export interface AlertTransport {
  deliver(
    decision: AlertDecision,
    signal?: AbortSignal,
  ): Promise<AlertTransportResult>;
}
