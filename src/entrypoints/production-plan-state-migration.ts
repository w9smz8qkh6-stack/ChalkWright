import { statSync } from 'node:fs';

import { loadOperationsConfig } from '../config/operations.js';
import { loadProductionServerConfigOwnedBy } from '../config/production.js';
import { importCurrentLegacyPlanState } from '../application/persistence/legacy-plan-state-migration.js';
import { isDirectEntrypoint } from './direct-invocation.js';

const serviceAccount = Object.freeze({ uid: 972, gid: 972 });
const legacyOwnerUid = 1000;

export async function runProductionPlanStateMigration(options: {
  readonly arguments: readonly string[];
  readonly environment?: NodeJS.ProcessEnv;
  readonly now?: () => string;
}): Promise<{ readonly exitCode: number; readonly status: string }> {
  if (options.arguments.length !== 0)
    return { exitCode: 64, status: 'rejected' };
  const environment = options.environment ?? process.env;
  try {
    if (process.geteuid?.() !== 0)
      throw new Error('production-plan-state-migration-root-required');
    const reference = required(
      environment,
      'CLASSROOM_HUB_PRODUCTION_CONFIG_REFERENCE',
    );
    const legacyDatabase = required(
      environment,
      'CLASSROOM_HUB_LEGACY_PLAN_DATABASE_REFERENCE',
    );
    const production = loadProductionServerConfigOwnedBy(
      reference,
      serviceAccount.uid,
    );
    const operations = loadOperationsConfig(environment);
    if (
      production.instanceId !== operations.instanceId ||
      production.timeZone !== operations.timeZone ||
      production.academicYearEnd !== operations.academicYearEnd ||
      production.managedRoot !== operations.managedRoot ||
      production.databasePath !== operations.databasePath ||
      production.backupDirectory !== operations.backupDirectory
    )
      throw new Error('production-plan-state-migration-config-mismatch');
    const managed = statSync(production.managedRoot);
    if (
      !managed.isDirectory() ||
      managed.uid !== serviceAccount.uid ||
      managed.gid !== serviceAccount.gid ||
      (managed.mode & 0o077) !== 0
    )
      throw new Error('production-plan-state-migration-managed-root-unsafe');
    const result = await importCurrentLegacyPlanState({
      sourceDatabasePath: legacyDatabase,
      sourceOwnerUid: legacyOwnerUid,
      production,
      targetDatabasePath: production.databasePath,
      now: options.now ?? (() => new Date().toISOString()),
      targetOwner: serviceAccount,
    });
    return {
      exitCode: result.status === 'rejected' ? 1 : 0,
      status: result.status,
    };
  } catch {
    return { exitCode: 1, status: 'rejected' };
  }
}

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name];
  if (value === undefined || value.length === 0) throw new Error(name);
  return value;
}

async function main(): Promise<void> {
  const output = await runProductionPlanStateMigration({
    arguments: process.argv.slice(2),
  });
  process.stdout.write(`${JSON.stringify(output)}\n`);
  process.exitCode = output.exitCode;
}

const invokedPath = process.argv[1];
if (isDirectEntrypoint(import.meta.url, invokedPath)) void main();
