import assert from 'node:assert/strict';
import test from 'node:test';

import { parseCalendarReconciliationCommand } from '../../../src/application/calendar/reconciliation-command.js';

test('defaults to dry-run and requires an exact explicit execute approval', () => {
  assert.deepEqual(parseCalendarReconciliationCommand([]), {
    mode: 'dry-run',
  });
  assert.deepEqual(parseCalendarReconciliationCommand(['--dry-run']), {
    mode: 'dry-run',
  });
  const fingerprint = `sha256:${'a'.repeat(64)}`;
  assert.deepEqual(
    parseCalendarReconciliationCommand([
      '--execute',
      '--approval-fingerprint',
      fingerprint,
    ]),
    { mode: 'execute', approvalFingerprint: fingerprint },
  );
  for (const invalid of [
    ['--execute'],
    ['--execute', '--approval-fingerprint', 'not-a-fingerprint'],
    ['--dry-run', '--execute'],
    ['--execute', '--approval-fingerprint', fingerprint, '--force'],
    ['--calendar-id', 'primary'],
  ])
    assert.equal(parseCalendarReconciliationCommand(invalid), undefined);
});
