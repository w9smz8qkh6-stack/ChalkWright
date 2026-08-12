import {
  decideAlert,
  emptyAlertState,
  isAlertDecision,
  isAlertState,
  type AlertDecision,
  type AlertState,
} from '../../domain/operations/alerts.js';
import {
  isOperationalReport,
  type OperationalReport,
} from '../../domain/operations/health.js';
import {
  isIsoInstant,
  isPlainObject,
} from '../../domain/runtime-validation.js';
import type {
  AlertCheckpoint,
  AlertTransport,
  OperationsStateReader,
  OperationsStateWriter,
} from '../../ports/operations.js';

export interface AlertEvaluationResult {
  readonly decision: AlertDecision;
  readonly checkpoint: AlertCheckpoint;
  readonly persistence: 'stored' | 'unchanged' | 'failed';
  readonly deliveryErrorCode?: string;
}

const alertEvaluationQueues = new WeakMap<object, Promise<void>>();

/** Serializes calls that share the exact in-process state capability object. */
export async function evaluateOperationalAlerts(options: {
  readonly report: OperationalReport;
  readonly evaluatedAt: string;
  readonly repeatAfterSeconds: number;
  readonly deliveryMode: 'report-only' | 'fake';
  readonly state: OperationsStateReader & OperationsStateWriter;
  readonly transport?: AlertTransport;
  readonly signal?: AbortSignal;
}): Promise<AlertEvaluationResult | undefined> {
  try {
    const key = Reflect.get(options, 'state') as unknown;
    if ((typeof key !== 'object' && typeof key !== 'function') || key === null)
      return undefined;
    const previous = alertEvaluationQueues.get(key) ?? Promise.resolve();
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => gate);
    alertEvaluationQueues.set(key, tail);
    await previous;
    try {
      return await evaluateOperationalAlertsUnlocked(options);
    } finally {
      release();
      if (alertEvaluationQueues.get(key) === tail)
        alertEvaluationQueues.delete(key);
    }
  } catch {
    return undefined;
  }
}

async function evaluateOperationalAlertsUnlocked(options: {
  readonly report: OperationalReport;
  readonly evaluatedAt: string;
  readonly repeatAfterSeconds: number;
  readonly deliveryMode: 'report-only' | 'fake';
  readonly state: OperationsStateReader & OperationsStateWriter;
  readonly transport?: AlertTransport;
  readonly signal?: AbortSignal;
}): Promise<AlertEvaluationResult | undefined> {
  try {
    if (
      !isPlainObject(options) ||
      !isOperationalReport(options.report) ||
      !isIsoInstant(options.evaluatedAt) ||
      !Number.isSafeInteger(options.repeatAfterSeconds) ||
      options.repeatAfterSeconds < 60 ||
      options.repeatAfterSeconds > 604_800 ||
      (options.deliveryMode !== 'report-only' &&
        options.deliveryMode !== 'fake') ||
      (options.deliveryMode === 'fake' && options.transport === undefined) ||
      (options.deliveryMode === 'report-only' &&
        options.transport !== undefined) ||
      options.signal?.aborted === true
    )
      return undefined;
    const priorCheckpoint = await options.state.loadAlertCheckpoint();
    const priorState = checkpointState(priorCheckpoint);
    if (!isAlertState(priorState)) return undefined;
    const decision = decideAlert({
      issues: options.report.issues,
      previousState: priorState,
      evaluatedAt: options.evaluatedAt,
      repeatAfterSeconds: options.repeatAfterSeconds,
      deliveryMode: options.deliveryMode === 'fake' ? 'send' : 'no-send',
    });
    if (decision === undefined || !isAlertDecision(decision)) return undefined;

    let deliveryState: AlertCheckpoint['deliveryState'] = 'not-attempted';
    let deliveryErrorCode: string | undefined;
    let lastSuccessfulIssueFingerprints =
      priorCheckpoint?.lastSuccessfulIssueFingerprints ?? [];
    let lastSuccessfulDeliveryAt = priorCheckpoint?.lastSuccessfulDeliveryAt;
    if (decision.shouldSend) {
      try {
        const delivery = await options.transport!.deliver(
          decision,
          options.signal,
        );
        if (delivery.status === 'delivered') {
          deliveryState = 'delivered';
          lastSuccessfulIssueFingerprints = decision.activeFingerprints;
          lastSuccessfulDeliveryAt = options.evaluatedAt;
        } else {
          deliveryState = 'failed';
          deliveryErrorCode = boundedCode(delivery.code);
        }
      } catch {
        deliveryState = 'failed';
        deliveryErrorCode = 'alert-transport-failed';
      }
    }
    const checkpoint: AlertCheckpoint = {
      activeIssueFingerprints: decision.activeFingerprints,
      lastSuccessfulIssueFingerprints,
      lastDecision: decision.kind,
      decidedAt: options.evaluatedAt,
      ...(lastSuccessfulDeliveryAt === undefined
        ? {}
        : { lastSuccessfulDeliveryAt }),
      deliveryMode: options.deliveryMode,
      deliveryState,
    };
    const stored = await options.state.storeAlertCheckpoint(checkpoint);
    return {
      decision,
      checkpoint,
      persistence:
        stored.status === 'stored' || stored.status === 'unchanged'
          ? stored.status
          : 'failed',
      ...(deliveryErrorCode === undefined ? {} : { deliveryErrorCode }),
    };
  } catch {
    return undefined;
  }
}

function checkpointState(checkpoint: AlertCheckpoint | undefined): AlertState {
  if (checkpoint === undefined) return emptyAlertState;
  return {
    activeFingerprints: checkpoint.activeIssueFingerprints,
    notifiedFingerprints: checkpoint.lastSuccessfulIssueFingerprints,
    ...(checkpoint.lastSuccessfulDeliveryAt === undefined
      ? {}
      : { lastNotifiedAt: checkpoint.lastSuccessfulDeliveryAt }),
  };
}

function boundedCode(value: unknown): string {
  return typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/u.test(value)
    ? value
    : 'alert-transport-failed';
}
