import assert from 'node:assert/strict';
import test from 'node:test';

import { simulateCalendarLease } from '../../../src/application/calendar/lease-simulator.js';

const base = {
  scopeId: 'scope-alpha',
  requestedLeaseId: 'lease-new',
  ownerId: 'owner-new',
  now: '2035-04-13T07:00:00.000Z',
  durationSeconds: 60,
} as const;

test('simulates acquisition and expiry without any external mutation', () => {
  const result = simulateCalendarLease(base);
  assert.equal(result.status, 'acquired');
  if (result.status !== 'acquired') return;
  assert.equal(result.lease.expiresAt, '2035-04-13T07:01:00.000Z');
  assert.equal(result.attemptedExternalMutations, 0);
  assert.equal(result.completedExternalMutations, 0);

  const afterExpiry = simulateCalendarLease({
    ...base,
    existing: {
      ...result.lease,
      leaseId: 'prior-lease',
      acquiredAt: '2035-04-13T06:58:59.000Z',
      expiresAt: '2035-04-13T06:59:59.000Z',
    },
  });
  assert.equal(afterExpiry.status, 'acquired');
});

test('refuses an active competing lease and malformed input', () => {
  const conflict = simulateCalendarLease({
    ...base,
    existing: {
      scopeId: 'scope-alpha',
      leaseId: 'prior-lease',
      ownerId: 'prior-owner',
      acquiredAt: '2035-04-13T06:59:00.000Z',
      expiresAt: '2035-04-13T07:01:00.000Z',
    },
  });
  assert.deepEqual(conflict, {
    status: 'refused',
    code: 'calendar-lease-conflict',
    attemptedExternalMutations: 0,
    completedExternalMutations: 0,
  });
  assert.equal(
    simulateCalendarLease({ ...base, durationSeconds: 901 }).status,
    'refused',
  );
});
