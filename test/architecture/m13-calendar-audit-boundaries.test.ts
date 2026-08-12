import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve('.');

test('M-13 declares exactly one intended owned-event read-only Calendar scope', () => {
  const config = source('src/config/google-calendar.ts');
  const official = source(
    'src/infrastructure/google-calendar/official-client.ts',
  );
  assert.match(
    config,
    /googleCalendarOwnedEventsReadScope\s*=\s*\n?\s*'https:\/\/www\.googleapis\.com\/auth\/calendar\.events\.owned\.readonly'/u,
  );
  assert.match(official, /googleCalendarOwnedEventsReadScope/u);
  assert.doesNotMatch(official, /googleCalendarOwnedEventsWriteScope/u);
  assert.doesNotMatch(official, /auth\/calendar(?:['"]|\s)/u);
});

test('official Calendar capability exposes only Events.list GET', () => {
  const official = source(
    'src/infrastructure/google-calendar/official-client.ts',
  );
  assert.match(official, /client\.events\.list\(/u);
  assert.match(official, /singleEvents: true/u);
  assert.match(official, /retry: false/u);
  assert.doesNotMatch(
    official,
    /\.events\.(?:insert|patch|update|delete|move|import|quickAdd|watch)\(/u,
  );
  assert.doesNotMatch(official, /requestBody|sendUpdates/u);
});

test('one configured composition binds marker, plan derivation, and provider policy', () => {
  const capability = source(
    'src/infrastructure/google-calendar/audit-capability.ts',
  );
  assert.match(capability, /calendarOwnershipMarker/u);
  assert.match(capability, /projectCalendarDay/u);
  assert.match(capability, /options\.config\.calendarId/u);
  assert.match(capability, /options\.config\.requestTimeoutMs/u);
  assert.match(capability, /options\.config\.maximumPages/u);
  assert.match(capability, /options\.config\.maximumEvents/u);
  assert.match(capability, /options\.config\.maximumWindowDays/u);
  assert.match(capability, /loadOfficialCalendarEventListTransport/u);
  assert.doesNotMatch(
    capability,
    /options\.(?:summaries|description|timeZone)/u,
  );
  assert.doesNotMatch(
    capability,
    /CalendarWriterPort|requestBody|sendUpdates/u,
  );
});

test('M-13 audit has no writer, command, shadow, display, or operational reachability', () => {
  const implementation = [
    'src/application/calendar/ownership-audit.ts',
    'src/application/calendar/projection-policy.ts',
    'src/application/calendar/lease-simulator.ts',
    'src/infrastructure/google-calendar/adapter.ts',
    'src/infrastructure/google-calendar/audit-capability.ts',
    'src/infrastructure/google-calendar/contracts.ts',
    'src/infrastructure/google-calendar/official-client.ts',
  ]
    .map(source)
    .join('\n');
  assert.doesNotMatch(
    implementation,
    /calendar-writer|CalendarWriterPort|child_process|execFile|spawn|tailscale|systemctl|requestBody/iu,
  );
  for (const path of [
    'src/app/shadow-server.ts',
    'src/application/operations/registry.ts',
    'src/entrypoints/job.ts',
    'src/presentation/html.ts',
  ]) {
    assert.doesNotMatch(source(path), /google-calendar|ownership-audit/u);
  }
});

test('the official Calendar dependency is exact-version pinned', () => {
  const manifest = JSON.parse(source('package.json')) as {
    dependencies?: Record<string, string>;
  };
  assert.equal(manifest.dependencies?.['@googleapis/calendar'], '16.0.0');
});

function source(path: string): string {
  return readFileSync(resolve(root, path), 'utf8');
}
