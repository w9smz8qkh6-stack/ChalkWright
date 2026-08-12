import type {
  ContractDiagnostic,
  IsoDate,
  IsoInstant,
  OpaqueId,
} from '../contracts/v1/common.js';

export function compactText(value: unknown): string {
  return String(value ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function slug(value: unknown): string {
  return compactText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function isIsoDate(value: unknown): boolean {
  const text = String(value ?? '');
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match === null) return false;
  const date = new Date(`${text}T00:00:00Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === text
  );
}

export function epoch(value: unknown): number | undefined {
  const parsed = Date.parse(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function addMinutes(
  instant: IsoInstant,
  minutes: number,
): IsoInstant | undefined {
  const parsed = epoch(instant);
  if (parsed === undefined || !Number.isFinite(minutes)) return undefined;
  return new Date(parsed + minutes * 60_000).toISOString();
}

export function addDateDays(date: IsoDate, days: number): IsoDate | undefined {
  if (!isIsoDate(date) || !Number.isInteger(days)) return undefined;
  const parsed = new Date(`${date}T12:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

export function stableId(
  prefix: string,
  ...parts: readonly unknown[]
): OpaqueId {
  const body = parts.map(slug).filter(Boolean).join('-');
  return body ? `${slug(prefix)}-${body}` : slug(prefix);
}

export function diagnostic(
  code: string,
  severity: ContractDiagnostic['severity'],
  message: string,
): ContractDiagnostic {
  return { code, severity, message };
}

function normalizeStable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeStable);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, normalizeStable(entry)]),
    );
  }
  return value;
}

export function stableSerialize(value: unknown): string {
  return JSON.stringify(normalizeStable(value));
}

/** Stable FNV-1a 64-bit digest; collision resistance is not a security claim. */
export function stableFingerprint(value: unknown): string {
  let hash = 0xcbf29ce484222325n;
  for (const character of stableSerialize(value)) {
    hash ^= BigInt(character.codePointAt(0) ?? 0);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `fnv1a64:${hash.toString(16).padStart(16, '0')}`;
}
