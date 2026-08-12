import type { IsoDate, OpaqueId } from '../contracts/v1/common.js';
import { isIsoDate } from './runtime-validation.js';

export const attendanceMarks = ['P', 'T', 'A'] as const;
export type AttendanceMark = (typeof attendanceMarks)[number];

export interface AttendanceMatrix {
  readonly meetings: readonly {
    readonly meetingId: OpaqueId;
    readonly date: IsoDate;
  }[];
  readonly rows: readonly {
    readonly learnerKey: OpaqueId;
    readonly marks: readonly AttendanceMark[];
  }[];
}

export type AttendanceMatrixResult =
  | { readonly status: 'accepted'; readonly matrix: AttendanceMatrix }
  | {
      readonly status: 'rejected';
      readonly codes: readonly AttendanceMatrixRejectionCode[];
    };

export type AttendanceMatrixRejectionCode =
  | 'attendance-matrix-shape-invalid'
  | 'attendance-matrix-budget-exceeded'
  | 'attendance-matrix-roster-invalid'
  | 'attendance-matrix-meetings-invalid'
  | 'attendance-matrix-marks-invalid'
  | 'attendance-matrix-cell-missing';

/**
 * Builds a transient roster-first P/T/A matrix from already-normalized marks.
 * Names, emails, submissions, response bodies, and persistence are absent.
 */
export function buildAttendanceMatrix(input: unknown): AttendanceMatrixResult {
  try {
    if (!exactObject(input, ['marks', 'meetings', 'roster']))
      return rejected('attendance-matrix-shape-invalid');
    const roster = exactArray(input.roster);
    const meetings = exactArray(input.meetings);
    const marks = exactArray(input.marks);
    if (roster === undefined || meetings === undefined || marks === undefined)
      return rejected('attendance-matrix-shape-invalid');
    if (
      roster.length < 1 ||
      roster.length > 100 ||
      meetings.length < 1 ||
      meetings.length > 200 ||
      marks.length > 20_000 ||
      roster.length * meetings.length > 20_000
    )
      return rejected('attendance-matrix-budget-exceeded');

    const learnerKeys: string[] = [];
    for (const entry of roster) {
      if (!exactObject(entry, ['learnerKey']) || !boundedId(entry.learnerKey))
        return rejected('attendance-matrix-roster-invalid');
      learnerKeys.push(entry.learnerKey);
    }
    if (new Set(learnerKeys).size !== learnerKeys.length)
      return rejected('attendance-matrix-roster-invalid');

    const meetingRecords: Array<{ meetingId: string; date: IsoDate }> = [];
    for (const entry of meetings) {
      if (
        !exactObject(entry, ['date', 'meetingId']) ||
        !boundedId(entry.meetingId) ||
        !isIsoDate(entry.date)
      )
        return rejected('attendance-matrix-meetings-invalid');
      meetingRecords.push({
        meetingId: entry.meetingId,
        date: entry.date as IsoDate,
      });
    }
    if (
      new Set(meetingRecords.map((entry) => entry.meetingId)).size !==
        meetingRecords.length ||
      !orderedMeetings(meetingRecords)
    )
      return rejected('attendance-matrix-meetings-invalid');

    const learnerSet = new Set(learnerKeys);
    const meetingSet = new Set(
      meetingRecords.map((meeting) => meeting.meetingId),
    );
    const cells = new Map<string, AttendanceMark>();
    for (const entry of marks) {
      if (
        !exactObject(entry, ['learnerKey', 'meetingId', 'status']) ||
        !boundedId(entry.learnerKey) ||
        !boundedId(entry.meetingId) ||
        !attendanceMarks.includes(entry.status as AttendanceMark) ||
        !learnerSet.has(entry.learnerKey) ||
        !meetingSet.has(entry.meetingId)
      )
        return rejected('attendance-matrix-marks-invalid');
      const key = cellKey(entry.learnerKey, entry.meetingId);
      if (cells.has(key)) return rejected('attendance-matrix-marks-invalid');
      cells.set(key, entry.status as AttendanceMark);
    }
    if (cells.size !== learnerKeys.length * meetingRecords.length)
      return rejected('attendance-matrix-cell-missing');

    return {
      status: 'accepted',
      matrix: deepFreeze({
        meetings: meetingRecords,
        rows: learnerKeys.map((learnerKey) => ({
          learnerKey,
          marks: meetingRecords.map((meeting) =>
            cells.get(cellKey(learnerKey, meeting.meetingId))!,
          ),
        })),
      }),
    };
  } catch {
    return rejected('attendance-matrix-shape-invalid');
  }
}

function orderedMeetings(
  meetings: readonly { readonly meetingId: string; readonly date: string }[],
): boolean {
  for (let index = 1; index < meetings.length; index += 1) {
    const previous = meetings[index - 1]!;
    const current = meetings[index]!;
    if (
      previous.date > current.date ||
      (previous.date === current.date &&
        previous.meetingId.localeCompare(current.meetingId) >= 0)
    )
      return false;
  }
  return true;
}

function cellKey(learnerKey: string, meetingId: string): string {
  return `${learnerKey}\u0000${meetingId}`;
}

function boundedId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)
  );
}

function exactObject(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actual = Reflect.ownKeys(descriptors);
  return (
    actual.length === keys.length &&
    actual.every(
      (key) =>
        typeof key === 'string' &&
        keys.includes(key) &&
        descriptors[key]?.enumerable === true &&
        Object.hasOwn(descriptors[key]!, 'value'),
    )
  );
}

function exactArray(value: unknown): readonly unknown[] | undefined {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype)
    return undefined;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const length = Reflect.getOwnPropertyDescriptor(value, 'length')?.value;
  if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0)
    return undefined;
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== length + 1) return undefined;
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (
      descriptor === undefined ||
      descriptor.enumerable !== true ||
      !Object.hasOwn(descriptor, 'value')
    )
      return undefined;
  }
  return value;
}

function rejected(code: AttendanceMatrixRejectionCode): AttendanceMatrixResult {
  return { status: 'rejected', codes: [code] };
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
