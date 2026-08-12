import type {
  ContinuityImportRejection,
  ContinuityImportResult,
  ContinuityImportValue,
} from './continuity-importer.js';
import {
  continuityImportFormatVersion,
  planContinuityImport,
} from './continuity-importer.js';
import type { ContinuityImportApplyResult } from '../../infrastructure/sqlite/continuity-import.js';
import { isIsoInstant } from '../../domain/runtime-validation.js';

export interface AttendanceQuarantineRecord {
  readonly recordIndex: number;
  readonly rejections: readonly ContinuityImportRejection[];
}

export interface AttendanceContinuityReport {
  readonly sourceCount: number;
  readonly acceptedCount: number;
  readonly quarantinedCount: number;
  readonly quarantine: readonly AttendanceQuarantineRecord[];
}

export type AttendanceContinuityPlanResult =
  | {
      readonly status: 'accepted';
      readonly plan: Extract<ContinuityImportResult, { status: 'accepted' }>;
      readonly report: AttendanceContinuityReport;
    }
  | {
      readonly status: 'rejected';
      readonly code:
        | 'attendance-export-shape-invalid'
        | 'attendance-export-version-unsupported'
        | 'attendance-export-time-invalid'
        | 'attendance-export-budget-exceeded';
    };

export interface AttendanceContinuityReconciliation {
  readonly status: 'matched' | 'mismatch';
  readonly sourceCount: number;
  readonly acceptedCount: number;
  readonly quarantinedCount: number;
  readonly insertedCount: number;
  readonly unchangedCount: number;
  readonly codes: readonly string[];
}

/** Plans only aggregate attendance records; unsafe records are quarantined whole. */
export function planAttendanceContinuityExport(
  input: unknown,
): AttendanceContinuityPlanResult {
  try {
    if (!exactObject(input, ['exportedAt', 'formatVersion', 'records']))
      return { status: 'rejected', code: 'attendance-export-shape-invalid' };
    if (input.formatVersion !== continuityImportFormatVersion)
      return {
        status: 'rejected',
        code: 'attendance-export-version-unsupported',
      };
    if (!isIsoInstant(input.exportedAt))
      return { status: 'rejected', code: 'attendance-export-time-invalid' };
    const records = exactArray(input.records);
    if (records === undefined)
      return { status: 'rejected', code: 'attendance-export-shape-invalid' };
    if (records.length > 500)
      return { status: 'rejected', code: 'attendance-export-budget-exceeded' };

    const accepted: Readonly<Record<string, ContinuityImportValue>>[] = [];
    const acceptedIdentities = new Set<string>();
    const quarantine: AttendanceQuarantineRecord[] = [];
    records.forEach((record, recordIndex) => {
      const candidate = planContinuityImport({
        formatVersion: continuityImportFormatVersion,
        attendanceAggregates: [record],
      });
      if (candidate.status === 'rejected') {
        quarantine.push({ recordIndex, rejections: candidate.rejections });
        return;
      }
      const operation = candidate.batch.operations[0];
      if (
        operation === undefined ||
        operation.collection !== 'attendanceAggregates' ||
        !validAttendanceProvenance(operation.record.provenance)
      ) {
        quarantine.push({
          recordIndex,
          rejections: [
            {
              category: 'corrupt-record',
              code: 'attendance-provenance-invalid',
              path: '$.attendanceAggregates[0].provenance',
            },
          ],
        });
        return;
      }
      if (!validAttendanceAggregateBounds(operation.record)) {
        quarantine.push({
          recordIndex,
          rejections: [
            {
              category: 'corrupt-record',
              code: 'attendance-record-bounds-invalid',
              path: '$.attendanceAggregates[0]',
            },
          ],
        });
        return;
      }
      if (acceptedIdentities.has(operation.identity)) {
        quarantine.push({
          recordIndex,
          rejections: [
            {
              category: 'corrupt-record',
              code: 'attendance-record-duplicate',
              path: '$.attendanceAggregates[0].attendanceId',
            },
          ],
        });
        return;
      }
      acceptedIdentities.add(operation.identity);
      accepted.push(operation.record);
    });
    const plan = planContinuityImport({
      formatVersion: continuityImportFormatVersion,
      attendanceAggregates: accepted,
    });
    if (plan.status === 'rejected')
      return { status: 'rejected', code: 'attendance-export-shape-invalid' };
    return {
      status: 'accepted',
      plan,
      report: deepFreeze({
        sourceCount: records.length,
        acceptedCount: accepted.length,
        quarantinedCount: quarantine.length,
        quarantine,
      }),
    };
  } catch {
    return { status: 'rejected', code: 'attendance-export-shape-invalid' };
  }
}

/** Compares only counts and stable codes; record identities and values stay out. */
export function reconcileAttendanceContinuity(
  planned: Extract<AttendanceContinuityPlanResult, { status: 'accepted' }>,
  applied: ContinuityImportApplyResult,
): AttendanceContinuityReconciliation {
  const codes: string[] = [];
  if (applied.status === 'rejected') codes.push('attendance-import-rejected');
  if (applied.acceptedCount !== planned.report.acceptedCount)
    codes.push('attendance-accepted-count-mismatch');
  if (
    applied.insertedCount + applied.unchangedCount !==
    planned.report.acceptedCount
  )
    codes.push('attendance-applied-count-mismatch');
  if (applied.rejectedCount !== 0)
    codes.push('attendance-storage-rejection-mismatch');
  return deepFreeze({
    status: codes.length === 0 ? 'matched' : 'mismatch',
    sourceCount: planned.report.sourceCount,
    acceptedCount: planned.report.acceptedCount,
    quarantinedCount: planned.report.quarantinedCount,
    insertedCount: applied.insertedCount,
    unchangedCount: applied.unchangedCount,
    codes,
  });
}

function validAttendanceAggregateBounds(
  record: Readonly<Record<string, ContinuityImportValue>>,
): boolean {
  for (const key of ['attendanceId', 'classId', 'meetingId'] as const)
    if (
      typeof record[key] !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(record[key])
    )
      return false;

  const links = record.links;
  const summary = record.summary;
  if (
    links === null ||
    typeof links !== 'object' ||
    Array.isArray(links) ||
    summary === null ||
    typeof summary !== 'object' ||
    Array.isArray(summary)
  )
    return false;
  return (
    Object.values(links).every(
      (value) => typeof value === 'string' && value.length <= 2_048,
    ) &&
    Object.values(summary).every(
      (value) =>
        typeof value === 'number' &&
        Number.isSafeInteger(value) &&
        value >= 0 &&
        value <= 10_000,
    )
  );
}

function validAttendanceProvenance(value: unknown): boolean {
  if (
    !exactObject(value, [
      'method',
      'observedAt',
      'source',
      'sourceReference',
      'verification',
    ])
  )
    return false;
  const expectedPrefix =
    value.source === 'legacy-transition'
      ? 'legacy:attendance'
      : 'fixture:attendance';
  return (
    (value.source === 'legacy-transition' ||
      value.source === 'synthetic-fixture') &&
    (value.method === 'local-import' || value.method === 'fixture') &&
    isIsoInstant(value.observedAt) &&
    (value.verification === 'verified' || value.verification === 'synthetic') &&
    typeof value.sourceReference === 'string' &&
    value.sourceReference.startsWith(expectedPrefix) &&
    /^(?:fixture|legacy):attendance(?:[-_:][A-Za-z0-9][A-Za-z0-9._:-]{0,95})?$/u.test(
      value.sourceReference,
    ) &&
    !/(?:student|learner|email|submission|response|token|secret|credential|cookie)/iu.test(
      value.sourceReference,
    )
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
  if (Reflect.ownKeys(descriptors).length !== length + 1) return undefined;
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

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
