import { isDirectEntrypoint } from './direct-invocation.js';
import { qualifyTelegramAlertDelivery } from '../infrastructure/operations/telegram-alert-transport.js';
import type { AlertTransportResult } from '../ports/operations.js';

const fixedReference =
  '/etc/classroom-hub/providers/alert-delivery/alert-delivery.json';
const referenceName = 'CLASSROOM_HUB_ALERT_DELIVERY_REFERENCE';
const forbiddenAuthorityPattern =
  /(?:PASSWORD|SECRET|TOKEN|CREDENTIAL|GOOGLE|POWERSCHOOL|CALENDAR|CLASSROOM|ONEPASSWORD|OP_)/iu;

export interface M16AlertQualificationOutput {
  readonly exitCode: number;
  readonly status: 'delivered' | 'failed' | 'rejected';
  readonly code?: string;
  readonly messagesAttempted: 0 | 1;
  readonly messagesDelivered: 0 | 1;
  readonly serviceChanges: 0;
  readonly routeChanges: 0;
  readonly applicationStateWrites: 0;
}

export async function runM16AlertLiveQualification(options: {
  readonly arguments: readonly string[];
  readonly environment: NodeJS.ProcessEnv;
  readonly signal?: AbortSignal;
  readonly qualify?: () => Promise<AlertTransportResult>;
}): Promise<M16AlertQualificationOutput> {
  if (options.arguments.length !== 1 || options.arguments[0] !== '--execute')
    return rejected('m16-alert-qualification-usage-invalid');
  if (!validEnvironment(options.environment))
    return rejected('m16-alert-qualification-environment-invalid');
  if (options.signal?.aborted === true)
    return rejected('m16-alert-qualification-aborted');

  let result: AlertTransportResult;
  try {
    result = await (options.qualify === undefined
      ? qualifyTelegramAlertDelivery({
          environment: {
            [referenceName]: fixedReference,
          },
          ...(options.signal === undefined ? {} : { signal: options.signal }),
        })
      : options.qualify());
  } catch {
    return failed('alert-transport-unavailable');
  }
  return result.status === 'delivered'
    ? {
        exitCode: 0,
        status: 'delivered',
        messagesAttempted: 1,
        messagesDelivered: 1,
        serviceChanges: 0,
        routeChanges: 0,
        applicationStateWrites: 0,
      }
    : failed(result.code);
}

function validEnvironment(environment: NodeJS.ProcessEnv): boolean {
  if (environment[referenceName] !== fixedReference) return false;
  for (const [name, value] of Object.entries(environment)) {
    if (
      name !== referenceName &&
      value !== undefined &&
      value.length > 0 &&
      (name.startsWith('CLASSROOM_HUB_') ||
        forbiddenAuthorityPattern.test(name))
    )
      return false;
  }
  return true;
}

function rejected(code: string): M16AlertQualificationOutput {
  return {
    exitCode: 64,
    status: 'rejected',
    code,
    messagesAttempted: 0,
    messagesDelivered: 0,
    serviceChanges: 0,
    routeChanges: 0,
    applicationStateWrites: 0,
  };
}

function failed(code: string): M16AlertQualificationOutput {
  return {
    exitCode: 1,
    status: 'failed',
    code: /^[a-z][a-z0-9-]{0,63}$/u.test(code)
      ? code
      : 'alert-transport-unavailable',
    messagesAttempted: 1,
    messagesDelivered: 0,
    serviceChanges: 0,
    routeChanges: 0,
    applicationStateWrites: 0,
  };
}

async function main(): Promise<void> {
  const controller = new AbortController();
  const abort = (): void => controller.abort('process-signal');
  process.once('SIGINT', abort);
  process.once('SIGTERM', abort);
  const output = await runM16AlertLiveQualification({
    arguments: process.argv.slice(2),
    environment: process.env,
    signal: controller.signal,
  });
  process.removeListener('SIGINT', abort);
  process.removeListener('SIGTERM', abort);
  process.stdout.write(`${JSON.stringify(output)}\n`);
  process.exitCode = output.exitCode;
}

if (isDirectEntrypoint(import.meta.url, process.argv[1])) {
  void main();
}
