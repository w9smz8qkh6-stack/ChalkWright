import { request as httpsRequest } from 'node:https';

import {
  loadTelegramAlertProtectedReferences,
  type TelegramAlertProtectedReferences,
} from '../../config/alert-delivery.js';
import {
  isAlertDecision,
  type AlertDecision,
} from '../../domain/operations/alerts.js';
import { readProtectedText } from '../filesystem/protected-json.js';
import type {
  AlertTransport,
  AlertTransportResult,
} from '../../ports/operations.js';

const telegramHost = 'api.telegram.org';
const requestTimeoutMs = 10_000;
const maximumResponseBytes = 16 * 1024;
const maximumDecisionFingerprints = 256;
const qualificationText = [
  'Classroom Hub alert delivery test',
  'No operational issue is being reported.',
].join('\n');

export interface TelegramHttpRequest {
  readonly hostname: typeof telegramHost;
  readonly method: 'POST';
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Buffer;
  readonly timeoutMs: number;
  readonly maximumResponseBytes: number;
}

export interface TelegramHttpResponse {
  readonly statusCode: number;
  readonly body: Buffer;
}

export type TelegramHttpExecutor = (
  request: TelegramHttpRequest,
  signal?: AbortSignal,
) => Promise<TelegramHttpResponse>;

/**
 * Fixed Telegram sendMessage adapter. It is intentionally not wired into any
 * service or job until protected references and live delivery are approved.
 */
class TelegramAlertTransport implements AlertTransport {
  constructor(
    private readonly references: TelegramAlertProtectedReferences,
    private readonly execute: TelegramHttpExecutor = executeTelegramRequest,
  ) {}

  async deliver(
    decision: AlertDecision,
    signal?: AbortSignal,
  ): Promise<AlertTransportResult> {
    if (signal?.aborted === true)
      return { status: 'failed', code: 'alert-delivery-aborted' };
    if (
      !isAlertDecision(decision) ||
      !decision.shouldSend ||
      decision.activeFingerprints.length > maximumDecisionFingerprints ||
      decision.addedFingerprints.length > maximumDecisionFingerprints ||
      decision.recoveredFingerprints.length > maximumDecisionFingerprints
    )
      return { status: 'failed', code: 'alert-decision-invalid' };

    return this.deliverText(renderAlertText(decision), signal);
  }

  /** Sends only the fixed non-operational M-16 qualification text. */
  async qualify(signal?: AbortSignal): Promise<AlertTransportResult> {
    if (signal?.aborted === true)
      return { status: 'failed', code: 'alert-delivery-aborted' };
    return this.deliverText(qualificationText, signal);
  }

  private async deliverText(
    text: string,
    signal?: AbortSignal,
  ): Promise<AlertTransportResult> {
    let token: string;
    let destination: string;
    try {
      token = readProtectedText(this.references.botTokenPath, {
        minimumBytes: 20,
        maximumBytes: 256,
      });
      destination = readProtectedText(this.references.destinationPath, {
        minimumBytes: 1,
        maximumBytes: 64,
      });
    } catch {
      return { status: 'failed', code: 'alert-authority-unavailable' };
    }
    if (!validBotToken(token) || !validDestination(destination))
      return { status: 'failed', code: 'alert-authority-invalid' };

    const body = Buffer.from(
      JSON.stringify({
        chat_id: destination,
        text,
        disable_notification: false,
        protect_content: true,
      }),
      'utf8',
    );
    const request: TelegramHttpRequest = {
      hostname: telegramHost,
      method: 'POST',
      path: `/bot${token}/sendMessage`,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': String(body.byteLength),
        Connection: 'close',
      },
      body,
      timeoutMs: requestTimeoutMs,
      maximumResponseBytes,
    };
    let response: TelegramHttpResponse | undefined;
    try {
      response = await this.execute(request, signal);
      return classifyResponse(response);
    } catch {
      return {
        status: 'failed',
        code: signalIsAborted(signal)
          ? 'alert-delivery-aborted'
          : 'alert-transport-unavailable',
      };
    } finally {
      body.fill(0);
      response?.body.fill(0);
    }
  }
}

export function createTelegramAlertTransport(
  options: {
    readonly environment?: NodeJS.ProcessEnv;
    readonly repositoryRoot?: string;
    readonly execute?: TelegramHttpExecutor;
  } = {},
): AlertTransport {
  const references = loadTelegramAlertProtectedReferences(
    options.environment,
    options.repositoryRoot,
  );
  return new TelegramAlertTransport(references, options.execute);
}

/** One-shot qualification surface; it is not part of the operational port. */
export function qualifyTelegramAlertDelivery(options: {
  readonly environment?: NodeJS.ProcessEnv;
  readonly repositoryRoot?: string;
  readonly execute?: TelegramHttpExecutor;
  readonly signal?: AbortSignal;
}): Promise<AlertTransportResult> {
  const references = loadTelegramAlertProtectedReferences(
    options.environment,
    options.repositoryRoot,
  );
  return new TelegramAlertTransport(references, options.execute).qualify(
    options.signal,
  );
}

export function renderTelegramQualificationText(): string {
  return qualificationText;
}

export function renderAlertText(decision: AlertDecision): string {
  if (!isAlertDecision(decision) || !decision.shouldSend)
    throw new Error('alert-decision-invalid');
  const label =
    decision.kind === 'recovery'
      ? 'recovery'
      : decision.kind === 'repeat'
        ? 'reminder'
        : decision.kind === 'mixed'
          ? 'update'
          : 'new issue';
  return [
    `Classroom Hub ${label}`,
    `Active issues: ${decision.activeFingerprints.length}`,
    `New issues: ${decision.addedFingerprints.length}`,
    `Recovered issues: ${decision.recoveredFingerprints.length}`,
    `Evaluated: ${decision.evaluatedAt}`,
  ].join('\n');
}

function classifyResponse(
  response: TelegramHttpResponse,
): AlertTransportResult {
  if (
    !Number.isSafeInteger(response.statusCode) ||
    response.statusCode < 100 ||
    response.statusCode > 599 ||
    !Buffer.isBuffer(response.body) ||
    response.body.byteLength > maximumResponseBytes
  )
    return { status: 'failed', code: 'alert-response-invalid' };
  if (response.statusCode === 401 || response.statusCode === 403)
    return { status: 'failed', code: 'alert-authority-rejected' };
  if (response.statusCode === 429)
    return { status: 'failed', code: 'alert-transport-rate-limited' };
  if (response.statusCode < 200 || response.statusCode >= 300)
    return {
      status: 'failed',
      code:
        response.statusCode >= 500
          ? 'alert-transport-unavailable'
          : 'alert-delivery-rejected',
    };
  try {
    const parsed: unknown = JSON.parse(response.body.toString('utf8'));
    return parsed !== null &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      (parsed as Record<string, unknown>).ok === true
      ? { status: 'delivered' }
      : { status: 'failed', code: 'alert-delivery-rejected' };
  } catch {
    return { status: 'failed', code: 'alert-response-invalid' };
  }
}

function validBotToken(value: string): boolean {
  return /^\d{5,20}:[A-Za-z0-9_-]{20,220}$/u.test(value);
}

function validDestination(value: string): boolean {
  return /^(?:-?\d{1,20}|@[A-Za-z0-9_]{5,32})$/u.test(value);
}

function signalIsAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function executeTelegramRequest(
  request: TelegramHttpRequest,
  signal?: AbortSignal,
): Promise<TelegramHttpResponse> {
  const timeoutSignal = AbortSignal.timeout(request.timeoutMs);
  const operationSignal =
    signal === undefined
      ? timeoutSignal
      : AbortSignal.any([signal, timeoutSignal]);
  return new Promise<TelegramHttpResponse>((resolve, reject) => {
    const client = httpsRequest(
      {
        hostname: request.hostname,
        port: 443,
        path: request.path,
        method: request.method,
        headers: { ...request.headers },
        agent: false,
        maxHeaderSize: 8 * 1024,
        signal: operationSignal,
      },
      (response) => {
        const chunks: Buffer[] = [];
        let bytes = 0;
        const declared = Number(response.headers['content-length']);
        if (
          response.headers['content-length'] !== undefined &&
          (!Number.isSafeInteger(declared) ||
            declared < 0 ||
            declared > request.maximumResponseBytes)
        ) {
          response.destroy(new Error('alert-response-too-large'));
          return;
        }
        response.on('data', (chunk: Buffer | string) => {
          const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          bytes += value.byteLength;
          if (bytes > request.maximumResponseBytes) {
            value.fill(0);
            for (const prior of chunks) prior.fill(0);
            chunks.length = 0;
            response.destroy(new Error('alert-response-too-large'));
            return;
          }
          chunks.push(value);
        });
        response.once('error', reject);
        response.once('end', () => {
          const body = Buffer.concat(chunks, bytes);
          for (const chunk of chunks) chunk.fill(0);
          resolve({ statusCode: response.statusCode ?? 0, body });
        });
      },
    );
    client.once('error', reject);
    client.end(request.body);
  });
}
