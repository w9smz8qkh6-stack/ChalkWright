export type CalendarReconciliationCommand =
  | { readonly mode: 'dry-run' }
  | {
      readonly mode: 'execute';
      readonly approvalFingerprint: string;
    };

/**
 * Finite command parser for the future reconciliation CLI. Dry-run is the
 * default; execute requires an explicit flag and exact approval fingerprint.
 */
export function parseCalendarReconciliationCommand(
  arguments_: readonly string[],
): CalendarReconciliationCommand | undefined {
  if (arguments_.length === 0) return { mode: 'dry-run' };
  if (arguments_.length === 1 && arguments_[0] === '--dry-run')
    return { mode: 'dry-run' };
  if (
    arguments_.length === 3 &&
    arguments_[0] === '--execute' &&
    arguments_[1] === '--approval-fingerprint' &&
    /^sha256:[a-f0-9]{64}$/u.test(arguments_[2] ?? '')
  )
    return {
      mode: 'execute',
      approvalFingerprint: arguments_[2]!,
    };
  return undefined;
}
