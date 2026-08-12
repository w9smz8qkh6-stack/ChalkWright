import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { createClassroomRefreshJobHandler } from '../application/classroom/job-handler.js';
import { createMaintenanceHandlers } from '../application/operations/handlers.js';
import {
  OperationsJobRegistry,
  type OperationsJobHandlers,
} from '../application/operations/registry.js';
import { runOperationsJob } from '../application/operations/runner.js';
import { createShadowSourceAuthHandler } from '../application/shadow/source-handler.js';
import { loadGoogleClassroomReadConfig } from '../config/google-classroom.js';
import { loadOperationsConfig } from '../config/operations.js';
import { loadPowerSchoolRoutineConfig } from '../config/powerschool-session.js';
import { loadShadowConfig } from '../config/shadow.js';
import {
  isOperationsJobName,
  type OperationsJobName,
} from '../domain/operations/jobs.js';
import { GoogleClassroomCourseworkSource } from '../infrastructure/google-classroom/adapter.js';
import { loadOfficialClassroomCourseWorkTransport } from '../infrastructure/google-classroom/official-client.js';
import { validateManagedStatePaths } from '../infrastructure/operations/sqlite-maintenance.js';
import { PassivePowerSchoolBellScheduleSource } from '../infrastructure/powerschool-session/bell-schedule-source.js';
import { SqliteClassroomEnrichmentCache } from '../infrastructure/sqlite/classroom-cache.js';
import { SqliteDatabase } from '../infrastructure/sqlite/database.js';
import { SqliteApplicationStateRepository } from '../infrastructure/sqlite/repository.js';

const allowedShadowJobs = new Set<OperationsJobName>([
  'source-auth-preflight',
  'classroom-refresh',
  'operations-report',
  'alert-evaluate',
  'brief-morning',
  'brief-evening',
  'sqlite-backup',
  'sqlite-integrity',
  'state-retention',
]);

export function parseShadowJob(
  arguments_: readonly string[],
): OperationsJobName {
  const name = arguments_[0];
  if (
    arguments_.length !== 1 ||
    !isOperationsJobName(name) ||
    !allowedShadowJobs.has(name)
  )
    throw new Error('shadow-job-usage-invalid');
  return name;
}

export async function runShadowJob(options: {
  readonly arguments: readonly string[];
  readonly environment?: NodeJS.ProcessEnv;
  readonly signal?: AbortSignal;
  readonly hardStop: () => never;
}): Promise<{
  readonly exitCode: number;
  readonly status: string;
  readonly code?: string;
}> {
  let jobName: OperationsJobName;
  try {
    jobName = parseShadowJob(options.arguments);
  } catch {
    return {
      exitCode: 64,
      status: 'rejected',
      code: 'shadow-job-usage-invalid',
    };
  }
  let database: SqliteDatabase | undefined;
  try {
    const environment = options.environment ?? process.env;
    const shadow = loadShadowConfig(environment);
    const operations = loadOperationsConfig(environment);
    if (
      operations.instanceId !== shadow.instanceId ||
      operations.managedRoot !== shadow.managedRoot ||
      operations.databasePath !== shadow.databasePath ||
      operations.backupDirectory !== shadow.backupDirectory ||
      operations.timeZone !== shadow.timeZone
    )
      throw new Error('shadow-operations-config-mismatch');
    validateManagedStatePaths(operations);
    const requestedAt = new Date().toISOString();
    database = new SqliteDatabase(operations.databasePath, {
      migration: { appliedAt: requestedAt },
    });
    let revision = 0;
    const repository = new SqliteApplicationStateRepository(database, {
      clock: { now: () => new Date().toISOString() },
      nextRevision: () => `shadow-job-${++revision}-${randomUUID()}`,
      academicYearEndForDate: () => shadow.academicYearEnd,
    });
    let integrationHandlers: OperationsJobHandlers = {};
    if (jobName === 'source-auth-preflight') {
      const powerSchool = loadPowerSchoolRoutineConfig(environment);
      if (powerSchool.roomId !== shadow.roomId)
        throw new Error('shadow-powerschool-room-mismatch');
      integrationHandlers = {
        'source-auth-preflight': createShadowSourceAuthHandler({
          config: shadow,
          plans: repository,
          sourceForRun: (signal) =>
            new PassivePowerSchoolBellScheduleSource(powerSchool, {
              signal,
              environment,
            }),
        }),
      };
    }
    if (jobName === 'classroom-refresh') {
      const classroom = loadGoogleClassroomReadConfig(environment);
      const expected = shadow.courseMappings.map(
        ({ classId, providerCourseKey }) => ({ classId, providerCourseKey }),
      );
      if (JSON.stringify(classroom.mappings) !== JSON.stringify(expected))
        throw new Error('shadow-classroom-mapping-mismatch');
      const source = new GoogleClassroomCourseworkSource({
        mappings: classroom.mappings,
        requestTimeoutMs: classroom.requestTimeoutMs,
        maximumPagesPerCourse: classroom.maximumPagesPerCourse,
        maximumItemsPerCourse: classroom.maximumItemsPerCourse,
        transport: loadOfficialClassroomCourseWorkTransport(
          classroom.credentialReferencePath,
        ),
      });
      integrationHandlers = {
        'classroom-refresh': createClassroomRefreshJobHandler({
          mappings: classroom.mappings,
          source,
          cache: new SqliteClassroomEnrichmentCache(database),
          timeZone: shadow.timeZone,
          cacheFreshSeconds: classroom.cacheFreshSeconds,
          backoffBaseSeconds: classroom.backoffBaseSeconds,
          backoffMaximumSeconds: classroom.backoffMaximumSeconds,
          maximumParallelCourses: classroom.maximumParallelCourses,
        }),
      };
    }
    const handlers: OperationsJobHandlers = {
      ...createMaintenanceHandlers(operations, repository),
      ...integrationHandlers,
    };
    const deadlineAt = new Date(
      Date.parse(requestedAt) + operations.jobDeadlineSeconds * 1_000,
    ).toISOString();
    const result = await runOperationsJob(
      {
        clock: { now: () => new Date().toISOString() },
        registry: new OperationsJobRegistry(handlers),
        state: repository,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        hardStop: options.hardStop,
      },
      {
        jobName,
        runId: randomUUID(),
        scopeId: operations.scopeId,
        requestedAt,
        deadlineAt,
      },
    );
    return {
      exitCode:
        result.category === 'succeeded'
          ? 0
          : result.category === 'repair-required'
            ? 3
            : result.category === 'failed'
              ? 1
              : 2,
      status: result.category,
      ...(result.category === 'repair-required'
        ? { code: result.error.code }
        : {}),
    };
  } catch {
    return {
      exitCode: 1,
      status: 'rejected',
      code: 'shadow-job-startup-failed',
    };
  } finally {
    database?.close();
  }
}

async function main(): Promise<void> {
  const controller = new AbortController();
  const interrupt = () => controller.abort('process-signal');
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  const output = await runShadowJob({
    arguments: process.argv.slice(2),
    signal: controller.signal,
    hardStop: () => process.exit(124),
  });
  process.removeListener('SIGINT', interrupt);
  process.removeListener('SIGTERM', interrupt);
  process.stdout.write(
    `${JSON.stringify({ status: output.status, ...(output.code === undefined ? {} : { code: output.code }) })}\n`,
  );
  process.exitCode = output.exitCode;
}

const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  import.meta.url === pathToFileURL(resolve(invokedPath)).href
)
  void main();
