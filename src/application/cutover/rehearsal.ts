import { createHash } from 'node:crypto';

const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const FOUR_HOURS_MS = 4 * 60 * 60 * 1_000;

export const m16Checklist = [
  'freeze-configuration',
  'verify-baseline',
  'create-verified-backup',
  'exclude-legacy-writer',
  'start-replacement-service',
  'acquire-replacement-writer',
  'start-replacement-timers',
  'switch-route',
  'smoke-b407',
  'release-replacement-writer',
  'restore-route',
  'stop-replacement-timers',
  'stop-replacement-service',
  'restore-verified-backup',
  'restore-legacy-writer',
  'verify-baseline-restored',
] as const;

export type M16ChecklistStep = (typeof m16Checklist)[number];

export const m16SmokeCases = [
  'compatibility-tv',
  'legacy-api-displays',
  'legacy-api-day-plan',
  'legacy-api-preview',
  'state-no-classes',
  'state-morning-overview',
  'state-idle',
  'state-pre-checkin',
  'state-in-class-content',
  'state-dismissal-warning',
  'state-post-end',
  'state-day-complete',
  'target',
  'manifest',
  'legacy-icon',
  'asset-css',
  'asset-client',
  'dismissal-media',
  'health',
  'readiness',
  'qr',
] as const;

export type M16SmokeCase = (typeof m16SmokeCases)[number];

export interface M16TargetReferenceHashes {
  readonly route: string;
  readonly serviceInventory: string;
  readonly schedulerInventory: string;
  readonly writerScope: string;
  readonly kioskRuntime: string;
}

export interface M16CutoverRehearsalManifest {
  readonly version: 1;
  readonly kind: 'm16-cutover-rehearsal-manifest';
  readonly environment: 'isolated-rehearsal';
  readonly timeZone: 'Asia/Ho_Chi_Minh';
  readonly recoveryObjectiveMs: typeof FOUR_HOURS_MS;
  readonly configurationFingerprint: string;
  readonly targetReferenceHashes: M16TargetReferenceHashes;
  readonly checklistFingerprint: string;
}

export interface M16OperationalSnapshot {
  readonly legacyServiceActive: true;
  readonly legacyTimersActive: true;
  readonly legacyWriterActive: boolean;
  readonly replacementServiceActive: boolean;
  readonly replacementTimersActive: boolean;
  readonly replacementWriterActive: boolean;
  readonly routeOwner: 'legacy' | 'replacement';
}

export interface M16SmokeResult {
  readonly cases: readonly M16SmokeCase[];
  readonly fingerprint: string;
}

export interface M16CutoverRehearsalPort {
  nowMs(): number;
  freezeConfiguration(): Promise<string>;
  snapshot(): Promise<M16OperationalSnapshot>;
  createVerifiedBackup(): Promise<string>;
  setLegacyWriterActive(active: boolean): Promise<void>;
  setReplacementServiceActive(active: boolean): Promise<void>;
  setReplacementWriterActive(active: boolean): Promise<void>;
  setReplacementTimersActive(active: boolean): Promise<void>;
  setRouteOwner(owner: 'legacy' | 'replacement'): Promise<void>;
  smokeReplacement(): Promise<M16SmokeResult>;
  restoreVerifiedBackup(backupFingerprint: string): Promise<void>;
}

export interface M16StepReceipt {
  readonly step: M16ChecklistStep;
  readonly outcome: 'passed';
  readonly elapsedMs: number;
  readonly stateFingerprint: string;
}

export interface M16CutoverRehearsalEvidence {
  readonly version: 1;
  readonly kind: 'm16-cutover-rehearsal-evidence';
  readonly status: 'passed' | 'failed-restored';
  readonly failureCode?: 'm16-forward-step-failed';
  readonly manifestFingerprint: string;
  readonly backupFingerprint: string;
  readonly smokeFingerprint?: string;
  readonly receipts: readonly M16StepReceipt[];
  readonly totalElapsedMs: number;
  readonly rollbackElapsedMs: number;
  readonly recoveryObjectiveMs: typeof FOUR_HOURS_MS;
  readonly recoveryObjectiveMet: boolean;
  readonly baselineRestored: true;
  readonly maximumConcurrentWriters: 1;
  readonly attemptedExternalMutations: 0;
  readonly completedExternalMutations: 0;
  readonly liveOperationalChanges: 0;
  readonly evidenceFingerprint: string;
}

export function buildM16CutoverRehearsalManifest(input: {
  readonly configurationFingerprint: string;
  readonly targetReferenceHashes: M16TargetReferenceHashes;
}): M16CutoverRehearsalManifest {
  const base = {
    version: 1 as const,
    kind: 'm16-cutover-rehearsal-manifest' as const,
    environment: 'isolated-rehearsal' as const,
    timeZone: 'Asia/Ho_Chi_Minh' as const,
    recoveryObjectiveMs: FOUR_HOURS_MS,
    configurationFingerprint: input.configurationFingerprint,
    targetReferenceHashes: input.targetReferenceHashes,
  };
  if (
    !SHA256.test(base.configurationFingerprint) ||
    !validTargetHashes(base.targetReferenceHashes)
  )
    throw new Error('m16-rehearsal-manifest-invalid');
  return {
    ...base,
    checklistFingerprint: digest({ checklist: m16Checklist, ...base }),
  };
}

export function isM16CutoverRehearsalManifest(
  value: unknown,
): value is M16CutoverRehearsalManifest {
  if (
    !isPlainObject(value) ||
    !hasExactKeys(value, [
      'version',
      'kind',
      'environment',
      'timeZone',
      'recoveryObjectiveMs',
      'configurationFingerprint',
      'targetReferenceHashes',
      'checklistFingerprint',
    ])
  )
    return false;
  if (
    value.version !== 1 ||
    value.kind !== 'm16-cutover-rehearsal-manifest' ||
    value.environment !== 'isolated-rehearsal' ||
    value.timeZone !== 'Asia/Ho_Chi_Minh' ||
    value.recoveryObjectiveMs !== FOUR_HOURS_MS ||
    typeof value.configurationFingerprint !== 'string' ||
    !SHA256.test(value.configurationFingerprint) ||
    !validTargetHashes(value.targetReferenceHashes) ||
    typeof value.checklistFingerprint !== 'string' ||
    !SHA256.test(value.checklistFingerprint)
  )
    return false;
  const { checklistFingerprint: _ignored, ...base } = value;
  return (
    value.checklistFingerprint === digest({ checklist: m16Checklist, ...base })
  );
}

export function fingerprintM16Manifest(
  manifest: M16CutoverRehearsalManifest,
): string {
  if (!isM16CutoverRehearsalManifest(manifest))
    throw new Error('m16-rehearsal-manifest-invalid');
  return digest(manifest);
}

export async function rehearseM16Cutover(options: {
  readonly manifest: M16CutoverRehearsalManifest;
  readonly port: M16CutoverRehearsalPort;
}): Promise<M16CutoverRehearsalEvidence> {
  if (!isM16CutoverRehearsalManifest(options.manifest))
    throw new Error('m16-rehearsal-manifest-invalid');

  const startedAt = finiteNow(options.port);
  const receipts: M16StepReceipt[] = [];
  let maximumConcurrentWriters = 0;
  let backupFingerprint = '';
  let smokeFingerprint: string | undefined;
  let rollbackStartedAt = startedAt;
  let forwardFailed = false;
  let doubleWriterObserved = false;

  const observe = async (): Promise<M16OperationalSnapshot> => {
    const snapshot = await options.port.snapshot();
    assertSnapshot(snapshot);
    const writers =
      Number(snapshot.legacyWriterActive) +
      Number(snapshot.replacementWriterActive);
    maximumConcurrentWriters = Math.max(maximumConcurrentWriters, writers);
    if (writers > 1) throw new Error('m16-rehearsal-double-writer');
    return snapshot;
  };
  const step = async (
    name: M16ChecklistStep,
    operation: () => Promise<void>,
  ): Promise<void> => {
    const before = finiteNow(options.port);
    await operation();
    const snapshot = await observe();
    const after = finiteNow(options.port);
    if (after < before) throw new Error('m16-rehearsal-clock-invalid');
    receipts.push({
      step: name,
      outcome: 'passed',
      elapsedMs: after - before,
      stateFingerprint: digest(snapshot),
    });
  };

  await step('freeze-configuration', async () => {
    const fingerprint = await options.port.freezeConfiguration();
    if (fingerprint !== options.manifest.configurationFingerprint)
      throw new Error('m16-rehearsal-configuration-drift');
  });
  const baseline = await observe();
  assertBaseline(baseline);
  await step('verify-baseline', async () => undefined);
  await step('create-verified-backup', async () => {
    backupFingerprint = await options.port.createVerifiedBackup();
    if (!SHA256.test(backupFingerprint))
      throw new Error('m16-rehearsal-backup-invalid');
  });

  try {
    await step('exclude-legacy-writer', () =>
      options.port.setLegacyWriterActive(false),
    );
    await step('start-replacement-service', () =>
      options.port.setReplacementServiceActive(true),
    );
    await step('acquire-replacement-writer', () =>
      options.port.setReplacementWriterActive(true),
    );
    await step('start-replacement-timers', () =>
      options.port.setReplacementTimersActive(true),
    );
    await step('switch-route', () => options.port.setRouteOwner('replacement'));
    await step('smoke-b407', async () => {
      const result = await options.port.smokeReplacement();
      if (!validSmokeResult(result))
        throw new Error('m16-rehearsal-smoke-invalid');
      smokeFingerprint = result.fingerprint;
    });
  } catch (error) {
    forwardFailed = true;
    doubleWriterObserved =
      error instanceof Error && error.message === 'm16-rehearsal-double-writer';
  }

  rollbackStartedAt = finiteNow(options.port);
  try {
    await step('release-replacement-writer', () =>
      options.port.setReplacementWriterActive(false),
    );
    await step('restore-route', () => options.port.setRouteOwner('legacy'));
    await step('stop-replacement-timers', () =>
      options.port.setReplacementTimersActive(false),
    );
    await step('stop-replacement-service', () =>
      options.port.setReplacementServiceActive(false),
    );
    await step('restore-verified-backup', () =>
      options.port.restoreVerifiedBackup(backupFingerprint),
    );
    await step('restore-legacy-writer', () =>
      options.port.setLegacyWriterActive(true),
    );
    await step('verify-baseline-restored', async () => {
      const restored = await observe();
      if (stableSerialize(restored) !== stableSerialize(baseline))
        throw new Error('m16-rehearsal-baseline-drift');
    });
  } catch {
    throw new Error('m16-rehearsal-rollback-failed');
  }

  const completedAt = finiteNow(options.port);
  if (completedAt < rollbackStartedAt || rollbackStartedAt < startedAt)
    throw new Error('m16-rehearsal-clock-invalid');
  const rollbackElapsedMs = completedAt - rollbackStartedAt;
  if (doubleWriterObserved) throw new Error('m16-rehearsal-double-writer');
  const base = {
    version: 1 as const,
    kind: 'm16-cutover-rehearsal-evidence' as const,
    status: forwardFailed ? ('failed-restored' as const) : ('passed' as const),
    ...(forwardFailed
      ? { failureCode: 'm16-forward-step-failed' as const }
      : {}),
    manifestFingerprint: fingerprintM16Manifest(options.manifest),
    backupFingerprint,
    ...(smokeFingerprint === undefined ? {} : { smokeFingerprint }),
    receipts,
    totalElapsedMs: completedAt - startedAt,
    rollbackElapsedMs,
    recoveryObjectiveMs: FOUR_HOURS_MS,
    recoveryObjectiveMet: rollbackElapsedMs <= FOUR_HOURS_MS,
    baselineRestored: true as const,
    maximumConcurrentWriters: 1 as const,
    attemptedExternalMutations: 0 as const,
    completedExternalMutations: 0 as const,
    liveOperationalChanges: 0 as const,
  };
  if (!base.recoveryObjectiveMet)
    throw new Error('m16-rehearsal-recovery-objective-missed');
  return { ...base, evidenceFingerprint: digest(base) };
}

function validTargetHashes(value: unknown): value is M16TargetReferenceHashes {
  return (
    isPlainObject(value) &&
    hasExactKeys(value, [
      'route',
      'serviceInventory',
      'schedulerInventory',
      'writerScope',
      'kioskRuntime',
    ]) &&
    Object.values(value).every(
      (entry) => typeof entry === 'string' && SHA256.test(entry),
    )
  );
}

function validSmokeResult(value: unknown): value is M16SmokeResult {
  return (
    isPlainObject(value) &&
    hasExactKeys(value, ['cases', 'fingerprint']) &&
    Array.isArray(value.cases) &&
    value.cases.length === m16SmokeCases.length &&
    value.cases.every((entry, index) => entry === m16SmokeCases[index]) &&
    typeof value.fingerprint === 'string' &&
    SHA256.test(value.fingerprint)
  );
}

function assertSnapshot(
  value: unknown,
): asserts value is M16OperationalSnapshot {
  if (
    !isPlainObject(value) ||
    !hasExactKeys(value, [
      'legacyServiceActive',
      'legacyTimersActive',
      'legacyWriterActive',
      'replacementServiceActive',
      'replacementTimersActive',
      'replacementWriterActive',
      'routeOwner',
    ]) ||
    value.legacyServiceActive !== true ||
    value.legacyTimersActive !== true ||
    typeof value.legacyWriterActive !== 'boolean' ||
    typeof value.replacementServiceActive !== 'boolean' ||
    typeof value.replacementTimersActive !== 'boolean' ||
    typeof value.replacementWriterActive !== 'boolean' ||
    (value.routeOwner !== 'legacy' && value.routeOwner !== 'replacement')
  )
    throw new Error('m16-rehearsal-snapshot-invalid');
}

function assertBaseline(snapshot: M16OperationalSnapshot): void {
  if (
    !snapshot.legacyServiceActive ||
    !snapshot.legacyTimersActive ||
    !snapshot.legacyWriterActive ||
    snapshot.replacementServiceActive ||
    snapshot.replacementTimersActive ||
    snapshot.replacementWriterActive ||
    snapshot.routeOwner !== 'legacy'
  )
    throw new Error('m16-rehearsal-baseline-invalid');
}

function finiteNow(port: M16CutoverRehearsalPort): number {
  const value = port.nowMs();
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error('m16-rehearsal-clock-invalid');
  return value;
}

function digest(value: unknown): string {
  return `sha256:${createHash('sha256').update(stableSerialize(value)).digest('hex')}`;
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map((entry) => stableSerialize(entry)).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`)
    .join(',')}}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return false;
  try {
    return Object.getPrototypeOf(value) === Object.prototype;
  } catch {
    return false;
  }
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  try {
    const actual = Object.keys(value).sort();
    const expected = [...keys].sort();
    return (
      actual.length === expected.length &&
      actual.every((entry, index) => entry === expected[index])
    );
  } catch {
    return false;
  }
}
