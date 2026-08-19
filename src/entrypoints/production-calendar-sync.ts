import { loadProductionCalendarConfig } from '../config/production-calendar.js';
import type { M17CanaryCalendarConfig } from '../config/m17-canary.js';
import { isDirectEntrypoint } from './direct-invocation.js';
import { runM17CanaryCalendarSync } from './m17-canary-calendar-sync.js';

export async function runProductionCalendarSync(options: {
  readonly arguments: readonly string[];
  readonly environment?: NodeJS.ProcessEnv;
  readonly signal?: AbortSignal;
  readonly now?: () => string;
}) {
  const environment = options.environment ?? process.env;
  const reference =
    environment.CHALKWRIGHT_PRODUCTION_CALENDAR_CONFIG_REFERENCE;
  if (reference === undefined)
    return {
      exitCode: 1,
      status: 'failed',
      code: 'production-calendar-config-required',
      observedEventCount: 0,
      intentCount: 0,
      attemptedExternalMutations: 0,
      completedExternalMutations: 0,
    } as const;
  return runM17CanaryCalendarSync({
    ...options,
    environment: {
      ...environment,
      CHALKWRIGHT_M17_CANARY_CONFIG_REFERENCE: reference,
    },
    loadConfig: () =>
      loadProductionCalendarConfig(
        reference,
      ) as unknown as M17CanaryCalendarConfig,
    requireCanaryInstance: false,
  });
}

async function main(): Promise<void> {
  const output = await runProductionCalendarSync({
    arguments: process.argv.slice(2),
    signal: AbortSignal.timeout(300_000),
  });
  process.stdout.write(`${JSON.stringify(output)}\n`);
  process.exitCode = output.exitCode;
}

if (isDirectEntrypoint(import.meta.url, process.argv[1])) void main();
