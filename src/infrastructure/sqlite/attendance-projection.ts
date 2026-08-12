import { createHash } from 'node:crypto';

import { isContinuityImportRecord } from '../../application/persistence/continuity-importer.js';
import type { IsoDate, OpaqueId } from '../../contracts/v1/common.js';
import type {
  AttendanceLinks,
  AttendanceSummary,
} from '../../domain/attendance.js';
import type { ClassId } from '../../domain/identities.js';
import { stableSerialize } from '../../domain/pure-values.js';
import {
  isAttendanceLinks,
  isAttendanceSummary,
} from '../../domain/runtime-validation.js';
import type { SqliteDatabase } from './database.js';

interface AttendanceRow {
  readonly identity: string;
  readonly checksum: string;
  readonly record_json: string;
}

/** Reads only validated aggregate continuity; corrupt or ambiguous rows fail closed. */
export class SqliteAttendanceProjectionSource {
  constructor(
    private readonly database: SqliteDatabase,
    private readonly classCodeForClass: Readonly<Record<string, string>>,
  ) {}

  async read(meetingId: OpaqueId, classId: ClassId | undefined, date: IsoDate) {
    const rows = this.database.connection
      .prepare(
        `SELECT identity, checksum, record_json
           FROM continuity_records
          WHERE collection = 'attendanceAggregates'
          ORDER BY imported_at DESC, identity ASC
          LIMIT 501`,
      )
      .all() as unknown as readonly AttendanceRow[];
    if (rows.length > 500)
      throw new Error('attendance-projection-budget-exceeded');

    let match:
      | { readonly summary: AttendanceSummary; readonly links: AttendanceLinks }
      | undefined;
    for (const row of rows) {
      let value: unknown;
      try {
        value = JSON.parse(row.record_json);
      } catch {
        throw new Error('attendance-projection-row-invalid');
      }
      if (
        createHash('sha256').update(stableSerialize(value)).digest('hex') !==
          row.checksum ||
        !isContinuityImportRecord('attendanceAggregates', row.identity, value)
      )
        throw new Error('attendance-projection-row-invalid');
      const record = value as Readonly<Record<string, unknown>>;
      if (
        record.meetingId !== meetingId ||
        record.date !== date ||
        (classId !== undefined && record.classId !== classId)
      )
        continue;
      if (
        !isAttendanceSummary(record.summary) ||
        !isAttendanceLinks(record.links)
      )
        throw new Error('attendance-projection-row-invalid');
      if (match !== undefined)
        throw new Error('attendance-projection-ambiguous');
      match = { summary: record.summary, links: record.links };
    }

    const classCode =
      classId === undefined ? undefined : this.classCodeForClass[classId];
    if (match === undefined && classCode === undefined) return undefined;
    return {
      ...(match === undefined ? {} : match),
      ...(classCode === undefined ? {} : { classCode }),
    };
  }
}
