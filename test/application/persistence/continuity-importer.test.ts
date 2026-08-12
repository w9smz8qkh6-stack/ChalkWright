import assert from 'node:assert/strict';
import test from 'node:test';

import {
  continuityImportCollections,
  planContinuityImport,
} from '../../../src/application/persistence/continuity-importer.js';

function safeDocument() {
  return {
    formatVersion: 1,
    configurationSnapshots: [
      {
        configurationId: 'config-alpha',
        scope: 'application',
        revision: 'revision-1',
        activeFrom: '2035-08-01T00:00:00Z',
        values: {
          timeZone: 'America/Chicago',
          academicYearId: '2035-36',
          schoolYearStart: '2035-08-15',
          schoolYearEnd: '2036-05-30',
          checkInLeadMinutes: 5,
          dismissalLeadMinutes: 5,
        },
      },
    ],
    mappings: [
      {
        mappingId: 'mapping-alpha',
        kind: 'class-to-room',
        sourceKey: 'class-alpha',
        targetKey: 'room-alpha',
        activeFrom: '2035-08-01T00:00:00Z',
      },
    ],
    scheduleObservations: [
      {
        contractVersion: '1.0.0',
        observationId: 'observation-alpha',
        observedForDate: '2035-09-04',
        kind: 'normal',
        verification: 'synthetic',
        periods: [
          {
            periodId: 'period-alpha',
            courseKey: 'course-alpha',
            blockLabel: 'A',
            roomKey: 'room-alpha',
            startsAt: '2035-09-04T13:00:00Z',
            endsAt: '2035-09-04T14:00:00Z',
          },
        ],
        provenance: {
          source: 'synthetic-fixture',
          method: 'fixture',
          observedAt: '2035-09-04T12:00:00Z',
          verification: 'synthetic',
          sourceReference: 'fixture-schedule-alpha',
        },
        freshness: {
          state: 'fresh',
          observedAt: '2035-09-04T12:00:00Z',
          expiresAt: '2035-09-04T12:15:00Z',
          lastSuccessfulAt: '2035-09-04T12:00:00Z',
        },
        diagnostics: [],
      },
    ],
    canonicalPlans: [
      {
        planId: 'plan-alpha',
        contractVersion: '1.0.0',
        date: '2035-09-04',
        timeZone: 'America/Chicago',
        roomId: 'room-alpha',
        sourceObservationIds: ['observation-alpha'],
        verification: 'synthetic',
        meetings: [meeting()],
        diagnostics: [],
      },
    ],
    effectivePlans: [
      {
        effectivePlanId: 'effective-alpha',
        canonicalPlanId: 'plan-alpha',
        contractVersion: '1.0.0',
        date: '2035-09-04',
        timeZone: 'America/Chicago',
        roomId: 'room-alpha',
        screenId: 'screen-alpha',
        verification: 'synthetic',
        meetings: [meeting()],
        diagnostics: [],
      },
    ],
    contentSnapshots: [
      {
        snapshotId: 'content-alpha',
        classId: 'class-alpha',
        screenId: 'screen-alpha',
        roomId: 'room-alpha',
        date: '2035-09-04',
        refreshedAt: '2035-09-04T12:00:00Z',
        items: [
          {
            type: 'bellringer',
            title: 'Synthetic warmup',
            lines: ['Review yesterday’s synthetic example.'],
            durationSeconds: 12,
          },
        ],
        diagnostics: [],
      },
    ],
    vocabularySelections: [
      {
        selectionId: 'vocabulary-alpha',
        classId: 'class-alpha',
        meetingKey: 'meeting-alpha',
        date: '2035-09-04',
        term: 'iteration',
        definition: 'A repeated process.',
        source: 'subject',
        selectionContext: {
          assignmentRefs: [],
          classroomCourseId: 'course-alpha',
          meetingDate: '2035-09-04',
          vocabularyPolicy: 'unused_focused',
          vocabularyReuse: 'new',
          candidateCount: 3,
          usedCandidateCount: 1,
          unusedCandidateCount: 2,
        },
      },
    ],
    vocabularyHistory: [
      {
        historyId: 'history-alpha',
        classId: 'class-alpha',
        entries: [
          {
            classId: 'class-alpha',
            meetingKey: 'meeting-alpha',
            date: '2035-09-04',
            term: 'iteration',
          },
        ],
      },
    ],
    attendanceAggregates: [
      {
        attendanceId: 'attendance-alpha',
        classId: 'class-alpha',
        meetingId: 'meeting-alpha',
        date: '2035-09-04',
        refreshedAt: '2035-09-04T12:00:00Z',
        links: { quick: 'https://fixture.example.invalid/check-in/alpha' },
        summary: {
          rosterCount: 24,
          presentCount: 21,
          tardyCount: 1,
          absentCount: 2,
          responseCount: 22,
        },
      },
    ],
    scopedOverrides: [
      {
        overrideId: 'override-alpha',
        screenId: 'screen-alpha',
        date: '2035-09-04',
        announcement: {
          cardId: 'announcement-alpha',
          type: 'announcement',
          title: 'Synthetic notice',
        },
        classOverrides: [
          {
            targetId: 'class-alpha',
            cardsMode: 'append',
            hideAssignments: false,
          },
        ],
      },
    ],
    carouselHolds: [
      {
        holdId: 'hold-alpha',
        planId: 'plan-alpha',
        screenId: 'screen-alpha',
        roomId: 'room-alpha',
        classId: 'class-alpha',
        meetingId: 'meeting-alpha',
        date: '2035-09-04',
        startsAt: '2035-09-04T13:00:00Z',
        endsAt: '2035-09-04T13:05:00Z',
        state: 'active',
        reason: 'synthetic-review',
      },
    ],
    calendarOwnershipCandidates: [
      {
        candidateId: 'calendar-alpha',
        calendarId: 'calendar-fixture',
        eventId: 'event-fixture',
        planId: 'plan-alpha',
        meetingId: 'meeting-alpha',
        ownershipMarker: 'classroom-hub:v1',
        fingerprint: 'synthetic-fingerprint',
        status: 'candidate',
        observedAt: '2035-09-04T12:00:00Z',
      },
    ],
    jobRuns: [
      {
        runId: 'run-alpha',
        jobName: 'synthetic-job',
        category: 'succeeded',
        startedAt: '2035-09-04T12:00:00Z',
        finishedAt: '2035-09-04T12:00:01Z',
        attemptedExternalMutations: 0,
        completedExternalMutations: 0,
        requestedDates: ['2035-09-04'],
        inputFingerprint: 'input-synthetic',
        outputFingerprint: 'output-synthetic',
        provenanceReferences: ['observation-alpha'],
        incidentCodes: [],
        latestStateReference: 'state-alpha',
        errors: [],
        diagnostics: [],
      },
    ],
    comparisonEvidence: [
      {
        comparisonId: 'comparison-alpha',
        screenId: 'screen-alpha',
        roomId: 'room-alpha',
        classId: 'class-alpha',
        date: '2035-09-04',
        evaluatedAt: '2035-09-04T12:00:00Z',
        equivalent: true,
        differences: [],
        diagnostics: [],
      },
    ],
    temporaryOperationalState: [
      {
        stateId: 'temporary-alpha',
        scopeId: 'screen-alpha',
        state: 'ready',
        code: 'synthetic-ready',
        observedAt: '2035-09-04T12:00:00Z',
        expiresAt: '2035-10-04T12:00:00Z',
      },
    ],
  };
}

function meeting() {
  return {
    meetingId: 'meeting-alpha',
    courseKey: 'course-alpha',
    blockLabel: 'A',
    checkInOpensAt: '2035-09-04T12:55:00Z',
    officialStartsAt: '2035-09-04T13:00:00Z',
    checkInClosesAt: '2035-09-04T13:00:00Z',
    contentStartsAt: '2035-09-04T13:00:00Z',
    dismissalStartsAt: '2035-09-04T13:55:00Z',
    officialEndsAt: '2035-09-04T14:00:00Z',
  };
}

test('accepts every safe continuity collection as one deterministic batch', () => {
  const document = safeDocument();
  const first = planContinuityImport(document);
  const second = planContinuityImport(structuredClone(document));

  assert.equal(first.status, 'accepted');
  assert.deepEqual(second, first);
  if (first.status !== 'accepted') return;
  assert.deepEqual(
    first.batch.operations.map((operation) => operation.collection),
    continuityImportCollections,
  );
  assert.match(first.batch.batchId, /^[a-f0-9]{64}$/u);
  assert.ok(
    first.batch.operations.every((item) => Object.isFrozen(item.record)),
  );
});

test('rejects impossible dates, non-normalized instants, and invalid timezones', () => {
  const cases: readonly {
    readonly label: string;
    readonly mutate: (document: ReturnType<typeof safeDocument>) => void;
  }[] = [
    {
      label: 'February overflow',
      mutate: (document) => {
        document.canonicalPlans[0]!.date = '2035-02-30';
      },
    },
    {
      label: 'invalid month and day',
      mutate: (document) => {
        document.scheduleObservations[0]!.observedForDate = '2035-99-99';
      },
    },
    {
      label: 'impossible instant',
      mutate: (document) => {
        document.mappings[0]!.activeFrom = '2035-02-30T08:00:00Z';
      },
    },
    {
      label: 'non-normalized instant',
      mutate: (document) => {
        document.jobRuns[0]!.startedAt = '2035-09-04T12:00:00+00:00';
      },
    },
    {
      label: 'invalid timezone',
      mutate: (document) => {
        document.configurationSnapshots[0]!.values.timeZone =
          'Invalid/Synthetic_Zone';
      },
    },
  ];

  for (const scenario of cases) {
    const document = safeDocument();
    scenario.mutate(document);
    assert.equal(
      planContinuityImport(document).status,
      'rejected',
      scenario.label,
    );
  }
});

test('requires every frozen configuration value field', () => {
  const mandatoryFields = [
    'timeZone',
    'academicYearId',
    'schoolYearStart',
    'schoolYearEnd',
    'checkInLeadMinutes',
    'dismissalLeadMinutes',
  ] as const;

  for (const field of mandatoryFields) {
    const document = safeDocument();
    Reflect.deleteProperty(document.configurationSnapshots[0]!.values, field);
    const result = planContinuityImport(document);

    assert.equal(result.status, 'rejected', field);
    if (result.status !== 'rejected') continue;
    assert.ok(
      result.rejections.some(
        (item) =>
          item.code === 'required-field-missing' &&
          item.path === `$.configurationSnapshots[0].values.${field}`,
      ),
      field,
    );
  }
});

test('compares valid instants by epoch rather than lexical spelling', () => {
  const cases: readonly {
    readonly label: string;
    readonly mutate: (document: ReturnType<typeof safeDocument>) => void;
  }[] = [
    {
      label: 'configuration lifecycle',
      mutate: (document) => {
        document.configurationSnapshots[0]!.activeFrom =
          '2035-08-01T00:00:00.500Z';
        Object.defineProperty(
          document.configurationSnapshots[0]!,
          'supersededAt',
          {
            value: '2035-08-01T00:00:00Z',
            enumerable: true,
          },
        );
      },
    },
    {
      label: 'mapping lifecycle',
      mutate: (document) => {
        document.mappings[0]!.activeFrom = '2035-08-01T00:00:00.500Z';
        Object.defineProperty(document.mappings[0]!, 'supersededAt', {
          value: '2035-08-01T00:00:00Z',
          enumerable: true,
        });
      },
    },
    {
      label: 'carousel hold',
      mutate: (document) => {
        document.carouselHolds[0]!.startsAt = '2035-09-04T12:00:00.500Z';
        document.carouselHolds[0]!.endsAt = '2035-09-04T12:00:00Z';
      },
    },
    {
      label: 'job run',
      mutate: (document) => {
        document.jobRuns[0]!.startedAt = '2035-09-04T12:00:00.500Z';
        document.jobRuns[0]!.finishedAt = '2035-09-04T12:00:00Z';
      },
    },
    {
      label: 'temporary state expiry',
      mutate: (document) => {
        document.temporaryOperationalState[0]!.observedAt =
          '2035-09-04T12:00:00.500Z';
        document.temporaryOperationalState[0]!.expiresAt =
          '2035-09-04T12:00:00Z';
      },
    },
  ];

  for (const scenario of cases) {
    const document = safeDocument();
    scenario.mutate(document);
    assert.equal(
      planContinuityImport(document).status,
      'rejected',
      scenario.label,
    );
  }
});

test('rejects contract enum drift and malformed nested domain records', () => {
  const cases: readonly {
    readonly label: string;
    readonly mutate: (document: ReturnType<typeof safeDocument>) => void;
  }[] = [
    {
      label: 'schedule kind',
      mutate: (document) => {
        document.scheduleObservations[0]!.kind = 'ordinary';
      },
    },
    {
      label: 'verification state',
      mutate: (document) => {
        document.canonicalPlans[0]!.verification = 'trusted';
      },
    },
    {
      label: 'diagnostic severity',
      mutate: (document) => {
        (
          document.effectivePlans[0] as unknown as {
            diagnostics: Array<{
              code: string;
              severity: string;
              message: string;
            }>;
          }
        ).diagnostics = [
          { code: 'synthetic', severity: 'fatal', message: 'Synthetic.' },
        ];
      },
    },
    {
      label: 'content card requires lines',
      mutate: (document) => {
        delete (
          document.contentSnapshots[0]!.items[0] as Partial<
            (typeof document.contentSnapshots)[number]['items'][number]
          >
        ).lines;
      },
    },
    {
      label: 'vocabulary source',
      mutate: (document) => {
        document.vocabularySelections[0]!.source = 'provider';
      },
    },
    {
      label: 'vocabulary policy',
      mutate: (document) => {
        document.vocabularySelections[0]!.selectionContext.vocabularyPolicy =
          'random';
      },
    },
    {
      label: 'hold requires plan identity',
      mutate: (document) => {
        delete (
          document.carouselHolds[0] as Partial<
            (typeof document.carouselHolds)[number]
          >
        ).planId;
      },
    },
    {
      label: 'job category',
      mutate: (document) => {
        document.jobRuns[0]!.category = 'complete';
      },
    },
  ];

  for (const scenario of cases) {
    const document = safeDocument();
    scenario.mutate(document);
    assert.equal(
      planContinuityImport(document).status,
      'rejected',
      scenario.label,
    );
  }
});

test('rejects meeting boundary violations and non-deterministic plan ordering', () => {
  const reversed = safeDocument();
  reversed.canonicalPlans[0]!.meetings[0]!.checkInClosesAt =
    '2035-09-04T13:01:00Z';
  assert.equal(planContinuityImport(reversed).status, 'rejected');

  const unordered = safeDocument();
  unordered.effectivePlans[0]!.meetings = [
    {
      ...meeting(),
      meetingId: 'meeting-later',
      checkInOpensAt: '2035-09-04T13:55:00Z',
      officialStartsAt: '2035-09-04T14:00:00Z',
      checkInClosesAt: '2035-09-04T14:00:00Z',
      contentStartsAt: '2035-09-04T14:00:00Z',
      dismissalStartsAt: '2035-09-04T14:55:00Z',
      officialEndsAt: '2035-09-04T15:00:00Z',
    },
    meeting(),
  ];
  assert.equal(planContinuityImport(unordered).status, 'rejected');

  const sparse = safeDocument();
  sparse.canonicalPlans[0]!.sourceObservationIds = Array<string>(1);
  assert.equal(planContinuityImport(sparse).status, 'rejected');
});

test('sorts by collection and identity and collapses identical repeats', () => {
  const document = safeDocument();
  document.mappings = [
    { ...document.mappings[0]!, mappingId: 'mapping-zulu' },
    { ...document.mappings[0]!, mappingId: 'mapping-alpha' },
    { ...document.mappings[0]!, mappingId: 'mapping-alpha' },
  ];
  const result = planContinuityImport(document);

  assert.equal(result.status, 'accepted');
  if (result.status !== 'accepted') return;
  assert.deepEqual(
    result.batch.operations
      .filter((operation) => operation.collection === 'mappings')
      .map((operation) => operation.identity),
    ['mapping-alpha', 'mapping-zulu'],
  );
});

test('rejects top-level, record, and nested fields outside explicit allowlists', () => {
  const document = safeDocument() as Record<string, unknown>;
  document.extraCollection = [];
  const content = (
    document.contentSnapshots as Array<Record<string, unknown>>
  )[0]!;
  content.unreviewed = true;
  const items = content.items as Array<Record<string, unknown>>;
  items[0]!.html = '<div>not allowlisted</div>';

  const result = planContinuityImport(document);

  assert.equal(result.status, 'rejected');
  if (result.status !== 'rejected') return;
  assert.deepEqual(
    result.rejections
      .filter((rejection) => rejection.category === 'unknown-field')
      .map((rejection) => rejection.path),
    [
      '$.contentSnapshots[0].items[0].html',
      '$.contentSnapshots[0].unreviewed',
      '$.extraCollection',
    ],
  );
});

test('rejects forbidden storage surfaces recursively and never reports values', () => {
  const forbiddenValues = [
    'synthetic-oauth-value',
    'synthetic-student-value',
    'synthetic-profile-value',
    'synthetic-raw-capture',
    'synthetic-log-value',
    '/private/synthetic/database.sqlite',
    'Bearer synthetic-private-material',
  ];
  const document = safeDocument() as Record<string, unknown>;
  const mappings = document.mappings as Array<Record<string, unknown>>;
  mappings[0]!.oauthToken = forbiddenValues[0];
  mappings[0]!.studentRecords = [{ studentName: forbiddenValues[1] }];
  mappings[0]!.studentData = [];
  mappings[0]!.browserProfile = forbiddenValues[2];
  mappings[0]!.rawProviderCapture = forbiddenValues[3];
  mappings[0]!.providerPayload = {};
  mappings[0]!.logs = [forbiddenValues[4]];
  mappings[0]!.outputPath = forbiddenValues[5];
  mappings[0]!.sourceKey = forbiddenValues[5];
  mappings[0]!.targetKey = forbiddenValues[6];

  const result = planContinuityImport(document);

  assert.equal(result.status, 'rejected');
  if (result.status !== 'rejected') return;
  const report = JSON.stringify(result.rejections);
  for (const forbidden of forbiddenValues)
    assert.equal(report.includes(forbidden), false);
  assert.ok(
    result.rejections.some((item) => item.code === 'forbidden-storage-surface'),
  );
  assert.ok(result.rejections.some((item) => item.code === 'arbitrary-path'));
  assert.ok(result.rejections.some((item) => item.code === 'secret-material'));
});

test('rejects malformed and corrupt records with redacted structural reports', () => {
  const malformed = planContinuityImport({
    formatVersion: 2,
    mappings: 'not-an-array',
    canonicalPlans: [null],
  });
  assert.equal(malformed.status, 'rejected');
  if (malformed.status !== 'rejected') return;
  assert.deepEqual(
    malformed.rejections.map((item) => item.code),
    ['record-not-object', 'unsupported-format-version', 'collection-not-array'],
  );

  const corrupt = safeDocument();
  delete (
    corrupt.attendanceAggregates[0] as Partial<
      (typeof corrupt.attendanceAggregates)[number]
    >
  ).meetingId;
  corrupt.attendanceAggregates[0]!.summary.presentCount = -1;
  const result = planContinuityImport(corrupt);
  assert.equal(result.status, 'rejected');
  if (result.status !== 'rejected') return;
  assert.ok(
    result.rejections.some(
      (item) =>
        item.code === 'required-field-missing' &&
        item.path.endsWith('.meetingId'),
    ),
  );
  assert.ok(
    result.rejections.some(
      (item) =>
        item.code === 'invalid-field-type' &&
        item.path.endsWith('.presentCount'),
    ),
  );
});

test('rejects conflicting duplicate identities without exposing either record', () => {
  const document = safeDocument();
  document.mappings.push({
    ...document.mappings[0]!,
    targetKey: 'room-beta',
  });
  const result = planContinuityImport(document);

  assert.equal(result.status, 'rejected');
  if (result.status !== 'rejected') return;
  assert.deepEqual(result.rejections, [
    {
      category: 'corrupt-record',
      code: 'conflicting-duplicate-identity',
      path: '$.mappings[1]',
    },
  ]);
  assert.equal(JSON.stringify(result).includes('room-beta'), false);
});

test('does not mutate accepted or rejected input objects', () => {
  const acceptedInput = safeDocument();
  const acceptedBefore = structuredClone(acceptedInput);
  planContinuityImport(acceptedInput);
  assert.deepEqual(acceptedInput, acceptedBefore);

  const rejectedInput = { ...safeDocument(), credentials: 'not-retained' };
  const rejectedBefore = structuredClone(rejectedInput);
  planContinuityImport(rejectedInput);
  assert.deepEqual(rejectedInput, rejectedBefore);
});

test('fails closed when an in-memory object cannot be safely read', () => {
  const unreadable = Object.defineProperty({}, 'formatVersion', {
    enumerable: true,
    get(): never {
      throw new Error('synthetic accessor failure');
    },
  });

  assert.deepEqual(planContinuityImport(unreadable), {
    status: 'rejected',
    rejections: [
      {
        category: 'malformed-input',
        code: 'document-unreadable',
        path: '$',
      },
    ],
  });
});

test('rejects stateful accessors before identity and record extraction', () => {
  const document = safeDocument();
  let reads = 0;
  Object.defineProperty(
    document.configurationSnapshots[0]!,
    'configurationId',
    {
      enumerable: true,
      get(): string {
        reads += 1;
        return `config-${reads}`;
      },
    },
  );

  assert.deepEqual(planContinuityImport(document), {
    status: 'rejected',
    rejections: [
      {
        category: 'malformed-input',
        code: 'document-unreadable',
        path: '$',
      },
    ],
  });
  assert.equal(reads, 0);
});

test('rejects symbol, non-enumerable, and augmented-array properties', () => {
  const cases: readonly ((
    document: ReturnType<typeof safeDocument>,
  ) => void)[] = [
    (document) => {
      Object.defineProperty(document.configurationSnapshots[0]!, 'concealed', {
        value: 'not continuity data',
        enumerable: false,
      });
    },
    (document) => {
      Object.defineProperty(
        document.configurationSnapshots[0]!,
        Symbol('concealed'),
        { value: 'not continuity data', enumerable: true },
      );
    },
    (document) => {
      Object.defineProperty(document.mappings, 'metadata', {
        value: 'not an array item',
        enumerable: true,
      });
    },
  ];

  for (const mutate of cases) {
    const document = safeDocument();
    mutate(document);
    assert.equal(planContinuityImport(document).status, 'rejected');
  }
});
