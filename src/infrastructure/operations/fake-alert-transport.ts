import {
  isAlertDecision,
  type AlertDecision,
} from '../../domain/operations/alerts.js';
import type {
  AlertTransport,
  AlertTransportResult,
} from '../../ports/operations.js';

/** Deterministic M-06 evidence transport; it performs no network or file I/O. */
export class FakeAlertTransport implements AlertTransport {
  readonly deliveries: AlertDecision[] = [];

  constructor(
    private readonly behavior: 'deliver' | 'fail' | 'throw' = 'deliver',
  ) {}

  async deliver(decision: AlertDecision): Promise<AlertTransportResult> {
    if (!isAlertDecision(decision))
      return { status: 'failed', code: 'alert-decision-invalid' };
    this.deliveries.push(structuredClone(decision));
    if (this.behavior === 'throw')
      throw new Error('synthetic alert transport failure');
    return this.behavior === 'fail'
      ? { status: 'failed', code: 'alert-transport-unavailable' }
      : { status: 'delivered' };
  }
}
