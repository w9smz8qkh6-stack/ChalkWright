import { startProductionApplication } from '../app/production-server.js';
import { loadProductionServerConfig } from '../config/production.js';
import { readProtectedText } from '../infrastructure/filesystem/protected-json.js';
import { isDirectEntrypoint } from './direct-invocation.js';

export async function runProductionServerEntrypoint(
  signal: AbortSignal,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const reference = environment.CLASSROOM_HUB_PRODUCTION_CONFIG_REFERENCE;
  if (reference === undefined || reference.length === 0)
    throw new Error('production-server-config-required');
  const config = loadProductionServerConfig(reference);
  const operatorToken = readProtectedText(config.operatorTokenReference, {
    minimumBytes: 16,
    maximumBytes: 256,
  });
  const running = await startProductionApplication(config, operatorToken);
  process.stdout.write(
    'Classroom Hub production reader is listening on loopback.\n',
  );
  await waitForProductionServerShutdown(running, signal);
}

export async function waitForProductionServerShutdown(
  running: { readonly close: () => Promise<void> },
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) {
    await running.close();
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const stop = (): void => {
      signal.removeEventListener('abort', stop);
      void running.close().then(resolve, reject);
    };
    signal.addEventListener('abort', stop, { once: true });
  });
}

const invokedPath = process.argv[1];
if (isDirectEntrypoint(import.meta.url, invokedPath)) {
  const controller = new AbortController();
  const interrupt = (): void => controller.abort('process-signal');
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  void runProductionServerEntrypoint(controller.signal, process.env)
    .catch(() => {
      process.stderr.write('Classroom Hub production startup failed safely.\n');
      process.exitCode = 1;
    })
    .finally(() => {
      process.removeListener('SIGINT', interrupt);
      process.removeListener('SIGTERM', interrupt);
    });
}
