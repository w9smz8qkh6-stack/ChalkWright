import assert from 'node:assert/strict';
import test from 'node:test';

import { contractVersion } from '../../src/contracts/v1/common.js';
import {
  containsUndefined,
  hasExactKeys,
  isCanonicalPlan,
  isContractDiagnostic,
  isDayPlanMeeting,
  isEffectivePlan,
  isFreshness,
  isIanaTimeZone,
  isIsoDate,
  isIsoInstant,
  isJsonSafeValue,
  isPlainObject,
  isProvenance,
  isScheduleObservation,
  isStringArray,
  isVocabularyHistoryEntry,
} from '../../src/domain/runtime-validation.js';

const meeting = {
  meetingId: 'meeting-alpha',
  courseKey: 'course-alpha',
  blockLabel: 'A',
  checkInOpensAt: '2035-04-13T07:55:00Z',
  officialStartsAt: '2035-04-13T08:00:00Z',
  checkInClosesAt: '2035-04-13T08:00:00Z',
  contentStartsAt: '2035-04-13T08:00:00Z',
  dismissalStartsAt: '2035-04-13T08:55:00Z',
  officialEndsAt: '2035-04-13T09:00:00Z',
};

const plan = {
  contractVersion,
  planId: 'plan-alpha',
  date: '2035-04-13',
  timeZone: 'Etc/UTC',
  roomId: 'room-alpha',
  sourceObservationIds: ['observation-alpha'],
  verification: 'synthetic',
  meetings: [meeting],
  diagnostics: [],
};

test('ISO dates reject impossible calendar values', () => {
  assert.equal(isIsoDate('2035-04-13'), true);
  assert.equal(isIsoDate('2036-02-29'), true);
  for (const value of [
    '2035-02-29',
    '2035-02-30',
    '2035-99-99',
    '2035-04-31',
    '2035-4-13',
  ])
    assert.equal(isIsoDate(value), false, value);
});

test('ISO instants require real normalized UTC instants', () => {
  assert.equal(isIsoInstant('2035-04-13T08:00:00Z'), true);
  assert.equal(isIsoInstant('2035-04-13T08:00:00.123Z'), true);
  for (const value of [
    'a',
    'b',
    'c',
    'd',
    '2035-02-30T08:00:00Z',
    '2035-04-13T24:00:00Z',
    '2035-04-13T08:60:00Z',
    '2035-04-13T08:00:60Z',
    '2035-04-13T08:00:00+00:00',
    '2035-04-13T08:00:00.1Z',
    '2035-04-13T08:00:00.1234Z',
  ])
    assert.equal(isIsoInstant(value), false, value);
});

test('IANA timezone validation rejects unknown names', () => {
  assert.equal(isIanaTimeZone('Etc/UTC'), true);
  assert.equal(isIanaTimeZone('America/Chicago'), true);
  assert.equal(isIanaTimeZone('Invalid/Synthetic_Zone'), false);
  assert.equal(isIanaTimeZone(''), false);
});

test('plain objects require exact present keys and reject undefined', () => {
  const valid = { required: 1, optional: false };
  assert.equal(isPlainObject(valid), true);
  assert.equal(hasExactKeys(valid, ['required'], ['optional']), true);
  assert.equal(
    hasExactKeys({ required: 1, surprise: true }, ['required']),
    false,
  );
  assert.equal(hasExactKeys({ required: undefined }, ['required']), false);
  assert.equal(containsUndefined({ nested: [{ value: undefined }] }), true);
  assert.equal(containsUndefined({ nested: [{ value: null }] }), false);
  assert.equal(isJsonSafeValue({ finite: 1, values: [true, null] }), true);
  assert.equal(isJsonSafeValue({ finite: Number.NaN }), false);
  assert.equal(isJsonSafeValue({ finite: Number.POSITIVE_INFINITY }), false);
});

test('array validation rejects holes and properties that cannot round-trip exactly', () => {
  const sparseStrings = Array<string>(1);
  const sparseMeetings = Array<(typeof plan.meetings)[number]>(1);
  const sparseDiagnostics = Array<never>(1);

  assert.equal(isStringArray(sparseStrings), false);
  assert.equal(
    isCanonicalPlan({ ...plan, sourceObservationIds: sparseStrings }),
    false,
  );
  assert.equal(isCanonicalPlan({ ...plan, meetings: sparseMeetings }), false);
  assert.equal(
    isCanonicalPlan({ ...plan, diagnostics: sparseDiagnostics }),
    false,
  );
  assert.equal(isJsonSafeValue(sparseStrings), false);
  assert.equal(containsUndefined(sparseStrings), true);

  const augmented = ['observation-alpha'];
  Object.defineProperty(augmented, 'metadata', {
    value: 'not serialized',
    enumerable: true,
  });
  assert.equal(
    isCanonicalPlan({ ...plan, sourceObservationIds: augmented }),
    false,
  );

  const accessorArray: string[] = [];
  Object.defineProperty(accessorArray, '0', {
    enumerable: true,
    get() {
      throw new Error('must not execute array getters');
    },
  });
  accessorArray.length = 1;
  assert.doesNotThrow(() => isStringArray(accessorArray));
  assert.equal(isStringArray(accessorArray), false);
});

test('validation fails closed for accessors and hostile proxies', () => {
  const accessorPlan = { ...plan };
  Object.defineProperty(accessorPlan, 'planId', {
    enumerable: true,
    get() {
      throw new Error('must not execute object getters');
    },
  });
  assert.doesNotThrow(() => isCanonicalPlan(accessorPlan));
  assert.equal(isCanonicalPlan(accessorPlan), false);

  const rootProxy = new Proxy(plan, {
    getPrototypeOf() {
      throw new Error('hostile prototype trap');
    },
  });
  assert.doesNotThrow(() => isCanonicalPlan(rootProxy));
  assert.equal(isCanonicalPlan(rootProxy), false);

  const propertyProxy = new Proxy(plan, {
    get(target, property, receiver) {
      if (property === 'date') throw new Error('hostile property trap');
      return Reflect.get(target, property, receiver);
    },
  });
  assert.doesNotThrow(() => isCanonicalPlan(propertyProxy));
  assert.equal(isCanonicalPlan(propertyProxy), false);

  const nestedProxy = new Proxy(['observation-alpha'], {
    ownKeys() {
      throw new Error('hostile ownKeys trap');
    },
  });
  assert.doesNotThrow(() =>
    isCanonicalPlan({ ...plan, sourceObservationIds: nestedProxy }),
  );
  assert.equal(
    isCanonicalPlan({ ...plan, sourceObservationIds: nestedProxy }),
    false,
  );

  const { proxy: revokedProxy, revoke } = Proxy.revocable(plan, {});
  revoke();
  assert.doesNotThrow(() => isCanonicalPlan(revokedProxy));
  assert.equal(isCanonicalPlan(revokedProxy), false);
  assert.doesNotThrow(() => isJsonSafeValue(revokedProxy));
  assert.equal(isJsonSafeValue(revokedProxy), false);
  assert.doesNotThrow(() => containsUndefined(revokedProxy));
  assert.equal(containsUndefined(revokedProxy), true);
});

test('JSON-safety traversal rejects cycles and non-data object properties', () => {
  const cyclicObject: Record<string, unknown> = {};
  cyclicObject.self = cyclicObject;
  const cyclicArray: unknown[] = [];
  cyclicArray.push(cyclicArray);

  assert.doesNotThrow(() => isJsonSafeValue(cyclicObject));
  assert.equal(isJsonSafeValue(cyclicObject), false);
  assert.equal(isJsonSafeValue(cyclicArray), false);
  assert.equal(containsUndefined(cyclicObject), true);
  assert.equal(containsUndefined(cyclicArray), true);

  const nonEnumerable = { visible: true };
  Object.defineProperty(nonEnumerable, 'hidden', {
    value: true,
    enumerable: false,
  });
  assert.equal(isJsonSafeValue(nonEnumerable), false);
  assert.equal(isPlainObject(nonEnumerable), false);

  const symbolProperty = { visible: true };
  Object.defineProperty(symbolProperty, Symbol('hidden'), {
    value: true,
    enumerable: true,
  });
  assert.equal(isJsonSafeValue(symbolProperty), false);
  assert.equal(isPlainObject(symbolProperty), false);
});

test('diagnostic, provenance, and freshness contracts are recursively exact', () => {
  const diagnostic = { code: 'synthetic', severity: 'info', message: 'Safe.' };
  const provenance = {
    source: 'synthetic-fixture',
    method: 'fixture',
    observedAt: '2035-04-13T05:00:00Z',
    verification: 'synthetic',
    sourceReference: 'source-alpha',
  };
  const freshness = {
    state: 'fresh',
    observedAt: '2035-04-13T05:00:00Z',
  };
  assert.equal(isContractDiagnostic(diagnostic), true);
  assert.equal(isProvenance(provenance), true);
  assert.equal(isFreshness(freshness), true);
  assert.equal(isContractDiagnostic({ ...diagnostic, nested: true }), false);
  assert.equal(isProvenance({ ...provenance, observedAt: 'a' }), false);
  assert.equal(isFreshness({ ...freshness, state: 'recent' }), false);
  assert.equal(isFreshness({ ...freshness, expiresAt: undefined }), false);
});

test('meeting validation rejects junk ordering and unexpected nested keys', () => {
  assert.equal(isDayPlanMeeting(meeting), true);
  assert.equal(
    isDayPlanMeeting({
      ...meeting,
      checkInOpensAt: 'a',
      officialStartsAt: 'b',
      checkInClosesAt: 'b',
      contentStartsAt: 'b',
      dismissalStartsAt: 'c',
      officialEndsAt: 'd',
    }),
    false,
  );
  assert.equal(isDayPlanMeeting({ ...meeting, unknown: true }), false);
  assert.equal(
    isDayPlanMeeting({ ...meeting, checkInClosesAt: '2035-04-13T08:01:00Z' }),
    false,
  );
  assert.equal(
    isDayPlanMeeting({
      ...meeting,
      officialStartsAt: '2035-04-13T08:00:00.000Z',
      checkInClosesAt: '2035-04-13T08:00:00Z',
      contentStartsAt: '2035-04-13T08:00:00Z',
    }),
    true,
  );
});

test('canonical and effective plans validate complete nested contracts', () => {
  assert.equal(isCanonicalPlan(plan), true);
  assert.equal(isCanonicalPlan({ ...plan, date: '2035-02-30' }), false);
  assert.equal(
    isCanonicalPlan({ ...plan, timeZone: 'Invalid/Synthetic_Zone' }),
    false,
  );
  assert.equal(isCanonicalPlan({ ...plan, sourceObservationIds: [] }), false);
  assert.equal(
    isCanonicalPlan({ ...plan, meetings: [{ ...meeting, extra: true }] }),
    false,
  );
  const effective = {
    contractVersion,
    effectivePlanId: 'effective-alpha',
    canonicalPlanId: plan.planId,
    date: plan.date,
    timeZone: plan.timeZone,
    roomId: plan.roomId,
    screenId: 'screen-alpha',
    verification: plan.verification,
    meetings: plan.meetings,
    diagnostics: [],
  };
  assert.equal(isEffectivePlan(effective), true);
  assert.equal(isEffectivePlan({ ...effective, screenId: 1 }), false);
});

test('schedule observations validate nested periods and real dates', () => {
  const observation = {
    contractVersion,
    observationId: 'observation-alpha',
    observedForDate: '2035-04-13',
    kind: 'normal',
    verification: 'synthetic',
    periods: [
      {
        periodId: 'period-alpha',
        courseKey: 'course-alpha',
        blockLabel: 'A',
        startsAt: '2035-04-13T08:00:00Z',
        endsAt: '2035-04-13T09:00:00Z',
      },
    ],
    provenance: {
      source: 'synthetic-fixture',
      method: 'fixture',
      observedAt: '2035-04-13T05:00:00Z',
      verification: 'synthetic',
      sourceReference: 'source-alpha',
    },
    freshness: { state: 'fresh', observedAt: '2035-04-13T05:00:00Z' },
    diagnostics: [],
  };
  assert.equal(isScheduleObservation(observation), true);
  assert.equal(
    isScheduleObservation({ ...observation, observedForDate: '2035-99-99' }),
    false,
  );
  assert.equal(
    isScheduleObservation({
      ...observation,
      periods: [{ ...observation.periods[0], endsAt: 'd' }],
    }),
    false,
  );
  assert.equal(
    isScheduleObservation({
      ...observation,
      periods: [{ ...observation.periods[0], unexpected: 'nested' }],
    }),
    false,
  );
  assert.equal(
    isScheduleObservation({ ...observation, kind: 'no-classes' }),
    false,
  );
  assert.equal(isScheduleObservation({ ...observation, periods: [] }), false);
  assert.equal(
    isScheduleObservation({
      ...observation,
      kind: 'no-classes',
      periods: [],
    }),
    true,
  );
});

test('vocabulary history nested types and keys are strict', () => {
  const entry = {
    classId: 'class-alpha',
    meetingKey: 'meeting-alpha',
    date: '2035-04-13',
    term: 'synthetic',
    vietnamese: { term: 'mau' },
  };
  assert.equal(isVocabularyHistoryEntry(entry), true);
  assert.equal(
    isVocabularyHistoryEntry({ ...entry, vietnamese: { term: 3 } }),
    false,
  );
  assert.equal(
    isVocabularyHistoryEntry({
      ...entry,
      vietnamese: { term: 'mau', unknown: true },
    }),
    false,
  );
});
