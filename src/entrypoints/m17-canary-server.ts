import { loadM17ActivationManifest } from '../config/m17-activation-manifest.js';
import { runProductionServerEntrypoint } from './production-server.js';
import { verifyM17ActivationManifest } from './m17-canary-activation-manifest.js';
import { isDirectEntrypoint } from './direct-invocation.js';

const manifestPath = '/etc/chalkwright/canary/activation-manifest.json';

export async function runM17CanaryServer(options: {
  readonly arguments: readonly string[];
  readonly environment?: NodeJS.ProcessEnv;
  readonly signal?: AbortSignal;
  readonly now?: () => string;
  readonly runServer?: (
    signal: AbortSignal,
    environment: NodeJS.ProcessEnv,
  ) => Promise<void>;
}): Promise<void> {
  if (options.arguments.length !== 0)
    throw new Error('m17-server-usage-invalid');
  const now = options.now ?? (() => new Date().toISOString());
  const verified = await verifyM17ActivationManifest({
    arguments: ['--verify-current', manifestPath],
    now,
  });
  if (verified.exitCode !== 0) throw new Error('m17-server-manifest-invalid');
  const manifest = loadM17ActivationManifest(manifestPath);
  const remaining = m17ObservationRemainingMs(
    now(),
    manifest.observationEndsAt,
  );
  const signal = AbortSignal.any(
    [AbortSignal.timeout(remaining), options.signal].filter(
      (value): value is AbortSignal => value !== undefined,
    ),
  );
  await (options.runServer ?? runProductionServerEntrypoint)(
    signal,
    options.environment ?? process.env,
  );
}

export function m17ObservationRemainingMs(now: string, endsAt: string): number {
  const remaining = Date.parse(endsAt) - Date.parse(now);
  if (!Number.isFinite(remaining) || remaining < 1)
    throw new Error('m17-server-window-expired');
  return remaining;
}

async function main(): Promise<void> {
  const controller = new AbortController();
  const stop = (): void => controller.abort('process-signal');
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    await runM17CanaryServer({
      arguments: process.argv.slice(2),
      environment: process.env,
      signal: controller.signal,
    });
  } catch {
    process.stderr.write('Chalkwright canary startup failed safely.\n');
    process.exitCode = 1;
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
}

if (isDirectEntrypoint(import.meta.url, process.argv[1])) void main();
