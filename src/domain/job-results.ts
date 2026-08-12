import type {
  CompletedJobOutcome,
  JobOutcome,
  RepairRequiredJobOutcome,
} from '../contracts/v1/operations.js';
import type { ActionableError } from './errors.js';

type CompletedFor<Category extends CompletedJobOutcome['category']> = Omit<
  CompletedJobOutcome,
  'category'
> & {
  readonly category: Category;
};

export type SucceededJobResult = CompletedFor<'succeeded'> & {
  readonly errors: readonly [];
};

export type DegradedJobResult = CompletedFor<'degraded'> & {
  readonly errors: readonly ActionableError[];
};

export type SkippedJobResult = CompletedFor<'skipped'> & {
  readonly reason:
    'not-required' | 'prerequisite-unavailable' | 'unsafe-to-proceed';
  readonly errors: readonly ActionableError[];
};

export type RepairRequiredJobResult = RepairRequiredJobOutcome & {
  readonly error: ActionableError & {
    readonly category: 'authentication-repair-required';
  };
};

export type FailedJobResult = CompletedFor<'failed'> & {
  readonly error: ActionableError;
};

/** Exhaustive operational result union compatible with the frozen v1 outcome. */
export type TypedJobResult =
  | SucceededJobResult
  | DegradedJobResult
  | SkippedJobResult
  | RepairRequiredJobResult
  | FailedJobResult;

export type JobResultContractIsV1Compatible = TypedJobResult extends JobOutcome
  ? true
  : false;
