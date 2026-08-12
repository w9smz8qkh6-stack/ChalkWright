import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createOfflineQualifiedCalendarMutationTransport,
  createOfflineQualifiedCalendarProductionTrialTransport,
  type NarrowCalendarMutationClient,
} from '../../../src/infrastructure/google-calendar/offline-writer-adapter.js';
import { CalendarMutationTransportError } from '../../../src/ports/calendar-mutation-transport.js';

const ownership = {
  classification: 'verified-application-owned' as const,
  scopeId: 'scope-alpha',
  ownershipMarker: 'classroom-hub-v1',
};
const desired = {
  summary: 'Block A',
  description: 'Imported from PowerSchool Bell Schedule.',
  startsAt: '2035-04-13T08:00:00.000Z',
  endsAt: '2035-04-13T09:00:00.000Z',
  timeZone: 'Etc/UTC',
};
const eventId = `ch${'a'.repeat(64)}`;

function providerEvent(id = eventId) {
  return {
    id,
    etag: '"etag-alpha"',
    status: 'confirmed',
    eventType: 'default',
    summary: desired.summary,
    description: desired.description,
    start: { dateTime: desired.startsAt, timeZone: desired.timeZone },
    end: { dateTime: desired.endsAt, timeZone: desired.timeZone },
    extendedProperties: {
      private: {
        classroomHubOwner: 'classroom-hub',
        classroomHubScope: ownership.scopeId,
        classroomHubOwnershipMarker: ownership.ownershipMarker,
      },
    },
  };
}

test('maps exact get, insert, update, and delete requests with no notifications', async () => {
  const calls: Array<{ method: string; params: unknown; options: unknown }> =
    [];
  let getMissing = false;
  const client: NarrowCalendarMutationClient = {
    events: {
      async get(params, options) {
        calls.push({ method: 'get', params, options });
        if (getMissing) throw { response: { status: 404 } };
        return { data: providerEvent(params.eventId) };
      },
      async insert(params, options) {
        calls.push({ method: 'insert', params, options });
        return { data: providerEvent(params.requestBody?.id ?? undefined) };
      },
      async update(params, options) {
        calls.push({ method: 'update', params, options });
        return { data: providerEvent(params.eventId) };
      },
      async delete(params, options) {
        calls.push({ method: 'delete', params, options });
        return {};
      },
    },
  };
  const transport = createOfflineQualifiedCalendarMutationTransport(client);
  const signal = new AbortController().signal;
  const boundary = {
    calendarId: 'synthetic@example.test',
    timeoutMs: 5_000,
    signal,
  };

  const observed = await transport.getEvent({
    ...boundary,
    eventReference: eventId,
  });
  assert.equal(observed.status, 'found');
  getMissing = true;
  assert.deepEqual(
    await transport.getEvent({ ...boundary, eventReference: 'missing' }),
    { status: 'not-found' },
  );
  getMissing = false;
  await transport.insertEvent({
    ...boundary,
    eventReference: eventId,
    desired,
    ownership,
    sendUpdates: 'none',
  });
  await transport.updateEvent({
    ...boundary,
    eventReference: eventId,
    expectedEtag: '"etag-alpha"',
    desired,
    ownership,
    sendUpdates: 'none',
  });
  await transport.deleteEvent({
    ...boundary,
    eventReference: eventId,
    expectedEtag: '"etag-alpha"',
    ownership,
    sendUpdates: 'none',
  });

  assert.deepEqual(
    calls.map((call) => call.method),
    ['get', 'get', 'insert', 'update', 'delete'],
  );
  const insert = calls[2]!.params as {
    readonly sendUpdates: string;
    readonly supportsAttachments: boolean;
    readonly conferenceDataVersion: number;
    readonly requestBody: Record<string, unknown>;
  };
  assert.equal(insert.sendUpdates, 'none');
  assert.equal(insert.supportsAttachments, false);
  assert.equal(insert.conferenceDataVersion, 0);
  assert.deepEqual(insert.requestBody, {
    id: eventId,
    summary: desired.summary,
    description: desired.description,
    start: { dateTime: desired.startsAt, timeZone: desired.timeZone },
    end: { dateTime: desired.endsAt, timeZone: desired.timeZone },
    extendedProperties: {
      private: {
        classroomHubOwner: 'classroom-hub',
        classroomHubScope: ownership.scopeId,
        classroomHubOwnershipMarker: ownership.ownershipMarker,
      },
    },
    reminders: { useDefault: false, overrides: [] },
  });
  const updateOptions = calls[3]!.options as {
    readonly retry: boolean;
    readonly headers: Readonly<Record<string, string>>;
  };
  assert.equal(updateOptions.retry, false);
  assert.equal(updateOptions.headers['If-Match'], '"etag-alpha"');
  const deleteCall = calls[4]!;
  assert.equal(
    (deleteCall.params as { readonly sendUpdates: string }).sendUpdates,
    'none',
  );
  assert.equal(
    (
      deleteCall.options as {
        readonly headers: Readonly<Record<string, string>>;
      }
    ).headers['If-Match'],
    '"etag-alpha"',
  );
});

test('rejects invalid IDs and responses and maps finite provider failures', async () => {
  let clientCalls = 0;
  let mode:
    'invalid-response' | 'forbidden-feature' | 'conflict' | 'unauthorized' =
    'invalid-response';
  const client: NarrowCalendarMutationClient = {
    events: {
      async get() {
        clientCalls += 1;
        if (mode === 'unauthorized') throw { response: { status: 401 } };
        return {
          data:
            mode === 'forbidden-feature'
              ? {
                  ...providerEvent(),
                  attendees: [{ email: 'person@example.test' }],
                }
              : { ...providerEvent(), etag: null },
        };
      },
      async insert() {
        clientCalls += 1;
        if (mode === 'conflict') throw { response: { status: 409 } };
        return { data: providerEvent() };
      },
      async update() {
        clientCalls += 1;
        throw { response: { status: 412 } };
      },
      async delete() {
        clientCalls += 1;
        throw { response: { status: 429 } };
      },
    },
  };
  const transport = createOfflineQualifiedCalendarMutationTransport(client);
  const signal = new AbortController().signal;
  const boundary = {
    calendarId: 'synthetic@example.test',
    timeoutMs: 5_000,
    signal,
  };
  await assert.rejects(
    transport.getEvent({ ...boundary, eventReference: eventId }),
    (error: unknown) =>
      error instanceof CalendarMutationTransportError &&
      error.code === 'calendar-write-unavailable',
  );
  mode = 'forbidden-feature';
  await assert.rejects(
    transport.getEvent({ ...boundary, eventReference: eventId }),
    /calendar-write-unavailable/,
  );
  await assert.rejects(
    transport.insertEvent({
      ...boundary,
      eventReference: 'invalid-z-id',
      desired,
      ownership,
      sendUpdates: 'none',
    }),
    /calendar-write-conflict/,
  );
  mode = 'conflict';
  await assert.rejects(
    transport.insertEvent({
      ...boundary,
      eventReference: eventId,
      desired,
      ownership,
      sendUpdates: 'none',
    }),
    (error: unknown) =>
      error instanceof CalendarMutationTransportError &&
      error.code === 'calendar-write-conflict',
  );
  mode = 'unauthorized';
  await assert.rejects(
    transport.getEvent({ ...boundary, eventReference: eventId }),
    (error: unknown) =>
      error instanceof CalendarMutationTransportError &&
      error.code === 'calendar-write-authentication-required',
  );

  const beforeBoundaryRejections = clientCalls;
  await assert.rejects(
    transport.getEvent({
      ...boundary,
      calendarId: 'primary',
      eventReference: eventId,
    }),
    /calendar-write-conflict/,
  );
  await assert.rejects(
    transport.updateEvent({
      ...boundary,
      eventReference: eventId,
      expectedEtag: 'etag-alpha',
      desired: { ...desired, summary: ' Block A' },
      ownership,
      sendUpdates: 'none',
    }),
    /calendar-write-conflict/,
  );
  await assert.rejects(
    transport.deleteEvent({
      ...boundary,
      eventReference: eventId,
      expectedEtag: 'etag-alpha',
      ownership: { ...ownership, ownershipMarker: 'foreign-marker' },
      sendUpdates: 'none',
    }),
    /calendar-write-conflict/,
  );
  await assert.rejects(
    (transport.insertEvent as (request: unknown) => Promise<unknown>)({
      ...boundary,
      eventReference: eventId,
      desired,
      ownership,
      sendUpdates: 'all',
      unexpected: true,
    }),
    /calendar-write-conflict/,
  );
  assert.equal(clientCalls, beforeBoundaryRejections);
});

test('treats an exact cancelled provider tombstone as logically absent', async () => {
  const transport = createOfflineQualifiedCalendarMutationTransport({
    events: {
      async get(params) {
        return {
          data: {
            id: params.eventId ?? null,
            status: 'cancelled',
          },
        };
      },
      async insert() {
        throw new Error('not-used');
      },
      async update() {
        throw new Error('not-used');
      },
      async delete() {
        throw new Error('not-used');
      },
    },
  });
  assert.deepEqual(
    await transport.getEvent({
      calendarId: 'synthetic@example.test',
      eventReference: eventId,
      timeoutMs: 5_000,
      signal: new AbortController().signal,
    }),
    { status: 'not-found' },
  );
});

test('reads an unmarked legacy event but rejects unknown private properties', async () => {
  let unknown = false;
  let adoptionMode = false;
  const transport = createOfflineQualifiedCalendarProductionTrialTransport({
    events: {
      async get(params) {
        const event = providerEvent(params.eventId);
        return {
          data: {
            ...event,
            extendedProperties: unknown
              ? { private: { foreignOwner: 'other-application' } }
              : null,
            ...(adoptionMode ? { reminders: { useDefault: true } } : {}),
          },
        };
      },
      async insert() {
        throw new Error('not-used');
      },
      async update() {
        throw new Error('not-used');
      },
      async delete() {
        throw new Error('not-used');
      },
    },
  });
  const request = {
    calendarId: 'synthetic@example.test',
    eventReference: eventId,
    timeoutMs: 5_000,
    signal: new AbortController().signal,
  };
  const legacy = await transport.getEvent(request);
  assert.equal(legacy.status, 'found');
  if (legacy.status === 'found') assert.deepEqual(legacy.event.ownership, {});
  unknown = true;
  await assert.rejects(
    transport.getEvent(request),
    /calendar-write-unavailable/u,
  );
  adoptionMode = true;
  const adoption = await transport.getAdoptionCandidateEvent(request);
  assert.equal(adoption.status, 'found');
  if (adoption.status === 'found')
    assert.deepEqual(adoption.event.ownership, {});
});

test('M-15 adoption uses a fixed patch and preserves omitted provider fields', async () => {
  const calls: Array<{ params: unknown; options: unknown }> = [];
  const transport = createOfflineQualifiedCalendarProductionTrialTransport({
    events: {
      async get(params, options) {
        calls.push({ params, options });
        return {
          data: {
            ...providerEvent(params.eventId),
            extendedProperties: null,
            reminders: { useDefault: true },
          },
        };
      },
      async insert() {
        throw new Error('not-used');
      },
      async update() {
        throw new Error('not-used');
      },
      async patch(params, options) {
        calls.push({ params, options });
        return {
          data: {
            ...providerEvent(params.eventId),
            reminders: { useDefault: true },
          },
        };
      },
      async delete() {
        throw new Error('not-used');
      },
    },
  });
  const signal = new AbortController().signal;
  const read = await transport.getAdoptionCandidateEvent({
    calendarId: 'synthetic@example.test',
    eventReference: eventId,
    timeoutMs: 5_000,
    signal,
  });
  assert.equal(read.status, 'found');
  const updated = await transport.updateAdoptedEvent({
    calendarId: 'synthetic@example.test',
    eventReference: eventId,
    expectedEtag: '"etag-alpha"',
    desired,
    ownership,
    reminderPolicy: 'provider-default',
    sendUpdates: 'none',
    timeoutMs: 5_000,
    signal,
  });
  assert.equal(updated.reminderPolicy, 'provider-default');
  const update = calls[1]!.params as {
    readonly sendUpdates: string;
    readonly requestBody: {
      readonly description: string;
      readonly extendedProperties: {
        readonly private: Readonly<Record<string, string>>;
      };
    };
  };
  assert.equal(update.sendUpdates, 'none');
  assert.deepEqual(update.requestBody, {
    description: desired.description,
    extendedProperties: {
      private: {
        classroomHubOwner: 'classroom-hub',
        classroomHubScope: ownership.scopeId,
        classroomHubOwnershipMarker: ownership.ownershipMarker,
      },
    },
  });
  const before = calls.length;
  await assert.rejects(
    (transport.updateAdoptedEvent as (request: unknown) => Promise<unknown>)({
      calendarId: 'synthetic@example.test',
      eventReference: eventId,
      expectedEtag: '"etag-alpha"',
      desired,
      ownership,
      reminderPolicy: 'custom',
      sendUpdates: 'none',
      timeoutMs: 5_000,
      signal,
    }),
    /calendar-write-conflict/u,
  );
  assert.equal(calls.length, before);
});

test('M-15 restoration updates only one exact adopted legacy snapshot', async () => {
  const legacy = {
    ...desired,
    description: 'Imported from PowerSchool Bell Schedule (legacy-v1).',
  };
  const calls: Array<{ params: unknown; options: unknown }> = [];
  const transport = createOfflineQualifiedCalendarProductionTrialTransport({
    events: {
      async get() {
        throw new Error('not-used');
      },
      async insert() {
        throw new Error('not-used');
      },
      async update() {
        throw new Error('not-used');
      },
      async patch(params, options) {
        calls.push({ params, options });
        return {
          data: {
            ...providerEvent(params.eventId),
            description: legacy.description,
            reminders: { useDefault: true },
          },
        };
      },
      async delete() {
        throw new Error('not-used');
      },
    },
  });
  const restored = await transport.restoreAdoptedEvent({
    calendarId: 'synthetic@example.test',
    eventReference: eventId,
    expectedEtag: '"etag-alpha"',
    desiredLegacySnapshot: legacy,
    ownership,
    reminderPolicy: 'provider-default',
    sendUpdates: 'none',
    timeoutMs: 5_000,
    signal: new AbortController().signal,
  });
  assert.equal(restored.description, legacy.description);
  const params = calls[0]!.params as {
    readonly sendUpdates: string;
    readonly supportsAttachments: boolean;
    readonly requestBody: {
      readonly description: string;
      readonly extendedProperties: {
        readonly private: Readonly<Record<string, string>>;
      };
    };
  };
  assert.equal(params.sendUpdates, 'none');
  assert.equal(params.supportsAttachments, false);
  assert.equal(params.requestBody.description, legacy.description);
  assert.equal(
    params.requestBody.extendedProperties.private.classroomHubOwner,
    'classroom-hub',
  );
  assert.equal(
    (calls[0]!.options as { headers: Record<string, string> }).headers[
      'If-Match'
    ],
    '"etag-alpha"',
  );
});

test('M-15 restoration rejects arbitrary snapshots before provider access', async () => {
  let calls = 0;
  const transport = createOfflineQualifiedCalendarProductionTrialTransport({
    events: {
      async get() {
        throw new Error('not-used');
      },
      async insert() {
        throw new Error('not-used');
      },
      async update() {
        calls += 1;
        return { data: providerEvent() };
      },
      async delete() {
        throw new Error('not-used');
      },
    },
  });
  await assert.rejects(
    transport.restoreAdoptedEvent({
      calendarId: 'synthetic@example.test',
      eventReference: eventId,
      expectedEtag: '"etag-alpha"',
      desiredLegacySnapshot: { ...desired, description: 'arbitrary' },
      ownership,
      reminderPolicy: 'provider-default',
      sendUpdates: 'none',
      timeoutMs: 5_000,
      signal: new AbortController().signal,
    }),
    /calendar-write-conflict/u,
  );
  assert.equal(calls, 0);
});
