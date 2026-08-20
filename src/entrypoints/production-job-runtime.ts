import { randomUUID } from 'node:crypto';

import type { ProductionServerConfig } from '../config/production.js';
import { loadProductionServerConfig } from '../config/production.js';
import type { OperationsConfig } from '../config/operations.js';
import { loadOperationsConfig } from '../config/operations.js';
import type { TypedJobResult } from '../domain/job-results.js';
import type { OperationsJobName } from '../domain/operations/jobs.js';
import { validateManagedStatePaths } from '../infrastructure/operations/sqlite-maintenance.js';
import { SqliteDatabase } from '../infrastructure/sqlite/database.js';
import { SqliteApplicationStateRepository } from '../infrastructure/sqlite/repository.js';
import type { OperationsJobHandler } from '../application/operations/registry.js';
import { OperationsJobRegistry } from '../application/operations/registry.js';
import { runOperationsJob } from '../application/operations/runner.js';

export interface ProductionJobRuntimeContext {
  readonly production: ProductionServerConfig;
  readonly operations: OperationsConfig;
  readonly database: SqliteDatabase;
  readonly state: SqliteApplicationStateRepository;
  readonly requestedAt: string;
}

export interface ProductionJobEntrypointOutput {
  readonly exitCode: number;
  readonly status: string;
  readonly code?: string;
  readonly result?: TypedJobResult;
}

/** Reject known application authority that does not belong to this job. */
export function rejectAmbientProductionAuthority(
  environment: NodeJS.ProcessEnv,
  forbiddenPrefixes: readonly string[],
): void {
  for (const [name, value] of Object.entries(environment)) {
    if (
      value !== undefined &&
      value.length > 0 &&
      (name === 'CLASSROOM_HUB_OPERATOR_TOKEN' ||
        forbiddenPrefixes.some((prefix) => name.startsWith(prefix)))
    )
      throw new Error('production-job-ambient-authority-rejected');
  }
}

/** Shared provider-neutral runtime for one exact inert production job binary. */
export async function runProductionJobRuntime(options: {
  readonly arguments: readonly string[];
  readonly jobName: OperationsJobName;
  readonly environment?: NodeJS.ProcessEnv;
  readonly signal?: AbortSignal;
  readonly hardStop: () => never;
  readonly now?: () => string;
  readonly nextId?: () => string;
  readonly hardStopGraceMs?: number;
  readonly handler: (
    context: ProductionJobRuntimeContext,
    environment: NodeJS.ProcessEnv,
  ) => OperationsJobHandler;
}): Promise<ProductionJobEntrypointOutput> {
  if (options.arguments.length !== 0)
    return {
      exitCode: 64,
      status: 'rejected',
      code: 'production-job-usage-invalid',
    };
  const environment = options.environment ?? process.env;
  let database: SqliteDatabase | undefined;
  try {
    const reference = environment.CLASSROOM_HUB_PRODUCTION_CONFIG_REFERENCE;
    if (reference === undefined || reference.length === 0)
      throw new Error('production-job-config-required');
    const production = loadProductionServerConfig(reference);
    const operations = loadOperationsConfig(environment);
    assertMatchingRuntime(production, operations);
    validateManagedStatePaths(operations);
    const now = options.now ?? (() => new Date().toISOString());
    const requestedAt = now();
    database = new SqliteDatabase(operations.databasePath, {
      migration: { appliedAt: requestedAt },
    });
    let revision = 0;
    const state = new SqliteApplicationStateRepository(database, {
      clock: { now },
      nextRevision: () => `production-job-${++revision}-${randomUUID()}`,
      academicYearEndForDate: () => production.academicYearEnd,
    });
    const handler = options.handler(
      { production, operations, database, state, requestedAt },
      environment,
    );
    const result = await runOperationsJob(
      {
        clock: { now },
        registry: new OperationsJobRegistry({ [options.jobName]: handler }),
        state,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        hardStop: options.hardStop,
        ...(options.hardStopGraceMs === undefined
          ? {}
          : { hardStopGraceMs: options.hardStopGraceMs }),
      },
      {
        jobName: options.jobName,
        runId: (options.nextId ?? randomUUID)(),
        scopeId: operations.scopeId,
        requestedAt,
        deadlineAt: new Date(
          Date.parse(requestedAt) + operations.jobDeadlineSeconds * 1_000,
        ).toISOString(),
      },
    );
    return {
      exitCode: exitCodeFor(result),
      status: result.category,
      ...(result.category === 'repair-required' || result.category === 'failed'
        ? { code: result.error.code }
        : {}),
      result,
    };
  } catch {
    return {
      exitCode: 1,
      status: 'rejected',
      code: 'production-job-startup-failed',
    };
  } finally {
    database?.close();
  }
}

function assertMatchingRuntime(
  production: ProductionServerConfig,
  operations: OperationsConfig,
): void {
  if (
    production.instanceId !== operations.instanceId ||
    production.timeZone !== operations.timeZone ||
    production.academicYearEnd !== operations.academicYearEnd ||
    production.managedRoot !== operations.managedRoot ||
    production.databasePath !== operations.databasePath ||
    production.backupDirectory !== operations.backupDirectory
  )
    throw new Error('production-operations-config-mismatch');
}

function exitCodeFor(result: TypedJobResult): number {
  switch (result.category) {
    case 'succeeded':
    case 'skipped':
      return 0;
    case 'degraded':
      return 2;
    case 'repair-required':
      return 3;
    case 'failed':
      return 1;
  }
}
