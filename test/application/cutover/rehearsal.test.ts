import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildM16CutoverRehearsalManifest,
  isM16CutoverRehearsalManifest,
  m16Checklist,
  m16SmokeCases,
  rehearseM16Cutover,
  type M16CutoverRehearsalPort,
  type M16OperationalSnapshot,
} from '../../../src/application/cutover/rehearsal.js';

const hash = (digit: string) => `sha256:${digit.repeat(64)}`;

function manifest() {
  return buildM16CutoverRehearsalManifest({
    configurationFingerprint: hash('1'),
    targetReferenceHashes: {
      route: hash('2'),
      serviceInventory: hash('3'),
      schedulerInventory: hash('4'),
      writerScope: hash('5'),
      kioskRuntime: hash('6'),
    },
  });
}

class FakeRehearsalPort implements M16CutoverRehearsalPort {
  readonly operations: string[] = [];
  readonly state: {
    legacyWriterActive: boolean;
    replacementServiceActive: boolean;
    replacementTimersActive: boolean;
    replacementWriterActive: boolean;
    routeOwner: 'legacy' | 'replacement';
  } = {
    legacyWriterActive: true,
    replacementServiceActive: false,
    replacementTimersActive: false,
    replacementWriterActive: false,
    routeOwner: 'legacy',
  };
  private tick = 0;

  constructor(
    private readonly failAt?: 'smoke' | 'restore',
    private readonly unsafeDoubleWriter = false,
  ) {}

  nowMs(): number {
    this.tick += 7;
    return this.tick;
  }

  async freezeConfiguration(): Promise<string> {
    this.operations.push('freeze');
    return hash('1');
  }

  async snapshot(): Promise<M16OperationalSnapshot> {
    return {
      legacyServiceActive: true,
      legacyTimersActive: true,
      ...this.state,
    };
  }

  async createVerifiedBackup(): Promise<string> {
    this.operations.push('backup');
    return hash('7');
  }

  async setLegacyWriterActive(active: boolean): Promise<void> {
    this.operations.push(`legacy-writer:${active}`);
    this.state.legacyWriterActive = active;
  }

  async setReplacementServiceActive(active: boolean): Promise<void> {
    this.operations.push(`replacement-service:${active}`);
    this.state.replacementServiceActive = active;
  }

  async setReplacementWriterActive(active: boolean): Promise<void> {
    this.operations.push(`replacement-writer:${active}`);
    this.state.replacementWriterActive = active;
    if (active && this.unsafeDoubleWriter) this.state.legacyWriterActive = true;
  }

  async setReplacementTimersActive(active: boolean): Promise<void> {
    this.operations.push(`replacement-timers:${active}`);
    this.state.replacementTimersActive = active;
  }

  async setRouteOwner(owner: 'legacy' | 'replacement'): Promise<void> {
    this.operations.push(`route:${owner}`);
    this.state.routeOwner = owner;
  }

  async smokeReplacement() {
    this.operations.push('smoke');
    if (this.failAt === 'smoke') throw new Error('synthetic-smoke-failure');
    return { cases: m16SmokeCases, fingerprint: hash('8') };
  }

  async restoreVerifiedBackup(): Promise<void> {
    this.operations.push('restore');
    if (this.failAt === 'restore') throw new Error('synthetic-restore-failure');
  }
}

test('rehearses the exact cutover and rollback with one writer and restored baseline', async () => {
  const port = new FakeRehearsalPort();
  const evidence = await rehearseM16Cutover({ manifest: manifest(), port });

  assert.equal(evidence.status, 'passed');
  assert.deepEqual(
    evidence.receipts.map((entry) => entry.step),
    m16Checklist,
  );
  assert.equal(evidence.maximumConcurrentWriters, 1);
  assert.equal(evidence.baselineRestored, true);
  assert.equal(evidence.recoveryObjectiveMet, true);
  assert.equal(evidence.attemptedExternalMutations, 0);
  assert.equal(evidence.completedExternalMutations, 0);
  assert.equal(evidence.liveOperationalChanges, 0);
  assert.deepEqual(port.state, {
    legacyWriterActive: true,
    replacementServiceActive: false,
    replacementTimersActive: false,
    replacementWriterActive: false,
    routeOwner: 'legacy',
  });
  assert.ok(
    port.operations.indexOf('legacy-writer:false') <
      port.operations.indexOf('replacement-writer:true'),
  );
  assert.ok(
    port.operations.indexOf('replacement-writer:false') <
      port.operations.indexOf('legacy-writer:true'),
  );
});

test('a forward failure executes the complete rollback and returns finite evidence', async () => {
  const port = new FakeRehearsalPort('smoke');
  const evidence = await rehearseM16Cutover({ manifest: manifest(), port });

  assert.equal(evidence.status, 'failed-restored');
  assert.equal(evidence.failureCode, 'm16-forward-step-failed');
  assert.equal(evidence.smokeFingerprint, undefined);
  assert.equal(evidence.baselineRestored, true);
  assert.equal(port.state.routeOwner, 'legacy');
  assert.equal(port.state.legacyWriterActive, true);
  assert.equal(port.state.replacementWriterActive, false);
  assert.equal(port.state.replacementServiceActive, false);
});

test('invalid manifests, double writers, and incomplete rollback fail closed', async () => {
  const valid = manifest();
  assert.equal(isM16CutoverRehearsalManifest(valid), true);
  assert.equal(isM16CutoverRehearsalManifest({ ...valid, extra: true }), false);
  assert.equal(
    isM16CutoverRehearsalManifest({
      ...valid,
      checklistFingerprint: hash('9'),
    }),
    false,
  );

  await assert.rejects(
    rehearseM16Cutover({
      manifest: valid,
      port: new FakeRehearsalPort(undefined, true),
    }),
    /m16-rehearsal-double-writer/u,
  );
  await assert.rejects(
    rehearseM16Cutover({
      manifest: valid,
      port: new FakeRehearsalPort('restore'),
    }),
    /m16-rehearsal-rollback-failed/u,
  );
});
