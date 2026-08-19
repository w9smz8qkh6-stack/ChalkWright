import { createHash } from 'node:crypto';

import { isIsoDate, isIsoInstant } from '../domain/runtime-validation.js';
import { readProtectedJson } from '../infrastructure/filesystem/protected-json.js';

const sha256Pattern = /^sha256:[a-f0-9]{64}$/u;
const releasePattern = /^[a-f0-9]{64}$/u;

export interface M17ActivationManifest {
  readonly version: 1;
  readonly kind: 'chalkwright-m17-activation-manifest';
  readonly releaseSha256: string;
  readonly calendarReferenceHash: string;
  readonly deniedCalendarReferenceHashes: readonly [string, string];
  readonly tailnetTarget: string;
  readonly legacyRouteFingerprint: string;
  readonly stopCommand: '/opt/chalkwright-canary/current/scripts/operations/stop-m17-canary.sh';
  readonly observationStartsAt: string;
  readonly observationEndsAt: string;
  readonly comparisonEvidenceFingerprint: string;
  readonly comparisonRecordKey: string;
  readonly comparisonDate: string;
  readonly screenId: string;
}

export function loadM17ActivationManifest(path: string): M17ActivationManifest {
  const value = readProtectedJson(path, isM17ActivationManifest);
  const duration =
    Date.parse(value.observationEndsAt) - Date.parse(value.observationStartsAt);
  if (duration < 60 * 60_000 || duration > 14 * 24 * 60 * 60_000)
    throw new Error('m17-activation-manifest-invalid');
  return value;
}

export function isM17ActivationManifest(
  value: unknown,
): value is M17ActivationManifest {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).sort().join(',') ===
      'calendarReferenceHash,comparisonDate,comparisonEvidenceFingerprint,comparisonRecordKey,deniedCalendarReferenceHashes,kind,legacyRouteFingerprint,observationEndsAt,observationStartsAt,releaseSha256,screenId,stopCommand,tailnetTarget,version' &&
    record.version === 1 &&
    record.kind === 'chalkwright-m17-activation-manifest' &&
    typeof record.releaseSha256 === 'string' &&
    releasePattern.test(record.releaseSha256) &&
    typeof record.calendarReferenceHash === 'string' &&
    sha256Pattern.test(record.calendarReferenceHash) &&
    Array.isArray(record.deniedCalendarReferenceHashes) &&
    record.deniedCalendarReferenceHashes.length === 2 &&
    record.deniedCalendarReferenceHashes.every(
      (entry) => typeof entry === 'string' && sha256Pattern.test(entry),
    ) &&
    typeof record.tailnetTarget === 'string' &&
    /^https:\/\/[a-z0-9](?:[a-z0-9-]{0,62}\.)+ts\.net(?::\d{1,5})?\/classroom-screen$/u.test(
      record.tailnetTarget,
    ) &&
    typeof record.legacyRouteFingerprint === 'string' &&
    sha256Pattern.test(record.legacyRouteFingerprint) &&
    record.stopCommand ===
      '/opt/chalkwright-canary/current/scripts/operations/stop-m17-canary.sh' &&
    typeof record.observationStartsAt === 'string' &&
    isIsoInstant(record.observationStartsAt) &&
    typeof record.observationEndsAt === 'string' &&
    isIsoInstant(record.observationEndsAt) &&
    Date.parse(record.observationEndsAt) >
      Date.parse(record.observationStartsAt) &&
    typeof record.comparisonEvidenceFingerprint === 'string' &&
    sha256Pattern.test(record.comparisonEvidenceFingerprint) &&
    typeof record.comparisonRecordKey === 'string' &&
    /^m17-preactivation-[a-f0-9]{24}$/u.test(record.comparisonRecordKey) &&
    typeof record.comparisonDate === 'string' &&
    isIsoDate(record.comparisonDate) &&
    typeof record.screenId === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/u.test(record.screenId)
  );
}

export function m17ActivationManifestFingerprint(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}
