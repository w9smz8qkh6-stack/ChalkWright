import type { AppConfig } from '../config/environment.js';

export interface RunResult {
  readonly message: string;
}

/** Produce the startup result without performing external or persistent work. */
export function run(config: AppConfig): RunResult {
  return {
    message: `Chalkwright ready (${config.nodeEnv}, ${config.logLevel})`,
  };
}
