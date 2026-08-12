import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calendarOwnershipMarker,
  googleCalendarOwnedEventsReadScope,
  loadGoogleCalendarAuditConfig,
} from '../../src/config/google-calendar.js';

const base = {
  CLASSROOM_HUB_CALENDAR_AUDIT_CREDENTIAL_REFERENCE:
    '/var/lib/classroom-hub/calendar-audit-oauth.json',
  CLASSROOM_HUB_CALENDAR_AUDIT_CALENDAR_ID: 'primary',
  CLASSROOM_HUB_CALENDAR_AUDIT_SCOPE_ID: 'calendar-scope-alpha',
};

test('loads one owned-event read scope and a bounded external reference', () => {
  const config = loadGoogleCalendarAuditConfig(
    base,
    '/workspace/classroom-hub',
  );
  assert.equal(
    googleCalendarOwnedEventsReadScope,
    'https://www.googleapis.com/auth/calendar.events.owned.readonly',
  );
  assert.equal(calendarOwnershipMarker, 'classroom-hub-v1');
  assert.deepEqual(config, {
    credentialReferencePath: '/var/lib/classroom-hub/calendar-audit-oauth.json',
    calendarId: 'primary',
    scopeId: 'calendar-scope-alpha',
    requestTimeoutMs: 15_000,
    maximumPages: 5,
    maximumEvents: 500,
    maximumWindowDays: 14,
  });
});

test('rejects repository credentials, generic identifiers, and unbounded policy', () => {
  for (const environment of [
    {
      ...base,
      CLASSROOM_HUB_CALENDAR_AUDIT_CREDENTIAL_REFERENCE:
        '/workspace/classroom-hub/oauth.json',
    },
    { ...base, CLASSROOM_HUB_CALENDAR_AUDIT_CALENDAR_ID: '*' },
    { ...base, CLASSROOM_HUB_CALENDAR_AUDIT_SCOPE_ID: '../scope' },
    { ...base, CLASSROOM_HUB_CALENDAR_AUDIT_MAX_PAGES: '11' },
    { ...base, CLASSROOM_HUB_CALENDAR_AUDIT_MAX_EVENTS: '1001' },
    { ...base, CLASSROOM_HUB_CALENDAR_AUDIT_MAX_WINDOW_DAYS: '32' },
  ]) {
    assert.throws(() =>
      loadGoogleCalendarAuditConfig(environment, '/workspace/classroom-hub'),
    );
  }
});
