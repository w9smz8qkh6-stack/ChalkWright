import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { runQuiescentChild } from '../../../src/infrastructure/process/quiescent-child.js';

const fixture = new URL(
  '../../../../test/fixtures/m07b-process-child.mjs',
  import.meta.url,
).pathname;

function environment(): Record<string, string> {
  return {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    LANG: 'C.UTF-8',
  };
}

test('returns output only after a successful worker process group exits', async () => {
  const result = await runQuiescentChild({
    executable: process.execPath,
    arguments: [fixture, 'success'],
    cwd: process.cwd(),
    environment: environment(),
    deadlineMs: 1_000,
    terminationGraceMs: 50,
  });
  assert.deepEqual(result, {
    status: 'completed',
    output: '{"status":"synthetic-success"}',
  });
});

test('delivers and overwrites one bounded ephemeral input packet', async () => {
  const input = Buffer.from('synthetic-ephemeral-input');
  const result = await runQuiescentChild({
    executable: process.execPath,
    arguments: [fixture, 'stdin'],
    cwd: process.cwd(),
    environment: environment(),
    deadlineMs: 1_000,
    terminationGraceMs: 50,
    input,
  });
  assert.deepEqual(result, {
    status: 'completed',
    output: '{"status":"stdin-received","total":25}',
  });
  assert.equal(
    input.every((byte) => byte === 0),
    true,
  );
});

test('hard deadline settles and confirms a non-cooperative worker is gone', async () => {
  const started = performance.now();
  const result = await runQuiescentChild({
    executable: process.execPath,
    arguments: [fixture, 'hang'],
    cwd: process.cwd(),
    environment: environment(),
    deadlineMs: 50,
    terminationGraceMs: 25,
  });
  assert.deepEqual(result, {
    status: 'failed',
    code: 'child-deadline-exceeded',
  });
  assert.ok(performance.now() - started < 1_000);
});

test('cancels delayed escalation after prompt deadline teardown', async (context) => {
  const originalKill = process.kill;
  const signaledGroups: Array<{ pid: number; signal: string | number }> = [];
  context.mock.method(
    process,
    'kill',
    (pid: number, signal?: NodeJS.Signals | number) => {
      if (pid < 0 && signal !== 0) {
        signaledGroups.push({ pid, signal: signal ?? 'SIGTERM' });
      }
      return originalKill(pid, signal);
    },
  );
  const result = await runQuiescentChild({
    executable: process.execPath,
    arguments: [fixture, 'term-exit'],
    cwd: process.cwd(),
    environment: environment(),
    deadlineMs: 50,
    terminationGraceMs: 100,
  });
  assert.deepEqual(result, {
    status: 'failed',
    code: 'child-deadline-exceeded',
  });
  const signalsAtReturn = signaledGroups.length;
  await new Promise<void>((resolve) => setTimeout(resolve, 150));
  assert.equal(signaledGroups.length, signalsAtReturn);
});

test('forced teardown removes a non-cooperative descendant process', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'm07b-quiescence-'));
  const marker = join(directory, 'descendant.pid');
  try {
    const result = await runQuiescentChild({
      executable: process.execPath,
      arguments: [fixture, 'descendant', marker],
      cwd: process.cwd(),
      environment: environment(),
      deadlineMs: 250,
      terminationGraceMs: 25,
    });
    assert.deepEqual(result, {
      status: 'failed',
      code: 'child-deadline-exceeded',
    });
    const pid = Number(await readFile(marker, 'utf8'));
    assert.throws(() => process.kill(pid, 0), /ESRCH/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('external abort reaches and quiesces the detached process group', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'm07c-interrupt-'));
  const marker = join(directory, 'descendant.pid');
  const controller = new AbortController();
  try {
    setTimeout(() => controller.abort('synthetic-interrupt'), 250);
    const result = await runQuiescentChild({
      executable: process.execPath,
      arguments: [fixture, 'descendant', marker],
      cwd: process.cwd(),
      environment: environment(),
      deadlineMs: 2_000,
      terminationGraceMs: 25,
      signal: controller.signal,
    });
    assert.deepEqual(result, {
      status: 'failed',
      code: 'child-interrupted',
    });
    const pid = Number(await readFile(marker, 'utf8'));
    assert.throws(() => process.kill(pid, 0), /ESRCH/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
