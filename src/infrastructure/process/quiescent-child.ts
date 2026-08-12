import { spawn } from 'node:child_process';

// Visible operator repair may use the separately bounded five-minute window.
const maximumDeadlineMs = 300_000;
const maximumGraceMs = 2_000;
const maximumOutputBytes = 64 * 1024;
const maximumInputBytes = 16 * 1024;

export type QuiescentChildResult =
  | { readonly status: 'completed'; readonly output: string }
  | {
      readonly status: 'failed';
      readonly code:
        | 'child-deadline-exceeded'
        | 'child-exit-failed'
        | 'child-output-invalid'
        | 'child-quiescence-unconfirmed'
        | 'child-start-failed'
        | 'child-interrupted';
    };

/**
 * Runs one fixed-purpose worker in its own process group. Completion is not
 * reported until the worker has exited and the complete process group no
 * longer exists. The caller must provide a fixed executable and argument list;
 * this capability is intentionally not exported through application ports.
 */
export async function runQuiescentChild(options: {
  readonly executable: string;
  readonly arguments: readonly string[];
  readonly cwd: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly deadlineMs: number;
  readonly terminationGraceMs: number;
  /** One bounded ephemeral packet. The runner overwrites it after delivery. */
  readonly input?: Buffer;
  readonly signal?: AbortSignal;
}): Promise<QuiescentChildResult> {
  if (
    options.executable.length === 0 ||
    options.arguments.length > 8 ||
    options.arguments.some((argument) => argument.length > 1_024) ||
    !Number.isSafeInteger(options.deadlineMs) ||
    options.deadlineMs < 1 ||
    options.deadlineMs > maximumDeadlineMs ||
    !Number.isSafeInteger(options.terminationGraceMs) ||
    options.terminationGraceMs < 1 ||
    options.terminationGraceMs > maximumGraceMs ||
    (options.input !== undefined &&
      (options.input.byteLength < 1 ||
        options.input.byteLength > maximumInputBytes))
  ) {
    options.input?.fill(0);
    throw new Error('quiescent-child-options-invalid');
  }
  if (options.signal?.aborted === true) {
    options.input?.fill(0);
    return { status: 'failed', code: 'child-interrupted' };
  }

  return await new Promise<QuiescentChildResult>((resolve) => {
    let settled = false;
    let deadlineExceeded = false;
    let interrupted = false;
    let outputInvalid = false;
    let output: string | undefined;
    let escalationTimer: NodeJS.Timeout | undefined;
    let deadlineTimer: NodeJS.Timeout | undefined;
    let child;
    try {
      child = spawn(options.executable, [...options.arguments], {
        cwd: options.cwd,
        env: { ...options.environment },
        detached: true,
        shell: false,
        stdio: [
          options.input === undefined ? 'ignore' : 'pipe',
          'ignore',
          'ignore',
          'ipc',
        ],
      });
    } catch {
      options.input?.fill(0);
      resolve({ status: 'failed', code: 'child-start-failed' });
      return;
    }
    const processGroup = child.pid;
    if (processGroup === undefined) {
      options.input?.fill(0);
      child.kill('SIGKILL');
      resolve({ status: 'failed', code: 'child-start-failed' });
      return;
    }

    if (options.input !== undefined) {
      const input = options.input;
      if (child.stdin === null) {
        input.fill(0);
        child.kill('SIGKILL');
        resolve({ status: 'failed', code: 'child-start-failed' });
        return;
      }
      child.stdin.once('error', () => {
        input.fill(0);
        outputInvalid = true;
        child.kill('SIGTERM');
      });
      child.stdin.end(input, () => input.fill(0));
    }

    const signalGroup = (signal: NodeJS.Signals): boolean => {
      try {
        process.kill(-processGroup, signal);
        return true;
      } catch (error: unknown) {
        return (
          error instanceof Error &&
          'code' in error &&
          (error as NodeJS.ErrnoException).code === 'ESRCH'
        );
      }
    };
    const groupExists = (): boolean => {
      try {
        process.kill(-processGroup, 0);
        return true;
      } catch (error: unknown) {
        return !(
          error instanceof Error &&
          'code' in error &&
          (error as NodeJS.ErrnoException).code === 'ESRCH'
        );
      }
    };
    const waitForGroupExit = async (maximumMs: number): Promise<boolean> => {
      const started = performance.now();
      while (groupExists() && performance.now() - started < maximumMs) {
        await new Promise<void>((done) => setTimeout(done, 10));
      }
      return !groupExists();
    };
    const forceQuiescence = async (): Promise<boolean> => {
      signalGroup('SIGTERM');
      if (await waitForGroupExit(options.terminationGraceMs)) return true;
      signalGroup('SIGKILL');
      return await waitForGroupExit(1_000);
    };
    const stopGroup = (): void => {
      signalGroup('SIGTERM');
      escalationTimer ??= setTimeout(
        () => signalGroup('SIGKILL'),
        options.terminationGraceMs,
      );
    };
    const onAbort = (): void => {
      interrupted = true;
      stopGroup();
    };
    const finish = async (
      code: number | null,
      startFailed = false,
    ): Promise<void> => {
      if (settled) return;
      settled = true;
      options.input?.fill(0);
      if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
      if (escalationTimer !== undefined) clearTimeout(escalationTimer);
      options.signal?.removeEventListener('abort', onAbort);
      const quiescent = await forceQuiescence();
      if (!quiescent) {
        resolve({ status: 'failed', code: 'child-quiescence-unconfirmed' });
      } else if (startFailed) {
        resolve({ status: 'failed', code: 'child-start-failed' });
      } else if (interrupted) {
        resolve({ status: 'failed', code: 'child-interrupted' });
      } else if (deadlineExceeded) {
        resolve({ status: 'failed', code: 'child-deadline-exceeded' });
      } else if (outputInvalid || output === undefined) {
        resolve({ status: 'failed', code: 'child-output-invalid' });
      } else if (code !== 0) {
        resolve({ status: 'failed', code: 'child-exit-failed' });
      } else {
        resolve({ status: 'completed', output });
      }
    };

    child.on('message', (message: unknown) => {
      if (
        output !== undefined ||
        typeof message !== 'string' ||
        Buffer.byteLength(message, 'utf8') > maximumOutputBytes
      ) {
        outputInvalid = true;
        signalGroup('SIGTERM');
        return;
      }
      output = message;
    });
    child.once('error', () => void finish(null, true));
    // `close` follows IPC teardown, so the single sanitized message has either
    // been accepted or the worker fails closed as missing output.
    child.once('close', (code) => void finish(code));
    options.signal?.addEventListener('abort', onAbort, { once: true });
    if (options.signal?.aborted === true) onAbort();
    deadlineTimer = setTimeout(() => {
      deadlineExceeded = true;
      stopGroup();
    }, options.deadlineMs);
  });
}
