import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { stableSerialize } from '../../domain/pure-values.js';

const execFileAsync = promisify(execFile);

export const legacyCalendarWriterJobId =
  'c174a3b2-1e75-49c5-94da-1b45f2c2f649' as const;
export const legacyCalendarWriterJobName =
  'PowerSchool Bell Calendar Sync' as const;

export interface LegacyWriterExclusionEvidence {
  readonly version: 1;
  readonly kind: 'legacy-calendar-writer-exclusion';
  readonly jobId: typeof legacyCalendarWriterJobId;
  readonly enabled: false;
  readonly running: false;
  readonly schedule: {
    readonly kind: 'cron';
    readonly expression: '0 6 * * *';
    readonly timeZone: 'Asia/Ho_Chi_Minh';
  };
  readonly fingerprint: string;
}

export interface OpenClawJsonRunner {
  run(
    executable: string,
    arguments_: readonly string[],
    signal: AbortSignal,
  ): Promise<unknown>;
}

export function createOpenClawJsonRunner(): OpenClawJsonRunner {
  return {
    async run(executable, arguments_, signal) {
      try {
        const result = await execFileAsync(executable, [...arguments_], {
          encoding: 'utf8',
          maxBuffer: 256 * 1024,
          timeout: 15_000,
          signal,
          windowsHide: true,
        });
        return JSON.parse(result.stdout);
      } catch {
        throw new Error('legacy-writer-exclusion-unavailable');
      }
    },
  };
}

export async function verifyLegacyWriterExcluded(options: {
  readonly executablePath: string;
  readonly profile: 'workonly';
  readonly jobId: typeof legacyCalendarWriterJobId;
  readonly signal: AbortSignal;
  readonly runner?: OpenClawJsonRunner;
}): Promise<LegacyWriterExclusionEvidence> {
  if (
    options.executablePath !== '/opt/openclaw/bin/openclaw' ||
    options.profile !== 'workonly' ||
    options.jobId !== legacyCalendarWriterJobId ||
    !(options.signal instanceof AbortSignal)
  )
    throw new Error('legacy-writer-exclusion-invalid');
  const value = await (options.runner ?? createOpenClawJsonRunner()).run(
    options.executablePath,
    ['--profile', options.profile, 'cron', 'list', '--all', '--json'],
    options.signal,
  );
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('legacy-writer-exclusion-invalid');
  const jobs = (value as Record<string, unknown>).jobs;
  if (!Array.isArray(jobs)) throw new Error('legacy-writer-exclusion-invalid');
  const matches = jobs.filter(
    (job) =>
      typeof job === 'object' &&
      job !== null &&
      !Array.isArray(job) &&
      (job as Record<string, unknown>).id === options.jobId,
  );
  if (matches.length !== 1) throw new Error('legacy-writer-exclusion-invalid');
  const job = matches[0] as Record<string, unknown>;
  const schedule = job.schedule;
  const state = job.state;
  if (
    job.name !== legacyCalendarWriterJobName ||
    job.enabled !== false ||
    typeof schedule !== 'object' ||
    schedule === null ||
    Array.isArray(schedule) ||
    (schedule as Record<string, unknown>).kind !== 'cron' ||
    (schedule as Record<string, unknown>).expr !== '0 6 * * *' ||
    (schedule as Record<string, unknown>).tz !== 'Asia/Ho_Chi_Minh' ||
    typeof state !== 'object' ||
    state === null ||
    Array.isArray(state) ||
    ((state as Record<string, unknown>).runningAtMs !== undefined &&
      (state as Record<string, unknown>).runningAtMs !== null)
  )
    throw new Error('legacy-writer-exclusion-invalid');
  const base = {
    version: 1 as const,
    kind: 'legacy-calendar-writer-exclusion' as const,
    jobId: legacyCalendarWriterJobId,
    enabled: false as const,
    running: false as const,
    schedule: {
      kind: 'cron' as const,
      expression: '0 6 * * *' as const,
      timeZone: 'Asia/Ho_Chi_Minh' as const,
    },
  };
  return { ...base, fingerprint: digest(base) };
}

function digest(value: unknown): string {
  return `sha256:${createHash('sha256').update(stableSerialize(value)).digest('hex')}`;
}
