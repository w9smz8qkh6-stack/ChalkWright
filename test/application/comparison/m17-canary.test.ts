import assert from 'node:assert/strict';
import test from 'node:test';

import {
  compareM17CanarySemantics,
  type M17SemanticComparisonInput,
} from '../../../src/application/comparison/m17-canary.js';
import type { ScreenId } from '../../../src/domain/identities.js';

const snapshot: M17SemanticComparisonInput['reference'] = {
  date: '2035-04-13',
  timeZone: 'Asia/Ho_Chi_Minh',
  meetings: [
    {
      startsAt: '2035-04-13T01:00:00.000Z',
      endsAt: '2035-04-13T01:45:00.000Z',
      summary: 'Computer Fundamentals',
    },
  ],
  calendar: [
    {
      startsAt: '2035-04-13T01:00:00.000Z',
      endsAt: '2035-04-13T01:45:00.000Z',
      summary: 'Computer Fundamentals',
    },
  ],
  ownershipCoverage: 'all-owned',
  readiness: 'ready',
  displayState: 'pre_checkin',
  planVerification: 'verified',
};

const input: M17SemanticComparisonInput = {
  version: 1,
  kind: 'chalkwright-m17-semantic-comparison',
  comparedAt: '2035-04-13T00:30:00.000Z',
  date: '2035-04-13',
  screenId: 'screen-c509-canary-production' as ScreenId,
  reference: snapshot,
  candidate: structuredClone(snapshot),
};

test('compares exact normalized canary semantics without provider IDs', () => {
  const result = compareM17CanarySemantics(input);
  assert.equal(result.equivalent, true);
  assert.deepEqual(result.differenceCodes, []);
  assert.equal(result.evidence.data.equal, true);
  assert.doesNotMatch(
    JSON.stringify(result),
    /providerEventId|etag|calendarId|https?:/iu,
  );
});

test('does not ignore time, summary, ownership, readiness, or display-state drift', () => {
  const result = compareM17CanarySemantics({
    ...input,
    candidate: {
      ...input.candidate,
      meetings: [
        {
          ...input.candidate.meetings[0]!,
          startsAt: '2035-04-13T01:05:00.000Z',
          summary: 'Changed',
        },
      ],
      ownershipCoverage: 'foreign-present',
      readiness: 'not-ready',
      displayState: 'idle',
    },
  });
  assert.equal(result.equivalent, false);
  assert.deepEqual(result.differenceCodes, [
    'm17-calendar-ownership-different',
    'm17-candidate-not-ready',
    'm17-candidate-ownership-not-qualified',
    'm17-display-state-different',
    'm17-plan-semantics-different',
    'm17-readiness-different',
  ]);
});

test('rejects IDs, extra fields, malformed Unicode, and unsorted intervals', () => {
  for (const changed of [
    { ...input, providerEventId: 'provider-1' },
    {
      ...input,
      candidate: {
        ...input.candidate,
        meetings: [
          { ...input.candidate.meetings[0]!, summary: 'Bad\u2028line' },
        ],
      },
    },
  ])
    assert.throws(
      () => compareM17CanarySemantics(changed as M17SemanticComparisonInput),
      /m17-comparison-input-invalid/u,
    );
});

test('accepts a fresh future class-day comparison within the Sunday lookahead', () => {
  const futureSnapshot: M17SemanticComparisonInput['reference'] = {
    ...snapshot,
    date: '2035-04-16',
    meetings: [
      {
        startsAt: '2035-04-16T01:00:00.000Z',
        endsAt: '2035-04-16T01:45:00.000Z',
        summary: 'Computer Fundamentals',
      },
    ],
    calendar: [
      {
        startsAt: '2035-04-16T01:00:00.000Z',
        endsAt: '2035-04-16T01:45:00.000Z',
        summary: 'Computer Fundamentals',
      },
    ],
  };
  const result = compareM17CanarySemantics({
    ...input,
    comparedAt: '2035-04-13T14:30:00.000Z',
    date: '2035-04-16',
    reference: futureSnapshot,
    candidate: structuredClone(futureSnapshot),
  });

  assert.equal(result.equivalent, true);
  assert.equal(result.evidence.scope.date, '2035-04-16');
});

test('rejects comparison instants before or beyond the bounded local lookahead', () => {
  for (const changed of [
    { ...input, comparedAt: '2035-04-13T17:00:00.000Z' },
    { ...input, date: '2035-04-21' },
  ])
    assert.throws(
      () => compareM17CanarySemantics(changed as M17SemanticComparisonInput),
      /m17-comparison-input-invalid/u,
    );
});

test('rejects interval instants outside the compared class date', () => {
  for (const changed of [
    {
      ...input,
      candidate: {
        ...input.candidate,
        meetings: [
          {
            ...input.candidate.meetings[0]!,
            startsAt: '2035-04-12T16:50:00.000Z',
            endsAt: '2035-04-12T17:10:00.000Z',
          },
        ],
      },
    },
  ])
    assert.throws(
      () => compareM17CanarySemantics(changed as M17SemanticComparisonInput),
      /m17-comparison-input-invalid/u,
    );
});

test('equal but unready, foreign, or unverified snapshots cannot qualify activation', () => {
  for (const changed of [
    { readiness: 'not-ready' as const },
    { ownershipCoverage: 'foreign-present' as const },
    { planVerification: 'unverified' as const },
  ]) {
    const unsafe = { ...input.reference, ...changed };
    const result = compareM17CanarySemantics({
      ...input,
      reference: unsafe,
      candidate: structuredClone(unsafe),
    });
    assert.equal(result.equivalent, false);
    assert.equal(result.evidence.data.equal, false);
    assert.ok(result.differenceCodes.length >= 2);
  }
});

test('equal semantic evidence binds both complete ID-free snapshots', () => {
  const first = compareM17CanarySemantics(input);
  const changed = {
    ...input.reference,
    meetings: [
      { ...input.reference.meetings[0]!, summary: 'Another safe summary' },
    ],
  };
  const second = compareM17CanarySemantics({
    ...input,
    reference: changed,
    candidate: structuredClone(changed),
  });
  assert.equal(first.equivalent, true);
  assert.equal(second.equivalent, true);
  assert.notEqual(first.evidenceFingerprint, second.evidenceFingerprint);
  assert.match(
    first.evidence.data.diagnostics[0]!.code,
    /^m17-semantic-input-[a-f0-9]{64}$/u,
  );
});

test('repeated equal observations retain distinct immutable evidence keys', () => {
  const first = compareM17CanarySemantics(input);
  const later = compareM17CanarySemantics({
    ...input,
    comparedAt: '2035-04-13T01:30:00.000Z',
  });
  assert.notEqual(first.evidence.recordKey, later.evidence.recordKey);
  assert.notEqual(first.evidenceFingerprint, later.evidenceFingerprint);
  assert.deepEqual(first.evidence.data.differenceCodes, []);
  assert.deepEqual(later.evidence.data.differenceCodes, []);
});
