import type { ContractDiagnostic, OpaqueId } from '../contracts/v1/common.js';
import { compactText, diagnostic } from './pure-values.js';

export interface AttendanceLinks {
  readonly directPrefilled?: string;
  readonly directResponder?: string;
  readonly wrapper?: string;
  readonly quick?: string;
  readonly teacherDisplay?: string;
  readonly classroom?: string;
}

function validHttpUrl(value: string | undefined): string | undefined {
  try {
    if (value === undefined) return undefined;
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') &&
      url.username.length === 0 &&
      url.password.length === 0
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

export function resolveAttendanceLink(links: AttendanceLinks): {
  readonly url?: string;
  readonly source?: keyof AttendanceLinks;
  readonly diagnostics: readonly ContractDiagnostic[];
} {
  for (const source of [
    'directPrefilled',
    'directResponder',
    'wrapper',
    'quick',
  ] as const) {
    const url = validHttpUrl(links[source]);
    if (url !== undefined) return { url, source, diagnostics: [] };
  }
  return {
    diagnostics: [
      diagnostic(
        'attendance-link-missing',
        'warning',
        'No valid attendance link is configured.',
      ),
    ],
  };
}

export interface PreCheckInDisplayModel {
  readonly meetingId: OpaqueId;
  readonly attendanceUrl?: string;
  readonly qrTarget?: string;
  readonly attendanceSummary?: AttendanceSummary;
  readonly classCode?: string;
  readonly teacherDisplayUrl?: string;
  readonly classroomUrl?: string;
  readonly diagnostics: readonly ContractDiagnostic[];
}

export interface RawAttendanceSummary {
  readonly rosterCount?: unknown;
  readonly presentCount?: unknown;
  readonly tardyCount?: unknown;
  readonly absentCount?: unknown;
  readonly responseCount?: unknown;
}

export interface AttendanceSummary {
  readonly rosterCount?: number;
  readonly presentCount?: number;
  readonly tardyCount?: number;
  readonly absentCount?: number;
  readonly responseCount?: number;
}

export function normalizeAttendanceSummary(
  value: RawAttendanceSummary | undefined,
): {
  readonly summary: AttendanceSummary;
  readonly diagnostics: readonly ContractDiagnostic[];
} {
  const diagnostics: ContractDiagnostic[] = [];
  const summary: Record<string, number> = {};
  for (const key of [
    'rosterCount',
    'presentCount',
    'tardyCount',
    'absentCount',
    'responseCount',
  ] as const) {
    const raw = value?.[key];
    if (
      raw === undefined ||
      raw === null ||
      (typeof raw === 'string' && compactText(raw).length === 0)
    )
      continue;
    if (typeof raw !== 'number' && typeof raw !== 'string') {
      diagnostics.push(
        diagnostic(
          'attendance-count-invalid',
          'warning',
          `The ${key} attendance value is invalid.`,
        ),
      );
      continue;
    }
    const count = Number(raw);
    if (!Number.isInteger(count) || count < 0) {
      diagnostics.push(
        diagnostic(
          'attendance-count-invalid',
          'warning',
          `The ${key} attendance value is invalid.`,
        ),
      );
      continue;
    }
    summary[key] = count;
  }
  return { summary, diagnostics };
}

/** Supplies QR target data only; QR rendering belongs to a later milestone. */
export function buildPreCheckInDisplayModel(options: {
  readonly meetingId: OpaqueId;
  readonly links: AttendanceLinks;
  readonly attendanceSummary?: RawAttendanceSummary;
  readonly classCode?: string;
}): PreCheckInDisplayModel {
  const resolved = resolveAttendanceLink(options.links);
  const attendance = normalizeAttendanceSummary(options.attendanceSummary);
  const diagnostics = [...resolved.diagnostics, ...attendance.diagnostics];
  const teacherDisplayUrl = validHttpUrl(options.links.teacherDisplay);
  const classroomUrl = validHttpUrl(options.links.classroom);
  const hasAttendanceSummary = Object.keys(attendance.summary).length > 0;
  return {
    meetingId: options.meetingId,
    ...(resolved.url === undefined
      ? {}
      : { attendanceUrl: resolved.url, qrTarget: resolved.url }),
    ...(hasAttendanceSummary ? { attendanceSummary: attendance.summary } : {}),
    ...(options.classCode === undefined
      ? {}
      : { classCode: options.classCode }),
    ...(teacherDisplayUrl === undefined ? {} : { teacherDisplayUrl }),
    ...(classroomUrl === undefined ? {} : { classroomUrl }),
    diagnostics,
  };
}
