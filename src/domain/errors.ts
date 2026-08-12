import type { ContractDiagnostic } from '../contracts/v1/common.js';

export const actionableErrorCategories = [
  'invalid-input',
  'not-found',
  'stale-observation',
  'authentication-repair-required',
  'authorization-denied',
  'ownership-ambiguous',
  'conflict',
  'timeout',
  'unavailable',
  'unsafe-configuration',
  'internal',
] as const;

export type ActionableErrorCategory =
  (typeof actionableErrorCategories)[number];

/** Safe error boundary: codes and messages must be redacted before construction. */
export interface ActionableError {
  readonly category: ActionableErrorCategory;
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly diagnostics: readonly ContractDiagnostic[];
}
