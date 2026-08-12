import { createHash } from 'node:crypto';

import {
  isAttendanceLinks,
  isAttendanceSummary,
  isCanonicalPlan,
  isContentCard,
  isDiagnostics,
  isEffectivePlan,
  isIanaTimeZone,
  isIsoDate,
  isIsoInstant,
  isScheduleObservation,
  isScopedDisplayOverride,
  isVocabularyHistoryEntry,
} from '../../domain/runtime-validation.js';

export const continuityImportFormatVersion = 1 as const;

export const continuityImportCollections = [
  'configurationSnapshots',
  'mappings',
  'scheduleObservations',
  'canonicalPlans',
  'effectivePlans',
  'contentSnapshots',
  'vocabularySelections',
  'vocabularyHistory',
  'attendanceAggregates',
  'scopedOverrides',
  'carouselHolds',
  'calendarOwnershipCandidates',
  'jobRuns',
  'comparisonEvidence',
  'temporaryOperationalState',
] as const;

export type ContinuityImportCollection =
  (typeof continuityImportCollections)[number];

export type ContinuityImportRejectionCategory =
  'malformed-input' | 'unknown-field' | 'forbidden-field' | 'corrupt-record';

/** A rejection identifies only structural locations and stable codes, never input values. */
export interface ContinuityImportRejection {
  readonly category: ContinuityImportRejectionCategory;
  readonly code: string;
  readonly path: string;
}

export type ContinuityImportValue =
  | null
  | boolean
  | number
  | string
  | readonly ContinuityImportValue[]
  | { readonly [key: string]: ContinuityImportValue };

export interface ContinuityImportOperation {
  readonly collection: ContinuityImportCollection;
  readonly identity: string;
  readonly checksum: string;
  readonly record: Readonly<Record<string, ContinuityImportValue>>;
}

/** All operations are prevalidated and ordered for application in one transaction. */
export interface ContinuityImportBatch {
  readonly formatVersion: typeof continuityImportFormatVersion;
  readonly batchId: string;
  readonly operations: readonly ContinuityImportOperation[];
}

export type ContinuityImportResult =
  | {
      readonly status: 'accepted';
      readonly batch: ContinuityImportBatch;
      readonly rejections: readonly [];
    }
  | {
      readonly status: 'rejected';
      readonly rejections: readonly ContinuityImportRejection[];
    };

type ValueSchema =
  | {
      readonly kind: 'string';
      readonly format?: 'date' | 'instant' | 'timezone' | 'url';
      readonly allowed?: readonly string[];
      readonly allowEmpty?: boolean;
    }
  | {
      readonly kind: 'number';
      readonly integer?: boolean;
      readonly minimum?: number;
    }
  | { readonly kind: 'boolean' }
  | { readonly kind: 'array'; readonly items: ValueSchema }
  | { readonly kind: 'oneOf'; readonly options: readonly ValueSchema[] }
  | ObjectSchema;

interface ObjectSchema {
  readonly kind: 'object';
  readonly fields: Readonly<Record<string, ValueSchema>>;
  readonly required?: readonly string[];
}

interface CollectionSchema {
  readonly identityField: string;
  readonly record: ObjectSchema;
}

const string: ValueSchema = { kind: 'string' };
const text: ValueSchema = { kind: 'string', allowEmpty: true };
const verification: ValueSchema = {
  kind: 'string',
  allowed: ['verified', 'unverified', 'synthetic'],
};
const contract: ValueSchema = { kind: 'string', allowed: ['1.0.0'] };
const date: ValueSchema = { kind: 'string', format: 'date' };
const instant: ValueSchema = { kind: 'string', format: 'instant' };
const timezone: ValueSchema = { kind: 'string', format: 'timezone' };
const url: ValueSchema = { kind: 'string', format: 'url' };
const boolean: ValueSchema = { kind: 'boolean' };
const count: ValueSchema = { kind: 'number', integer: true, minimum: 0 };
const number: ValueSchema = { kind: 'number' };

function array(items: ValueSchema): ValueSchema {
  return { kind: 'array', items };
}

function oneOf(...options: readonly ValueSchema[]): ValueSchema {
  return { kind: 'oneOf', options };
}

function object(
  fields: Readonly<Record<string, ValueSchema>>,
  required: readonly string[] = [],
): ObjectSchema {
  return { kind: 'object', fields, required };
}

const diagnostic = object(
  {
    code: string,
    severity: { kind: 'string', allowed: ['info', 'warning', 'error'] },
    message: text,
  },
  ['code', 'severity', 'message'],
);
const diagnostics = array(diagnostic);

const provenance = object(
  {
    source: {
      kind: 'string',
      allowed: [
        'synthetic-fixture',
        'powerschool',
        'google-classroom',
        'local-configuration',
        'legacy-transition',
      ],
    },
    method: {
      kind: 'string',
      allowed: [
        'fixture',
        'session-http',
        'browser-read',
        'api-read',
        'local-import',
      ],
    },
    observedAt: instant,
    verification,
    sourceReference: string,
  },
  ['source', 'method', 'observedAt', 'verification', 'sourceReference'],
);
const freshness = object(
  {
    state: { kind: 'string', allowed: ['fresh', 'stale', 'unknown'] },
    observedAt: instant,
    expiresAt: instant,
    lastSuccessfulAt: instant,
  },
  ['state', 'observedAt'],
);
const schedulePeriod = object(
  {
    periodId: string,
    courseKey: string,
    blockLabel: text,
    roomKey: string,
    startsAt: instant,
    endsAt: instant,
  },
  ['periodId', 'courseKey', 'blockLabel', 'startsAt', 'endsAt'],
);

const meeting = object(
  {
    meetingId: string,
    courseKey: string,
    blockLabel: text,
    checkInOpensAt: instant,
    officialStartsAt: instant,
    checkInClosesAt: instant,
    contentStartsAt: instant,
    dismissalStartsAt: instant,
    officialEndsAt: instant,
  },
  [
    'meetingId',
    'courseKey',
    'blockLabel',
    'checkInOpensAt',
    'officialStartsAt',
    'checkInClosesAt',
    'contentStartsAt',
    'dismissalStartsAt',
    'officialEndsAt',
  ],
);

const contentCard = object(
  {
    type: {
      kind: 'string',
      allowed: [
        'announcement',
        'bellringer',
        'objective',
        'agenda',
        'assessment_prompt',
        'reminder',
        'card',
        'vocabulary',
        'generic',
      ],
    },
    title: text,
    lines: array(string),
    featured: text,
    details: array(string),
    accent: text,
    durationSeconds: count,
    dueDate: date,
  },
  ['type', 'title', 'lines'],
);

const vietnamese = object({
  term: text,
  definition: text,
  example: text,
});
const assignmentReference = object(
  {
    courseWorkId: string,
    title: text,
    timing: { kind: 'string', allowed: ['recent', 'upcoming'] },
    dueDate: date,
    updateTime: instant,
  },
  ['courseWorkId', 'title', 'timing', 'updateTime'],
);
const vocabularyContext = object(
  {
    assignmentRefs: array(assignmentReference),
    classroomCourseId: text,
    meetingDate: date,
    vocabularyPolicy: {
      kind: 'string',
      allowed: [
        'recorded_same_meeting',
        'unused_focused',
        'unused_best_available',
        'exhausted_best_available',
      ],
    },
    vocabularyReuse: {
      kind: 'string',
      allowed: ['recorded_same_meeting', 'new', 'repeat_after_exhaustion'],
    },
    candidateCount: count,
    usedCandidateCount: count,
    unusedCandidateCount: count,
  },
  [
    'assignmentRefs',
    'classroomCourseId',
    'meetingDate',
    'vocabularyPolicy',
    'vocabularyReuse',
    'candidateCount',
    'usedCandidateCount',
    'unusedCandidateCount',
  ],
);

const vocabularyHistoryEntry = object(
  {
    classId: string,
    meetingKey: string,
    date,
    term: string,
    definition: text,
    source: { kind: 'string', allowed: ['class', 'subject', 'codehs'] },
    pronunciation: text,
    partOfSpeech: text,
    example: text,
    vietnamese,
    accent: text,
    durationSeconds: count,
    selectionContext: vocabularyContext,
  },
  ['classId', 'meetingKey', 'date', 'term'],
);

const displayCard = object(
  {
    cardId: string,
    type: text,
    title: text,
    body: text,
    lines: array(string),
    accent: text,
    durationSeconds: count,
  },
  ['cardId', 'title'],
);
const classOverride = object(
  {
    targetId: string,
    cards: array(displayCard),
    cardsMode: { kind: 'string', allowed: ['append', 'replace'] },
    hideAssignments: boolean,
    dismissalMessage: text,
  },
  ['targetId'],
);

const errorEvidence = object(
  {
    category: {
      kind: 'string',
      allowed: [
        'invalid-input',
        'not-found',
        'stale-observation',
        'authentication-repair-required',
        'authorization-denied',
        'ownership-ambiguous',
        'conflict',
        'timeout',
        'unavailable',
        'unsafe-configuration',
        'internal',
      ],
    },
    code: string,
    message: text,
    retryable: boolean,
    diagnostics,
  },
  ['category', 'code', 'message', 'retryable', 'diagnostics'],
);
const comparisonDifference = object({ code: string, message: text }, [
  'code',
  'message',
]);

const collectionSchemas: Readonly<
  Record<ContinuityImportCollection, CollectionSchema>
> = {
  configurationSnapshots: {
    identityField: 'configurationId',
    record: object(
      {
        configurationId: string,
        scope: string,
        revision: string,
        activeFrom: instant,
        supersededAt: instant,
        values: object(
          {
            timeZone: timezone,
            academicYearId: string,
            schoolYearStart: date,
            schoolYearEnd: date,
            checkInLeadMinutes: count,
            dismissalLeadMinutes: count,
          },
          [
            'timeZone',
            'academicYearId',
            'schoolYearStart',
            'schoolYearEnd',
            'checkInLeadMinutes',
            'dismissalLeadMinutes',
          ],
        ),
      },
      ['configurationId', 'scope', 'revision', 'activeFrom', 'values'],
    ),
  },
  mappings: {
    identityField: 'mappingId',
    record: object(
      {
        mappingId: string,
        kind: string,
        sourceKey: string,
        targetKey: string,
        activeFrom: instant,
        supersededAt: instant,
      },
      ['mappingId', 'kind', 'sourceKey', 'targetKey', 'activeFrom'],
    ),
  },
  scheduleObservations: {
    identityField: 'observationId',
    record: object(
      {
        contractVersion: contract,
        observationId: string,
        observedForDate: date,
        kind: { kind: 'string', allowed: ['normal', 'special', 'no-classes'] },
        verification,
        periods: array(schedulePeriod),
        provenance,
        freshness,
        diagnostics,
      },
      [
        'contractVersion',
        'observationId',
        'observedForDate',
        'kind',
        'verification',
        'periods',
        'provenance',
        'freshness',
        'diagnostics',
      ],
    ),
  },
  canonicalPlans: {
    identityField: 'planId',
    record: object(
      {
        planId: string,
        contractVersion: contract,
        date,
        timeZone: timezone,
        roomId: string,
        sourceObservationIds: array(string),
        verification,
        meetings: array(meeting),
        diagnostics,
      },
      [
        'planId',
        'contractVersion',
        'date',
        'timeZone',
        'roomId',
        'sourceObservationIds',
        'verification',
        'meetings',
        'diagnostics',
      ],
    ),
  },
  effectivePlans: {
    identityField: 'effectivePlanId',
    record: object(
      {
        effectivePlanId: string,
        canonicalPlanId: string,
        contractVersion: contract,
        date,
        timeZone: timezone,
        roomId: string,
        screenId: string,
        verification,
        meetings: array(meeting),
        diagnostics,
      },
      [
        'effectivePlanId',
        'canonicalPlanId',
        'contractVersion',
        'date',
        'timeZone',
        'roomId',
        'screenId',
        'verification',
        'meetings',
        'diagnostics',
      ],
    ),
  },
  contentSnapshots: {
    identityField: 'snapshotId',
    record: object(
      {
        snapshotId: string,
        classId: string,
        screenId: string,
        roomId: string,
        date,
        refreshedAt: instant,
        items: array(contentCard),
        diagnostics,
      },
      ['snapshotId', 'classId', 'date', 'refreshedAt', 'items'],
    ),
  },
  vocabularySelections: {
    identityField: 'selectionId',
    record: object(
      {
        selectionId: string,
        classId: string,
        meetingKey: string,
        date,
        term: string,
        definition: string,
        source: { kind: 'string', allowed: ['class', 'subject', 'codehs'] },
        pronunciation: text,
        partOfSpeech: text,
        example: text,
        vietnamese,
        accent: text,
        durationSeconds: count,
        selectionContext: vocabularyContext,
      },
      [
        'selectionId',
        'classId',
        'meetingKey',
        'date',
        'term',
        'definition',
        'source',
      ],
    ),
  },
  vocabularyHistory: {
    identityField: 'historyId',
    record: object(
      {
        historyId: string,
        classId: string,
        entries: array(vocabularyHistoryEntry),
      },
      ['historyId', 'classId', 'entries'],
    ),
  },
  attendanceAggregates: {
    identityField: 'attendanceId',
    record: object(
      {
        attendanceId: string,
        classId: string,
        meetingId: string,
        date,
        refreshedAt: instant,
        links: object({
          directPrefilled: url,
          directResponder: url,
          wrapper: url,
          quick: url,
          teacherDisplay: url,
          classroom: url,
        }),
        summary: object({
          rosterCount: count,
          presentCount: count,
          tardyCount: count,
          absentCount: count,
          responseCount: count,
        }),
        provenance,
      },
      [
        'attendanceId',
        'classId',
        'meetingId',
        'date',
        'refreshedAt',
        'links',
        'summary',
      ],
    ),
  },
  scopedOverrides: {
    identityField: 'overrideId',
    record: object(
      {
        overrideId: string,
        screenId: string,
        date,
        announcement: oneOf(displayCard, text),
        simulator: object({ forcedState: text, forcedMeetingId: string }),
        classOverrides: array(classOverride),
      },
      ['overrideId', 'screenId', 'date', 'classOverrides'],
    ),
  },
  carouselHolds: {
    identityField: 'holdId',
    record: object(
      {
        holdId: string,
        planId: string,
        screenId: string,
        roomId: string,
        classId: string,
        meetingId: string,
        date,
        startsAt: instant,
        endsAt: instant,
        state: {
          kind: 'string',
          allowed: ['active', 'released', 'expired'],
        },
        reason: string,
      },
      [
        'holdId',
        'planId',
        'screenId',
        'meetingId',
        'date',
        'startsAt',
        'endsAt',
        'state',
      ],
    ),
  },
  calendarOwnershipCandidates: {
    identityField: 'candidateId',
    record: object(
      {
        candidateId: string,
        calendarId: string,
        eventId: string,
        planId: string,
        meetingId: string,
        ownershipMarker: string,
        fingerprint: string,
        status: {
          kind: 'string',
          allowed: ['candidate', 'rejected', 'superseded'],
        },
        observedAt: instant,
      },
      [
        'candidateId',
        'calendarId',
        'eventId',
        'ownershipMarker',
        'fingerprint',
        'status',
        'observedAt',
      ],
    ),
  },
  jobRuns: {
    identityField: 'runId',
    record: object(
      {
        runId: string,
        jobName: string,
        category: {
          kind: 'string',
          allowed: [
            'succeeded',
            'degraded',
            'skipped',
            'repair-required',
            'failed',
          ],
        },
        startedAt: instant,
        finishedAt: instant,
        attemptedExternalMutations: count,
        completedExternalMutations: count,
        reason: string,
        requestedDates: array(date),
        inputFingerprint: string,
        outputFingerprint: string,
        provenanceReferences: array(string),
        incidentCodes: array(string),
        latestStateReference: string,
        error: errorEvidence,
        errors: array(errorEvidence),
        diagnostics,
      },
      [
        'runId',
        'jobName',
        'category',
        'startedAt',
        'finishedAt',
        'attemptedExternalMutations',
        'completedExternalMutations',
        'requestedDates',
        'provenanceReferences',
        'incidentCodes',
      ],
    ),
  },
  comparisonEvidence: {
    identityField: 'comparisonId',
    record: object(
      {
        comparisonId: string,
        screenId: string,
        roomId: string,
        classId: string,
        date,
        evaluatedAt: instant,
        equivalent: boolean,
        differences: array(comparisonDifference),
        diagnostics,
      },
      [
        'comparisonId',
        'screenId',
        'date',
        'evaluatedAt',
        'equivalent',
        'differences',
      ],
    ),
  },
  temporaryOperationalState: {
    identityField: 'stateId',
    record: object(
      {
        stateId: string,
        scopeId: string,
        state: {
          kind: 'string',
          allowed: ['pending', 'ready', 'completed', 'failed'],
        },
        code: string,
        observedAt: instant,
        expiresAt: instant,
      },
      ['stateId', 'scopeId', 'state', 'code', 'observedAt', 'expiresAt'],
    ),
  },
};

const forbiddenFieldNames = new Set([
  'password',
  'passphrase',
  'secret',
  'clientsecret',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'oauthtoken',
  'oauthdata',
  'credential',
  'credentials',
  'cookie',
  'cookies',
  'browserprofile',
  'profilepath',
  'rawcapture',
  'rawprovidercapture',
  'studentid',
  'studentname',
  'studentemail',
  'studentrecord',
  'studentrecords',
  'rosterrows',
  'attendancerows',
  'log',
  'logs',
  'loglines',
  'filepath',
  'databasepath',
  'dbpath',
  'sourcepath',
  'backuppath',
  'privatekey',
]);

function normalizedFieldName(name: string): string {
  return name.replace(/[^a-z0-9]/giu, '').toLowerCase();
}

function isForbiddenFieldName(name: string): boolean {
  const normalized = normalizedFieldName(name);
  return (
    forbiddenFieldNames.has(normalized) ||
    normalized.startsWith('oauth') ||
    normalized.startsWith('student') ||
    normalized.startsWith('raw') ||
    normalized.includes('token') ||
    normalized.includes('password') ||
    normalized.includes('passphrase') ||
    normalized.includes('secret') ||
    normalized.includes('privatekey') ||
    normalized.includes('credential') ||
    normalized.includes('cookie') ||
    normalized.includes('browserprofile') ||
    normalized.includes('rawcapture') ||
    normalized.includes('rawprovidercapture') ||
    normalized.includes('studentrow') ||
    normalized.includes('studentrecord') ||
    normalized.includes('studentlevel') ||
    normalized.endsWith('payload') ||
    normalized.endsWith('path') ||
    normalized.endsWith('log') ||
    normalized.endsWith('logs')
  );
}

function safeFieldSegment(name: string): string {
  return /^[A-Za-z][A-Za-z0-9_-]{0,63}$/u.test(name) && !looksLikeSecret(name)
    ? name
    : '<redacted-field>';
}

function fieldPath(parent: string, name: string): string {
  return `${parent}.${safeFieldSegment(name)}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Take one detached snapshot using property descriptors so accessors are never
 * invoked and later validation, identity extraction, and cloning all observe
 * the same data properties.
 */
function cloneDataSnapshot(
  value: unknown,
  seen: WeakMap<object, unknown> = new WeakMap<object, unknown>(),
): unknown {
  if (value === null || typeof value !== 'object') return value;

  const previous = seen.get(value);
  if (previous !== undefined) return previous;

  const isArray = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (
    (!isArray && prototype !== Object.prototype && prototype !== null) ||
    (isArray && prototype !== Array.prototype)
  )
    throw new TypeError('continuity input must contain only data objects');

  const keys = Reflect.ownKeys(value);
  const descriptors = new Map<PropertyKey, PropertyDescriptor>();
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !('value' in descriptor))
      throw new TypeError('continuity input must not contain accessors');
    descriptors.set(key, descriptor);
  }

  if (isArray) {
    const lengthDescriptor = descriptors.get('length');
    if (
      lengthDescriptor === undefined ||
      typeof lengthDescriptor.value !== 'number' ||
      !Number.isSafeInteger(lengthDescriptor.value) ||
      lengthDescriptor.value < 0
    )
      throw new TypeError('continuity input array length is invalid');

    const items: Array<readonly [number, unknown]> = [];
    for (const [key, descriptor] of descriptors) {
      if (key === 'length') continue;
      if (
        typeof key !== 'string' ||
        !/^(?:0|[1-9][0-9]*)$/u.test(key) ||
        Number(key) >= lengthDescriptor.value ||
        descriptor.enumerable !== true
      )
        throw new TypeError('continuity arrays must contain only data items');
      items.push([Number(key), descriptor.value]);
    }
    if (items.length !== lengthDescriptor.value)
      throw new TypeError('continuity arrays must not be sparse');

    const snapshot: unknown[] = new Array(lengthDescriptor.value);
    seen.set(value, snapshot);
    for (const [index, item] of items)
      snapshot[index] = cloneDataSnapshot(item, seen);
    return snapshot;
  }

  const snapshot = Object.create(null) as Record<string, unknown>;
  seen.set(value, snapshot);
  for (const [key, descriptor] of descriptors) {
    if (typeof key !== 'string' || descriptor.enumerable !== true)
      throw new TypeError('continuity objects must contain only data fields');
    Object.defineProperty(snapshot, key, {
      value: cloneDataSnapshot(descriptor.value, seen),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return snapshot;
}

function looksLikePath(value: string): boolean {
  return /^(?:\/|file:\/\/|[A-Za-z]:[\\/])/u.test(value);
}

function looksLikeSecret(value: string): boolean {
  return (
    /^\s*Bearer\s+\S+/iu.test(value) ||
    /\b(?:authorization|cookie)\s*:\s*\S+/iu.test(value) ||
    /\b(?:access_token|refresh_token|client_secret|id_token)=/iu.test(value) ||
    /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/u.test(value) ||
    /\bsk-(?:proj-)?[A-Za-z0-9_-]{12,}/u.test(value) ||
    /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/u.test(value)
  );
}

function addRejection(
  rejections: ContinuityImportRejection[],
  category: ContinuityImportRejectionCategory,
  code: string,
  path: string,
): void {
  if (
    !rejections.some(
      (entry) =>
        entry.category === category &&
        entry.code === code &&
        entry.path === path,
    )
  )
    rejections.push({ category, code, path });
}

function inspectForbidden(
  value: unknown,
  path: string,
  rejections: ContinuityImportRejection[],
  seen: Set<object>,
): void {
  if (typeof value === 'string') {
    if (looksLikePath(value))
      addRejection(rejections, 'forbidden-field', 'arbitrary-path', path);
    if (looksLikeSecret(value))
      addRejection(rejections, 'forbidden-field', 'secret-material', path);
    return;
  }
  if (value === null || typeof value !== 'object') return;
  if (seen.has(value)) {
    addRejection(rejections, 'malformed-input', 'cyclic-value', path);
    return;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) {
        addRejection(
          rejections,
          'malformed-input',
          'sparse-array',
          `${path}[${index}]`,
        );
        continue;
      }
      inspectForbidden(value[index], `${path}[${index}]`, rejections, seen);
    }
  } else {
    for (const key of Object.keys(value).sort()) {
      const childPath = fieldPath(path, key);
      if (isForbiddenFieldName(key))
        addRejection(
          rejections,
          'forbidden-field',
          'forbidden-storage-surface',
          childPath,
        );
      inspectForbidden(
        (value as Record<string, unknown>)[key],
        childPath,
        rejections,
        seen,
      );
    }
  }
  seen.delete(value);
}

function validateStringFormat(value: string, schema: ValueSchema): boolean {
  if (schema.kind !== 'string') return false;
  if (schema.allowed !== undefined && !schema.allowed.includes(value))
    return false;
  if (schema.format === 'date') return isIsoDate(value);
  if (schema.format === 'instant') return isIsoInstant(value);
  if (schema.format === 'timezone') return isIanaTimeZone(value);
  if (schema.format === 'url') {
    try {
      const parsed = new URL(value);
      return (
        (parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
        parsed.username.length === 0 &&
        parsed.password.length === 0
      );
    } catch {
      return false;
    }
  }
  return schema.allowEmpty === true || value.trim().length > 0;
}

function compareInstants(left: unknown, right: unknown): number | undefined {
  if (
    typeof left !== 'string' ||
    typeof right !== 'string' ||
    !isIsoInstant(left) ||
    !isIsoInstant(right)
  )
    return undefined;
  return Date.parse(left) - Date.parse(right);
}

function validateValue(
  value: unknown,
  schema: ValueSchema,
  path: string,
  rejections: ContinuityImportRejection[],
): void {
  switch (schema.kind) {
    case 'string':
      if (typeof value !== 'string' || !validateStringFormat(value, schema))
        addRejection(rejections, 'corrupt-record', 'invalid-field-type', path);
      return;
    case 'number':
      if (
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        (schema.integer === true && !Number.isInteger(value)) ||
        (schema.minimum !== undefined && value < schema.minimum)
      )
        addRejection(rejections, 'corrupt-record', 'invalid-field-type', path);
      return;
    case 'boolean':
      if (typeof value !== 'boolean')
        addRejection(rejections, 'corrupt-record', 'invalid-field-type', path);
      return;
    case 'oneOf': {
      const accepted = schema.options.some((option) => {
        const optionRejections: ContinuityImportRejection[] = [];
        validateValue(value, option, path, optionRejections);
        return optionRejections.length === 0;
      });
      if (!accepted)
        addRejection(rejections, 'corrupt-record', 'invalid-field-type', path);
      return;
    }
    case 'array':
      if (!Array.isArray(value)) {
        addRejection(rejections, 'corrupt-record', 'invalid-field-type', path);
        return;
      }
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) {
          addRejection(
            rejections,
            'corrupt-record',
            'invalid-field-type',
            `${path}[${index}]`,
          );
          continue;
        }
        validateValue(
          value[index],
          schema.items,
          `${path}[${index}]`,
          rejections,
        );
      }
      return;
    case 'object':
      if (!isPlainObject(value)) {
        addRejection(rejections, 'corrupt-record', 'invalid-field-type', path);
        return;
      }
      for (const required of schema.required ?? []) {
        if (!Object.hasOwn(value, required))
          addRejection(
            rejections,
            'corrupt-record',
            'required-field-missing',
            fieldPath(path, required),
          );
      }
      for (const key of Object.keys(value).sort()) {
        const childPath = fieldPath(path, key);
        const childSchema = schema.fields[key];
        if (childSchema === undefined) {
          if (!isForbiddenFieldName(key))
            addRejection(
              rejections,
              'unknown-field',
              'field-not-allowlisted',
              childPath,
            );
          continue;
        }
        validateValue(value[key], childSchema, childPath, rejections);
      }
  }
}

function hasDeterministicallyOrderedMeetings(value: unknown): boolean {
  if (!isPlainObject(value) || !Array.isArray(value.meetings)) return false;
  for (let index = 1; index < value.meetings.length; index += 1) {
    const previous = value.meetings[index - 1];
    const current = value.meetings[index];
    if (!isPlainObject(previous) || !isPlainObject(current)) return false;
    if (
      typeof previous.officialStartsAt !== 'string' ||
      typeof current.officialStartsAt !== 'string' ||
      typeof previous.meetingId !== 'string' ||
      typeof current.meetingId !== 'string'
    )
      return false;
    const order = compareInstants(
      previous.officialStartsAt,
      current.officialStartsAt,
    );
    if (
      order === undefined ||
      order > 0 ||
      (order === 0 && previous.meetingId.localeCompare(current.meetingId) > 0)
    )
      return false;
  }
  return true;
}

function collectionSemanticsAreValid(
  collection: ContinuityImportCollection,
  value: Record<string, unknown>,
): boolean {
  switch (collection) {
    case 'configurationSnapshots': {
      const values = value.values;
      return (
        isPlainObject(values) &&
        typeof values.schoolYearStart === 'string' &&
        typeof values.schoolYearEnd === 'string' &&
        values.schoolYearStart <= values.schoolYearEnd &&
        (value.supersededAt === undefined ||
          (compareInstants(value.activeFrom, value.supersededAt) ?? 1) <= 0)
      );
    }
    case 'mappings':
      return (
        value.supersededAt === undefined ||
        (compareInstants(value.activeFrom, value.supersededAt) ?? 1) <= 0
      );
    case 'scheduleObservations':
      return isScheduleObservation(value);
    case 'canonicalPlans':
      return (
        isCanonicalPlan(value) && hasDeterministicallyOrderedMeetings(value)
      );
    case 'effectivePlans':
      return (
        isEffectivePlan(value) && hasDeterministicallyOrderedMeetings(value)
      );
    case 'contentSnapshots':
      return (
        Array.isArray(value.items) &&
        value.items.every((item) => isContentCard(item)) &&
        isDiagnostics(value.diagnostics)
      );
    case 'vocabularySelections': {
      const context = value.selectionContext;
      if (!isPlainObject(context) || !Array.isArray(context.assignmentRefs))
        return false;
      return (
        (value.durationSeconds === undefined ||
          (typeof value.durationSeconds === 'number' &&
            value.durationSeconds > 0)) &&
        context.meetingDate === value.date &&
        context.candidateCount ===
          Number(context.usedCandidateCount) +
            Number(context.unusedCandidateCount)
      );
    }
    case 'vocabularyHistory':
      return (
        Array.isArray(value.entries) &&
        value.entries.every(
          (entry) =>
            isVocabularyHistoryEntry(entry) && entry.classId === value.classId,
        )
      );
    case 'attendanceAggregates':
      return (
        isAttendanceLinks(value.links) && isAttendanceSummary(value.summary)
      );
    case 'scopedOverrides': {
      const overrides = value.classOverrides;
      if (!Array.isArray(overrides)) return false;
      const targets = new Set<string>();
      const classes: Record<string, unknown> = {};
      for (const entry of overrides) {
        if (!isPlainObject(entry) || typeof entry.targetId !== 'string')
          return false;
        if (targets.has(entry.targetId)) return false;
        targets.add(entry.targetId);
        const { targetId: _targetId, ...classOverride } = entry;
        classes[entry.targetId] = classOverride;
      }
      return isScopedDisplayOverride({
        screenId: value.screenId,
        date: value.date,
        ...(value.announcement === undefined
          ? {}
          : { announcement: value.announcement }),
        ...(value.simulator === undefined
          ? {}
          : { simulator: value.simulator }),
        classes,
      });
    }
    case 'carouselHolds':
      return (compareInstants(value.startsAt, value.endsAt) ?? 0) < 0;
    case 'calendarOwnershipCandidates':
      return true;
    case 'jobRuns':
      return (
        (compareInstants(value.startedAt, value.finishedAt) ?? 1) <= 0 &&
        typeof value.attemptedExternalMutations === 'number' &&
        typeof value.completedExternalMutations === 'number' &&
        value.completedExternalMutations <= value.attemptedExternalMutations &&
        (value.category !== 'repair-required' ||
          (value.attemptedExternalMutations === 0 &&
            value.completedExternalMutations === 0)) &&
        isDiagnostics(value.diagnostics)
      );
    case 'comparisonEvidence':
      return isDiagnostics(value.diagnostics);
    case 'temporaryOperationalState':
      return (
        value.expiresAt === undefined ||
        (compareInstants(value.observedAt, value.expiresAt) ?? 1) <= 0
      );
  }
}

function validateContinuityRecord(
  collection: ContinuityImportCollection,
  value: Record<string, unknown>,
  path: string,
  rejections: ContinuityImportRejection[],
): void {
  validateValue(value, collectionSchemas[collection].record, path, rejections);
  if (!collectionSemanticsAreValid(collection, value))
    addRejection(
      rejections,
      'corrupt-record',
      'contract-invariant-violated',
      path,
    );
}

/** Revalidates a stored row against the same recursive collection contract. */
export function isContinuityImportRecord(
  collection: ContinuityImportCollection,
  identity: string,
  value: unknown,
): value is Readonly<Record<string, ContinuityImportValue>> {
  try {
    const snapshot = cloneDataSnapshot(value);
    if (!isPlainObject(snapshot)) return false;
    const rejections: ContinuityImportRejection[] = [];
    inspectForbidden(snapshot, '$', rejections, new Set<object>());
    validateContinuityRecord(collection, snapshot, '$', rejections);
    return (
      rejections.length === 0 &&
      snapshot[collectionSchemas[collection].identityField] === identity
    );
  } catch {
    return false;
  }
}

function canonicalJson(value: ContinuityImportValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${canonicalJson(
          (value as Record<string, ContinuityImportValue>)[key] ?? null,
        )}`,
    )
    .join(',')}}`;
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function cloneRecord(
  value: Record<string, unknown>,
): Record<string, ContinuityImportValue> {
  return structuredClone(value) as Record<string, ContinuityImportValue>;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function planContinuityImportUnchecked(input: unknown): ContinuityImportResult {
  const rejections: ContinuityImportRejection[] = [];
  inspectForbidden(input, '$', rejections, new Set<object>());
  if (!isPlainObject(input)) {
    addRejection(rejections, 'malformed-input', 'document-not-object', '$');
    return { status: 'rejected', rejections };
  }

  const topLevelFields = new Set<string>([
    'formatVersion',
    ...continuityImportCollections,
  ]);
  for (const key of Object.keys(input).sort()) {
    if (!topLevelFields.has(key) && !isForbiddenFieldName(key))
      addRejection(
        rejections,
        'unknown-field',
        'top-level-field-not-allowlisted',
        fieldPath('$', key),
      );
  }
  if (input.formatVersion !== continuityImportFormatVersion)
    addRejection(
      rejections,
      'malformed-input',
      'unsupported-format-version',
      '$.formatVersion',
    );

  const candidates: Array<{
    collection: ContinuityImportCollection;
    identity: string;
    record: Record<string, ContinuityImportValue>;
    checksum: string;
    index: number;
  }> = [];

  for (const collection of continuityImportCollections) {
    const rawCollection = input[collection];
    if (rawCollection === undefined) continue;
    if (!Array.isArray(rawCollection)) {
      addRejection(
        rejections,
        'malformed-input',
        'collection-not-array',
        `$.${collection}`,
      );
      continue;
    }
    const schema = collectionSchemas[collection];
    for (let index = 0; index < rawCollection.length; index += 1) {
      if (!Object.hasOwn(rawCollection, index)) continue;
      const rawRecord = rawCollection[index];
      const path = `$.${collection}[${index}]`;
      if (!isPlainObject(rawRecord)) {
        addRejection(rejections, 'malformed-input', 'record-not-object', path);
        continue;
      }
      const before = rejections.length;
      validateContinuityRecord(collection, rawRecord, path, rejections);
      const identity = rawRecord[schema.identityField];
      if (rejections.length !== before || typeof identity !== 'string')
        continue;
      const record = cloneRecord(rawRecord);
      const serialized = canonicalJson(record);
      candidates.push({
        collection,
        identity,
        record,
        checksum: digest(serialized),
        index,
      });
    }
  }

  const unique = new Map<string, (typeof candidates)[number]>();
  for (const candidate of candidates) {
    const key = `${candidate.collection}\u0000${candidate.identity}`;
    const previous = unique.get(key);
    if (previous === undefined) {
      unique.set(key, candidate);
      continue;
    }
    if (previous.checksum !== candidate.checksum)
      addRejection(
        rejections,
        'corrupt-record',
        'conflicting-duplicate-identity',
        `$.${candidate.collection}[${candidate.index}]`,
      );
  }

  if (rejections.length > 0)
    return {
      status: 'rejected',
      rejections: rejections.sort(
        (left, right) =>
          left.path.localeCompare(right.path) ||
          left.category.localeCompare(right.category) ||
          left.code.localeCompare(right.code),
      ),
    };

  const operations = [...unique.values()]
    .sort(
      (left, right) =>
        continuityImportCollections.indexOf(left.collection) -
          continuityImportCollections.indexOf(right.collection) ||
        left.identity.localeCompare(right.identity) ||
        left.checksum.localeCompare(right.checksum),
    )
    .map<ContinuityImportOperation>((candidate) => ({
      collection: candidate.collection,
      identity: candidate.identity,
      checksum: candidate.checksum,
      record: deepFreeze(candidate.record),
    }));
  const batchPayload = canonicalJson(
    operations as unknown as ContinuityImportValue,
  );
  return {
    status: 'accepted',
    rejections: [],
    batch: deepFreeze({
      formatVersion: continuityImportFormatVersion,
      batchId: digest(batchPayload),
      operations,
    }),
  };
}

/**
 * Validate an in-memory continuity document and prepare deterministic operations.
 * This pure boundary deliberately has no path, database, clock, or provider access.
 */
export function planContinuityImport(input: unknown): ContinuityImportResult {
  try {
    return planContinuityImportUnchecked(cloneDataSnapshot(input));
  } catch {
    return {
      status: 'rejected',
      rejections: [
        {
          category: 'malformed-input',
          code: 'document-unreadable',
          path: '$',
        },
      ],
    };
  }
}
