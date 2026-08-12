import {
  characterizePowerSchoolProfilePreflight,
  type PowerSchoolCharacterizationResult,
} from '../application/read-only/powerschool-characterization.js';
import { powerSchoolM07bCharacterizationPolicy } from '../infrastructure/powerschool/characterization-policy.js';

/**
 * Source-less M-07B preflight entrypoint. It receives no profile or source
 * capability, so its bounded failure cannot leave provider activity running.
 */
export function runM07bPowerSchoolProfilePreflight(options: {
  readonly clock: import('../domain/determinism.js').Clock;
}): PowerSchoolCharacterizationResult {
  return characterizePowerSchoolProfilePreflight({
    policy: powerSchoolM07bCharacterizationPolicy,
    clock: options.clock,
  });
}

/**
 * Renders the current source-less preflight as the complete sanitized evidence
 * document. It accepts no arguments, destination, profile, or source capability;
 * the caller owns writing the returned bytes to the separately authorized
 * evidence directory.
 */
export function main(): string {
  const result = runM07bPowerSchoolProfilePreflight({
    clock: { now: () => new Date().toISOString() },
  });
  return `${JSON.stringify(result.evidence, undefined, 2)}\n`;
}
