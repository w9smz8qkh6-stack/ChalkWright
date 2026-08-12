export class BoundedOperationTimeoutError extends Error {
  constructor() {
    super('bounded-operation-timeout');
    this.name = 'BoundedOperationTimeoutError';
  }
}

/**
 * Bounds caller-visible settlement, signals cooperative cancellation, clears
 * timers, and retains rejection handlers on operations that settle late.
 */
export function withBoundedSettlement<Value>(
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<Value>,
  parentSignal?: AbortSignal,
): Promise<Value> {
  return new Promise<Value>((resolve, reject) => {
    const controller = new AbortController();
    let settled = false;
    const finish = (action: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      parentSignal?.removeEventListener('abort', onAbort);
      action();
    };
    const onAbort = (): void => {
      controller.abort();
      finish(() => reject(new BoundedOperationTimeoutError()));
    };
    const timer = setTimeout(onAbort, timeoutMs);
    parentSignal?.addEventListener('abort', onAbort, { once: true });
    if (parentSignal?.aborted === true) {
      onAbort();
      return;
    }

    Promise.resolve()
      .then(() => operation(controller.signal))
      .then(
        (value) => finish(() => resolve(value)),
        (error: unknown) => finish(() => reject(error)),
      );
  });
}

export function isBoundedOperationTimeout(
  error: unknown,
): error is BoundedOperationTimeoutError {
  return error instanceof BoundedOperationTimeoutError;
}
