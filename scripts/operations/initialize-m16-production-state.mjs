import { lstatSync, realpathSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const applicationRoot = '/opt/classroom-hub';
const configReference = '/etc/classroom-hub/server/production-server.json';
const databasePath =
  '/var/lib/classroom-hub/production/state/classroom-hub.sqlite';

export function assertInitializationConfig(config) {
  if (
    config?.instanceId !== 'classroom-hub-c509-production' ||
    config.roomId !== 'room-c509' ||
    config.screenId !== 'screen-c509-production' ||
    config.host !== '127.0.0.1' ||
    config.port !== 4317 ||
    config.timeZone !== 'Asia/Ho_Chi_Minh' ||
    config.managedRoot !== '/var/lib/classroom-hub/production' ||
    config.databasePath !== databasePath ||
    config.backupDirectory !== '/var/lib/classroom-hub/production/backups'
  )
    throw new Error('m16-initialize-policy-invalid');
}

async function main() {
  if (process.argv.length !== 2)
    throw new Error('m16-initialize-usage-invalid');
  if (process.geteuid?.() === 0) throw new Error('m16-initialize-root-refused');
  if (realpathSync(applicationRoot) !== applicationRoot)
    throw new Error('m16-initialize-application-unsafe');
  assertAbsent(databasePath);
  process.umask(0o077);

  const [{ loadProductionServerConfig }, { SqliteDatabase }] =
    await Promise.all([
      import(
        pathToFileURL(`${applicationRoot}/dist/config/production.js`).href
      ),
      import(
        pathToFileURL(
          `${applicationRoot}/dist/infrastructure/sqlite/database.js`,
        ).href
      ),
    ]);
  const config = loadProductionServerConfig(configReference, applicationRoot);
  assertInitializationConfig(config);
  const database = new SqliteDatabase(databasePath, {
    migration: { appliedAt: new Date().toISOString() },
  });
  try {
    const integrity = database.integrityCheck();
    if (!integrity.ok || integrity.foreignKeyViolations !== 0)
      throw new Error('m16-initialize-integrity-failed');
  } finally {
    database.close();
  }
  const state = lstatSync(databasePath);
  if (
    !state.isFile() ||
    state.isSymbolicLink() ||
    state.nlink !== 1 ||
    (state.mode & 0o777) !== 0o600 ||
    state.uid !== process.geteuid() ||
    realpathSync(databasePath) !== databasePath
  )
    throw new Error('m16-initialize-state-unsafe');
  process.stdout.write(
    `${JSON.stringify({ status: 'initialized-inert', schemaIntegrity: 'ok', providerRequests: 0, servicesStarted: 0 })}\n`,
  );
}

function assertAbsent(path) {
  try {
    lstatSync(path);
    throw new Error('m16-initialize-state-exists');
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === 'm16-initialize-state-exists'
    )
      throw error;
    if (error?.code !== 'ENOENT') throw error;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({ status: 'rejected', code: error instanceof Error ? error.message : 'm16-initialize-failed' })}\n`,
    );
    process.exitCode = 1;
  }
}
