import type { IsoInstant, OpaqueId } from '../contracts/v1/common.js';
import type { TypedJobResult } from '../domain/job-results.js';

export const localCommandKinds = [
  'collect-compatibility-snapshot',
  'render-operator-brief',
] as const;

export type LocalCommandKind = (typeof localCommandKinds)[number];

/**
 * Bounded command data intentionally excludes executables, arguments,
 * environment values, working directories, and arbitrary paths.
 */
export interface LocalCommandRequest {
  readonly commandId: OpaqueId;
  readonly kind: LocalCommandKind;
  readonly deadlineAt: IsoInstant;
  readonly scopeId: OpaqueId;
}

/** Operational compatibility capability; no process implementation is part of M-02. */
export interface LocalCommandPort {
  execute(request: LocalCommandRequest): Promise<TypedJobResult>;
}
