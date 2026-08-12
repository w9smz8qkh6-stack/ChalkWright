import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  m16RuntimeImplementationFingerprint,
  m16TargetReferenceHashesFromProposalText,
  runM16OfflineCutoverRehearsal,
} from '../../src/entrypoints/m16-rehearsal.js';

test('binds every target-reference class to the exact validated proposal bytes', () => {
  const text = readFileSync('docs/migration/m16-target-proposal.json', 'utf8');
  const first = m16TargetReferenceHashesFromProposalText(text);
  const second = m16TargetReferenceHashesFromProposalText(
    text.replace('accepted-inert-policy', 'accepted-inert-policy-tampered'),
  );
  assert.deepEqual(Object.keys(first).sort(), [
    'kioskRuntime',
    'route',
    'schedulerInventory',
    'serviceInventory',
    'writerScope',
  ]);
  for (const value of Object.values(first))
    assert.match(value, /^sha256:[a-f0-9]{64}$/u);
  assert.notDeepEqual(first, second);
  assert.throws(
    () =>
      m16TargetReferenceHashesFromProposalText(
        text.replace(
          '"status": "approved-inert-target",',
          '"status": "approved-inert-target", "unexpected": true,',
        ),
      ),
    /m16-target-proposal-invalid/u,
  );
  assert.throws(
    () =>
      m16TargetReferenceHashesFromProposalText(
        text.replace(
          '"preparedOn": "2026-08-11",',
          '"preparedOn": "2026-08-11", "secret": "forbidden",',
        ),
      ),
    /m16-target-proposal-invalid/u,
  );
});

test('runs the complete M-16 rehearsal only on disposable loopback and SQLite state', async () => {
  assert.match(m16RuntimeImplementationFingerprint(), /^sha256:[a-f0-9]{64}$/u);
  const evidence = await runM16OfflineCutoverRehearsal();

  assert.equal(evidence.status, 'passed');
  assert.equal(evidence.receipts.length, 16);
  assert.equal(evidence.smokeFingerprint?.startsWith('sha256:'), true);
  assert.equal(evidence.maximumConcurrentWriters, 1);
  assert.equal(evidence.baselineRestored, true);
  assert.equal(evidence.recoveryObjectiveMet, true);
  assert.equal(evidence.attemptedExternalMutations, 0);
  assert.equal(evidence.completedExternalMutations, 0);
  assert.equal(evidence.liveOperationalChanges, 0);
});
