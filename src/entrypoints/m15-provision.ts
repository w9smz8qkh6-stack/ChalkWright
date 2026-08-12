import { createHash } from 'node:crypto';
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

import { loadShadowConfig } from '../config/shadow.js';
import {
  readProtectedJson,
  writeNewProtectedJson,
} from '../infrastructure/filesystem/protected-json.js';

const fixedLegacySource =
  '/srv/openclaw/scripts/powerschool_bell_calendar_sync.js';

export function provisionM15ProductionTrialConfig(options: {
  readonly writerConfigPath: string;
  readonly shadowServerEnvironmentPath: string;
  readonly outputConfigPath: string;
  readonly trialManagedRoot: string;
  readonly legacySourcePath?: string;
}): { readonly status: 'provisioned'; readonly calendarReferenceHash: string } {
  const writer = readProtectedJson(
    options.writerConfigPath,
    isHistoricalM14ProvisioningConfig,
  );
  const shadow = loadShadowConfig(
    readProtectedEnvironment(options.shadowServerEnvironmentPath),
  );
  if (
    shadow.timeZone !== 'Asia/Ho_Chi_Minh' ||
    shadow.roomId !== 'room-c509' ||
    shadow.screenId !== 'screen-c509-shadow'
  )
    throw new Error('m15-provision-shadow-scope-invalid');
  const calendarId = readLegacyCalendarId(
    options.legacySourcePath ?? fixedLegacySource,
  );
  const calendarReferenceHash = digest(calendarId);
  if (calendarReferenceHash !== writer.productionCalendarReferenceHash)
    throw new Error('m15-provision-calendar-identity-invalid');
  ensureNewProtectedDirectory(options.trialManagedRoot);
  const config = {
    version: 1,
    environment: 'production-trial',
    date: '2026-08-11',
    calendarId,
    calendarReferenceHash,
    scopeId: 'classroom-hub-c509-2026-27',
    timeMin: '2026-08-10T17:00:00.000Z',
    timeMax: '2026-08-11T17:00:00.000Z',
    timeZone: 'Asia/Ho_Chi_Minh',
    roomId: shadow.roomId,
    screenId: shadow.screenId,
    credentialReferencePath: writer.credentialReferencePath,
    sourceManagedRoot: shadow.managedRoot,
    sourceDatabasePath: shadow.databasePath,
    sourceBackupDirectory: shadow.backupDirectory,
    trialManagedRoot: options.trialManagedRoot,
    trialDatabasePath: join(options.trialManagedRoot, 'execution.sqlite'),
    preparedStatePath: join(options.trialManagedRoot, 'prepared.json'),
    approvalStatePath: join(options.trialManagedRoot, 'approval.json'),
    requestTimeoutMs: 15_000,
    overallTimeoutMs: 180_000,
    leaseDurationSeconds: 300,
    maximumPages: 5,
    maximumEvents: 100,
    maximumWindowDays: 1,
    legacyOpenClawPath: '/opt/openclaw/bin/openclaw',
    legacyProfile: 'workonly',
    legacyCronJobId: 'c174a3b2-1e75-49c5-94da-1b45f2c2f649',
  };
  writeNewProtectedJson(options.outputConfigPath, config);
  return { status: 'provisioned', calendarReferenceHash };
}

interface HistoricalM14ProvisioningConfig {
  readonly version: 1;
  readonly environment: 'non-production';
  readonly calendarSummary: 'Auto Lesson 2';
  readonly calendarId: string;
  readonly calendarReferenceHash: string;
  readonly productionCalendarReferenceHash: string;
  readonly qualificationRunId: string;
  readonly scopeId: 'classroom-hub-m14-auto-lesson-2';
  readonly timeZone: 'Asia/Ho_Chi_Minh';
  readonly credentialReferencePath: string;
  readonly databasePath: string;
  readonly requestTimeoutMs: 15_000;
  readonly overallTimeoutMs: 180_000;
  readonly leaseDurationSeconds: 300;
}

function isHistoricalM14ProvisioningConfig(
  value: unknown,
): value is HistoricalM14ProvisioningConfig {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).sort().join(',') ===
      'calendarId,calendarReferenceHash,calendarSummary,credentialReferencePath,databasePath,environment,leaseDurationSeconds,overallTimeoutMs,productionCalendarReferenceHash,qualificationRunId,requestTimeoutMs,scopeId,timeZone,version' &&
    record.version === 1 &&
    record.environment === 'non-production' &&
    record.calendarSummary === 'Auto Lesson 2' &&
    typeof record.calendarId === 'string' &&
    record.calendarId !== 'primary' &&
    /^[A-Za-z0-9][A-Za-z0-9._@-]{0,511}$/u.test(record.calendarId) &&
    record.calendarReferenceHash === digest(record.calendarId) &&
    typeof record.productionCalendarReferenceHash === 'string' &&
    /^sha256:[a-f0-9]{64}$/u.test(record.productionCalendarReferenceHash) &&
    record.productionCalendarReferenceHash !== record.calendarReferenceHash &&
    typeof record.qualificationRunId === 'string' &&
    /^m14-[A-Za-z0-9._:-]{1,59}$/u.test(record.qualificationRunId) &&
    record.scopeId === 'classroom-hub-m14-auto-lesson-2' &&
    record.timeZone === 'Asia/Ho_Chi_Minh' &&
    normalizedAbsolutePath(record.credentialReferencePath) &&
    normalizedAbsolutePath(record.databasePath) &&
    record.requestTimeoutMs === 15_000 &&
    record.overallTimeoutMs === 180_000 &&
    record.leaseDurationSeconds === 300
  );
}

function normalizedAbsolutePath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.startsWith('/') &&
    value !== '/' &&
    !value.includes('\0')
  );
}

function readProtectedEnvironment(path: string): NodeJS.ProcessEnv {
  assertOwnerOnlyFile(path, 64 * 1024);
  const environment: NodeJS.ProcessEnv = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/u)) {
    if (line.length === 0 || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) throw new Error('m15-provision-shadow-config-invalid');
    const name = line.slice(0, separator);
    const value = decodeEnvironmentValue(line.slice(separator + 1));
    if (!/^CLASSROOM_HUB_[A-Z0-9_]{1,96}$/u.test(name))
      throw new Error('m15-provision-shadow-config-invalid');
    if (environment[name] !== undefined)
      throw new Error('m15-provision-shadow-config-invalid');
    environment[name] = value;
  }
  return environment;
}

function decodeEnvironmentValue(value: string): string {
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    const inner = value.slice(1, -1);
    if (inner.includes("'"))
      throw new Error('m15-provision-shadow-config-invalid');
    return inner;
  }
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    const inner = value.slice(1, -1);
    if (/[^\\]"/u.test(inner))
      throw new Error('m15-provision-shadow-config-invalid');
    return inner.replace(/\\([\\"$`])/gu, '$1');
  }
  if (/\s/u.test(value)) throw new Error('m15-provision-shadow-config-invalid');
  return value;
}

function readLegacyCalendarId(path: string): string {
  if (path !== fixedLegacySource)
    throw new Error('m15-provision-legacy-source-invalid');
  const stat = lstatSync(path);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== 1 ||
    stat.size < 1 ||
    stat.size > 512 * 1024 ||
    realpathSync(path) !== path
  )
    throw new Error('m15-provision-legacy-source-invalid');
  const source = readFileSync(path, 'utf8');
  const match =
    /const DEFAULT_CALENDAR_ID\s*=\s*["']([A-Za-z0-9][A-Za-z0-9._@-]{0,511})["'];/u.exec(
      source,
    );
  if (
    match === null ||
    source.match(/const DEFAULT_CALENDAR_ID\b/gu)?.length !== 1
  )
    throw new Error('m15-provision-calendar-identity-invalid');
  return match[1]!;
}

function assertOwnerOnlyFile(path: string, maximumBytes: number): void {
  const effectiveUid = process.geteuid?.();
  if (effectiveUid === undefined) throw new Error('m15-provision-path-unsafe');
  const stat = lstatSync(path);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== 1 ||
    stat.uid !== effectiveUid ||
    (stat.mode & 0o077) !== 0 ||
    stat.size < 2 ||
    stat.size > maximumBytes ||
    realpathSync(path) !== path
  )
    throw new Error('m15-provision-path-unsafe');
}

function ensureNewProtectedDirectory(path: string): void {
  try {
    mkdirSync(path, { mode: 0o700 });
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST')
      throw new Error('m15-provision-path-unsafe');
  }
  const effectiveUid = process.geteuid?.();
  const stat = lstatSync(path);
  if (
    effectiveUid === undefined ||
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    stat.uid !== effectiveUid ||
    (stat.mode & 0o077) !== 0 ||
    realpathSync(path) !== path
  )
    throw new Error('m15-provision-path-unsafe');
  chmodSync(path, 0o700);
  const parent = lstatSync(dirname(path));
  if (!parent.isDirectory() || parent.isSymbolicLink())
    throw new Error('m15-provision-path-unsafe');
}

function digest(value: string): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

if (process.argv[1]?.endsWith('/entrypoints/m15-provision.js')) {
  try {
    const result = provisionM15ProductionTrialConfig({
      writerConfigPath:
        '/etc/classroom-hub/providers/google-calendar/writer-config.json',
      shadowServerEnvironmentPath: '/etc/classroom-hub/shadow/server.env',
      outputConfigPath:
        '/etc/classroom-hub/migration/m15-production-trial.json',
      trialManagedRoot: '/var/lib/classroom-hub/m15-trial',
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error: unknown) {
    const message =
      error instanceof Error && /^[a-z0-9-]{3,96}$/u.test(error.message)
        ? error.message
        : 'm15-provision-failed';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
