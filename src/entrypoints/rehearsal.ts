import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runJobEntrypoint } from './job.js';
import { SqliteDatabase } from '../infrastructure/sqlite/database.js';

/** Repository-only synthetic rehearsal. All state is confined to one temp root. */
export async function runOfflineOperationsRehearsal(): Promise<{
  readonly jobs: number;
  readonly successful: number;
}> {
  const root = mkdtempSync(join(tmpdir(), 'classroom-hub-ops-rehearsal-'));
  const backupDirectory = join(root, 'backups');
  mkdirSync(backupDirectory, { mode: 0o700 });
  const environment: NodeJS.ProcessEnv = {
    CLASSROOM_HUB_INSTANCE_ID: 'synthetic-rehearsal',
    CLASSROOM_HUB_OPERATIONS_SCOPE_ID: 'screen-b407',
    CLASSROOM_HUB_TIME_ZONE: 'America/Chicago',
    CLASSROOM_HUB_MANAGED_ROOT: root,
    CLASSROOM_HUB_DATABASE_PATH: join(root, 'state.sqlite'),
    CLASSROOM_HUB_BACKUP_DIRECTORY: backupDirectory,
    CLASSROOM_HUB_ACADEMIC_YEAR_END: '2035-05-31',
    CLASSROOM_HUB_JOB_DEADLINE_SECONDS: '300',
    CLASSROOM_HUB_ALERT_DELIVERY_MODE: 'report-only',
  };
  const jobs = [
    'operations-report',
    'alert-evaluate',
    'brief-morning',
    'sqlite-integrity',
    'sqlite-backup',
    'state-retention',
  ] as const;
  try {
    const database = new SqliteDatabase(
      environment.CLASSROOM_HUB_DATABASE_PATH!,
      {
        migration: { appliedAt: '2035-04-13T07:00:00Z' },
      },
    );
    database.close();
    let successful = 0;
    for (const [index, jobName] of jobs.entries()) {
      const instant = new Date(
        Date.parse('2035-04-13T07:00:00Z') + index * 1_000,
      ).toISOString();
      const result = await runJobEntrypoint({
        arguments: [jobName],
        environment,
        now: () => instant,
        nextId: () => `synthetic-${jobName}`,
        hardStop: () => {
          throw new Error('synthetic-job-did-not-quiesce');
        },
      });
      if (result.result?.category === 'succeeded') successful += 1;
      else throw new Error(`offline-rehearsal-${jobName}-failed`);
    }
    return { jobs: jobs.length, successful };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

if (process.argv[1]?.endsWith('/entrypoints/rehearsal.js')) {
  void runOfflineOperationsRehearsal()
    .then((result) => {
      process.stdout.write(
        `Offline operations rehearsal passed ${result.successful}/${result.jobs} jobs.\n`,
      );
    })
    .catch(() => {
      process.stderr.write('Offline operations rehearsal failed safely.\n');
      process.exitCode = 1;
    });
}
