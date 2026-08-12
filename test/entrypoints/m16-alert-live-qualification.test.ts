import assert from 'node:assert/strict';
import test from 'node:test';

import { runM16AlertLiveQualification } from '../../src/entrypoints/m16-alert-live-qualification.js';

const reference =
  '/etc/classroom-hub/providers/alert-delivery/alert-delivery.json';

test('one-shot M-16 alert qualification emits only bounded delivery evidence', async () => {
  let calls = 0;
  assert.deepEqual(
    await runM16AlertLiveQualification({
      arguments: ['--execute'],
      environment: { CLASSROOM_HUB_ALERT_DELIVERY_REFERENCE: reference },
      qualify: async () => {
        calls += 1;
        return { status: 'delivered' };
      },
    }),
    {
      exitCode: 0,
      status: 'delivered',
      messagesAttempted: 1,
      messagesDelivered: 1,
      serviceChanges: 0,
      routeChanges: 0,
      applicationStateWrites: 0,
    },
  );
  assert.equal(calls, 1);
});

test('qualification rejects arguments, ambient authority, and abort before delivery', async () => {
  let calls = 0;
  const qualify = async () => {
    calls += 1;
    return { status: 'delivered' as const };
  };
  const controller = new AbortController();
  controller.abort();
  for (const options of [
    { arguments: [] as string[], environment: {}, qualify },
    {
      arguments: ['--execute'],
      environment: {
        CLASSROOM_HUB_ALERT_DELIVERY_REFERENCE: '/tmp/wrong.json',
      },
      qualify,
    },
    {
      arguments: ['--execute'],
      environment: {
        CLASSROOM_HUB_ALERT_DELIVERY_REFERENCE: reference,
        CLASSROOM_HUB_DATABASE_PATH: '/tmp/state',
      },
      qualify,
    },
    {
      arguments: ['--execute'],
      environment: { CLASSROOM_HUB_ALERT_DELIVERY_REFERENCE: reference },
      signal: controller.signal,
      qualify,
    },
  ]) {
    const output = await runM16AlertLiveQualification(options);
    assert.equal(output.status, 'rejected');
    assert.equal(output.messagesAttempted, 0);
  }
  assert.equal(calls, 0);
});

test('qualification maps transport failure and thrown detail to finite evidence', async () => {
  const failed = await runM16AlertLiveQualification({
    arguments: ['--execute'],
    environment: { CLASSROOM_HUB_ALERT_DELIVERY_REFERENCE: reference },
    qualify: async () => ({
      status: 'failed',
      code: 'alert-authority-rejected',
    }),
  });
  assert.deepEqual(failed, {
    exitCode: 1,
    status: 'failed',
    code: 'alert-authority-rejected',
    messagesAttempted: 1,
    messagesDelivered: 0,
    serviceChanges: 0,
    routeChanges: 0,
    applicationStateWrites: 0,
  });

  const thrown = await runM16AlertLiveQualification({
    arguments: ['--execute'],
    environment: { CLASSROOM_HUB_ALERT_DELIVERY_REFERENCE: reference },
    qualify: async () => {
      throw new Error('private provider response');
    },
  });
  assert.equal(thrown.code, 'alert-transport-unavailable');
});
