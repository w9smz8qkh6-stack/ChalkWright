import { createPlanRefreshJobHandler } from '../application/integration/plan-refresh-handler.js';
import { loadPowerSchoolRoutineConfig } from '../config/powerschool-session.js';
import type { ScheduleObservationSource } from '../ports/read-sources.js';
import { PassivePowerSchoolBellScheduleSource } from '../infrastructure/powerschool-session/bell-schedule-source.js';
import {
  rejectAmbientProductionAuthority,
  runProductionJobRuntime,
  type ProductionJobEntrypointOutput,
  type ProductionJobRuntimeContext,
} from './production-job-runtime.js';
import { isDirectEntrypoint } from './direct-invocation.js';

export async function runProductionPlanRefresh(options: {
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
  ) => ScheduleObservationSource;
}): Promise<ProductionJobEntrypointOutput> {
  return runProductionJobRuntime({
    ...options,
    jobName: 'source-auth-preflight',
    handler: (context, environment) => {
      rejectAmbientProductionAuthority(environment, [
        'CLASSROOM_HUB_CLASSROOM_',
        'CLASSROOM_HUB_CALENDAR_',
        'CLASSROOM_HUB_ALERT_DELIVERY_REFERENCE',
        'CLASSROOM_HUB_M15_',
        'CLASSROOM_HUB_POWERSCHOOL_REPAIR_',
      ]);
      const powerSchool = loadPowerSchoolRoutineConfig(environment);
      if (powerSchool.roomId !== context.production.roomId)
        throw new Error('production-powerschool-room-mismatch');
      return createPlanRefreshJobHandler({
        config: context.production,
        plans: context.state,
        evidencePrefix: 'production',
        sourceForRun: (signal) =>
          options.sourceForRun?.(context, signal, environment) ??
          new PassivePowerSchoolBellScheduleSource(powerSchool, {
            signal,
            environment,
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
  const output = await runProductionPlanRefresh({
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
