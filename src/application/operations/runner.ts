import { contractVersion, type JobOutcome } from '../../contracts/v1/index.js';
import type { Clock } from '../../domain/determinism.js';
import type { ActionableError } from '../../domain/errors.js';
import type { TypedJobResult } from '../../domain/job-results.js';
import { isIsoInstant } from '../../domain/runtime-validation.js';
import type { OperationsStateWriter } from '../../ports/operations.js';
import type { OperationsJobRunRecord } from '../../ports/operations.js';
import {
  isOperationsJobRequest,
  OperationsJobRegistry,
  type OperationsJobRequest,
} from './registry.js';

const maximumDeadlineMilliseconds = 3_600_000;

export interface OperationsJobRunnerDependencies {
  readonly clock: Clock;
  readonly registry: OperationsJobRegistry;
  readonly state: OperationsStateWriter;
  readonly signal?: AbortSignal;
  /** Process-isolation boundary if a trusted handler ignores cancellation. */
  readonly hardStop: () => never;
}

/** Runs one finite registry job and records its redacted outcome. */
export async function runOperationsJob(
  dependencies: OperationsJobRunnerDependencies,
  request: OperationsJobRequest,
): Promise<TypedJobResult> {
  if (!isOperationsJobRequest(request))
    return failedResult(request, safeNow(dependencies.clock), {
      category: 'invalid-input',
      code: 'job-request-invalid',
      message: 'The operations job request is invalid.',
      retryable: false,
      diagnostics: [],
    });
  const startedAt = safeNow(dependencies.clock);
  const remaining = Date.parse(request.deadlineAt) - Date.parse(startedAt);
  let result: TypedJobResult;
  if (remaining <= 0 || remaining > maximumDeadlineMilliseconds) {
    result = failedResult(request, startedAt, {
      category: 'timeout',
      code: 'job-deadline-invalid',
      message: 'The operations job deadline is outside the bounded window.',
      retryable: false,
      diagnostics: [],
    });
  } else {
    const controller = new AbortController();
    try {
      result = await withinDeadline(
        dependencies.registry.execute(request, controller.signal),
        remaining,
        controller,
        dependencies.signal,
        dependencies.hardStop,
        async () => {
          await safeStore(
            dependencies.state,
            ledgerRecord(
              request,
              failedResult(request, safeNow(dependencies.clock), {
                category: 'timeout',
                code: 'job-hard-stop-required',
                message: 'The operations job did not stop cooperatively.',
                retryable: true,
                diagnostics: [],
              }),
            ),
          );
        },
      );
    } catch (error) {
      result = failedResult(request, safeNow(dependencies.clock), {
        category:
          error instanceof OperationsDeadlineError
            ? 'timeout'
            : error instanceof OperationsInterruptedError
              ? 'unavailable'
              : 'internal',
        code:
          error instanceof OperationsDeadlineError
            ? 'job-deadline-exceeded'
            : error instanceof OperationsInterruptedError
              ? 'job-interrupted'
              : 'job-execution-failed',
        message:
          error instanceof OperationsDeadlineError
            ? 'The operations job exceeded its bounded deadline.'
            : error instanceof OperationsInterruptedError
              ? 'The operations job was interrupted safely.'
              : 'The operations job failed safely.',
        retryable: true,
        diagnostics: [],
      });
    }
  }

  const stored = await safeStore(
    dependencies.state,
    ledgerRecord(request, result),
  );
  if (!stored) {
    return failedResult(request, safeNow(dependencies.clock), {
      category: 'unavailable',
      code: 'job-ledger-store-failed',
      message: 'The operations result could not be recorded safely.',
      retryable: true,
      diagnostics: [],
    });
  }
  return result;
}

class OperationsDeadlineError extends Error {}
class OperationsInterruptedError extends Error {}

async function withinDeadline(
  operation: Promise<TypedJobResult>,
  milliseconds: number,
  controller: AbortController,
  externalSignal?: AbortSignal,
  hardStop?: () => never,
  beforeHardStop?: () => Promise<void>,
): Promise<TypedJobResult> {
  let timeout: NodeJS.Timeout | undefined;
  let removeAbortListener: (() => void) | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort('deadline');
      reject(new OperationsDeadlineError('deadline'));
    }, milliseconds);
  });
  const interrupted = new Promise<never>((_resolve, reject) => {
    if (externalSignal === undefined) return;
    const interrupt = (): void => {
      controller.abort('interrupted');
      reject(new OperationsInterruptedError('interrupted'));
    };
    if (externalSignal.aborted) interrupt();
    else {
      externalSignal.addEventListener('abort', interrupt, { once: true });
      removeAbortListener = () =>
        externalSignal.removeEventListener('abort', interrupt);
    }
  });
  try {
    return await Promise.race([operation, deadline, interrupted]);
  } catch (error) {
    // Do not publish a terminal result or close dependencies while a trusted
    // handler can still perform a late effect. Handlers receive the abort
    // signal and must quiesce; the entrypoint hard stop is the final process
    // isolation bound when a trusted handler violates that contract.
    let hardStopTimer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        operation.catch(() => undefined),
        new Promise<never>((_resolve, reject) => {
          hardStopTimer = setTimeout(() => {
            let ledgerTimer: NodeJS.Timeout | undefined;
            const ledgerBound = new Promise<void>((resolve) => {
              ledgerTimer = setTimeout(resolve, 100);
            });
            void Promise.race([
              (beforeHardStop?.() ?? Promise.resolve()).catch(() => undefined),
              ledgerBound,
            ]).then(() => {
              if (ledgerTimer !== undefined) clearTimeout(ledgerTimer);
              try {
                if (hardStop === undefined)
                  throw new Error('operations-hard-stop-missing');
                hardStop();
              } catch (stopError) {
                reject(stopError);
              }
            });
          }, 1_000);
        }),
      ]);
    } finally {
      if (hardStopTimer !== undefined) clearTimeout(hardStopTimer);
    }
    throw error;
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    removeAbortListener?.();
  }
}

async function safeStore(
  state: OperationsStateWriter,
  record: OperationsJobRunRecord,
): Promise<boolean> {
  try {
    const result = await state.storeJobRun(record);
    return result.status === 'stored' || result.status === 'unchanged';
  } catch {
    return false;
  }
}

function ledgerRecord(
  request: OperationsJobRequest,
  result: TypedJobResult,
): OperationsJobRunRecord {
  return {
    kind: 'job-run',
    recordKey: result.runId,
    scope: {},
    data: {
      outcome: frozenOutcome(result),
      errorCodes: resultErrorCodes(result),
      incidentCodes: [],
      requestedDates: [],
      provenanceReferences: [request.scopeId],
    },
  };
}

function frozenOutcome(result: TypedJobResult): JobOutcome {
  return {
    contractVersion: result.contractVersion,
    runId: result.runId,
    jobName: result.jobName,
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    diagnostics: result.diagnostics,
    category: result.category,
    attemptedExternalMutations: result.attemptedExternalMutations,
    completedExternalMutations: result.completedExternalMutations,
  } as JobOutcome;
}

function resultErrorCodes(result: TypedJobResult): readonly string[] {
  switch (result.category) {
    case 'succeeded':
      return [];
    case 'degraded':
    case 'skipped':
      return result.errors.map((error) => error.code).sort();
    case 'repair-required':
    case 'failed':
      return [result.error.code];
  }
}

function safeNow(clock: Clock): string {
  try {
    const now = clock.now();
    return isIsoInstant(now) ? now : '1970-01-01T00:00:00Z';
  } catch {
    return '1970-01-01T00:00:00Z';
  }
}

function failedResult(
  request: Partial<OperationsJobRequest>,
  finishedAt: string,
  error: ActionableError,
): TypedJobResult {
  const startedAt =
    isIsoInstant(request.requestedAt) &&
    Date.parse(request.requestedAt) <= Date.parse(finishedAt)
      ? request.requestedAt
      : finishedAt;
  return {
    contractVersion,
    runId:
      typeof request.runId === 'string' && request.runId.length > 0
        ? request.runId
        : 'invalid-job-run',
    jobName:
      typeof request.jobName === 'string' && request.jobName.length > 0
        ? request.jobName
        : 'invalid-job',
    startedAt,
    finishedAt,
    diagnostics: [],
    category: 'failed',
    attemptedExternalMutations: 0,
    completedExternalMutations: 0,
    error,
  };
}
