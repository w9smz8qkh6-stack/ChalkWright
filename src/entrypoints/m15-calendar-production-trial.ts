import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { lstatSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';

import {
  buildM15ProductionTrialApproval,
  executePreparedM15ProductionTrial,
  fingerprintM15ProductionTrialApproval,
  isM15PreparedProductionTrialForOptions,
  isM15ProductionTrialApprovalForOptions,
  prepareM15ProductionTrial,
  type M15PreparedProductionTrial,
  type M15ProductionTrialApproval,
  type M15ProductionTrialOptions,
} from '../application/calendar/production-trial.js';
import { m14RuntimeImplementationFingerprint } from './m14-calendar-live-qualification.js';
import {
  loadM15CalendarProductionTrialConfig,
  type M15CalendarProductionTrialConfig,
} from '../config/m15-calendar-production-trial.js';
import type { OpaqueId } from '../contracts/v1/common.js';
import type { EffectiveDayPlan } from '../domain/plans.js';
import { stableSerialize } from '../domain/pure-values.js';
import {
  isEffectivePlan,
  isPlainObject,
} from '../domain/runtime-validation.js';
import {
  readProtectedJson,
  writeNewProtectedJson,
} from '../infrastructure/filesystem/protected-json.js';
import { loadOfficialCalendarProductionTrialTransports } from '../infrastructure/google-calendar/official-writer-client.js';
import {
  verifyLegacyWriterExcluded,
  type LegacyWriterExclusionEvidence,
} from '../infrastructure/openclaw/legacy-writer-exclusion.js';
import {
  createSqliteBackup,
  readBackupCatalogEntry,
  verifySqliteBackup,
  type BackupArtifact,
  type SqlitePathPolicy,
} from '../infrastructure/sqlite/backup.js';
import { SqliteCalendarExecutionState } from '../infrastructure/sqlite/calendar-execution-state.js';
import { SqliteDatabase } from '../infrastructure/sqlite/database.js';

const configEnvironmentName = 'CLASSROOM_HUB_M15_CONFIG_REFERENCE' as const;

export type M15EntrypointResult =
  | {
      readonly mode: 'prepare';
      readonly status: 'ready';
      readonly code: 'm15-production-preflight-ready';
      readonly proposalFingerprint: string;
      readonly backupFingerprint: string;
      readonly observedEventCount: 3;
      readonly proposedReplaceCount: 3;
      readonly attemptedExternalMutations: 0;
      readonly completedExternalMutations: 0;
    }
  | {
      readonly mode: 'prepare';
      readonly status: 'blocked';
      readonly code: string;
      readonly diagnostic?: Exclude<
        Awaited<ReturnType<typeof prepareM15ProductionTrial>>,
        { status: 'ready' }
      >['diagnostic'];
      readonly attemptedExternalMutations: 0;
      readonly completedExternalMutations: 0;
    }
  | {
      readonly mode: 'stage-approval';
      readonly status: 'ready';
      readonly approvalFingerprint: string;
      readonly proposalFingerprint: string;
      readonly expiresAt: string;
      readonly attemptedExternalMutations: 0;
      readonly completedExternalMutations: 0;
    }
  | {
      readonly mode: 'execute';
      readonly evidence: Awaited<
        ReturnType<typeof executePreparedM15ProductionTrial>
      >;
    };

export async function runM15ProductionTrialEntrypoint(options: {
  readonly arguments: readonly string[];
  readonly environment?: NodeJS.ProcessEnv;
  readonly clock?: () => string;
}): Promise<M15EntrypointResult> {
  const environment = options.environment ?? process.env;
  const referencePath = environment[configEnvironmentName];
  if (referencePath === undefined)
    throw new Error('m15-production-config-reference-invalid');
  const config = loadM15CalendarProductionTrialConfig(referencePath);
  const clock = options.clock ?? (() => new Date().toISOString());
  const implementationFingerprint = m14RuntimeImplementationFingerprint();
  const signal = AbortSignal.timeout(config.overallTimeoutMs);

  if (options.arguments.length === 1 && options.arguments[0] === '--prepare') {
    const exclusion = await exclusionEvidence(config, signal);
    const backup = await createSqliteBackup({
      paths: sourcePaths(config),
      now: new Date(clock()),
    });
    const backupFingerprint = fingerprintBackup(backup);
    const plan = readExactEffectivePlan(config, backup.backupPath);
    const runtime = openRuntime({
      config,
      plan,
      exclusion,
      backupFingerprint,
      implementationFingerprint,
      clock,
      signal,
    });
    try {
      const result = await prepareM15ProductionTrial(runtime.options);
      if (result.status !== 'ready')
        return {
          mode: 'prepare',
          status: 'blocked',
          code: result.code,
          ...(result.diagnostic === undefined
            ? {}
            : { diagnostic: result.diagnostic }),
          attemptedExternalMutations: 0,
          completedExternalMutations: 0,
        };
      writeNewProtectedJson(config.preparedStatePath, result.prepared);
      return {
        mode: 'prepare',
        status: 'ready',
        code: result.code,
        proposalFingerprint: result.prepared.proposalFingerprint,
        backupFingerprint,
        observedEventCount: result.observedEventCount,
        proposedReplaceCount: result.proposedReplaceCount,
        attemptedExternalMutations: 0,
        completedExternalMutations: 0,
      };
    } finally {
      runtime.database.close();
    }
  }

  const loosePrepared = readProtectedJson(
    config.preparedStatePath,
    isLoosePrepared,
  );
  const retainedBackup = findRetainedBackup(
    config,
    loosePrepared.backupFingerprint,
  );
  if (fingerprintBackup(retainedBackup) !== loosePrepared.backupFingerprint)
    throw new Error('m15-production-backup-invalid');
  const exclusion = await exclusionEvidence(config, signal);
  const runtime = openRuntime({
    config,
    plan: loosePrepared.planSnapshot,
    exclusion,
    backupFingerprint: loosePrepared.backupFingerprint,
    implementationFingerprint,
    clock,
    signal,
  });
  try {
    if (!isM15PreparedProductionTrialForOptions(runtime.options, loosePrepared))
      throw new Error('m15-production-prepared-invalid');
    const prepared = loosePrepared;

    if (
      options.arguments.length === 1 &&
      options.arguments[0] === '--stage-approval'
    ) {
      const issuedAt = clock();
      const expiresAt = new Date(
        Date.parse(issuedAt) + 15 * 60_000,
      ).toISOString();
      const approval = buildM15ProductionTrialApproval({
        prepared,
        approvalId:
          `m15-${prepared.proposalFingerprint.slice(-32)}` as OpaqueId,
        issuedAt,
        expiresAt,
      });
      writeNewProtectedJson(config.approvalStatePath, approval);
      return {
        mode: 'stage-approval',
        status: 'ready',
        approvalFingerprint: fingerprintM15ProductionTrialApproval(approval),
        proposalFingerprint: prepared.proposalFingerprint,
        expiresAt,
        attemptedExternalMutations: 0,
        completedExternalMutations: 0,
      };
    }

    if (
      options.arguments.length !== 3 ||
      options.arguments[0] !== '--execute' ||
      options.arguments[1] !== '--approval-fingerprint'
    )
      throw new Error('m15-production-command-invalid');
    const looseApproval = readProtectedJson(
      config.approvalStatePath,
      isLooseApproval,
    );
    if (
      !isM15ProductionTrialApprovalForOptions(
        runtime.options,
        prepared,
        looseApproval,
      ) ||
      options.arguments[2] !==
        fingerprintM15ProductionTrialApproval(looseApproval)
    )
      throw new Error('m15-production-approval-invalid');
    return {
      mode: 'execute',
      evidence: await executePreparedM15ProductionTrial(
        runtime.options,
        prepared,
        looseApproval,
      ),
    };
  } finally {
    runtime.database.close();
  }
}

function openRuntime(input: {
  readonly config: M15CalendarProductionTrialConfig;
  readonly plan: EffectiveDayPlan;
  readonly exclusion: LegacyWriterExclusionEvidence;
  readonly backupFingerprint: string;
  readonly implementationFingerprint: string;
  readonly clock: () => string;
  readonly signal: AbortSignal;
}): {
  readonly database: SqliteDatabase;
  readonly options: M15ProductionTrialOptions;
} {
  assertProtectedRuntimeTarget(input.config.trialManagedRoot);
  assertProtectedRuntimeTarget(dirname(input.config.trialDatabasePath));
  const database = new SqliteDatabase(input.config.trialDatabasePath, {
    migration: { appliedAt: input.clock() },
  });
  try {
    const transports = loadOfficialCalendarProductionTrialTransports(
      input.config.credentialReferencePath,
    );
    return {
      database,
      options: {
        calendarId: input.config.calendarId,
        scopeId: input.config.scopeId,
        timeMin: input.config.timeMin,
        timeMax: input.config.timeMax,
        plan: input.plan,
        requestTimeoutMs: input.config.requestTimeoutMs,
        maximumPages: input.config.maximumPages,
        maximumEvents: input.config.maximumEvents,
        maximumWindowDays: input.config.maximumWindowDays,
        leaseDurationSeconds: input.config.leaseDurationSeconds,
        overallTimeoutMs: input.config.overallTimeoutMs,
        legacyWriterExclusionFingerprint: input.exclusion.fingerprint,
        backupFingerprint: input.backupFingerprint,
        implementationFingerprint: input.implementationFingerprint,
        clock: input.clock,
        signal: input.signal,
        listTransport: transports.listTransport,
        mutationTransport: transports.mutationTransport,
        state: new SqliteCalendarExecutionState(database),
      },
    };
  } catch (error: unknown) {
    database.close();
    throw error;
  }
}

async function exclusionEvidence(
  config: M15CalendarProductionTrialConfig,
  signal: AbortSignal,
): Promise<LegacyWriterExclusionEvidence> {
  return verifyLegacyWriterExcluded({
    executablePath: config.legacyOpenClawPath,
    profile: config.legacyProfile,
    jobId: config.legacyCronJobId,
    signal,
  });
}

function sourcePaths(
  config: M15CalendarProductionTrialConfig,
): SqlitePathPolicy {
  return {
    managedRoot: config.sourceManagedRoot,
    databasePath: config.sourceDatabasePath,
    backupDirectory: config.sourceBackupDirectory,
  };
}

function readExactEffectivePlan(
  config: M15CalendarProductionTrialConfig,
  backupPath: string,
): EffectiveDayPlan {
  const database = new DatabaseSync(backupPath, { readOnly: true });
  try {
    const rows = database
      .prepare(
        `SELECT payload_json, semantic_hash FROM plan_snapshots
          WHERE plan_kind = 'effective' AND date_scope = ?
            AND screen_id = ? AND room_id = ? AND superseded_at IS NULL
          ORDER BY created_at DESC, rowid DESC`,
      )
      .all(config.date, config.screenId, config.roomId) as unknown as readonly {
      readonly payload_json: string;
      readonly semantic_hash: string;
    }[];
    for (const row of rows) {
      try {
        const value: unknown = JSON.parse(row.payload_json);
        if (
          isEffectivePlan(value) &&
          value.date === config.date &&
          value.screenId === config.screenId &&
          value.roomId === config.roomId &&
          value.verification === 'verified' &&
          value.meetings.length === 3 &&
          row.semantic_hash === unprefixedDigest(value)
        )
          return value;
      } catch {
        // Continue to an older exact-scope snapshot.
      }
    }
    throw new Error('m15-production-plan-unavailable');
  } finally {
    database.close();
  }
}

function fingerprintBackup(artifact: BackupArtifact): string {
  return digest({
    version: artifact.version,
    backupFile: artifact.backupFile,
    createdAt: artifact.createdAt,
    checksumSha256: artifact.checksumSha256,
    byteLength: artifact.byteLength,
    pagesTransferred: artifact.pagesTransferred,
    integrity: artifact.integrity,
  });
}

function findRetainedBackup(
  config: M15CalendarProductionTrialConfig,
  expectedFingerprint: string,
): BackupArtifact {
  const paths = sourcePaths(config);
  const candidates = readdirSync(config.sourceBackupDirectory)
    .filter((name) => /^classroom-hub-[0-9TZ-]+\.sqlite$/u.test(name))
    .slice(0, 1_000)
    .flatMap((name) => {
      try {
        const artifact = readBackupCatalogEntry({
          paths,
          backupPath: join(config.sourceBackupDirectory, name),
        });
        return fingerprintBackup(artifact) === expectedFingerprint
          ? [artifact]
          : [];
      } catch {
        return [];
      }
    });
  if (candidates.length !== 1) throw new Error('m15-production-backup-invalid');
  return verifySqliteBackup({ paths, backupPath: candidates[0]!.backupPath });
}

function isLoosePrepared(value: unknown): value is M15PreparedProductionTrial {
  return (
    isPlainObject(value) &&
    value.version === 1 &&
    value.kind === 'm15-production-trial-prepared' &&
    typeof value.backupFingerprint === 'string' &&
    /^sha256:[a-f0-9]{64}$/u.test(value.backupFingerprint) &&
    isEffectivePlan(value.planSnapshot)
  );
}

function isLooseApproval(value: unknown): value is M15ProductionTrialApproval {
  return (
    isPlainObject(value) &&
    value.version === 1 &&
    value.kind === 'm15-production-trial-approval'
  );
}

function assertProtectedRuntimeTarget(path: string): void {
  const effectiveUid = process.geteuid?.();
  if (effectiveUid === undefined)
    throw new Error('m15-production-runtime-unsafe');
  const stat = lstatSync(path);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    stat.uid !== effectiveUid ||
    (stat.mode & 0o077) !== 0 ||
    realpathSync(path) !== path
  )
    throw new Error('m15-production-runtime-unsafe');
}

function digest(value: unknown): string {
  return `sha256:${unprefixedDigest(value)}`;
}

function unprefixedDigest(value: unknown): string {
  return createHash('sha256').update(stableSerialize(value)).digest('hex');
}

if (
  process.argv[1]?.endsWith('/entrypoints/m15-calendar-production-trial.js')
) {
  void runM15ProductionTrialEntrypoint({ arguments: process.argv.slice(2) })
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result)}\n`);
      if (result.mode === 'execute' && result.evidence.status !== 'succeeded')
        process.exitCode = 1;
      if (result.mode === 'prepare' && result.status === 'blocked')
        process.exitCode = 1;
    })
    .catch((error: unknown) => {
      const message =
        error instanceof Error && /^[a-z0-9-]{3,96}$/u.test(error.message)
          ? error.message
          : 'm15-production-trial-failed';
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
    });
}
