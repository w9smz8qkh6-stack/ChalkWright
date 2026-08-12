import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string): string => readFileSync(path, 'utf8');

test('keeps the offline M-14 writer unreachable from every operational entrypoint', () => {
  const operational = [
    'src/application/operations/registry.ts',
    'src/entrypoints/job.ts',
    'src/entrypoints/shadow-job.ts',
    'src/entrypoints/shadow-server.ts',
    'src/app/shadow-server.ts',
    'systemd/classroom-hub-shadow.service',
    'systemd/classroom-hub-shadow-refresh.service',
    'systemd/classroom-hub-shadow-backup.service',
  ]
    .map(read)
    .join('\n');
  assert.doesNotMatch(
    operational,
    /writer-qualification|rollback-qualification|calendar-mutation-transport|calendar-execution-state|calendar-writer/iu,
  );
});

test('keeps credentials and the official Google client out of the offline writer graph', () => {
  const writer = [
    'src/application/calendar/writer-qualification.ts',
    'src/application/calendar/rollback-planner.ts',
    'src/application/calendar/rollback-qualification.ts',
    'src/ports/calendar-mutation-transport.ts',
    'src/ports/calendar-execution-state.ts',
    'src/infrastructure/sqlite/calendar-execution-state.ts',
  ]
    .map(read)
    .join('\n');
  assert.doesNotMatch(
    writer,
    /@googleapis|official-client|OAuth|refreshToken|clientSecret|credentialReference|process\.env|fetch\s*\(|node:https/iu,
  );
});

test('admits only exact event operations and fixed notification suppression', () => {
  const transport = read('src/ports/calendar-mutation-transport.ts').replace(
    /\/\*[\s\S]*?\*\//gu,
    '',
  );
  const requestSurface = transport.split(
    'export class CalendarMutationTransportError',
  )[0]!;
  assert.match(transport, /getEvent/);
  assert.match(transport, /insertEvent/);
  assert.match(transport, /updateEvent/);
  assert.match(transport, /deleteEvent/);
  assert.match(transport, /sendUpdates: 'none'/);
  assert.doesNotMatch(
    requestSurface,
    /attendee|recurrence|conference|attachment|location|requestBody|Record<string/iu,
  );
  assert.match(transport, /reminderPolicy: 'provider-default'/u);
  assert.doesNotMatch(transport, /reminderPolicy: (?:string|number)/u);
});

test('keeps the generated-method adapter credential-free and factory-free', () => {
  const adapter = read(
    'src/infrastructure/google-calendar/offline-writer-adapter.ts',
  ).replace(/\/\*[\s\S]*?\*\//gu, '');
  assert.match(adapter, /client\.events\.get/);
  assert.match(adapter, /client\.events\.insert/);
  assert.match(adapter, /client\.events\.update/);
  assert.match(adapter, /client\.events\.delete/);
  assert.doesNotMatch(
    adapter,
    /\bauth\b|OAuth|refreshToken|clientSecret|credential|calendar\s*\(|process\.env/iu,
  );
});

test('retains the M-13 official adapter as a list-only read capability', () => {
  const official = read(
    'src/infrastructure/google-calendar/official-client.ts',
  );
  assert.match(official, /client\.events\.list/);
  assert.doesNotMatch(
    official,
    /client\.events\.(?:insert|update|patch|delete|move|import)\s*\(/u,
  );
});
