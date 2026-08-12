import type { CalendarMutationIntent } from '../contracts/v1/calendar.js';
import type { OpaqueId } from '../contracts/v1/common.js';
import type { TypedJobResult } from '../domain/job-results.js';

export interface CalendarWriteRequest {
  readonly scopeId: OpaqueId;
  readonly writerLeaseId: OpaqueId;
  readonly intents: readonly CalendarMutationIntent[];
}

/** The only Calendar mutation capability; it accepts inert, precomputed intents. */
export interface CalendarWriterPort {
  reconcile(request: CalendarWriteRequest): Promise<TypedJobResult>;
}
