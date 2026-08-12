import assert from 'node:assert/strict';
import test from 'node:test';

import {
  planAttendanceContinuityExport,
  reconcileAttendanceContinuity,
} from '../../../src/application/persistence/attendance-continuity.js';

function aggregate(attendanceId = 'attendance-alpha') {
  return {
    attendanceId,
    classId: 'class-alpha',
    meetingId: 'meeting-alpha',
    date: '2035-09-04',
    refreshedAt: '2035-09-04T12:00:00Z',
    links: { quick: 'https://fixture.example.invalid/check-in/alpha' },
    summary: {
      rosterCount: 24,
      presentCount: 21,
      tardyCount: 1,
      absentCount: 2,
      responseCount: 22,
    },
    provenance: {
      source: 'synthetic-fixture',
      method: 'fixture',
      observedAt: '2035-09-04T12:00:00Z',
      verification: 'synthetic',
      sourceReference: 'fixture:attendance-alpha',
    },
  };
}

test('accepts aggregate-only records and quarantines unsafe records whole', () => {
  const result = planAttendanceContinuityExport({
    formatVersion: 1,
    exportedAt: '2035-09-04T12:30:00Z',
    records: [
      aggregate(),
      {
        ...aggregate('attendance-quarantined'),
        studentName: 'Synthetic Student Must Not Escape',
      },
    ],
  });

  assert.equal(result.status, 'accepted');
  if (result.status !== 'accepted') return;
  assert.equal(result.plan.batch.operations.length, 1);
  assert.equal(result.report.sourceCount, 2);
  assert.equal(result.report.acceptedCount, 1);
  assert.equal(result.report.quarantinedCount, 1);
  assert.equal(result.report.quarantine[0]?.recordIndex, 1);
  const report = JSON.stringify(result.report);
  assert.doesNotMatch(report, /Synthetic Student|attendance-quarantined/u);
  assert.match(report, /forbidden-field/u);
});

test('requires explicit bounded attendance provenance', () => {
  const missing = aggregate() as Record<string, unknown>;
  delete missing.provenance;
  const invalid = {
    ...aggregate('attendance-beta'),
    provenance: {
      ...aggregate().provenance,
      source: 'powerschool',
    },
  };
  const sensitiveReference = {
    ...aggregate('attendance-gamma'),
    provenance: {
      ...aggregate().provenance,
      sourceReference: 'fixture:attendance:student-123',
    },
  };
  const result = planAttendanceContinuityExport({
    formatVersion: 1,
    exportedAt: '2035-09-04T12:30:00Z',
    records: [missing, invalid, sensitiveReference],
  });

  assert.equal(result.status, 'accepted');
  if (result.status !== 'accepted') return;
  assert.equal(result.report.acceptedCount, 0);
  assert.equal(result.report.quarantinedCount, 3);
  assert.deepEqual(
    result.report.quarantine.map((entry) => entry.rejections[0]?.code),
    [
      'attendance-provenance-invalid',
      'attendance-provenance-invalid',
      'attendance-provenance-invalid',
    ],
  );
});

test('quarantines duplicate aggregate identities deterministically', () => {
  const result = planAttendanceContinuityExport({
    formatVersion: 1,
    exportedAt: '2035-09-04T12:30:00Z',
    records: [aggregate(), aggregate()],
  });

  assert.equal(result.status, 'accepted');
  if (result.status !== 'accepted') return;
  assert.equal(result.report.acceptedCount, 1);
  assert.equal(result.report.quarantinedCount, 1);
  assert.equal(
    result.report.quarantine[0]?.rejections[0]?.code,
    'attendance-record-duplicate',
  );
});

test('quarantines oversized aggregate identifiers, links, and counts', () => {
  const cases = [
    { ...aggregate(), classId: `class-${'x'.repeat(128)}` },
    {
      ...aggregate(),
      links: { quick: `https://fixture.example.invalid/${'x'.repeat(2_048)}` },
    },
    {
      ...aggregate(),
      summary: { ...aggregate().summary, rosterCount: 10_001 },
    },
  ];

  for (const record of cases) {
    const result = planAttendanceContinuityExport({
      formatVersion: 1,
      exportedAt: '2035-09-04T12:30:00Z',
      records: [record],
    });
    assert.equal(result.status, 'accepted');
    if (result.status !== 'accepted') continue;
    assert.equal(result.report.acceptedCount, 0);
    assert.equal(
      result.report.quarantine[0]?.rejections[0]?.code,
      'attendance-record-bounds-invalid',
    );
  }
});

test('rejects unsupported envelopes and enforces the top-level record budget', () => {
  assert.deepEqual(
    planAttendanceContinuityExport({
      formatVersion: 2,
      exportedAt: '2035-09-04T12:30:00Z',
      records: [],
    }),
    {
      status: 'rejected',
      code: 'attendance-export-version-unsupported',
    },
  );
  assert.deepEqual(
    planAttendanceContinuityExport({
      formatVersion: 1,
      exportedAt: '2035-09-04T12:30:00Z',
      records: Array.from({ length: 501 }, () => aggregate()),
    }),
    {
      status: 'rejected',
      code: 'attendance-export-budget-exceeded',
    },
  );
});

test('reconciliation exposes counts and stable mismatch codes only', () => {
  const planned = planAttendanceContinuityExport({
    formatVersion: 1,
    exportedAt: '2035-09-04T12:30:00Z',
    records: [aggregate()],
  });
  assert.equal(planned.status, 'accepted');
  if (planned.status !== 'accepted') return;

  const matched = reconcileAttendanceContinuity(planned, {
    status: 'imported',
    importId: 'import-private-identifier',
    semanticHash: 'accepted:private-hash',
    acceptedCount: 1,
    insertedCount: 1,
    unchangedCount: 0,
    rejectedCount: 0,
    rejections: [],
  });
  assert.deepEqual(matched, {
    status: 'matched',
    sourceCount: 1,
    acceptedCount: 1,
    quarantinedCount: 0,
    insertedCount: 1,
    unchangedCount: 0,
    codes: [],
  });
  assert.doesNotMatch(JSON.stringify(matched), /private/u);

  const mismatch = reconcileAttendanceContinuity(planned, {
    status: 'rejected',
    importId: 'private',
    semanticHash: 'private',
    acceptedCount: 0,
    insertedCount: 0,
    unchangedCount: 0,
    rejectedCount: 1,
    rejections: [],
  });
  assert.deepEqual(mismatch.codes, [
    'attendance-import-rejected',
    'attendance-accepted-count-mismatch',
    'attendance-applied-count-mismatch',
    'attendance-storage-rejection-mismatch',
  ]);
});
