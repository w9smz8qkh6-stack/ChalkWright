import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('keeps transient attendance matrices outside persistence and HTTP modules', () => {
  for (const file of [
    'src/application/persistence/attendance-continuity.ts',
    'src/application/persistence/continuity-importer.ts',
    'src/infrastructure/sqlite/continuity-import.ts',
    'src/infrastructure/sqlite/migrations.ts',
    'src/infrastructure/http/server.ts',
  ]) {
    assert.doesNotMatch(
      readFileSync(file, 'utf8'),
      /attendance-matrix|AttendanceMatrix|learnerKey/u,
      `${file} must not receive learner-level matrix data`,
    );
  }
});

test('keeps the attendance continuity surface aggregate-only', () => {
  const source = readFileSync(
    'src/application/persistence/attendance-continuity.ts',
    'utf8',
  );
  assert.doesNotMatch(
    source,
    /(?:readonly\s+|record\.)(?:learnerKey|studentName|studentEmail|submission|responseBody|rosterRows|attendanceRows)\b/u,
  );
  assert.match(source, /planContinuityImport/u);
  assert.match(source, /validAttendanceProvenance/u);
});
