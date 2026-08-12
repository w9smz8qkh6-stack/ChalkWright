export const nodeEnvironments = ['development', 'test', 'production'] as const;
export const logLevels = ['debug', 'info', 'warn', 'error'] as const;

export type NodeEnvironment = (typeof nodeEnvironments)[number];
export type LogLevel = (typeof logLevels)[number];

export interface AppConfig {
  readonly nodeEnv: NodeEnvironment;
  readonly logLevel: LogLevel;
  readonly host: '127.0.0.1' | '::1';
  readonly port: number;
  readonly operatorToken?: string;
}

function valueFrom<T extends string>(
  name: string,
  value: string | undefined,
  allowedValues: readonly T[],
  fallback: T,
): T {
  const resolved = value ?? fallback;

  if (!allowedValues.includes(resolved as T)) {
    throw new Error(
      `${name} must be one of: ${allowedValues.join(', ')}; received ${resolved}`,
    );
  }

  return resolved as T;
}

/** Validate supported, non-secret settings before application work begins. */
export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
): AppConfig {
  const host = valueFrom(
    'CLASSROOM_HUB_HOST',
    environment.CLASSROOM_HUB_HOST,
    ['127.0.0.1', '::1'] as const,
    '127.0.0.1',
  );
  const portText = environment.CLASSROOM_HUB_PORT ?? '4317';
  if (!/^\d{1,5}$/u.test(portText))
    throw new Error(
      'CLASSROOM_HUB_PORT must be an integer from 0 through 65535',
    );
  const port = Number(portText);
  if (port > 65_535)
    throw new Error(
      'CLASSROOM_HUB_PORT must be an integer from 0 through 65535',
    );
  const operatorToken = environment.CLASSROOM_HUB_OPERATOR_TOKEN;
  if (
    operatorToken !== undefined &&
    operatorToken.length > 0 &&
    (operatorToken.length < 16 || operatorToken.length > 256)
  )
    throw new Error(
      'CLASSROOM_HUB_OPERATOR_TOKEN must be empty or 16 through 256 characters',
    );
  return {
    nodeEnv: valueFrom(
      'NODE_ENV',
      environment.NODE_ENV,
      nodeEnvironments,
      'development',
    ),
    logLevel: valueFrom('LOG_LEVEL', environment.LOG_LEVEL, logLevels, 'info'),
    host,
    port,
    ...(operatorToken === undefined || operatorToken.length === 0
      ? {}
      : { operatorToken }),
  };
}
