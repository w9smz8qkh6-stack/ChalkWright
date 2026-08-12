import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  planAttendanceContinuityExport,
  reconcileAttendanceContinuity,
} from '../../../src/application/persistence/attendance-continuity.js';
import { applyContinuityImport } from '../../../src/infrastructure/sqlite/continuity-import.js';
import { SqliteDatabase } from '../../../src/infrastructure/sqlite/database.js';

test('applies aggregate continuity idempotently without persisting learner rows', () => {
  const directory = mkdtempSync(join(tmpdir(), 'classroom-hub-attendance-'));
  const database = new SqliteDatabase(join(directory, 'state.sqlite'), {
    migration: { appliedAt: '2035-09-04T12:00:00Z' },
  });
  try {
    const planned = planAttendanceContinuityExport({
      formatVersion: 1,
      exportedAt: '2035-09-04T12:30:00Z',
      records: [
        {
          attendanceId: 'attendance-alpha',
          classId: 'class-alpha',
          meetingId: 'meeting-alpha',
          date: '2035-09-04',
          refreshedAt: '2035-09-04T12:00:00Z',
          links: {
            quick: 'https://fixture.example.invalid/check-in/alpha',
          },
          summary: {
            rosterCount: 2,
            presentCount: 1,
            tardyCount: 1,
            absentCount: 0,
            responseCount: 2,
          },
          provenance: {
            source: 'synthetic-fixture',
            method: 'fixture',
            observedAt: '2035-09-04T12:00:00Z',
            verification: 'synthetic',
            sourceReference: 'fixture:attendance-alpha',
          },
        },
      ],
    });
    assert.equal(planned.status, 'accepted');
    if (planned.status !== 'accepted') return;
    let sequence = 0;
    const apply = () =>
      applyContinuityImport({
        database,
        plan: planned.plan,
        sourceReference: 'fixture:m09-attendance',
        clock: { now: () => '2035-09-04T12:31:00Z' },
        nextImportId: () => `attendance-import-${++sequence}`,
      });

    const first = apply();
    const repeated = apply();
    assert.equal(first.status, 'imported');
    assert.equal(repeated.status, 'unchanged');
    assert.equal(
      reconcileAttendanceContinuity(planned, first).status,
      'matched',
    );
    assert.equal(
      reconcileAttendanceContinuity(planned, repeated).status,
      'matched',
    );
    const stored = database.connection
      .prepare(
        `SELECT collection, record_json
           FROM continuity_records
          WHERE collection = 'attendanceAggregates'`,
      )
      .all() as unknown as readonly {
      collection: string;
      record_json: string;
    }[];
    assert.equal(stored.length, 1);
    assert.equal(stored[0]?.collection, 'attendanceAggregates');
    assert.doesNotMatch(
      stored[0]?.record_json ?? '',
      /learnerKey|studentName|studentEmail|attendanceRows|rosterRows/u,
    );
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
