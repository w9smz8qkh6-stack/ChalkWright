import type { OpaqueId } from '../contracts/v1/common.js';
import { compactText, slug } from './pure-values.js';

declare const identityKind: unique symbol;

/** Nominal identity prevents accidental class, room, and screen cross-wiring. */
export type DomainIdentity<Kind extends string> = OpaqueId & {
  readonly [identityKind]: Kind;
};

export type ClassId = DomainIdentity<'class'>;
export type RoomId = DomainIdentity<'room'>;
export type ScreenId = DomainIdentity<'screen'>;

export function screenIdFromLocation(location: unknown): ScreenId | undefined {
  const value = slug(location);
  return value.length === 0 ? undefined : (value as ScreenId);
}

/** Canonicalize a provider or legacy room label into an idempotent room ID. */
export function roomIdFromLocation(location: unknown): RoomId | undefined {
  const value = slug(location).replace(/^room-/, '');
  return value.length === 0 ? undefined : (`room-${value}` as RoomId);
}

/** Normalize the section code shared by Classroom and PowerSchool. */
export function courseKeyFromSectionCode(
  sectionCode: unknown,
): OpaqueId | undefined {
  const value = slug(sectionCode);
  return value.length === 0 ? undefined : value;
}

/** Match a PowerSchool code as one delimiter-bounded token in Classroom section text. */
export function sectionCodeContainsCourseKey(
  sectionCode: unknown,
  courseKey: unknown,
): boolean {
  const section = courseKeyFromSectionCode(sectionCode);
  const course = courseKeyFromSectionCode(courseKey);
  if (section === undefined || course === undefined) return false;
  return `-${section}-`.includes(`-${course}-`);
}

export function classIdFromLegacyRecord(record: {
  readonly studentCheckInUrl?: unknown;
  readonly attendanceDisplayUrl?: unknown;
  readonly targetAttendanceDisplayUrl?: unknown;
  readonly courseName?: unknown;
  readonly blockLabel?: unknown;
}): ClassId | undefined {
  for (const value of [
    record.studentCheckInUrl,
    record.attendanceDisplayUrl,
    record.targetAttendanceDisplayUrl,
  ]) {
    const encoded = compactText(value).match(/[?&]class_key=([^&]+)/)?.[1];
    if (encoded !== undefined) {
      try {
        const decoded = decodeURIComponent(encoded);
        return decoded.length === 0 ? undefined : (decoded as ClassId);
      } catch {
        return undefined;
      }
    }
  }
  const fallback =
    `${slug(record.courseName)}-${slug(record.blockLabel)}`.replace(
      /^-|-$/g,
      '',
    );
  return fallback.length === 0 ? undefined : (fallback as ClassId);
}
