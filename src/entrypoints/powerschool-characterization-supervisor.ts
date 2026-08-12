import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir, userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  isPowerSchoolCharacterizationEvidence,
  type PowerSchoolCharacterizationEvidence,
} from '../application/read-only/powerschool-characterization.js';
import { powerSchoolM07bCharacterizationPolicy as policy } from '../infrastructure/powerschool/characterization-policy.js';
import { runQuiescentChild } from '../infrastructure/process/quiescent-child.js';
import {
  powerSchoolCharacterizationProfileEnvironmentKey,
  powerSchoolCharacterizationSupervisorCapability,
} from './powerschool-characterization-child.js';

export type SupervisedCharacterizationResult =
  | {
      readonly status: 'completed';
      readonly evidence: PowerSchoolCharacterizationEvidence;
    }
  | {
      readonly status: 'failed';
      readonly code:
        | 'outside-window'
        | 'supervised-child-failed'
        | 'supervised-evidence-invalid';
    };

/**
 * The only nonzero M-07B execution boundary. Its child and arguments are fixed;
 * the caller can supply only the separately authorized managed-profile path.
 */
export async function runSupervisedPowerSchoolCharacterization(options: {
  readonly profilePath: string;
  readonly clock?: { now(): string };
}): Promise<SupervisedCharacterizationResult> {
  if (
    typeof options.profilePath !== 'string' ||
    options.profilePath.length < 1 ||
    options.profilePath.length > 4_096 ||
    /[\n\r\0]/u.test(options.profilePath)
  ) {
    throw new Error('powerschool-characterization-profile-reference-invalid');
  }
  const authorizedProfilePath = join(
    userInfo({ encoding: 'utf8' }).homedir,
    '.openclaw-workonly',
    'browser',
    'powerschool',
  );
  if (options.profilePath !== authorizedProfilePath) {
    throw new Error('powerschool-characterization-profile-reference-invalid');
  }
  const clock = options.clock ?? { now: () => new Date().toISOString() };
  const startedAt = clock.now();
  if (startedAt < policy.windowStartsAt || startedAt >= policy.windowEndsAt) {
    return { status: 'failed', code: 'outside-window' };
  }
  const remainingWindowMs =
    Date.parse(policy.windowEndsAt) - Date.parse(startedAt);
  const deadlineMs = Math.min(policy.totalTimeoutMs, remainingWindowMs);
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1) {
    return { status: 'failed', code: 'outside-window' };
  }

  const runtimeRoot = await mkdtemp(
    join(tmpdir(), 'classroom-hub-m07b-runtime-'),
  );
  const childFile = fileURLToPath(
    new URL('./powerschool-characterization-child.js', import.meta.url),
  );
  try {
    const child = await runQuiescentChild({
      executable: process.execPath,
      arguments: [childFile, powerSchoolCharacterizationSupervisorCapability],
      // Keep cwd at the repository root so managed-profile validation can
      // reject any repository-contained lookalike, not merely dist/ children.
      cwd: dirname(dirname(dirname(dirname(childFile)))),
      environment: {
        PATH: '/usr/bin:/bin',
        LANG: 'C.UTF-8',
        TZ: 'UTC',
        HOME: runtimeRoot,
        XDG_CONFIG_HOME: join(runtimeRoot, 'config'),
        XDG_CACHE_HOME: join(runtimeRoot, 'cache'),
        TMPDIR: runtimeRoot,
        [powerSchoolCharacterizationProfileEnvironmentKey]: options.profilePath,
      },
      deadlineMs,
      terminationGraceMs: 1_000,
    });
    if (child.status !== 'completed') {
      return { status: 'failed', code: 'supervised-child-failed' };
    }
    let evidence: unknown;
    try {
      evidence = JSON.parse(child.output);
    } catch {
      return { status: 'failed', code: 'supervised-evidence-invalid' };
    }
    if (
      !isPowerSchoolCharacterizationEvidence(evidence) ||
      evidence.startedAt < startedAt ||
      evidence.completedAt >= policy.windowEndsAt
    ) {
      return { status: 'failed', code: 'supervised-evidence-invalid' };
    }
    return { status: 'completed', evidence };
  } finally {
    await rm(runtimeRoot, { recursive: true, force: true });
  }
}
