import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { startShadowApplication } from '../app/shadow-server.js';
import { loadShadowConfig } from '../config/shadow.js';

async function main(): Promise<void> {
  try {
    const config = loadShadowConfig();
    const running = await startShadowApplication(config);
    process.stdout.write(
      `Classroom Hub shadow instance ${running.instanceId} is listening on loopback.\n`,
    );
    let stopping = false;
    const stop = async (): Promise<void> => {
      if (stopping) return;
      stopping = true;
      await running.close();
    };
    process.once('SIGINT', () => void stop());
    process.once('SIGTERM', () => void stop());
  } catch {
    process.stderr.write('Classroom Hub shadow startup failed safely.\n');
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  import.meta.url === pathToFileURL(resolve(invokedPath)).href
)
  void main();
