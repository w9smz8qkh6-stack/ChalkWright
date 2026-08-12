import { contractVersion } from '../../contracts/v1/common.js';
import type { TypedJobResult } from '../../domain/job-results.js';
import {
  hasExactKeys,
  isActionableError,
  isDiagnostics,
  isIsoInstant,
  isNonEmptyString,
  isPlainObject,
} from '../../domain/runtime-validation.js';
import {
  isOperationsJobName,
  operationsJobNames,
  type OperationsJobName,
} from '../../domain/operations/jobs.js';

export { isOperationsJobName, operationsJobNames };
export type { OperationsJobName };

export type OperationsJobAvailability = 'implemented' | 'deferred';

export interface OperationsJobDefinition {
  readonly name: OperationsJobName;
  readonly availability: OperationsJobAvailability;
  readonly effect:
    | 'read-only'
    | 'local-state'
    | 'local-maintenance'
    | 'external-write-deferred';
  readonly prerequisites: readonly OperationsJobName[];
}

/**
 * Deferred entries preserve required workflow and ordering names without
 * making provider or Calendar capabilities reachable in M-06.
 */
export const operationsJobDefinitions: readonly OperationsJobDefinition[] = [
  {
    name: 'source-auth-preflight',
    availability: 'implemented',
    effect: 'read-only',
    prerequisites: [],
  },
  {
    name: 'classroom-refresh',
    availability: 'implemented',
    effect: 'read-only',
    prerequisites: ['source-auth-preflight'],
  },
  {
    name: 'calendar-reconcile',
    availability: 'deferred',
    effect: 'external-write-deferred',
    prerequisites: ['source-auth-preflight'],
  },
  {
    name: 'operations-report',
    availability: 'implemented',
    effect: 'local-state',
    prerequisites: [],
  },
  {
    name: 'alert-evaluate',
    availability: 'implemented',
    effect: 'local-state',
    prerequisites: ['operations-report'],
  },
  {
    name: 'brief-morning',
    availability: 'implemented',
    effect: 'local-state',
    prerequisites: ['operations-report'],
  },
  {
    name: 'brief-evening',
    availability: 'implemented',
    effect: 'local-state',
    prerequisites: ['operations-report'],
  },
  {
    name: 'sqlite-backup',
    availability: 'implemented',
    effect: 'local-maintenance',
    prerequisites: [],
  },
  {
    name: 'sqlite-integrity',
    availability: 'implemented',
    effect: 'local-state',
    prerequisites: [],
  },
  {
    name: 'state-retention',
    availability: 'implemented',
    effect: 'local-maintenance',
    prerequisites: ['sqlite-backup'],
  },
] as const;

export interface OperationsJobRequest {
  readonly jobName: OperationsJobName;
  readonly runId: string;
  readonly scopeId: string;
  readonly requestedAt: string;
  readonly deadlineAt: string;
}

export type OperationsJobHandler = (
  request: OperationsJobRequest,
  signal: AbortSignal,
) => Promise<TypedJobResult>;

export type OperationsJobHandlers = Partial<
  Readonly<Record<OperationsJobName, OperationsJobHandler>>
>;

export class OperationsJobRequestError extends Error {
  constructor(
    readonly code:
      | 'job-request-invalid'
      | 'job-unknown'
      | 'job-handler-invalid'
      | 'job-result-invalid',
  ) {
    super(`Operations job request rejected: ${code}`);
    this.name = 'OperationsJobRequestError';
  }
}

export function isOperationsJobRequest(
  value: unknown,
): value is OperationsJobRequest {
  try {
    return (
      isPlainObject(value) &&
      hasExactKeys(value, [
        'jobName',
        'runId',
        'scopeId',
        'requestedAt',
        'deadlineAt',
      ]) &&
      isOperationsJobName(value.jobName) &&
      isNonEmptyString(value.runId) &&
      value.runId.length <= 128 &&
      isNonEmptyString(value.scopeId) &&
      value.scopeId.length <= 128 &&
      isIsoInstant(value.requestedAt) &&
      isIsoInstant(value.deadlineAt) &&
      Date.parse(value.deadlineAt) > Date.parse(value.requestedAt)
    );
  } catch {
    return false;
  }
}

export function isTypedJobResult(value: unknown): value is TypedJobResult {
  try {
    if (
      !isPlainObject(value) ||
      value.contractVersion !== contractVersion ||
      !isNonEmptyString(value.runId) ||
      !isNonEmptyString(value.jobName) ||
      !isIsoInstant(value.startedAt) ||
      !isIsoInstant(value.finishedAt) ||
      Date.parse(value.finishedAt) < Date.parse(value.startedAt) ||
      !isDiagnostics(value.diagnostics) ||
      !Number.isSafeInteger(value.attemptedExternalMutations) ||
      !Number.isSafeInteger(value.completedExternalMutations) ||
      Number(value.attemptedExternalMutations) < 0 ||
      Number(value.completedExternalMutations) < 0 ||
      Number(value.completedExternalMutations) >
        Number(value.attemptedExternalMutations)
    )
      return false;

    switch (value.category) {
      case 'succeeded':
        return (
          hasExactKeys(value, [
            'contractVersion',
            'runId',
            'jobName',
            'startedAt',
            'finishedAt',
            'diagnostics',
            'category',
            'attemptedExternalMutations',
            'completedExternalMutations',
            'errors',
          ]) &&
          Array.isArray(value.errors) &&
          value.errors.length === 0
        );
      case 'degraded':
        return (
          hasExactKeys(value, [
            'contractVersion',
            'runId',
            'jobName',
            'startedAt',
            'finishedAt',
            'diagnostics',
            'category',
            'attemptedExternalMutations',
            'completedExternalMutations',
            'errors',
          ]) &&
          Array.isArray(value.errors) &&
          value.errors.every(isActionableError)
        );
      case 'skipped':
        return (
          hasExactKeys(value, [
            'contractVersion',
            'runId',
            'jobName',
            'startedAt',
            'finishedAt',
            'diagnostics',
            'category',
            'attemptedExternalMutations',
            'completedExternalMutations',
            'reason',
            'errors',
          ]) &&
          (value.reason === 'not-required' ||
            value.reason === 'prerequisite-unavailable' ||
            value.reason === 'unsafe-to-proceed') &&
          Array.isArray(value.errors) &&
          value.errors.every(isActionableError)
        );
      case 'repair-required':
        if (!(
          hasExactKeys(value, [
            'contractVersion',
            'runId',
            'jobName',
            'startedAt',
            'finishedAt',
            'diagnostics',
            'category',
            'attemptedExternalMutations',
            'completedExternalMutations',
            'error',
          ]) &&
          value.attemptedExternalMutations === 0 &&
          value.completedExternalMutations === 0 &&
          isActionableError(value.error)
        ))
          return false;
        return (
          isPlainObject(value.error) &&
          value.error.category === 'authentication-repair-required'
        );
      case 'failed':
        return (
          hasExactKeys(value, [
            'contractVersion',
            'runId',
            'jobName',
            'startedAt',
            'finishedAt',
            'diagnostics',
            'category',
            'attemptedExternalMutations',
            'completedExternalMutations',
            'error',
          ]) && isActionableError(value.error)
        );
      default:
        return false;
    }
  } catch {
    return false;
  }
}

export class OperationsJobRegistry {
  readonly #handlers: OperationsJobHandlers;

  constructor(handlers: OperationsJobHandlers) {
    for (const [name, handler] of Object.entries(handlers)) {
      const definition = operationsJobDefinitions.find(
        (candidate) => candidate.name === name,
      );
      if (
        definition === undefined ||
        definition.availability !== 'implemented' ||
        typeof handler !== 'function'
      )
        throw new OperationsJobRequestError('job-handler-invalid');
    }
    this.#handlers = { ...handlers };
  }

  definition(name: unknown): OperationsJobDefinition {
    if (!isOperationsJobName(name))
      throw new OperationsJobRequestError('job-unknown');
    const definition = operationsJobDefinitions.find(
      (candidate) => candidate.name === name,
    );
    if (definition === undefined)
      throw new OperationsJobRequestError('job-unknown');
    return definition;
  }

  async execute(
    request: OperationsJobRequest,
    signal: AbortSignal,
  ): Promise<TypedJobResult> {
    if (!isOperationsJobRequest(request))
      throw new OperationsJobRequestError('job-request-invalid');
    const definition = this.definition(request.jobName);
    if (definition.availability === 'deferred') return deferredResult(request);
    const handler = this.#handlers[request.jobName];
    if (handler === undefined)
      throw new OperationsJobRequestError('job-handler-invalid');
    const result = await handler(request, signal);
    if (
      !isTypedJobResult(result) ||
      result.jobName !== request.jobName ||
      result.runId !== request.runId
    )
      throw new OperationsJobRequestError('job-result-invalid');
    return result;
  }
}

function deferredResult(request: OperationsJobRequest): TypedJobResult {
  const error = {
    category: 'unavailable',
    code: 'job-deferred',
    message: 'This job remains unavailable until its later migration gate.',
    retryable: false,
    diagnostics: [],
  } as const;
  return {
    contractVersion,
    runId: request.runId,
    jobName: request.jobName,
    startedAt: request.requestedAt,
    finishedAt: request.requestedAt,
    diagnostics: [],
    category: 'skipped',
    attemptedExternalMutations: 0,
    completedExternalMutations: 0,
    reason: 'prerequisite-unavailable',
    errors: [error],
  };
}
