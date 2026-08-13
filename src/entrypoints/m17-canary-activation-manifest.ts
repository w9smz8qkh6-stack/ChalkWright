import { loadM17ActivationManifest } from '../config/m17-activation-manifest.js';
import { loadM17CanaryCalendarConfig } from '../config/m17-canary.js';
import { loadProductionServerConfig } from '../config/production.js';
import { SqliteDatabase } from '../infrastructure/sqlite/database.js';
import { SqliteApplicationStateRepository } from '../infrastructure/sqlite/repository.js';
import { m17EvidenceFingerprint } from '../application/comparison/m17-canary.js';
import { isDirectEntrypoint } from './direct-invocation.js';
import type { ScreenId } from '../domain/identities.js';
import { readlinkSync } from 'node:fs';

export async function verifyM17ActivationManifest(options: {
  readonly arguments: readonly string[];
  readonly environment?: NodeJS.ProcessEnv;
  readonly now?: () => string;
  readonly calendarConfigReference?: string;
  readonly currentReleaseSha256?: () => string;
}): Promise<{ readonly exitCode: number; readonly status: string }> {
  if (
    (options.arguments.length !== 3 ||
      options.arguments[0] !== '--verify' ||
      !/^[a-f0-9]{64}$/u.test(options.arguments[2] ?? '')) &&
    (options.arguments.length !== 2 ||
      options.arguments[0] !== '--verify-current')
  )
    return { exitCode: 64, status: 'm17-activation-manifest-usage-invalid' };
  let database: SqliteDatabase | undefined;
  try {
    const manifest = loadM17ActivationManifest(options.arguments[1]!);
    const releaseSha256 =
      options.arguments[0] === '--verify'
        ? options.arguments[2]!
        : (options.currentReleaseSha256 ?? currentReleaseSha256)();
    const calendar = loadM17CanaryCalendarConfig(
      options.calendarConfigReference ??
        '/etc/chalkwright/canary/calendar.json',
    );
    const production = loadProductionServerConfig(
      calendar.productionConfigReference,
    );
    const now = (options.now ?? (() => new Date().toISOString()))();
    if (
      manifest.releaseSha256 !== releaseSha256 ||
      manifest.calendarReferenceHash !== calendar.calendarReferenceHash ||
      JSON.stringify(manifest.deniedCalendarReferenceHashes) !==
        JSON.stringify(calendar.deniedCalendarReferenceHashes) ||
      manifest.screenId !== production.screenId ||
      now < manifest.observationStartsAt ||
      now >= manifest.observationEndsAt
    )
      throw new Error('m17-activation-manifest-binding-invalid');
    database = new SqliteDatabase(calendar.databasePath, {
      migration: { appliedAt: now },
    });
    const repository = new SqliteApplicationStateRepository(database, {
      clock: { now: () => now },
      nextRevision: () => 'm17-manifest-verification',
    });
    const record = await repository.findRecord({
      kind: 'comparison-evidence',
      recordKey: manifest.comparisonRecordKey,
      date: manifest.comparisonDate,
      screenId: manifest.screenId as ScreenId,
    });
    if (
      record === undefined ||
      record.kind !== 'comparison-evidence' ||
      !record.data.equal ||
      record.data.differenceCodes.length !== 0 ||
      Date.parse(record.data.comparedAt) > Date.parse(now) ||
      (options.arguments[0] === '--verify' &&
        Date.parse(now) - Date.parse(record.data.comparedAt) >
          24 * 60 * 60_000) ||
      m17EvidenceFingerprint(record) !== manifest.comparisonEvidenceFingerprint
    )
      throw new Error('m17-activation-comparison-invalid');
    return { exitCode: 0, status: 'm17-activation-manifest-verified' };
  } catch {
    return { exitCode: 1, status: 'm17-activation-manifest-invalid' };
  } finally {
    database?.close();
  }
}

function currentReleaseSha256(): string {
  const match = /^releases\/([a-f0-9]{64})$/u.exec(
    readlinkSync('/opt/chalkwright-canary/current'),
  );
  if (match === null) throw new Error('m17-activation-release-invalid');
  return match[1]!;
}

async function main(): Promise<void> {
  const result = await verifyM17ActivationManifest({
    arguments: process.argv.slice(2),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result.exitCode;
}

if (isDirectEntrypoint(import.meta.url, process.argv[1])) void main();
