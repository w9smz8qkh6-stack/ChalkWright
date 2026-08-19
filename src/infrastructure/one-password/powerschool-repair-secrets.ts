import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';

import {
  lockedOnePasswordExecutable,
  type PowerSchoolRepairReferences,
} from '../../config/powerschool-repair.js';

const maximumSecretBytes = 4_096;
const secretReadTimeoutMs = 60_000;

export interface PowerSchoolRepairSecretBuffers {
  readonly username: Buffer;
  readonly password: Buffer;
  readonly totp: Buffer;
}

export type OnePasswordExecutor = (
  executable: string,
  arguments_: readonly string[],
  options: {
    readonly environment: Readonly<NodeJS.ProcessEnv>;
    readonly timeoutMs: number;
    readonly maximumBytes: number;
    readonly signal?: AbortSignal;
  },
) => Promise<Buffer>;

/** Resolves the three fixed references without ever returning a string value. */
export async function readPowerSchoolRepairSecrets(options: {
  readonly references: PowerSchoolRepairReferences;
  readonly environment?: NodeJS.ProcessEnv;
  readonly serviceAccountToken?: Buffer;
  readonly execute?: OnePasswordExecutor;
  readonly signal?: AbortSignal;
}): Promise<PowerSchoolRepairSecretBuffers> {
  const execute = options.execute ?? executeOnePasswordRead;
  const environment = sanitizedOnePasswordEnvironment(
    options.environment ?? process.env,
    options.serviceAccountToken,
  );
  const configurationDirectory =
    options.serviceAccountToken === undefined
      ? undefined
      : mkdtempSync('/tmp/chalkwright-onepassword-config-');
  const acquired: Buffer[] = [];
  try {
    for (const reference of [
      options.references.usernameReference,
      options.references.passwordReference,
      options.references.totpReference,
    ]) {
      if (options.signal?.aborted === true)
        throw new Error('powerschool-repair-secret-unavailable');
      const value = await execute(
        lockedOnePasswordExecutable,
        [
          ...(configurationDirectory === undefined
            ? []
            : ['--config', configurationDirectory, '--cache=false']),
          'read',
          reference,
          '--no-newline',
        ],
        {
          environment,
          timeoutMs: secretReadTimeoutMs,
          maximumBytes: maximumSecretBytes,
          ...(options.signal === undefined ? {} : { signal: options.signal }),
        },
      );
      assertBoundedSecret(value);
      acquired.push(value);
    }
    const username = acquired[0]!;
    const password = acquired[1]!;
    const totp = acquired[2]!;
    if (username.byteLength > 320 || !asciiDigits(totp, 6, 8)) {
      throw new Error('powerschool-repair-secret-invalid');
    }
    return { username, password, totp };
  } catch {
    for (const value of acquired) value.fill(0);
    throw new Error('powerschool-repair-secret-unavailable');
  } finally {
    if (configurationDirectory !== undefined) {
      try {
        rmSync(configurationDirectory, { recursive: true, force: false });
      } catch {
        for (const value of acquired) value.fill(0);
        throw new Error('powerschool-repair-secret-unavailable');
      }
    }
  }
}

export function destroyPowerSchoolRepairSecrets(
  secrets: PowerSchoolRepairSecretBuffers,
): void {
  secrets.username.fill(0);
  secrets.password.fill(0);
  secrets.totp.fill(0);
}

function executeOnePasswordRead(
  executable: string,
  arguments_: readonly string[],
  options: {
    readonly environment: Readonly<NodeJS.ProcessEnv>;
    readonly timeoutMs: number;
    readonly maximumBytes: number;
    readonly signal?: AbortSignal;
  },
): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    execFile(
      executable,
      [...arguments_],
      {
        shell: false,
        windowsHide: true,
        encoding: 'buffer',
        env: { ...options.environment },
        timeout: options.timeoutMs,
        maxBuffer: options.maximumBytes,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      },
      (error, stdout) => {
        if (error !== null || !Buffer.isBuffer(stdout)) {
          if (Buffer.isBuffer(stdout)) stdout.fill(0);
          reject(new Error('powerschool-repair-secret-unavailable'));
          return;
        }
        resolve(stdout);
      },
    );
  });
}

function sanitizedOnePasswordEnvironment(
  source: NodeJS.ProcessEnv,
  serviceAccountToken?: Buffer,
): NodeJS.ProcessEnv {
  const output: NodeJS.ProcessEnv = {};
  for (const name of [
    'DBUS_SESSION_BUS_ADDRESS',
    'DISPLAY',
    'HOME',
    'LANG',
    'OP_ACCOUNT',
    'SSH_AUTH_SOCK',
    'WAYLAND_DISPLAY',
    'XDG_CONFIG_HOME',
    'XDG_RUNTIME_DIR',
  ]) {
    const value = source[name];
    if (value !== undefined) output[name] = value;
  }
  if (serviceAccountToken !== undefined) {
    if (
      serviceAccountToken.byteLength < 32 ||
      serviceAccountToken.byteLength > 2_048 ||
      !serviceAccountToken.subarray(0, 4).equals(Buffer.from('ops_')) ||
      serviceAccountToken.some(
        (byte) =>
          !(
            (byte >= 48 && byte <= 57) ||
            (byte >= 65 && byte <= 90) ||
            (byte >= 97 && byte <= 122) ||
            byte === 45 ||
            byte === 46 ||
            byte === 95
          ),
      )
    )
      throw new Error('powerschool-repair-secret-unavailable');
    output.OP_SERVICE_ACCOUNT_TOKEN = serviceAccountToken.toString('ascii');
  }
  return output;
}

function assertBoundedSecret(value: Buffer): void {
  if (
    value.byteLength < 1 ||
    value.byteLength > maximumSecretBytes ||
    value.some((byte) => byte < 0x20 || byte === 0x7f)
  ) {
    throw new Error('powerschool-repair-secret-invalid');
  }
}

function asciiDigits(value: Buffer, minimum: number, maximum: number): boolean {
  return (
    value.byteLength >= minimum &&
    value.byteLength <= maximum &&
    value.every((byte) => byte >= 48 && byte <= 57)
  );
}
