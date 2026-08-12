import { contractVersion } from '../../contracts/v1/common.js';
import type { TypedJobResult } from '../../domain/job-results.js';
import type { OperationsConfig } from '../../config/operations.js';
import { buildMorningBrief } from '../../domain/operations/briefs.js';
import { buildOperationalReport } from '../../domain/operations/health.js';
import {
  applyManagedRetention,
  backupManagedDatabase,
  inspectManagedDatabase,
} from '../../infrastructure/operations/sqlite-maintenance.js';
import { FakeAlertTransport } from '../../infrastructure/operations/fake-alert-transport.js';
import type {
  AlertTransport,
  OperationsStateReader,
  OperationsStateWriter,
} from '../../ports/operations.js';
import { evaluateOperationalAlerts } from './alerts.js';
import type {
  OperationsJobHandler,
  OperationsJobHandlers,
  OperationsJobRequest,
} from './registry.js';

function succeeded(
  request: OperationsJobRequest,
  codes: readonly string[],
): TypedJobResult {
  return {
    contractVersion,
    runId: request.runId,
    jobName: request.jobName,
    startedAt: request.requestedAt,
    finishedAt: request.requestedAt,
    diagnostics: codes.map((code) => ({
      code,
      severity: 'info' as const,
      message: 'Local operational evidence was recorded.',
    })),
    category: 'succeeded',
    attemptedExternalMutations: 0,
    completedExternalMutations: 0,
    errors: [],
  };
}

function failed(request: OperationsJobRequest, code: string): TypedJobResult {
  return {
    contractVersion,
    runId: request.runId,
    jobName: request.jobName,
    startedAt: request.requestedAt,
    finishedAt: request.requestedAt,
    diagnostics: [],
    category: 'failed',
    attemptedExternalMutations: 0,
    completedExternalMutations: 0,
    error: {
      category: 'unavailable',
      code,
      message: 'The local operational job failed safely.',
      retryable: true,
      diagnostics: [],
    },
  };
}

function degraded(request: OperationsJobRequest, code: string): TypedJobResult {
  return {
    contractVersion,
    runId: request.runId,
    jobName: request.jobName,
    startedAt: request.requestedAt,
    finishedAt: request.requestedAt,
    diagnostics: [],
    category: 'degraded',
    attemptedExternalMutations: 0,
    completedExternalMutations: 0,
    errors: [
      {
        category: 'unavailable',
        code,
        message: 'The local operational job completed with a redacted issue.',
        retryable: true,
        diagnostics: [],
      },
    ],
  };
}

function skipped(request: OperationsJobRequest, code: string): TypedJobResult {
  return {
    contractVersion,
    runId: request.runId,
    jobName: request.jobName,
    startedAt: request.requestedAt,
    finishedAt: request.requestedAt,
    diagnostics: [],
    category: 'skipped',
    attemptedExternalMutations: 0,
    completedExternalMutations: 0,
    reason: 'prerequisite-unavailable',
    errors: [
      {
        category: 'unavailable',
        code,
        message: 'A later characterized prerequisite is unavailable.',
        retryable: false,
        diagnostics: [],
      },
    ],
  };
}

function localHandler(
  operation: (
    request: OperationsJobRequest,
  ) => Promise<readonly string[]> | readonly string[],
): OperationsJobHandler {
  return async (request, signal) => {
    if (signal.aborted) return failed(request, 'job-aborted');
    try {
      const codes = await operation(request);
      if (signal.aborted) return failed(request, 'job-aborted');
      return succeeded(request, codes);
    } catch {
      return failed(request, `${request.jobName}-failed`);
    }
  };
}

/** Creates only the M-06 handlers backed by local, bounded capabilities. */
export function createMaintenanceHandlers(
  config: OperationsConfig,
  state?: OperationsStateReader & OperationsStateWriter,
  fakeTransport: AlertTransport = new FakeAlertTransport(),
): OperationsJobHandlers {
  const reportFor = (request: OperationsJobRequest) =>
    buildOperationalReport({
      generatedAt: request.requestedAt,
      observations: [
        {
          check: 'catalog-coverage',
          observedAt: request.requestedAt,
          scope: { kind: 'global' },
          requiredCount: 1,
          availableCount: 1,
        },
        {
          check: 'source-sync',
          observedAt: request.requestedAt,
          scope: { kind: 'global' },
          state: 'unknown',
        },
        {
          check: 'assignment-freshness',
          observedAt: request.requestedAt,
          scope: {
            kind: 'screen',
            screenId: config.scopeId,
            targetDate: localDate(request.requestedAt, config.timeZone),
          },
          assignmentDate: localDate(request.requestedAt, config.timeZone),
          freshness: 'unknown',
        },
        {
          check: 'standalone-readiness',
          observedAt: request.requestedAt,
          scope: { kind: 'global' },
          ready: false,
        },
        {
          check: 'compatibility-route',
          observedAt: request.requestedAt,
          scope: { kind: 'screen', screenId: config.scopeId },
          available: false,
        },
        {
          check: 'display-discovery',
          observedAt: request.requestedAt,
          scope: { kind: 'screen', screenId: config.scopeId },
          expectedCount: 1,
          discoveredCount: 0,
        },
        {
          check: 'preview-diagnostics',
          observedAt: request.requestedAt,
          scope: { kind: 'screen', screenId: config.scopeId },
          warningCount: 0,
          errorCount: 0,
        },
      ],
    });
  return {
    'operations-report': localHandler((request) => {
      const report = reportFor(request);
      if (report === undefined) throw new Error('report-invalid');
      return [
        `operations-status-${report.status}`,
        `operations-issues-${report.issues.length}`,
      ];
    }),
    'alert-evaluate': async (request, signal) => {
      if (signal.aborted) return failed(request, 'job-aborted');
      if (state === undefined)
        return skipped(request, 'operations-state-unavailable');
      const report = reportFor(request);
      if (report === undefined)
        return failed(request, 'operations-report-invalid');
      const evaluated = await evaluateOperationalAlerts({
        report,
        evaluatedAt: request.requestedAt,
        repeatAfterSeconds: config.alertRepeatSeconds ?? 3600,
        deliveryMode: config.alertDeliveryMode,
        state,
        signal,
        ...(config.alertDeliveryMode === 'fake'
          ? { transport: fakeTransport }
          : {}),
      });
      if (evaluated === undefined)
        return failed(request, 'alert-evaluation-failed');
      if (evaluated.persistence === 'failed')
        return failed(request, 'alert-checkpoint-store-failed');
      if (evaluated.deliveryErrorCode !== undefined)
        return degraded(request, evaluated.deliveryErrorCode);
      return succeeded(request, [
        `alert-decision-${evaluated.decision.kind}`,
        `alert-delivery-${evaluated.checkpoint.deliveryState}`,
      ]);
    },
    'brief-morning': localHandler((request) => {
      const report = reportFor(request);
      if (report === undefined) throw new Error('report-invalid');
      const brief = buildMorningBrief({
        timeZone: config.timeZone,
        generatedAt: request.requestedAt,
        targetDate: localDate(request.requestedAt, config.timeZone),
        status: report.status,
        counts: { screens: 1, meetings: 0, issues: report.issues.length },
        issueCodes: report.issues.map((issue) => issue.code),
      });
      if (brief === undefined) throw new Error('brief-invalid');
      return [`brief-${brief.kind}-${brief.status}`];
    }),
    'brief-evening': async (request) =>
      skipped(request, 'next-configured-class-day-unavailable'),
    'sqlite-integrity': localHandler(() => {
      const result = inspectManagedDatabase(config);
      if (!result.ok) throw new Error('integrity-failed');
      return ['sqlite-integrity-ok'];
    }),
    'sqlite-backup': localHandler(async (request) => {
      const result = await backupManagedDatabase(config, request.requestedAt);
      return [
        'sqlite-backup-verified',
        `backup-daily-${result.retainedDaily}`,
        `backup-weekly-${result.retainedWeekly}`,
      ];
    }),
    'state-retention': localHandler(async (request) => {
      await backupManagedDatabase(config, request.requestedAt);
      const result = applyManagedRetention(config, request.requestedAt);
      return [
        'state-retention-policy-validated',
        `expired-records-${result.expiredRecords}`,
        `policy-deleted-records-${result.policyDeletedRecords}`,
      ];
    }),
  };
}

function localDate(instant: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(instant));
  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}
