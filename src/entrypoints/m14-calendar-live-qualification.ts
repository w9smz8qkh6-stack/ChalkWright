import { createHash } from 'node:crypto';
import { lstatSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

import {
  recoverM14LiveQualification,
  runM14LiveQualification,
  type M14LiveQualificationEvidence,
} from '../application/calendar/live-qualification.js';
import {
  loadGoogleCalendarWriterConfig,
  type GoogleCalendarWriterConfig,
} from '../config/google-calendar-writer.js';
import { stableSerialize } from '../domain/pure-values.js';
import { epoch } from '../domain/pure-values.js';
import { isIsoInstant } from '../domain/runtime-validation.js';
import { loadOfficialCalendarMutationTransport } from '../infrastructure/google-calendar/official-writer-client.js';
import { completeRuntimeImplementationFingerprint } from '../infrastructure/filesystem/runtime-fingerprint.js';
import { SqliteCalendarExecutionState } from '../infrastructure/sqlite/calendar-execution-state.js';
import { SqliteDatabase } from '../infrastructure/sqlite/database.js';

const configEnvironmentName =
  'CLASSROOM_HUB_M14_WRITER_CONFIG_REFERENCE' as const;

export function m14LiveApprovalFingerprint(
  config: Pick<
    GoogleCalendarWriterConfig,
    | 'approvalExpiresAt'
    | 'approvalIssuedAt'
    | 'calendarReferenceHash'
    | 'credentialReferencePath'
    | 'databasePath'
    | 'leaseDurationSeconds'
    | 'overallTimeoutMs'
    | 'productionCalendarReferenceHash'
    | 'qualificationRunId'
    | 'requestTimeoutMs'
    | 'scopeId'
    | 'timeZone'
  >,
  implementationFingerprint: string,
  mode: 'execute' | 'recover' = 'execute',
): string {
  return digest({
    kind: 'm14-auto-lesson-2-live-qualification',
    version: 1,
    calendarReferenceHash: config.calendarReferenceHash,
    productionCalendarReferenceHash: config.productionCalendarReferenceHash,
    qualificationRunId: config.qualificationRunId,
    scopeId: config.scopeId,
    timeZone: config.timeZone,
    requestTimeoutMs: config.requestTimeoutMs,
    overallTimeoutMs: config.overallTimeoutMs,
    leaseDurationSeconds: config.leaseDurationSeconds,
    approvalIssuedAt: config.approvalIssuedAt,
    approvalExpiresAt: config.approvalExpiresAt,
    credentialReferenceHash: digest(config.credentialReferencePath),
    databaseReferenceHash: digest(config.databasePath),
    implementationFingerprint,
    mode,
    sequence:
      mode === 'execute'
        ? 'setup-create-two;verify-seeded-owned-noop;create-replace-delete;injected-journal-retry;readback;rollback-main-with-fresh-delete-restore;rollback-setup;delete-restored-copy;failure-recovery;empty-readback'
        : 'preflight-four-deterministic-owned-references;delete-exact-owned-test-events;empty-readback',
  });
}

export async function runM14LiveQualificationEntrypoint(options: {
  readonly arguments: readonly string[];
  readonly environment?: NodeJS.ProcessEnv;
  readonly clock?: () => string;
}): Promise<
  | { readonly mode: 'approval'; readonly approvalFingerprint: string }
  | {
      readonly mode: 'execute' | 'recover';
      readonly evidence: M14LiveQualificationEvidence;
    }
> {
  const environment = options.environment ?? process.env;
  const referencePath = environment[configEnvironmentName];
  if (
    typeof referencePath !== 'string' ||
    !isAbsolute(referencePath) ||
    resolve(referencePath) !== referencePath
  )
    throw new Error('m14-writer-config-reference-invalid');
  const config = loadGoogleCalendarWriterConfig(referencePath);
  const clock = options.clock ?? (() => new Date().toISOString());
  const now = clock();
  if (!validApprovalAt(config, now))
    throw new Error('m14-live-approval-expired');
  const implementationFingerprint = m14RuntimeImplementationFingerprint();
  if (
    options.arguments.length === 1 &&
    options.arguments[0] === '--print-approval-fingerprint'
  )
    return {
      mode: 'approval',
      approvalFingerprint: m14LiveApprovalFingerprint(
        config,
        implementationFingerprint,
        'execute',
      ),
    };
  if (
    options.arguments.length === 1 &&
    options.arguments[0] === '--print-recovery-approval-fingerprint'
  )
    return {
      mode: 'approval',
      approvalFingerprint: m14LiveApprovalFingerprint(
        config,
        implementationFingerprint,
        'recover',
      ),
    };
  const requestedMode =
    options.arguments[0] === '--execute'
      ? 'execute'
      : options.arguments[0] === '--recover'
        ? 'recover'
        : undefined;
  const expectedApproval =
    requestedMode === undefined
      ? undefined
      : m14LiveApprovalFingerprint(
          config,
          implementationFingerprint,
          requestedMode,
        );
  if (
    requestedMode === undefined ||
    options.arguments.length !== 3 ||
    options.arguments[1] !== '--approval-fingerprint' ||
    options.arguments[2] !== expectedApproval
  )
    throw new Error('m14-live-approval-invalid');

  assertSafeDatabaseTarget(config.databasePath, false);
  const database = new SqliteDatabase(config.databasePath, {
    migration: { appliedAt: now },
  });
  try {
    assertSafeDatabaseTarget(config.databasePath, true);
    const qualificationOptions = {
      calendarId: config.calendarId,
      calendarReferenceHash: config.calendarReferenceHash,
      productionCalendarReferenceHash: config.productionCalendarReferenceHash,
      qualificationRunId: config.qualificationRunId,
      approvalExpiresAt: config.approvalExpiresAt,
      scopeId: config.scopeId,
      timeZone: config.timeZone,
      requestTimeoutMs: config.requestTimeoutMs,
      leaseDurationSeconds: config.leaseDurationSeconds,
      clock,
      signal: AbortSignal.timeout(config.overallTimeoutMs),
      state: new SqliteCalendarExecutionState(database),
      transport: loadOfficialCalendarMutationTransport(
        config.credentialReferencePath,
      ),
    };
    const evidence =
      requestedMode === 'execute'
        ? await runM14LiveQualification(qualificationOptions)
        : await recoverM14LiveQualification(qualificationOptions);
    return { mode: requestedMode, evidence };
  } finally {
    database.close();
  }
}

function validApprovalAt(
  config: Pick<
    GoogleCalendarWriterConfig,
    'approvalIssuedAt' | 'approvalExpiresAt' | 'overallTimeoutMs'
  >,
  now: string,
): boolean {
  if (!isIsoInstant(now)) return false;
  const issued = epoch(config.approvalIssuedAt);
  const expires = epoch(config.approvalExpiresAt);
  const current = epoch(now);
  return (
    issued !== undefined &&
    expires !== undefined &&
    current !== undefined &&
    issued <= current &&
    current < expires &&
    current + config.overallTimeoutMs <= expires
  );
}

export function m14RuntimeImplementationFingerprint(): string {
  return completeRuntimeImplementationFingerprint({
    anchorSourcePath: 'src/entrypoints/m14-calendar-live-qualification.ts',
    errorCode: 'm14-live-implementation-unavailable',
  });
}

function assertSafeDatabaseTarget(path: string, required: boolean): void {
  const effectiveUid = process.geteuid?.();
  if (effectiveUid === undefined)
    throw new Error('m14-live-database-target-unsafe');
  const parent = dirname(path);
  const parentStat = lstatSync(parent);
  if (
    !parentStat.isDirectory() ||
    parentStat.isSymbolicLink() ||
    parentStat.uid !== effectiveUid ||
    (parentStat.mode & 0o077) !== 0 ||
    realpathSync(parent) !== parent
  )
    throw new Error('m14-live-database-target-unsafe');
  try {
    const file = lstatSync(path);
    if (
      !file.isFile() ||
      file.isSymbolicLink() ||
      file.nlink !== 1 ||
      file.uid !== effectiveUid ||
      (file.mode & 0o077) !== 0 ||
      realpathSync(path) !== path
    )
      throw new Error('m14-live-database-target-unsafe');
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      error.message === 'm14-live-database-target-unsafe'
    )
      throw error;
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || required)
      throw new Error('m14-live-database-target-unsafe');
  }
}

function digest(value: unknown): string {
  return `sha256:${createHash('sha256').update(stableSerialize(value)).digest('hex')}`;
}

if (
  process.argv[1]?.endsWith('/entrypoints/m14-calendar-live-qualification.js')
) {
  void runM14LiveQualificationEntrypoint({
    arguments: process.argv.slice(2),
  })
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result)}\n`);
      if (
        (result.mode === 'execute' || result.mode === 'recover') &&
        result.evidence.status !== 'succeeded'
      )
        process.exitCode = 1;
    })
    .catch((error: unknown) => {
      const message =
        error instanceof Error && /^[a-z0-9-]{3,80}$/u.test(error.message)
          ? error.message
          : 'm14-live-qualification-failed';
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
    });
}
