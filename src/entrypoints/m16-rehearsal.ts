import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  startFixtureBackedMvp,
  type RunningMvpApplication,
} from '../app/mvp-server.js';
import {
  buildM16CutoverRehearsalManifest,
  m16SmokeCases,
  rehearseM16Cutover,
  type M16CutoverRehearsalEvidence,
  type M16CutoverRehearsalPort,
  type M16OperationalSnapshot,
  type M16SmokeResult,
  type M16TargetReferenceHashes,
} from '../application/cutover/rehearsal.js';
import { b407StateInstants } from '../infrastructure/fixture/b407.js';
import {
  createSqliteBackup,
  restoreSqliteBackup,
  verifySqliteBackup,
  type BackupArtifact,
  type SqlitePathPolicy,
} from '../infrastructure/sqlite/backup.js';
import { SqliteDatabase } from '../infrastructure/sqlite/database.js';
import { completeRuntimeImplementationFingerprint } from '../infrastructure/filesystem/runtime-fingerprint.js';

const SYNTHETIC_INSTANT = '2035-04-13T07:00:00.000Z';

interface RunningProxy {
  readonly origin: string;
  close(): Promise<void>;
}

/**
 * Executes the complete M-16 switch and rollback only against disposable
 * loopback servers and temporary SQLite state. It has no host command,
 * provider, identity, service-manager, scheduler, or route capability.
 */
export async function runM16OfflineCutoverRehearsal(): Promise<M16CutoverRehearsalEvidence> {
  const harness = await IsolatedM16Harness.create();
  const manifest = buildM16CutoverRehearsalManifest({
    configurationFingerprint: m16RuntimeImplementationFingerprint(),
    targetReferenceHashes: loadM16TargetReferenceHashes(),
  });
  try {
    return await rehearseM16Cutover({ manifest, port: harness });
  } finally {
    await harness.close();
  }
}

export function m16RuntimeImplementationFingerprint(): string {
  return completeRuntimeImplementationFingerprint({
    anchorSourcePath: 'src/entrypoints/m16-rehearsal.ts',
    errorCode: 'm16-rehearsal-implementation-unavailable',
    additionalRepositoryPaths: [
      'public',
      'scripts/operations',
      'systemd',
      'docs/migration/m16-target-proposal.json',
    ],
  });
}

export function m16TargetReferenceHashesFromProposalText(
  text: string,
): M16TargetReferenceHashes {
  if (
    typeof text !== 'string' ||
    Buffer.byteLength(text, 'utf8') < 128 ||
    Buffer.byteLength(text, 'utf8') > 32_768
  )
    throw new Error('m16-target-proposal-invalid');
  let proposal: unknown;
  try {
    proposal = JSON.parse(text);
  } catch {
    throw new Error('m16-target-proposal-invalid');
  }
  if (
    proposal === null ||
    typeof proposal !== 'object' ||
    Array.isArray(proposal) ||
    Object.keys(proposal).sort().join(',') !==
      'alertDelivery,cadence,classroomEnrichment,display,livePreflight,maintenance,operatorRoles,preparedOn,retainedDisabled,schedulerPolicy,schemaVersion,status,timeZone,unresolved'
  )
    throw new Error('m16-target-proposal-invalid');
  const record = proposal as Record<string, unknown>;
  if (
    record.schemaVersion !== 4 ||
    record.status !== 'approved-inert-target' ||
    record.timeZone !== 'Asia/Ho_Chi_Minh' ||
    !Array.isArray(record.cadence) ||
    !Array.isArray(record.retainedDisabled) ||
    !plainRecord(record.display) ||
    !plainRecord(record.livePreflight) ||
    !plainRecord(record.maintenance) ||
    !plainRecord(record.operatorRoles) ||
    !plainRecord(record.classroomEnrichment) ||
    !plainRecord(record.schedulerPolicy) ||
    !plainRecord(record.alertDelivery) ||
    !plainRecord(record.unresolved)
  )
    throw new Error('m16-target-proposal-invalid');
  const classes = [
    'route',
    'serviceInventory',
    'schedulerInventory',
    'writerScope',
    'kioskRuntime',
  ] as const;
  return Object.fromEntries(
    classes.map((kind) => [kind, digest(`${kind}\u0000${text}`)]),
  ) as unknown as M16TargetReferenceHashes;
}

function loadM16TargetReferenceHashes(): M16TargetReferenceHashes {
  try {
    return m16TargetReferenceHashesFromProposalText(
      readFileSync('docs/migration/m16-target-proposal.json', 'utf8'),
    );
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === 'm16-target-proposal-invalid'
    )
      throw error;
    throw new Error('m16-target-proposal-invalid');
  }
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

class IsolatedM16Harness implements M16CutoverRehearsalPort {
  private readonly root: string;
  private readonly paths: SqlitePathPolicy;
  private readonly sourceDatabase: SqliteDatabase;
  private readonly legacy: RunningMvpApplication;
  private readonly proxy: RunningProxy;
  private replacement: RunningMvpApplication | undefined;
  private backup: BackupArtifact | undefined;
  private legacyWriterActive = true;
  private replacementWriterActive = false;
  private replacementTimersActive = false;
  private routeOwner: 'legacy' | 'replacement' = 'legacy';
  private closed = false;

  private constructor(input: {
    readonly root: string;
    readonly paths: SqlitePathPolicy;
    readonly sourceDatabase: SqliteDatabase;
    readonly legacy: RunningMvpApplication;
    readonly proxy: RunningProxy;
  }) {
    this.root = input.root;
    this.paths = input.paths;
    this.sourceDatabase = input.sourceDatabase;
    this.legacy = input.legacy;
    this.proxy = input.proxy;
  }

  static async create(): Promise<IsolatedM16Harness> {
    const root = mkdtempSync(join(tmpdir(), 'classroom-hub-m16-'));
    const backupDirectory = join(root, 'backups');
    mkdirSync(backupDirectory, { mode: 0o700 });
    const paths = {
      managedRoot: root,
      databasePath: join(root, 'state.sqlite'),
      backupDirectory,
    };
    const sourceDatabase = new SqliteDatabase(paths.databasePath, {
      migration: { appliedAt: SYNTHETIC_INSTANT },
    });
    sourceDatabase.connection.exec(
      "CREATE TABLE m16_rehearsal_marker (id INTEGER PRIMARY KEY CHECK (id = 1), value TEXT NOT NULL); INSERT INTO m16_rehearsal_marker (id, value) VALUES (1, 'baseline');",
    );
    const legacy = await startFixtureBackedMvp(
      {
        nodeEnv: 'test',
        logLevel: 'warn',
        host: '127.0.0.1',
        port: 0,
      },
      process.cwd(),
      { legacyRouteCompatibility: true },
    );
    let harness: IsolatedM16Harness | undefined;
    try {
      const proxy = await startProxy(() => {
        if (harness?.routeOwner === 'replacement') {
          if (harness.replacement === undefined)
            throw new Error('m16-rehearsal-replacement-unavailable');
          return {
            owner: 'replacement' as const,
            origin: harness.replacement.origin,
          };
        }
        return { owner: 'legacy' as const, origin: legacy.origin };
      });
      harness = new IsolatedM16Harness({
        root,
        paths,
        sourceDatabase,
        legacy,
        proxy,
      });
      return harness;
    } catch (error) {
      await legacy.close();
      sourceDatabase.close();
      rmSync(root, { recursive: true, force: true });
      throw error;
    }
  }

  nowMs(): number {
    return Math.floor(performance.now());
  }

  async freezeConfiguration(): Promise<string> {
    return m16RuntimeImplementationFingerprint();
  }

  async snapshot(): Promise<M16OperationalSnapshot> {
    return {
      legacyServiceActive: true,
      legacyTimersActive: true,
      legacyWriterActive: this.legacyWriterActive,
      replacementServiceActive: this.replacement !== undefined,
      replacementTimersActive: this.replacementTimersActive,
      replacementWriterActive: this.replacementWriterActive,
      routeOwner: this.routeOwner,
    };
  }

  async createVerifiedBackup(): Promise<string> {
    this.backup = await createSqliteBackup({
      paths: this.paths,
      now: new Date(SYNTHETIC_INSTANT),
    });
    verifySqliteBackup({
      paths: this.paths,
      backupPath: this.backup.backupPath,
    });
    this.sourceDatabase.connection
      .prepare('UPDATE m16_rehearsal_marker SET value = ? WHERE id = 1')
      .run('post-backup-drift');
    return `sha256:${this.backup.checksumSha256}`;
  }

  async setLegacyWriterActive(active: boolean): Promise<void> {
    if (active && this.replacementWriterActive)
      throw new Error('m16-rehearsal-double-writer');
    this.legacyWriterActive = active;
  }

  async setReplacementServiceActive(active: boolean): Promise<void> {
    if (active) {
      if (this.replacement !== undefined) return;
      this.replacement = await startFixtureBackedMvp(
        {
          nodeEnv: 'test',
          logLevel: 'warn',
          host: '127.0.0.1',
          port: 0,
        },
        process.cwd(),
        { legacyRouteCompatibility: true },
      );
      return;
    }
    if (
      this.routeOwner === 'replacement' ||
      this.replacementWriterActive ||
      this.replacementTimersActive
    )
      throw new Error('m16-rehearsal-service-still-owned');
    await this.replacement?.close();
    this.replacement = undefined;
  }

  async setReplacementWriterActive(active: boolean): Promise<void> {
    if (active && (this.legacyWriterActive || this.replacement === undefined))
      throw new Error('m16-rehearsal-writer-precondition');
    this.replacementWriterActive = active;
  }

  async setReplacementTimersActive(active: boolean): Promise<void> {
    if (
      active &&
      (this.replacement === undefined || !this.replacementWriterActive)
    )
      throw new Error('m16-rehearsal-timer-precondition');
    this.replacementTimersActive = active;
  }

  async setRouteOwner(owner: 'legacy' | 'replacement'): Promise<void> {
    if (owner === 'replacement' && this.replacement === undefined)
      throw new Error('m16-rehearsal-route-precondition');
    this.routeOwner = owner;
  }

  async smokeReplacement(): Promise<M16SmokeResult> {
    if (this.routeOwner !== 'replacement' || this.replacement === undefined)
      throw new Error('m16-rehearsal-smoke-precondition');
    const observations: Array<readonly [string, number, boolean]> = [];
    await observeText(
      this.proxy.origin,
      '/classroom-screen/b407',
      'state-in_class_content',
      observations,
    );
    await observeStatus(
      this.proxy.origin,
      '/classroom-screen/api/displays',
      200,
      observations,
    );
    await observeStatus(
      this.proxy.origin,
      '/classroom-screen/api/day-plan/b407?date=2035-04-13',
      200,
      observations,
    );
    await observeStatus(
      this.proxy.origin,
      '/classroom-screen/api/preview/b407?date=2035-04-13',
      200,
      observations,
    );
    for (const [state, instant] of Object.entries(b407StateInstants)) {
      await observeText(
        this.proxy.origin,
        `/classroom-screen/preview/b407?view=display&now=${encodeURIComponent(instant)}`,
        `state-${state}`,
        observations,
      );
    }
    await observeStatus(
      this.proxy.origin,
      '/classroom-screen/api/target/b407',
      200,
      observations,
    );
    await observeStatus(
      this.proxy.origin,
      '/classroom-screen/manifest.json',
      200,
      observations,
    );
    await observeStatus(
      this.proxy.origin,
      '/classroom-screen/icon.svg',
      200,
      observations,
    );
    await observeStatus(
      this.proxy.origin,
      '/classroom-screen/assets/display.css',
      200,
      observations,
    );
    await observeStatus(
      this.proxy.origin,
      '/classroom-screen/assets/display.js',
      200,
      observations,
    );
    await observeStatus(
      this.proxy.origin,
      '/classroom-screen/api/media/horse-video',
      404,
      observations,
    );
    await observeStatus(
      this.proxy.origin,
      '/classroom-screen/health',
      200,
      observations,
    );
    await observeStatus(
      this.proxy.origin,
      '/classroom-screen/ready',
      200,
      observations,
    );
    const qr = await fetch(
      `${this.proxy.origin}/classroom-screen/api/qr/b407/meeting-b407-a?date=2035-04-13`,
    );
    const signature = new Uint8Array(await qr.arrayBuffer()).slice(0, 8);
    const qrPassed =
      qr.status === 200 &&
      qr.headers.get('x-m16-route-owner') === 'replacement' &&
      [...signature].join(',') === '137,80,78,71,13,10,26,10';
    observations.push(['qr', qr.status, qrPassed]);
    if (!observations.every((entry) => entry[2]))
      throw new Error('m16-rehearsal-smoke-failed');
    return { cases: m16SmokeCases, fingerprint: digest(observations) };
  }

  async restoreVerifiedBackup(backupFingerprint: string): Promise<void> {
    if (
      this.backup === undefined ||
      backupFingerprint !== `sha256:${this.backup.checksumSha256}`
    )
      throw new Error('m16-rehearsal-backup-invalid');
    const restorePath = join(this.root, 'restored.sqlite');
    await restoreSqliteBackup({
      paths: this.paths,
      backupPath: this.backup.backupPath,
      restorePath,
      expectedChecksumSha256: this.backup.checksumSha256,
    });
    const restored = new DatabaseSync(restorePath, { readOnly: true });
    try {
      const row = restored
        .prepare('SELECT value FROM m16_rehearsal_marker WHERE id = 1')
        .get() as { readonly value?: unknown } | undefined;
      if (row?.value !== 'baseline')
        throw new Error('m16-rehearsal-restore-content-invalid');
      const integrity = restored.prepare('PRAGMA integrity_check').get() as
        { readonly integrity_check?: unknown } | undefined;
      if (integrity?.integrity_check !== 'ok')
        throw new Error('m16-rehearsal-restore-integrity-invalid');
    } finally {
      restored.close();
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.proxy.close();
    await this.replacement?.close();
    await this.legacy.close();
    this.sourceDatabase.close();
    rmSync(this.root, { recursive: true, force: true });
  }
}

async function observeText(
  origin: string,
  path: string,
  marker: string,
  observations: Array<readonly [string, number, boolean]>,
): Promise<void> {
  const response = await fetch(`${origin}${path}`);
  const passed =
    response.status === 200 &&
    response.headers.get('x-m16-route-owner') === 'replacement' &&
    (await response.text()).includes(marker);
  observations.push([path.split('?')[0] ?? path, response.status, passed]);
}

async function observeStatus(
  origin: string,
  path: string,
  expectedStatus: number,
  observations: Array<readonly [string, number, boolean]>,
): Promise<void> {
  const response = await fetch(`${origin}${path}`);
  const passed =
    response.status === expectedStatus &&
    response.headers.get('x-m16-route-owner') === 'replacement';
  await response.arrayBuffer();
  observations.push([path, response.status, passed]);
}

async function startProxy(
  target: () => {
    readonly owner: 'legacy' | 'replacement';
    readonly origin: string;
  },
): Promise<RunningProxy> {
  const server = createServer((request, response) => {
    void (async () => {
      try {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          response.writeHead(405).end();
          return;
        }
        const selected = target();
        const upstream = await fetch(
          new URL(request.url ?? '/', selected.origin),
          { method: request.method, redirect: 'manual' },
        );
        const headers: Record<string, string> = {
          'x-m16-route-owner': selected.owner,
        };
        for (const name of ['content-type', 'cache-control', 'location']) {
          const value = upstream.headers.get(name);
          if (value !== null) headers[name] = value;
        }
        response.writeHead(upstream.status, headers);
        if (request.method === 'HEAD') response.end();
        else response.end(Buffer.from(await upstream.arrayBuffer()));
      } catch {
        if (!response.headersSent) response.writeHead(502);
        response.end();
      }
    })();
  });
  await listen(server);
  const address = server.address();
  if (address === null || typeof address === 'string') {
    server.close();
    throw new Error('m16-rehearsal-proxy-start-failed');
  }
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => closeServer(server),
  };
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}

function digest(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

if (process.argv[1]?.endsWith('/entrypoints/m16-rehearsal.js')) {
  void runM16OfflineCutoverRehearsal()
    .then((evidence) => {
      process.stdout.write(
        `${JSON.stringify({
          status: evidence.status,
          evidenceFingerprint: evidence.evidenceFingerprint,
          totalElapsedMs: evidence.totalElapsedMs,
          rollbackElapsedMs: evidence.rollbackElapsedMs,
          recoveryObjectiveMet: evidence.recoveryObjectiveMet,
          maximumConcurrentWriters: evidence.maximumConcurrentWriters,
          attemptedExternalMutations: evidence.attemptedExternalMutations,
          completedExternalMutations: evidence.completedExternalMutations,
          liveOperationalChanges: evidence.liveOperationalChanges,
        })}\n`,
      );
    })
    .catch(() => {
      process.stderr.write(
        '{"status":"failed","code":"m16-rehearsal-failed"}\n',
      );
      process.exitCode = 1;
    });
}
