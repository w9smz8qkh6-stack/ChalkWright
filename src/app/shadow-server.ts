import { randomUUID } from 'node:crypto';

import { FixtureBackedDisplayController } from '../application/display/controller.js';
import type {
  DisplayContentSource,
  DisplayNextClassDaySource,
  DisplayFixtureData,
  DisplayPlanSource,
} from '../application/display/contracts.js';
import type { IsoDate, IsoInstant, OpaqueId } from '../contracts/v1/common.js';
import {
  sectionCodeContainsCourseKey,
  type ClassId,
  type ScreenId,
} from '../domain/identities.js';
import type { EffectiveDayPlan } from '../domain/plans.js';
import { resolveClassContent } from '../domain/content.js';
import { stableId } from '../domain/pure-values.js';
import type { ShadowConfig } from '../config/shadow.js';
import {
  startClassroomHttpServer,
  type RunningClassroomHttpServer,
} from '../infrastructure/http/index.js';
import {
  SqliteFixtureDisplayStore,
  SqliteFixtureOverrideStore,
} from '../infrastructure/fixture/b407.js';
import { SqliteDatabase } from '../infrastructure/sqlite/database.js';
import { SqliteClassroomEnrichmentCache } from '../infrastructure/sqlite/classroom-cache.js';
import { SqliteApplicationStateRepository } from '../infrastructure/sqlite/repository.js';
import { SqliteAttendanceProjectionSource } from '../infrastructure/sqlite/attendance-projection.js';
import { SqliteDisplayContentProjection } from '../infrastructure/sqlite/display-content-projection.js';
import {
  B407MvpHttpController,
  type MvpRuntimeClock,
} from './mvp-controller.js';
import { loadAssets, loadDismissalMedia } from './mvp-server.js';

class ShadowPlanSource implements DisplayPlanSource, DisplayNextClassDaySource {
  constructor(
    private readonly repository: SqliteApplicationStateRepository,
    private readonly config: PersistentDisplayConfig,
    private readonly classByMeeting: Record<string, ClassId>,
    private readonly attendanceClassCodeByMeeting: Record<string, string>,
  ) {}

  async read(screenId: ScreenId, date: IsoDate): Promise<EffectiveDayPlan> {
    if (screenId !== this.config.screenId)
      throw new Error('shadow-screen-scope-mismatch');
    const plan = await this.repository.findEffective({
      screenId,
      roomId: this.config.roomId,
      date,
    });
    if (plan === undefined) throw new Error('shadow-plan-unavailable');
    for (const meeting of plan.meetings) {
      const mapping = this.config.courseMappings.find((entry) =>
        sectionCodeContainsCourseKey(entry.sectionCode, meeting.courseKey),
      );
      if (mapping !== undefined) {
        this.classByMeeting[meeting.meetingId] = mapping.classId;
        if (mapping.attendanceClassCode !== undefined)
          this.attendanceClassCodeByMeeting[meeting.meetingId] =
            mapping.attendanceClassCode;
      }
    }
    return plan;
  }

  async readAfter(screenId: ScreenId, roomId: string, date: IsoDate) {
    if (screenId !== this.config.screenId || roomId !== this.config.roomId)
      throw new Error('shadow-screen-scope-mismatch');
    return this.repository.findNextEffective({
      screenId,
      roomId: this.config.roomId,
      afterDate: date,
    });
  }
}

class ShadowContentSource implements DisplayContentSource {
  private readonly cache: SqliteClassroomEnrichmentCache;
  private readonly local: SqliteDisplayContentProjection;

  constructor(database: SqliteDatabase) {
    this.cache = new SqliteClassroomEnrichmentCache(database);
    this.local = new SqliteDisplayContentProjection(database);
  }

  async read(
    classId: ClassId,
    date: IsoDate,
    observedAt: IsoInstant,
    meetingId?: OpaqueId,
  ) {
    const entry = await this.cache.load(classId, date, observedAt);
    const local = this.local.read(classId, date, meetingId);
    if (
      entry?.enrichment === undefined &&
      (local.staticContent.items?.length ?? 0) === 0 &&
      local.vocabularyCard === undefined
    )
      return undefined;
    const resolved = resolveClassContent({
      configuration: {
        dateOverrides: { [date]: { [classId]: local.staticContent } },
      },
      date,
      classId,
      ...(entry?.enrichment === undefined
        ? {}
        : {
            coursework: [
              ...entry.enrichment.recent,
              ...entry.enrichment.upcoming,
            ],
            courseworkFresh: entry.enrichment.freshness === 'fresh',
          }),
    });
    return {
      assignmentsVisible: true,
      cards: [
        ...resolved.items.map((card, index) => ({
          cardId: stableId('content', classId, date, index, card.title),
          type: card.type,
          title: card.title,
          lines: card.lines,
          ...(card.featured === undefined ? {} : { featured: card.featured }),
          ...(card.details === undefined ? {} : { details: card.details }),
          ...(card.accent === undefined ? {} : { accent: card.accent }),
          ...(card.durationSeconds === undefined
            ? {}
            : { durationSeconds: card.durationSeconds }),
        })),
        ...(local.vocabularyCard === undefined ? [] : [local.vocabularyCard]),
      ],
    };
  }
}

function localDate(instant: string, timeZone: string): IsoDate {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(instant));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}` as IsoDate;
}

export interface RunningShadowApplication extends RunningClassroomHttpServer {
  readonly instanceId: string;
}

export type PersistentDisplayConfig = Pick<
  ShadowConfig,
  | 'roomId'
  | 'screenId'
  | 'screenLabel'
  | 'timeZone'
  | 'academicYearEnd'
  | 'courseMappings'
>;

/** Compose the provider-free persistent display controller over one SQLite DB. */
export function createPersistentDisplayController(
  config: PersistentDisplayConfig,
  database: SqliteDatabase,
): FixtureBackedDisplayController {
  let revision = 0;
  const repository = new SqliteApplicationStateRepository(database, {
    clock: { now: () => new Date().toISOString() },
    nextRevision: () => `display-${++revision}-${randomUUID()}`,
    academicYearEndForDate: () => config.academicYearEnd,
  });
  const classByMeeting: Record<string, ClassId> = {};
  const attendanceClassCodeByMeeting: Record<string, string> = {};
  const data: DisplayFixtureData = {
    displays: [
      {
        screenId: config.screenId,
        roomId: config.roomId,
        label: config.screenLabel,
      },
    ],
    classByMeeting,
    contentByMeeting: {},
    attendanceByMeeting: {},
    attendanceLinksByMeeting: {},
    attendanceClassCodeByMeeting,
    assets: [],
    media: [],
    nextClassDayPlans: [],
  };
  const displayStore = new SqliteFixtureDisplayStore(database, repository);
  const plans = new ShadowPlanSource(
    repository,
    config,
    classByMeeting,
    attendanceClassCodeByMeeting,
  );
  const attendanceClassCodes = Object.fromEntries(
    config.courseMappings.flatMap((mapping) =>
      mapping.attendanceClassCode === undefined
        ? []
        : [[mapping.classId, mapping.attendanceClassCode]],
    ),
  );
  const attendanceCheckInUrls = Object.fromEntries(
    config.courseMappings.flatMap((mapping) =>
      mapping.attendanceCheckInUrl === undefined
        ? []
        : [[mapping.classId, mapping.attendanceCheckInUrl]],
    ),
  );
  return new FixtureBackedDisplayController({
    data,
    plans,
    planStore: displayStore,
    overrides: new SqliteFixtureOverrideStore(repository),
    holds: displayStore,
    content: new ShadowContentSource(database),
    attendance: new SqliteAttendanceProjectionSource(
      database,
      attendanceClassCodes,
      attendanceCheckInUrls,
    ),
    nextClassDays: plans,
    dateForInstant: (instant) => localDate(instant, config.timeZone),
  });
}

/** Start the persistent, loopback-only, mutation-disabled M-11 shadow reader. */
export async function startShadowApplication(
  config: ShadowConfig,
  projectRoot = process.cwd(),
  options: {
    readonly clock?: MvpRuntimeClock;
    readonly legacyRouteCompatibility?: boolean;
  } = {},
): Promise<RunningShadowApplication> {
  const database = new SqliteDatabase(config.databasePath, {
    migration: { appliedAt: new Date().toISOString() },
  });
  const display = createPersistentDisplayController(config, database);
  const media = loadDismissalMedia();
  const legacyRouteCompatibility = options.legacyRouteCompatibility === true;
  try {
    const running = await startClassroomHttpServer({
      controller: new B407MvpHttpController(
        display,
        media.ready,
        { now: () => options.clock?.now() ?? new Date().toISOString() },
        legacyRouteCompatibility ? '/classroom-screen' : '',
      ),
      host: config.host,
      port: config.port,
      assets: loadAssets(projectRoot),
      media: media.resources,
      displayCompatibilityPaths: legacyRouteCompatibility
        ? {
            '/': config.screenId,
            '/tv': config.screenId,
            '/b407': config.screenId,
          }
        : {},
      ...(legacyRouteCompatibility
        ? {
            routePrefix: '/classroom-screen' as const,
            legacyRouteCompatibility: true,
            screenIdAliases: { b407: config.screenId },
          }
        : {}),
    });
    return {
      ...running,
      instanceId: config.instanceId,
      async close() {
        await running.close();
        database.close();
      },
    };
  } catch (error) {
    database.close();
    throw error;
  }
}
