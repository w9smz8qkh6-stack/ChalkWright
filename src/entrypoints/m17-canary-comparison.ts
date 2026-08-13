import {
  compareM17CanarySemantics,
  isM17SemanticComparisonInput,
} from '../application/comparison/m17-canary.js';
import { loadProductionServerConfig } from '../config/production.js';
import { readProtectedJson } from '../infrastructure/filesystem/protected-json.js';
import { writeNewProtectedJson } from '../infrastructure/filesystem/protected-json.js';
import { SqliteDatabase } from '../infrastructure/sqlite/database.js';
import { SqliteApplicationStateRepository } from '../infrastructure/sqlite/repository.js';
import { isDirectEntrypoint } from './direct-invocation.js';

export async function runM17CanaryComparison(options: {
  readonly arguments: readonly string[];
  readonly environment?: NodeJS.ProcessEnv;
}): Promise<{
  readonly exitCode: number;
  readonly status: string;
  readonly differenceCount: number;
  readonly evidenceFingerprint?: string;
}> {
  if (
    options.arguments.length > 1 ||
    (options.arguments.length === 1 &&
      options.arguments[0] !== '--preactivation')
  )
    return {
      exitCode: 64,
      status: 'm17-comparison-usage-invalid',
      differenceCount: 0,
    };
  const environment = options.environment ?? process.env;
  const inputReference = environment.CHALKWRIGHT_M17_COMPARISON_REFERENCE;
  const productionReference =
    environment.CLASSROOM_HUB_PRODUCTION_CONFIG_REFERENCE;
  if (inputReference === undefined || productionReference === undefined)
    return {
      exitCode: 1,
      status: 'm17-comparison-config-required',
      differenceCount: 0,
    };
  let database: SqliteDatabase | undefined;
  try {
    const input = readProtectedJson(
      inputReference,
      isM17SemanticComparisonInput,
    );
    const production = loadProductionServerConfig(productionReference);
    if (
      input.screenId !== production.screenId ||
      input.reference.timeZone !== production.timeZone ||
      input.candidate.timeZone !== production.timeZone
    )
      throw new Error('m17-comparison-runtime-mismatch');
    const result = compareM17CanarySemantics(input);
    database = new SqliteDatabase(production.databasePath, {
      migration: { appliedAt: input.comparedAt },
    });
    const repository = new SqliteApplicationStateRepository(database, {
      clock: { now: () => input.comparedAt },
      nextRevision: () =>
        `m17-comparison-${result.evidenceFingerprint.slice(-24)}`,
      academicYearEndForDate: () => production.academicYearEnd,
    });
    const stored = await repository.storeRecord(result.evidence);
    if (stored.status === 'rejected')
      throw new Error('m17-comparison-store-failed');
    if (options.arguments[0] === '--preactivation')
      writeNewProtectedJson(
        '/var/lib/chalkwright/canary-production/evidence/m17-preactivation.json',
        result.evidence,
      );
    return {
      exitCode: result.equivalent ? 0 : 2,
      status: result.equivalent
        ? 'm17-comparison-equivalent'
        : 'm17-comparison-different',
      differenceCount: result.differenceCodes.length,
      evidenceFingerprint: result.evidenceFingerprint,
    };
  } catch {
    return { exitCode: 1, status: 'm17-comparison-failed', differenceCount: 0 };
  } finally {
    database?.close();
  }
}

async function main(): Promise<void> {
  const result = await runM17CanaryComparison({
    arguments: process.argv.slice(2),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result.exitCode;
}

if (isDirectEntrypoint(import.meta.url, process.argv[1])) void main();
