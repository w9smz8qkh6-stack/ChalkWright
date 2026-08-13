import { loadPowerSchoolRoutineConfig } from '../config/powerschool-session.js';
import {
  loadFilteredPowerSchoolState,
  writeFilteredPowerSchoolState,
} from '../infrastructure/powerschool-session/protected-state.js';
import { isDirectEntrypoint } from './direct-invocation.js';

const sourceEnvironment = 'CHALKWRIGHT_M17_POWERSCHOOL_SOURCE_DIRECTORY';

/** Copies only validated PowerSchool-origin filtered state into the isolated canary root. */
export function copyM17PowerSchoolState(
  environment: NodeJS.ProcessEnv = process.env,
) {
  const source = environment[sourceEnvironment];
  if (source === undefined) throw new Error('m17-session-source-required');
  const config = loadPowerSchoolRoutineConfig(environment);
  if (source === config.sessionDirectory)
    throw new Error('m17-session-paths-overlap');
  const state = loadFilteredPowerSchoolState(source, config.powerSchoolOrigin);
  writeFilteredPowerSchoolState(
    config.sessionDirectory,
    config.powerSchoolOrigin,
    state,
  );
  return {
    status: 'copied-filtered-state',
    cookies: state.cookies.length,
    origins: state.origins.length,
    profilesCopied: 0,
    googleOriginsCopied: 0,
    providerRequests: 0,
  } as const;
}

if (isDirectEntrypoint(import.meta.url, process.argv[1])) {
  try {
    if (process.argv.length !== 2)
      throw new Error('m17-session-copy-usage-invalid');
    process.stdout.write(`${JSON.stringify(copyM17PowerSchoolState())}\n`);
  } catch (error) {
    const code =
      error instanceof Error && /^[a-z0-9-]{3,96}$/u.test(error.message)
        ? error.message
        : 'm17-session-copy-failed';
    process.stderr.write(`${JSON.stringify({ status: 'rejected', code })}\n`);
    process.exitCode = 1;
  }
}
