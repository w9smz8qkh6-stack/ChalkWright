import type {
  ContractDiagnostic,
  ContractEnvelope,
  IsoInstant,
  OpaqueId,
} from './common.js';

export const jobOutcomeCategories = [
  'succeeded',
  'degraded',
  'skipped',
  'repair-required',
  'failed',
] as const;

export type JobOutcomeCategory = (typeof jobOutcomeCategories)[number];

interface JobOutcomeBase extends ContractEnvelope {
  readonly runId: OpaqueId;
  readonly jobName: string;
  readonly startedAt: IsoInstant;
  readonly finishedAt: IsoInstant;
  readonly diagnostics: readonly ContractDiagnostic[];
}

export interface RepairRequiredJobOutcome extends JobOutcomeBase {
  readonly category: 'repair-required';
  readonly attemptedExternalMutations: 0;
  readonly completedExternalMutations: 0;
}

export interface CompletedJobOutcome extends JobOutcomeBase {
  readonly category: Exclude<JobOutcomeCategory, 'repair-required'>;
  readonly attemptedExternalMutations: number;
  readonly completedExternalMutations: number;
}

/** Repair-required is structurally a zero-mutation result. */
export type JobOutcome = RepairRequiredJobOutcome | CompletedJobOutcome;
