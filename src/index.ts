import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { run, type RunResult } from './app/run.js';
import { startFixtureBackedMvp } from './app/mvp-server.js';
import { loadConfig } from './config/environment.js';

/** Validate startup configuration and invoke the application orchestration. */
export function main(environment: NodeJS.ProcessEnv = process.env): RunResult {
  return run(loadConfig(environment));
}

async function start(): Promise<void> {
  try {
    const config = loadConfig();
    const result = run(config);
    const application = await startFixtureBackedMvp(config);
    process.stdout.write(
      `${result.message}; fixture-backed B407 MVP listening at ${application.origin}\n`,
    );
    let stopping = false;
    const stop = async (): Promise<void> => {
      if (stopping) return;
      stopping = true;
      await application.close();
    };
    process.once('SIGINT', () => void stop());
    process.once('SIGTERM', () => void stop());
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    process.stderr.write(`Classroom Hub failed: ${message}\n`);
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1];

if (
  invokedPath !== undefined &&
  import.meta.url === pathToFileURL(resolve(invokedPath)).href
) {
  void start();
}
