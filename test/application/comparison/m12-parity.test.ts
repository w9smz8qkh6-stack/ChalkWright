import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  compareM12ParityCase,
  compareM12ParitySuite,
  m12RouteFamilies,
  m12ScenarioKinds,
  toM12ComparisonEvidence,
  type M12ParityCase,
  type M12ParitySnapshot,
  type M12ScenarioKind,
} from '../../../src/application/comparison/m12-parity.js';
import { displayStates } from '../../../src/contracts/v1/display.js';
import type { ScreenId } from '../../../src/domain/identities.js';
import { SqliteDatabase } from '../../../src/infrastructure/sqlite/database.js';
import { SqliteApplicationStateRepository } from '../../../src/infrastructure/sqlite/repository.js';

const comparedAt = '2035-04-13T07:00:00Z';
const screenId = 'screen-fixture' as ScreenId;
const legacyRouteFamilies = m12RouteFamilies.filter(
  (family) => !['hold', 'attendance', 'attendance-redirect'].includes(family),
);

function snapshot(
  side: 'reference' | 'candidate',
  overrides: {
    readonly plan?: Partial<M12ParitySnapshot['plan']>;
    readonly display?: Partial<M12ParitySnapshot['display']>;
    readonly routes?: Partial<M12ParitySnapshot['routes']>;
    readonly operations?: Partial<M12ParitySnapshot['operations']>;
  } = {},
): M12ParitySnapshot {
  return {
    plan: {
      variation: 'normal',
      meetingCount: 3,
      verification: 'verified',
      scopeIsolation: 'strict',
      timingBoundaries: 'preserved',
      stateSequence: displayStates,
      nextClassDay: 'tomorrow',
      fallbackAuthority: 'disabled',
      ...overrides.plan,
    },
    display: {
      state: 'in_class_content',
      currentMeeting: true,
      nextMeeting: true,
      shell: 'full-screen',
      contentKinds: [
        'schedule',
        'check-in',
        'objective',
        'bellringer',
        'vocabulary',
        'generic',
        'attendance',
        'media',
        'next-day',
      ],
      classroomEnrichment: 'preserved',
      vocabularyRotation: 'preserved',
      attendanceResolution: 'preserved',
      attendanceMatrix: 'preserved',
      previewSemantics: 'preserved',
      overrideSemantics: 'preserved',
      attendance: 'visible',
      qr: 'visible',
      media: 'ready',
      polling: 'legacy-compatible',
      carousel:
        side === 'reference' ? 'client-local-pause' : 'server-persistent-hold',
      layout: 'fits',
      assets: 'local-only',
      ...overrides.display,
    },
    routes: {
      families: side === 'reference' ? legacyRouteFamilies : m12RouteFamilies,
      getHead: 'preserved',
      cachePolicy: 'preserved',
      securityHeaders: 'preserved',
      compatibilityRoute: 'preserved',
      ...overrides.routes,
    },
    operations: {
      providerSessionLifecycle: 'preserved',
      powerschoolExtendedReads: 'preserved',
      classroomReadPipeline: 'preserved',
      legacyGoogleReadScope: 'preserved',
      source: 'succeeded',
      classroom: 'succeeded',
      readiness: 'ready',
      lastKnownGood: 'current',
      jobSequence: 'auth-first',
      refreshCadence:
        side === 'reference' ? 'legacy-weekday-0620' : 'shadow-sun-fri-0720',
      briefWorkflows: 'distinct',
      alertSemantics: 'preserved',
      healthDiagnostics: 'preserved',
      persistence: 'preserved',
      serviceLifecycle: 'preserved',
      rollbackReadiness: 'preserved',
      operatorSecurity: 'preserved',
      networkIsolation: 'preserved',
      dependencyIndependence: 'preserved',
      attemptedExternalMutations: 0,
      completedExternalMutations: 0,
      ...overrides.operations,
    },
  };
}

const scenarioOverrides: Record<
  M12ScenarioKind,
  Parameters<typeof snapshot>[1]
> = {
  normal: {},
  changed: {
    plan: { variation: 'changed' },
    display: {
      state: 'morning_overview',
      currentMeeting: false,
      nextMeeting: true,
    },
  },
  gap: {
    plan: { variation: 'gap' },
    display: {
      state: 'idle',
      currentMeeting: false,
      nextMeeting: true,
    },
  },
  'no-class': {
    plan: {
      variation: 'no-class',
      meetingCount: 0,
      verification: 'absent',
      nextClassDay: 'none',
    },
    display: {
      state: 'no_classes',
      currentMeeting: false,
      nextMeeting: false,
      attendance: 'unavailable',
      qr: 'unavailable',
    },
  },
  'future-day': {
    plan: { variation: 'future-day', nextClassDay: 'next-class-day' },
    display: {
      state: 'day_complete',
      currentMeeting: false,
      nextMeeting: true,
    },
  },
  'stale-cache': {
    display: {
      state: 'pre_checkin',
      currentMeeting: false,
      nextMeeting: true,
      attendance: 'hidden',
    },
    operations: { classroom: 'degraded', lastKnownGood: 'retained' },
  },
  'auth-failure': {
    display: {
      state: 'post_end',
      currentMeeting: false,
      nextMeeting: true,
    },
    operations: {
      source: 'repair-required',
      classroom: 'skipped',
      readiness: 'not-ready',
      lastKnownGood: 'retained',
    },
  },
};

function comparison(kind: M12ScenarioKind): M12ParityCase {
  return {
    id: `m12-${kind}`,
    kind,
    date: '2035-04-13',
    screenId,
    reference: snapshot('reference', scenarioOverrides[kind]),
    candidate: snapshot('candidate', scenarioOverrides[kind]),
  };
}

function manifest(): readonly M12ParityCase[] {
  return m12ScenarioKinds.map(comparison);
}

test('the exact seven-scenario manifest accepts only the approved replacements', () => {
  const result = compareM12ParitySuite(manifest());

  assert.equal(result.equivalent, true);
  assert.equal(result.caseCount, 7);
  assert.equal(result.acceptedDifferenceCount, 21);
  assert.equal(result.unexplainedDifferenceCount, 0);
  for (const item of result.cases) {
    assert.deepEqual(
      item.differences.map(({ code }) => code),
      [
        'display-carousel-model-strengthened',
        'operations-refresh-cadence-approved',
        'route-families-different',
      ],
    );
    assert.ok(
      item.differences.every(({ disposition }) => disposition === 'accepted'),
    );
  }
});

test('material drift is value-free and attributed to frozen behavior IDs', () => {
  const base = comparison('normal');
  const item: M12ParityCase = {
    ...base,
    candidate: {
      ...base.candidate,
      plan: { ...base.candidate.plan, meetingCount: 2 },
      display: { ...base.candidate.display, layout: 'overflow' },
      routes: { ...base.candidate.routes, securityHeaders: 'weaker' },
      operations: { ...base.candidate.operations, readiness: 'not-ready' },
    },
  };

  const result = compareM12ParityCase(item);
  assert.equal(result.equivalent, false);
  assert.deepEqual(
    result.differences
      .filter(({ disposition }) => disposition === 'unexplained')
      .map(({ code }) => code),
    [
      'display-layout-different',
      'operations-readiness-different',
      'plan-meeting-count-different',
      'route-security-headers-different',
    ],
  );
  assert.ok(result.behaviorIds.includes('PLAN-001'));
  assert.ok(result.behaviorIds.includes('DISP-007'));
  assert.ok(result.behaviorIds.includes('HTTP-003'));
  assert.ok(result.behaviorIds.includes('HEALTH-001'));
  assert.doesNotMatch(
    JSON.stringify(result),
    /meetingCount|reference|candidate/u,
  );
});

test('scenario semantics constrain the reference while candidate drift is compared', () => {
  const base = comparison('no-class');
  const item: M12ParityCase = {
    ...base,
    candidate: {
      ...base.candidate,
      plan: {
        ...base.candidate.plan,
        variation: 'normal',
        meetingCount: 1,
        verification: 'verified',
      },
      display: {
        ...base.candidate.display,
        state: 'in_class_content',
        currentMeeting: true,
      },
    },
  };

  const result = compareM12ParityCase(item);
  assert.equal(result.equivalent, false);
  assert.ok(
    result.differences.some(({ code }) => code === 'plan-variation-different'),
  );
  assert.ok(
    result.differences.some(
      ({ code }) => code === 'plan-meeting-count-different',
    ),
  );
  assert.ok(
    result.differences.some(({ code }) => code === 'display-state-different'),
  );
});

test('attributes preview, override, continuity, provider, and operations surfaces', () => {
  const base = comparison('normal');
  const item: M12ParityCase = {
    ...base,
    candidate: {
      ...base.candidate,
      display: {
        ...base.candidate.display,
        classroomEnrichment: 'different',
        vocabularyRotation: 'different',
        attendanceResolution: 'different',
        attendanceMatrix: 'different',
        previewSemantics: 'different',
        overrideSemantics: 'different',
      },
      operations: {
        ...base.candidate.operations,
        providerSessionLifecycle: 'different',
        powerschoolExtendedReads: 'different',
        classroomReadPipeline: 'different',
        legacyGoogleReadScope: 'different',
        healthDiagnostics: 'different',
        persistence: 'different',
        serviceLifecycle: 'different',
        rollbackReadiness: 'different',
        operatorSecurity: 'different',
        networkIsolation: 'different',
        dependencyIndependence: 'different',
      },
    },
  };

  const result = compareM12ParityCase(item);
  assert.equal(result.equivalent, false);
  for (const behaviorId of [
    'ATT-002',
    'ATT-006',
    'PRE-001',
    'PRE-002',
    'PRE-003',
    'OVR-001',
    'OVR-002',
    'OVR-003',
    'HEALTH-003',
    'PERSIST-001',
    'PERSIST-002',
    'PERSIST-003',
    'OPS-001',
    'OPS-003',
    'OPS-004',
    'SEC-001',
    'NET-001',
    'DEP-001',
    'PS-010',
    'PS-011',
    'GC-007',
  ]) {
    assert.ok(result.behaviorIds.includes(behaviorId), behaviorId);
  }
});

test('any candidate provider mutation count fails even when both sides match', () => {
  const base = comparison('normal');
  const item: M12ParityCase = {
    ...base,
    reference: {
      ...base.reference,
      operations: {
        ...base.reference.operations,
        attemptedExternalMutations: 1,
      },
    },
    candidate: {
      ...base.candidate,
      operations: {
        ...base.candidate.operations,
        attemptedExternalMutations: 1,
      },
    },
  };

  const result = compareM12ParityCase(item);
  assert.equal(result.equivalent, false);
  assert.ok(
    result.differences.some(
      ({ code }) => code === 'operations-source-mutation-boundary-violated',
    ),
  );
});

test('accepted replacements are directional and exact', () => {
  const base = comparison('normal');
  const reversed: M12ParityCase = {
    ...base,
    reference: {
      ...base.reference,
      display: {
        ...base.reference.display,
        carousel: 'server-persistent-hold',
      },
      routes: { ...base.reference.routes, families: m12RouteFamilies },
      operations: {
        ...base.reference.operations,
        refreshCadence: 'shadow-sun-fri-0720',
      },
    },
    candidate: {
      ...base.candidate,
      display: {
        ...base.candidate.display,
        carousel: 'client-local-pause',
      },
      routes: { ...base.candidate.routes, families: legacyRouteFamilies },
      operations: {
        ...base.candidate.operations,
        refreshCadence: 'legacy-weekday-0620',
      },
    },
  };

  const result = compareM12ParityCase(reversed);
  assert.equal(result.equivalent, false);
  assert.equal(result.unexplainedDifferenceCount, 3);
});

test('manifest and snapshots reject omissions, duplicates, unknowns, and hostile accessors', () => {
  assert.throws(
    () => compareM12ParitySuite(manifest().slice(0, -1)),
    /m12-comparison-manifest-invalid/u,
  );
  const duplicate = [...manifest()];
  duplicate[6] = { ...duplicate[6]!, kind: 'normal' };
  assert.throws(
    () => compareM12ParitySuite(duplicate),
    /m12-comparison-manifest-invalid/u,
  );
  const relabeled = m12ScenarioKinds.map((kind) => ({
    ...comparison('normal'),
    id: `m12-${kind}`,
    kind,
  }));
  assert.throws(
    () => compareM12ParitySuite(relabeled),
    /m12-comparison-manifest-invalid/u,
  );
  const unsortedBase = comparison('normal');
  const unsortedRoutes: M12ParityCase = {
    ...unsortedBase,
    candidate: {
      ...unsortedBase.candidate,
      routes: {
        ...unsortedBase.candidate.routes,
        families: [...m12RouteFamilies.slice(1), m12RouteFamilies[0]],
      },
    },
  };
  assert.throws(
    () => compareM12ParityCase(unsortedRoutes),
    /m12-comparison-case-invalid/u,
  );
  const extra = structuredClone(comparison('normal')) as unknown as Record<
    string,
    unknown
  >;
  (extra.candidate as Record<string, unknown>).privatePayload = 'forbidden';
  assert.throws(
    () => compareM12ParityCase(extra as unknown as M12ParityCase),
    /m12-comparison-case-invalid/u,
  );
  const accessor = structuredClone(comparison('normal')) as unknown as Record<
    string,
    unknown
  >;
  Object.defineProperty(accessor, 'reference', {
    enumerable: true,
    get() {
      throw new Error('private-provider-value');
    },
  });
  assert.throws(
    () => compareM12ParityCase(accessor as unknown as M12ParityCase),
    /^Error: m12-comparison-case-invalid$/u,
  );
});

test('redacted evidence rejects forged results and round-trips atomically', async () => {
  const comparisons = manifest();
  const results = compareM12ParitySuite(comparisons);
  const records = comparisons.map((item, index) =>
    toM12ComparisonEvidence({
      comparison: item,
      result: results.cases[index]!,
      comparedAt,
    }),
  );
  assert.ok(records.every(({ data }) => data.equal === false));
  assert.doesNotMatch(
    JSON.stringify(records),
    /reference|candidate|meetingCount|course|student|provider|https?:/iu,
  );

  const forged = { ...results.cases[0]!, equivalent: false };
  assert.throws(
    () =>
      toM12ComparisonEvidence({
        comparison: comparisons[0]!,
        result: forged,
        comparedAt,
      }),
    /m12-comparison-evidence-invalid/u,
  );

  const directory = mkdtempSync(join(tmpdir(), 'classroom-hub-m12-'));
  const database = new SqliteDatabase(join(directory, 'state.sqlite'), {
    migration: { appliedAt: comparedAt },
  });
  let revision = 0;
  const repository = new SqliteApplicationStateRepository(database, {
    clock: { now: () => comparedAt },
    nextRevision: () => `revision-${++revision}`,
    academicYearEndForDate: () => '2035-06-30',
  });
  try {
    assert.ok(
      repository
        .storeRecordsAtomically(records)
        .every(({ status }) => status === 'stored'),
    );
    for (const record of records) {
      assert.deepEqual(
        await repository.findRecord({
          kind: record.kind,
          recordKey: record.recordKey,
          ...record.scope,
        }),
        record,
      );
    }
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
