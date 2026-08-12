import {
  createActiveClassroomRefreshJobHandler,
  projectClassroomRefreshTriggerTarget,
} from '../application/classroom/active-job-handler.js';
import { createPersistentDisplayController } from '../app/shadow-server.js';
import { loadGoogleClassroomReadConfig } from '../config/google-classroom.js';
import type { CourseworkEnrichment } from '../domain/coursework.js';
import { GoogleClassroomCourseworkSource } from '../infrastructure/google-classroom/adapter.js';
import { loadOfficialClassroomCourseWorkTransport } from '../infrastructure/google-classroom/official-client.js';
import { SqliteClassroomEnrichmentCache } from '../infrastructure/sqlite/classroom-cache.js';
import type { EnrichmentObservationSource } from '../ports/read-sources.js';
import {
  rejectAmbientProductionAuthority,
  runProductionJobRuntime,
  type ProductionJobEntrypointOutput,
  type ProductionJobRuntimeContext,
} from './production-job-runtime.js';
import { isDirectEntrypoint } from './direct-invocation.js';

export async function runProductionClassroomRefresh(options: {
  readonly arguments: readonly string[];
  readonly environment?: NodeJS.ProcessEnv;
  readonly signal?: AbortSignal;
  readonly hardStop: () => never;
  readonly now?: () => string;
  readonly nextId?: () => string;
  readonly sourceForRun?: (
    context: ProductionJobRuntimeContext,
    signal: AbortSignal,
    environment: NodeJS.ProcessEnv,
  ) => EnrichmentObservationSource<CourseworkEnrichment>;
}): Promise<ProductionJobEntrypointOutput> {
  return runProductionJobRuntime({
    ...options,
    jobName: 'classroom-refresh',
    handler: (context, environment) => {
      rejectAmbientProductionAuthority(environment, [
        'CLASSROOM_HUB_POWERSCHOOL_',
        'CLASSROOM_HUB_CALENDAR_',
        'CLASSROOM_HUB_ALERT_DELIVERY_REFERENCE',
        'CLASSROOM_HUB_M15_',
      ]);
      const classroom = loadGoogleClassroomReadConfig(environment);
      const expectedMappings = context.production.courseMappings.map(
        ({ classId, providerCourseKey }) => ({ classId, providerCourseKey }),
      );
      if (
        JSON.stringify(classroom.mappings) !== JSON.stringify(expectedMappings)
      )
        throw new Error('production-classroom-mapping-mismatch');
      if (
        classroom.backoffBaseSeconds !== 60 ||
        classroom.backoffMaximumSeconds !== 900
      )
        throw new Error('production-classroom-policy-mismatch');
      const display = createPersistentDisplayController(
        context.production,
        context.database,
      );
      return createActiveClassroomRefreshJobHandler({
        mappings: classroom.mappings,
        cache: new SqliteClassroomEnrichmentCache(context.database),
        timeZone: context.production.timeZone,
        cacheFreshSeconds: classroom.cacheFreshSeconds,
        backoffBaseSeconds: classroom.backoffBaseSeconds,
        backoffMaximumSeconds: classroom.backoffMaximumSeconds,
        maximumParallelCourses: classroom.maximumParallelCourses,
        evaluationIntervalSeconds: 30,
        targetForRun: async (request) =>
          projectClassroomRefreshTriggerTarget(
            await display.getTarget(
              context.production.screenId,
              request.requestedAt,
            ),
          ),
        sourceForRun: (signal) =>
          options.sourceForRun?.(context, signal, environment) ??
          new GoogleClassroomCourseworkSource({
            mappings: classroom.mappings,
            requestTimeoutMs: classroom.requestTimeoutMs,
            maximumPagesPerCourse: classroom.maximumPagesPerCourse,
            maximumItemsPerCourse: classroom.maximumItemsPerCourse,
            transport: loadOfficialClassroomCourseWorkTransport(
              classroom.credentialReferencePath,
            ),
          }),
      });
    },
  });
}

async function main(): Promise<void> {
  const controller = new AbortController();
  const interrupt = (): void => controller.abort('process-signal');
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  const output = await runProductionClassroomRefresh({
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
if (isDirectEntrypoint(import.meta.url, invokedPath)) void main();
