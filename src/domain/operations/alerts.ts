import {
  hasExactKeys,
  isEnumValue,
  isIsoInstant,
  isJsonSafeValue,
  isNonNegativeInteger,
  isPlainObject,
} from '../runtime-validation.js';
import type { OperationalIssue } from './health.js';
import { isOperationalIssue } from './health.js';

export interface AlertState {
  readonly activeFingerprints: readonly string[];
  readonly notifiedFingerprints: readonly string[];
  readonly lastNotifiedAt?: string;
}

export type AlertDecisionKind =
  'new' | 'unchanged' | 'repeat' | 'recovery' | 'mixed' | 'no-send';

export interface AlertDecision {
  readonly kind: AlertDecisionKind;
  readonly shouldSend: boolean;
  readonly evaluatedAt: string;
  readonly activeFingerprints: readonly string[];
  readonly addedFingerprints: readonly string[];
  readonly recoveredFingerprints: readonly string[];
  readonly nextState: AlertState;
}

const fingerprintPattern = /^fnv1a64:[0-9a-f]{16}$/u;

function isFingerprintArray(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    isJsonSafeValue(value) &&
    value.every(
      (entry, index) =>
        typeof entry === 'string' &&
        fingerprintPattern.test(entry) &&
        (index === 0 || value[index - 1]! < entry),
    )
  );
}

export function isAlertState(value: unknown): value is AlertState {
  try {
    return (
      isJsonSafeValue(value) &&
      isPlainObject(value) &&
      hasExactKeys(
        value,
        ['activeFingerprints', 'notifiedFingerprints'],
        ['lastNotifiedAt'],
      ) &&
      isFingerprintArray(value.activeFingerprints) &&
      isFingerprintArray(value.notifiedFingerprints) &&
      (value.lastNotifiedAt === undefined || isIsoInstant(value.lastNotifiedAt))
    );
  } catch {
    return false;
  }
}

export const emptyAlertState: AlertState = {
  activeFingerprints: [],
  notifiedFingerprints: [],
};

function difference(
  left: readonly string[],
  right: readonly string[],
): readonly string[] {
  const excluded = new Set(right);
  return left.filter((entry) => !excluded.has(entry));
}

export function decideAlert(input: {
  readonly issues: unknown;
  readonly previousState: unknown;
  readonly evaluatedAt: unknown;
  readonly repeatAfterSeconds: unknown;
  readonly deliveryMode: unknown;
}): AlertDecision | undefined {
  try {
    if (
      !isJsonSafeValue(input) ||
      !isPlainObject(input) ||
      !hasExactKeys(input, [
        'issues',
        'previousState',
        'evaluatedAt',
        'repeatAfterSeconds',
        'deliveryMode',
      ]) ||
      !Array.isArray(input.issues) ||
      !input.issues.every(isOperationalIssue) ||
      !isAlertState(input.previousState) ||
      !isIsoInstant(input.evaluatedAt) ||
      (input.previousState.lastNotifiedAt !== undefined &&
        Date.parse(input.evaluatedAt) <
          Date.parse(input.previousState.lastNotifiedAt)) ||
      !isNonNegativeInteger(input.repeatAfterSeconds) ||
      !isEnumValue(input.deliveryMode, ['send', 'no-send'] as const)
    )
      return undefined;
    const activeFingerprints = [
      ...new Set(
        (input.issues as readonly OperationalIssue[]).map(
          (entry) => entry.fingerprint,
        ),
      ),
    ].sort();
    const addedFingerprints = difference(
      activeFingerprints,
      input.previousState.notifiedFingerprints,
    );
    const recoveredFingerprints = difference(
      input.previousState.notifiedFingerprints,
      activeFingerprints,
    );
    let kind: AlertDecisionKind;
    let shouldSend = false;
    if (input.deliveryMode === 'no-send') {
      kind = 'no-send';
    } else if (
      addedFingerprints.length > 0 &&
      recoveredFingerprints.length > 0
    ) {
      kind = 'mixed';
      shouldSend = true;
    } else if (addedFingerprints.length > 0) {
      kind = 'new';
      shouldSend = true;
    } else if (recoveredFingerprints.length > 0) {
      kind = 'recovery';
      shouldSend = true;
    } else if (
      activeFingerprints.length > 0 &&
      input.previousState.lastNotifiedAt !== undefined &&
      Date.parse(input.evaluatedAt) -
        Date.parse(input.previousState.lastNotifiedAt) >=
        input.repeatAfterSeconds * 1_000
    ) {
      kind = 'repeat';
      shouldSend = true;
    } else {
      kind = 'unchanged';
    }
    const nextState: AlertState = shouldSend
      ? {
          activeFingerprints,
          notifiedFingerprints: activeFingerprints,
          lastNotifiedAt: input.evaluatedAt,
        }
      : {
          activeFingerprints,
          notifiedFingerprints: [...input.previousState.notifiedFingerprints],
          ...(input.previousState.lastNotifiedAt === undefined
            ? {}
            : { lastNotifiedAt: input.previousState.lastNotifiedAt }),
        };
    return {
      kind,
      shouldSend,
      evaluatedAt: input.evaluatedAt,
      activeFingerprints,
      addedFingerprints,
      recoveredFingerprints,
      nextState,
    };
  } catch {
    return undefined;
  }
}

export function isAlertDecision(value: unknown): value is AlertDecision {
  try {
    if (
      isJsonSafeValue(value) &&
      isPlainObject(value) &&
      hasExactKeys(value, [
        'kind',
        'shouldSend',
        'evaluatedAt',
        'activeFingerprints',
        'addedFingerprints',
        'recoveredFingerprints',
        'nextState',
      ]) &&
      isEnumValue(value.kind, [
        'new',
        'unchanged',
        'repeat',
        'recovery',
        'mixed',
        'no-send',
      ] as const) &&
      typeof value.shouldSend === 'boolean' &&
      value.shouldSend === !['unchanged', 'no-send'].includes(value.kind) &&
      isIsoInstant(value.evaluatedAt) &&
      isFingerprintArray(value.activeFingerprints) &&
      isFingerprintArray(value.addedFingerprints) &&
      isFingerprintArray(value.recoveredFingerprints) &&
      isAlertState(value.nextState)
    ) {
      if (
        value.activeFingerprints.join('\0') !==
        value.nextState.activeFingerprints.join('\0')
      )
        return false;
      const added = value.addedFingerprints.length;
      const recovered = value.recoveredFingerprints.length;
      const correctKind =
        value.kind === 'no-send' ||
        (value.kind === 'new' && added > 0 && recovered === 0) ||
        (value.kind === 'recovery' && added === 0 && recovered > 0) ||
        (value.kind === 'mixed' && added > 0 && recovered > 0) ||
        (value.kind === 'repeat' &&
          added === 0 &&
          recovered === 0 &&
          value.activeFingerprints.length > 0) ||
        (value.kind === 'unchanged' && added === 0 && recovered === 0);
      if (!correctKind) return false;
      if (value.shouldSend)
        return (
          value.nextState.notifiedFingerprints.join('\0') ===
            value.activeFingerprints.join('\0') &&
          value.nextState.lastNotifiedAt === value.evaluatedAt
        );
      return true;
    }
    return false;
  } catch {
    return false;
  }
}
