import type { IsoInstant, OpaqueId } from '../contracts/v1/common.js';
import type { ClassId, RoomId, ScreenId } from './identities.js';

export interface Clock {
  now(): IsoInstant;
}

export interface IdentityByKind {
  readonly class: ClassId;
  readonly room: RoomId;
  readonly screen: ScreenId;
  readonly observation: OpaqueId;
  readonly plan: OpaqueId;
  readonly meeting: OpaqueId;
  readonly intent: OpaqueId;
  readonly run: OpaqueId;
  readonly command: OpaqueId;
}

export type IdentityKind = keyof IdentityByKind;

/** Implementations inject deterministic identities in tests and stable IDs in production. */
export interface IdentifierFactory {
  next<Kind extends IdentityKind>(kind: Kind): IdentityByKind[Kind];
}
