export const operationsJobNames = [
  'source-auth-preflight',
  'classroom-refresh',
  'calendar-reconcile',
  'operations-report',
  'alert-evaluate',
  'brief-morning',
  'brief-evening',
  'sqlite-backup',
  'sqlite-integrity',
  'state-retention',
] as const;

export type OperationsJobName = (typeof operationsJobNames)[number];

export function isOperationsJobName(
  value: unknown,
): value is OperationsJobName {
  return (
    typeof value === 'string' &&
    operationsJobNames.includes(value as OperationsJobName)
  );
}
