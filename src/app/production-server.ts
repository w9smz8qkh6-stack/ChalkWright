import type { ProductionServerConfig } from '../config/production.js';
import {
  startClassroomHttpServer,
  type RunningClassroomHttpServer,
} from '../infrastructure/http/index.js';
import { validateManagedStatePaths } from '../infrastructure/operations/sqlite-maintenance.js';
import { SqliteDatabase } from '../infrastructure/sqlite/database.js';
import {
  B407MvpHttpController,
  type MvpRuntimeClock,
} from './mvp-controller.js';
import { loadAssets, loadDismissalMedia } from './mvp-server.js';
import { createPersistentDisplayController } from './shadow-server.js';

export interface RunningProductionApplication extends RunningClassroomHttpServer {
  readonly instanceId: string;
}

/**
 * Start the provider-free production display composition. Operational install,
 * activation, routing, and provider jobs remain separately gated by M-17.
 */
export async function startProductionApplication(
  config: ProductionServerConfig,
  operatorToken: string,
  projectRoot = process.cwd(),
  options: { readonly clock?: MvpRuntimeClock } = {},
): Promise<RunningProductionApplication> {
  validateManagedStatePaths(config);
  const database = new SqliteDatabase(config.databasePath, {
    migration: { appliedAt: new Date().toISOString() },
  });
  const display = createPersistentDisplayController(config, database);
  const media = loadDismissalMedia(config.dismissalMedia);
  try {
    const running = await startClassroomHttpServer({
      controller: new B407MvpHttpController(
        display,
        media.ready,
        { now: () => options.clock?.now() ?? new Date().toISOString() },
        '/classroom-screen',
      ),
      host: config.host,
      port: config.port,
      mutationToken: operatorToken,
      assets: loadAssets(projectRoot),
      media: media.resources,
      routePrefix: '/classroom-screen',
      legacyRouteCompatibility: true,
      screenIdAliases: { b407: config.screenId },
      displayCompatibilityPaths: {
        '/': config.screenId,
        '/tv': config.screenId,
        '/b407': config.screenId,
      },
    });
    return {
      ...running,
      instanceId: config.instanceId,
      async close(): Promise<void> {
        await running.close();
        database.close();
      },
    };
  } catch (error) {
    database.close();
    throw error;
  }
}
