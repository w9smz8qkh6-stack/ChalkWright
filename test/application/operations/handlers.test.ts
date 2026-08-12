import assert from 'node:assert/strict';
import test from 'node:test';

import { createMaintenanceHandlers } from '../../../src/application/operations/handlers.js';
import {
  OperationsJobRegistry,
  type OperationsJobRequest,
} from '../../../src/application/operations/registry.js';
import type { OperationsConfig } from '../../../src/config/operations.js';
import { FakeAlertTransport } from '../../../src/infrastructure/operations/fake-alert-transport.js';
import type {
  AlertCheckpoint,
  OperationsJobRunRecord,
  OperationsRunLedgerQuery,
} from '../../../src/ports/operations.js';

const config: OperationsConfig = {
  instanceId: 'synthetic-instance',
  scopeId: 'screen-b407',
  timeZone: 'America/Chicago',
  managedRoot: '/tmp/synthetic-managed-root',
  databasePath: '/tmp/synthetic-managed-root/state.sqlite',
  backupDirectory: '/tmp/synthetic-managed-root/backups',
  academicYearEnd: '2035-05-31',
  jobDeadlineSeconds: 300,
  alertDeliveryMode: 'fake',
  alertRepeatSeconds: 900,
};
const request: OperationsJobRequest = {
  jobName: 'alert-evaluate',
  runId: 'synthetic-run',
  scopeId: 'screen-b407',
  requestedAt: '2035-04-13T07:00:00Z',
  deadlineAt: '2035-04-13T07:01:00Z',
};

function state(reject: boolean) {
  let checkpoint: AlertCheckpoint | undefined;
  return {
    loadAlertCheckpoint: async () => checkpoint,
    listJobRuns: async (_query: OperationsRunLedgerQuery) =>
      [] as readonly OperationsJobRunRecord[],
    storeAlertCheckpoint: async (value: AlertCheckpoint) => {
      if (reject)
        return {
          status: 'rejected' as const,
          error: {
            category: 'unavailable' as const,
            code: 'synthetic-rejection',
            message: 'Synthetic rejection.',
            retryable: true,
            diagnostics: [],
          },
        };
      checkpoint = value;
      return { status: 'stored' as const, revision: 'synthetic-revision' };
    },
    storeJobRun: async (_record: OperationsJobRunRecord) => ({
      status: 'stored' as const,
      revision: 'synthetic-run-revision',
    }),
  };
}

test('alert handler degrades when fake delivery fails', async () => {
  const registry = new OperationsJobRegistry(
    createMaintenanceHandlers(
      config,
      state(false),
      new FakeAlertTransport('fail'),
    ),
  );
  const result = await registry.execute(request, new AbortController().signal);
  assert.equal(result.category, 'degraded');
  if (result.category === 'degraded')
    assert.deepEqual(
      result.errors.map((error) => error.code),
      ['alert-transport-unavailable'],
    );
});

test('alert handler fails when restart-safe checkpoint persistence fails', async () => {
  const registry = new OperationsJobRegistry(
    createMaintenanceHandlers(config, state(true), new FakeAlertTransport()),
  );
  const result = await registry.execute(request, new AbortController().signal);
  assert.equal(result.category, 'failed');
  if (result.category === 'failed')
    assert.equal(result.error.code, 'alert-checkpoint-store-failed');
});
