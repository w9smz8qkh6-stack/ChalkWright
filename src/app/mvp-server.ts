import { lstatSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

import type { AppConfig } from '../config/environment.js';
import { FixtureBackedDisplayController } from '../application/display/controller.js';
import {
  B407MvpHttpController,
  type MvpRuntimeClock,
} from './mvp-controller.js';
import {
  b407FixtureData,
  b407NoClassesPlan,
  b407NextClassPlan,
  b407Plan,
  b407SecondaryPlan,
  MutableFixturePlanSource,
  SqliteFixtureDisplayStore,
  SqliteFixtureOverrideStore,
} from '../infrastructure/fixture/b407.js';
import {
  startClassroomHttpServer,
  type HttpBinaryResource,
  type RunningClassroomHttpServer,
} from '../infrastructure/http/index.js';
import { SqliteDatabase } from '../infrastructure/sqlite/database.js';
import { SqliteApplicationStateRepository } from '../infrastructure/sqlite/repository.js';
import {
  dismissalMediaContract,
  presentationAssetRegistry,
  type DismissalMediaReference,
} from '../presentation/index.js';

const fixtureInstant = '2035-04-13T07:00:00Z';

export interface RunningMvpApplication extends RunningClassroomHttpServer {
  readonly stateDirectory: string;
}

function anchoredFixtureClock(): MvpRuntimeClock {
  const startedAt = process.hrtime.bigint();
  const anchor = Date.parse('2035-04-13T08:00:00Z');
  return {
    now: () =>
      new Date(
        anchor + Number((process.hrtime.bigint() - startedAt) / 1_000_000n),
      ).toISOString(),
  };
}

export function loadAssets(
  projectRoot: string,
): Record<string, HttpBinaryResource> {
  const resources: Record<string, HttpBinaryResource> = {};
  for (const entry of Object.values(presentationAssetRegistry)) {
    if (!entry.publicPath.startsWith('/assets/')) continue;
    const name = entry.publicPath.slice('/assets/'.length);
    resources[name] = {
      bytes: readFileSync(resolve(projectRoot, entry.repositoryPath)),
      contentType: entry.contentType,
    };
  }
  return resources;
}

export function loadDismissalMedia(reference?: DismissalMediaReference): {
  readonly resources: Record<string, HttpBinaryResource>;
  readonly ready: boolean;
} {
  if (reference === undefined) return { resources: {}, ready: false };
  if (
    !isAbsolute(reference.path) ||
    resolve(reference.path) !== reference.path ||
    reference.path === '/' ||
    !Number.isSafeInteger(reference.byteLength) ||
    reference.byteLength < 12 ||
    reference.byteLength > 100_000_000 ||
    !/^[a-f0-9]{64}$/u.test(reference.sha256)
  )
    throw new Error('dismissal-media-reference-invalid');
  const mediaPath = reference.path;
  let bytes: Buffer;
  try {
    const metadata = lstatSync(mediaPath);
    if (metadata.isSymbolicLink() || !metadata.isFile())
      throw new Error('dismissal-media-invalid');
    if (metadata.nlink !== 1 || metadata.size !== reference.byteLength)
      throw new Error('dismissal-media-invalid');
    bytes = readFileSync(mediaPath);
  } catch {
    throw new Error('dismissal-media-invalid');
  }
  if (
    bytes.byteLength !== reference.byteLength ||
    bytes.subarray(4, 8).toString('ascii') !== 'ftyp' ||
    createHash('sha256').update(bytes).digest('hex') !== reference.sha256
  )
    throw new Error('dismissal-media-invalid');
  const resource = {
    bytes,
    contentType: dismissalMediaContract.contentType,
  };
  return {
    resources: {
      dismissal: resource,
      'horse.mp4': resource,
    },
    ready: true,
  };
}

/** Start only the synthetic M-05 application using disposable SQLite state. */
export async function startFixtureBackedMvp(
  config: AppConfig,
  projectRoot = process.cwd(),
  options: {
    readonly clock?: MvpRuntimeClock;
    readonly legacyRouteCompatibility?: boolean;
    readonly dismissalMedia?: DismissalMediaReference;
  } = {},
): Promise<RunningMvpApplication> {
  const stateDirectory = mkdtempSync(join(tmpdir(), 'classroom-hub-m05-'));
  const database = new SqliteDatabase(join(stateDirectory, 'state.sqlite'), {
    migration: { appliedAt: fixtureInstant },
  });
  let revision = 0;
  const repository = new SqliteApplicationStateRepository(database, {
    clock: { now: () => fixtureInstant },
    nextRevision: () => `m05-revision-${++revision}`,
    academicYearEndForDate: () => '2035-06-30',
  });
  const persistence = new SqliteFixtureDisplayStore(database, repository);
  const overrides = new SqliteFixtureOverrideStore(repository);
  const display = new FixtureBackedDisplayController({
    data: b407FixtureData,
    plans: new MutableFixturePlanSource([
      b407Plan,
      b407SecondaryPlan,
      b407NoClassesPlan,
      b407NextClassPlan,
    ]),
    planStore: persistence,
    overrides,
    holds: persistence,
  });
  const media = loadDismissalMedia(options.dismissalMedia);
  const legacyRouteCompatibility = options.legacyRouteCompatibility === true;
  try {
    const running = await startClassroomHttpServer({
      controller: new B407MvpHttpController(
        display,
        media.ready,
        options.clock ?? anchoredFixtureClock(),
        legacyRouteCompatibility ? '/classroom-screen' : '',
      ),
      host: config.host,
      port: config.port,
      ...(config.operatorToken === undefined
        ? {}
        : { mutationToken: config.operatorToken }),
      assets: loadAssets(projectRoot),
      media: media.resources,
      displayCompatibilityPaths: {
        '/': 'screen-b407',
        '/tv': 'screen-b407',
        '/b407': 'screen-b407',
      },
      ...(legacyRouteCompatibility
        ? {
            routePrefix: '/classroom-screen' as const,
            legacyRouteCompatibility: true,
            screenIdAliases: { b407: 'screen-b407' },
          }
        : {}),
    });
    let closed = false;
    return {
      ...running,
      stateDirectory,
      async close(): Promise<void> {
        if (closed) return;
        closed = true;
        await running.close();
        database.close();
        rmSync(stateDirectory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    database.close();
    rmSync(stateDirectory, { recursive: true, force: true });
    throw error;
  }
}
