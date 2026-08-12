import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { createMaintenanceHandlers } from '../application/operations/handlers.js';
import {
  isOperationsJobName,
  OperationsJobRegistry,
  type OperationsJobName,
} from '../application/operations/registry.js';
import { runOperationsJob } from '../application/operations/runner.js';
import { loadOperationsConfig } from '../config/operations.js';
import type { TypedJobResult } from '../domain/job-results.js';
import { SqliteDatabase } from '../infrastructure/sqlite/database.js';
import { SqliteApplicationStateRepository } from '../infrastructure/sqlite/repository.js';
import {
  inspectManagedDatabase,
  validateManagedStatePaths,
} from '../infrastructure/operations/sqlite-maintenance.js';

export interface JobEntrypointOutput {
  readonly exitCode: number;
  readonly result?: TypedJobResult;
  readonly errorCode?: string;
}

/** Exact one-name parser; validation precedes environment or filesystem access. */
export function parseJobArguments(
  arguments_: readonly string[],
): OperationsJobName {
  if (arguments_.length !== 1 || !isOperationsJobName(arguments_[0]))
    throw new Error('job-usage-invalid');
  return arguments_[0];
}

export async function runJobEntrypoint(options: {
  readonly arguments: readonly string[];
  readonly environment?: NodeJS.ProcessEnv;
  readonly now?: () => string;
  readonly nextId?: () => string;
  readonly signal?: AbortSignal;
  readonly hardStop: () => never;
}): Promise<JobEntrypointOutput> {
  let jobName: OperationsJobName;
  try {
    jobName = parseJobArguments(options.arguments);
  } catch {
    return { exitCode: 64, errorCode: 'job-usage-invalid' };
  }
  let database: SqliteDatabase | undefined;
  try {
    const config = loadOperationsConfig(options.environment);
    const now = options.now ?? (() => new Date().toISOString());
    const requestedAt = now();
    const deadlineAt = new Date(
      Date.parse(requestedAt) + config.jobDeadlineSeconds * 1_000,
    ).toISOString();
    validateManagedStatePaths(config);
    if (jobName === 'sqlite-integrity') inspectManagedDatabase(config);
    database = new SqliteDatabase(config.databasePath, {
      migration: { appliedAt: requestedAt },
    });
    let revision = 0;
    const repository = new SqliteApplicationStateRepository(database, {
      clock: { now },
      nextRevision: () => `ops-${++revision}-${randomUUID()}`,
    });
    const registry = new OperationsJobRegistry(
      createMaintenanceHandlers(config, repository),
    );
    const result = await runOperationsJob(
      {
        clock: { now },
        registry,
        state: repository,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        hardStop: options.hardStop,
      },
      {
        jobName,
        runId: (options.nextId ?? randomUUID)(),
        scopeId: config.scopeId,
        requestedAt,
        deadlineAt,
      },
    );
    return { exitCode: exitCodeFor(result), result };
  } catch {
    return { exitCode: 1, errorCode: 'job-startup-failed' };
  } finally {
    database?.close();
  }
}

function exitCodeFor(result: TypedJobResult): number {
  switch (result.category) {
    case 'succeeded':
      return 0;
    case 'degraded':
    case 'skipped':
      return 2;
    case 'repair-required':
      return 3;
    case 'failed':
      return 1;
  }
}

async function main(): Promise<void> {
  const controller = new AbortController();
  const interrupt = (): void => controller.abort('process-signal');
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  const output = await runJobEntrypoint({
    arguments: process.argv.slice(2),
    signal: controller.signal,
    hardStop: () => process.exit(124),
  });
  process.removeListener('SIGINT', interrupt);
  process.removeListener('SIGTERM', interrupt);
  process.stdout.write(
    `${JSON.stringify(
      output.result === undefined
        ? { status: 'rejected', code: output.errorCode }
        : {
            status: output.result.category,
            runId: output.result.runId,
            jobName: output.result.jobName,
          },
    )}\n`,
  );
  process.exitCode = output.exitCode;
}

const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  import.meta.url === pathToFileURL(resolve(invokedPath)).href
) {
  void main();
}
