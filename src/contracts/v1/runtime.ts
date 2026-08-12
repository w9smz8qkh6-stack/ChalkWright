export const routeFamilies = [
  'display',
  'displays',
  'day-plan',
  'target',
  'preview',
  'overrides',
  'qr',
  'media',
  'assets',
  'manifest',
  'health',
  'readiness',
] as const;

export type RouteFamily = (typeof routeFamilies)[number];

export const meetingTimelineOrder = [
  'checkInOpensAt',
  'officialStartsAt',
  'checkInClosesAt',
  'contentStartsAt',
  'dismissalStartsAt',
  'officialEndsAt',
] as const;

/** Initial TV polling values are parity contracts, not an implemented retry loop. */
export const displayPollingTiming = {
  requestTimeoutMs: 10_000,
  healthyIntervalMs: 30_000,
  initialRetryMs: 5_000,
  maximumRetryMs: 120_000,
  retryStrategy: 'exponential',
} as const;
