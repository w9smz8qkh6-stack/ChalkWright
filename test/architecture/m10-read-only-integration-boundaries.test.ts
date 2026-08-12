import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('M-10 integration cannot construct Calendar or provider-write capability', () => {
  const source = readFileSync(
    'src/application/integration/read-only-gate.ts',
    'utf8',
  );
  assert.doesNotMatch(
    source,
    /calendar-writer|CalendarWriterPort|calendar-intents|reconcile\(|CalendarMutationIntent/u,
  );
  assert.doesNotMatch(
    source,
    /loadOfficial|loadGoogleClassroomReadConfig|manual-bootstrap|official-client|protected-state|fetch\(|post\(|patch\(|delete\(/iu,
  );
  assert.match(source, /eligibleCalendarIntents: 0/u);
  assert.match(source, /calendarCapabilityConstructed: false/u);
});

test('M-10 result surface contains classifications and counts, not source identities', () => {
  const source = readFileSync(
    'src/application/integration/read-only-gate.ts',
    'utf8',
  );
  const resultInterface = source.slice(
    source.indexOf('export interface M10CaseResult'),
    source.indexOf('export type M10DifferenceCode'),
  );
  assert.doesNotMatch(
    resultInterface,
    /roomId|classId|courseKey|providerCourseKey|observationId|planId|errorMessage|raw/u,
  );
  assert.match(resultInterface, /scheduleStatus/u);
  assert.match(resultInterface, /classroomStatus/u);
  assert.match(resultInterface, /meetingCount/u);
});
