import type { IsoDate, IsoInstant } from '../contracts/v1/common.js';
import type { CourseworkEnrichment } from '../domain/coursework.js';
import type { ClassId } from '../domain/identities.js';
import type { PersistenceWriteResult } from './persistence-write.js';

export interface ClassroomCacheEntry {
  readonly classId: ClassId;
  readonly observedForDate: IsoDate;
  readonly enrichment?: CourseworkEnrichment;
  readonly refreshedAt?: IsoInstant;
  readonly expiresAt?: IsoInstant;
  readonly consecutiveFailures: number;
  readonly lastAttemptAt: IsoInstant;
  readonly nextAttemptAt?: IsoInstant;
  readonly lastErrorCode?: string;
}

/** Local normalized cache only; OAuth and raw provider responses cannot enter it. */
export interface ClassroomEnrichmentCache {
  load(
    classId: ClassId,
    date: IsoDate,
    observedAt: IsoInstant,
  ): Promise<ClassroomCacheEntry | undefined>;
  storeSuccess(options: {
    readonly enrichment: CourseworkEnrichment;
    readonly expiresAt: IsoInstant;
  }): Promise<PersistenceWriteResult>;
  recordFailure(options: {
    readonly classId: ClassId;
    readonly observedForDate: IsoDate;
    readonly attemptedAt: IsoInstant;
    readonly nextAttemptAt: IsoInstant;
    readonly errorCode: string;
  }): Promise<PersistenceWriteResult>;
}
