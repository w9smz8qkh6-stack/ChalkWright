import type { PowerSchoolCharacterizationPolicy } from '../../application/read-only/powerschool-characterization.js';

/** Frozen M-07B characterization policy; changing any value requires review. */
export const powerSchoolM07bCharacterizationPolicy: PowerSchoolCharacterizationPolicy =
  Object.freeze({
    origin: 'https://tasv.powerschool.com',
    requestedDate: '2026-08-10',
    windowStartsAt: '2026-08-09T04:24:00.000Z',
    windowEndsAt: '2026-08-09T05:24:00.000Z',
    statusPath: '/teachers/home.html',
    bellPath: '/teachers/aet_schedulebell.html?target_date=08/10/2026',
    allowedMethods: Object.freeze(['GET', 'HEAD'] as const),
    maximumTopLevelRequests: 8,
    maximumConcurrency: 1,
    requestTimeoutMs: 10_000,
    totalTimeoutMs: 120_000,
    maximumResponseBytesPerRequest: 2 * 1024 * 1024,
    maximumEvidenceRetentionMs: 7 * 24 * 60 * 60 * 1_000,
    authenticationCooloffMs: 1_800_000,
    repairAllowed: false,
  });
