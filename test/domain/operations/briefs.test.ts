import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildEveningBrief,
  buildMorningBrief,
  isOperatorBrief,
} from '../../../src/domain/operations/briefs.js';

const base = {
  timeZone: 'America/Chicago',
  generatedAt: '2035-04-13T12:00:00Z',
  targetDate: '2035-04-13',
  status: 'degraded',
  counts: { screens: 2, meetings: 8, issues: 2 },
  issueCodes: ['source-sync-stale', 'assignment-stale'],
} as const;

test('morning and evening briefs remain distinct minimal workflows', () => {
  const morning = buildMorningBrief(base);
  const evening = buildEveningBrief({ ...base, targetDate: '2035-04-16' });
  assert.ok(morning);
  assert.ok(evening);
  assert.equal(morning.kind, 'morning');
  assert.equal(morning.targetDateSemantics, 'current-local-day');
  assert.equal(evening.kind, 'evening');
  assert.equal(evening.targetDateSemantics, 'next-configured-class-day');
  assert.equal(isOperatorBrief(morning), true);
  assert.equal(isOperatorBrief(evening), true);
  assert.deepEqual(morning.issueCodes, [
    'assignment-stale',
    'source-sync-stale',
  ]);
  for (const forbidden of [
    'content',
    'destination',
    'recipient',
    'message',
    'url',
  ])
    assert.equal(Object.hasOwn(morning, forbidden), false);
});

test('brief validation rejects invalid timezone, dates, instants, and counts', () => {
  assert.equal(
    buildMorningBrief({ ...base, timeZone: 'Private/Server' }),
    undefined,
  );
  assert.equal(
    buildMorningBrief({ ...base, targetDate: '2035-02-30' }),
    undefined,
  );
  assert.equal(
    buildMorningBrief({ ...base, targetDate: '2035-04-14' }),
    undefined,
  );
  assert.equal(
    buildEveningBrief({ ...base, targetDate: '2035-04-13' }),
    undefined,
  );
  assert.ok(buildEveningBrief({ ...base, targetDate: '2035-04-16' }));
  assert.equal(
    buildEveningBrief({ ...base, targetDate: '2035-04-12' }),
    undefined,
  );
  assert.equal(
    buildMorningBrief({
      ...base,
      generatedAt: '2035-04-13T07:00:00-05:00',
    }),
    undefined,
  );
  assert.equal(
    buildMorningBrief({
      ...base,
      counts: { ...base.counts, meetings: Number.POSITIVE_INFINITY },
    }),
    undefined,
  );
  assert.equal(
    buildMorningBrief({
      ...base,
      counts: { ...base.counts, issues: 1 },
    }),
    undefined,
  );
});

test('brief contracts structurally reject forbidden material and unknown codes', () => {
  assert.equal(
    buildMorningBrief({
      ...base,
      issueCodes: ['https://example.invalid/path'],
    }),
    undefined,
  );
  assert.equal(
    buildMorningBrief({ ...base, issueCodes: ['oauth-token'] }),
    undefined,
  );
  assert.equal(
    isOperatorBrief({
      ...buildMorningBrief(base),
      recipient: 'operator-placeholder',
    }),
    false,
  );
  assert.equal(
    isOperatorBrief({
      ...buildMorningBrief(base),
      message: 'authorization-like material',
    }),
    false,
  );
});

test('brief validation fails closed for sparse, accessor, cyclic, and hostile data', () => {
  const sparse = Array<string>(1);
  assert.equal(buildMorningBrief({ ...base, issueCodes: sparse }), undefined);

  const accessor = { ...base } as Record<string, unknown>;
  Object.defineProperty(accessor, 'timeZone', {
    enumerable: true,
    get() {
      throw new Error('must not execute');
    },
  });
  assert.doesNotThrow(() => buildMorningBrief(accessor as typeof base));
  assert.equal(buildMorningBrief(accessor as typeof base), undefined);

  const cyclicCounts: Record<string, unknown> = {};
  cyclicCounts.self = cyclicCounts;
  assert.equal(buildMorningBrief({ ...base, counts: cyclicCounts }), undefined);

  const hostile = new Proxy(base, {
    ownKeys() {
      throw new Error('hostile');
    },
  });
  assert.doesNotThrow(() => buildMorningBrief(hostile));
  assert.equal(buildMorningBrief(hostile), undefined);
});
