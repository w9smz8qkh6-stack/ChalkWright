import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

import {
  parityCoverage,
  visualBaselineManifest,
} from '../../../src/contracts/v1/index.js';
import { scheduleFixtureCatalog } from '../../fixtures/schedule-cases.js';

const inventory = readFileSync('docs/legacy-parity-inventory.md', 'utf8');
const inventoryIds = [
  ...inventory.matchAll(/^\|\s+((?:[A-Z]+|U)-\d{3})\s+\|/gm),
].flatMap((match) => (match[1] === undefined ? [] : [match[1]]));

test('accounts for every inventory behavior and unknown exactly once', () => {
  const coverageIds = parityCoverage.map((entry) => entry.parityId);

  assert.equal(new Set(inventoryIds).size, inventoryIds.length);
  assert.equal(new Set(coverageIds).size, coverageIds.length);
  assert.deepEqual([...coverageIds].sort(), [...inventoryIds].sort());
});

test('gives every coverage entry an explicit later verification gate', () => {
  for (const coverage of parityCoverage) {
    assert.notEqual(coverage.laterGate.trim(), '');
    assert.notEqual(coverage.note.trim(), '');
    assert.ok(
      coverage.kind === 'later-verification' || coverage.references.length > 0,
      `${coverage.parityId} must reference its M-01 evidence`,
    );
  }
});

test('resolves every M-01 fixture, visual, contract, and invariant reference', () => {
  const fixtureIds = new Set(
    scheduleFixtureCatalog.map((fixture) => fixture.fixtureId),
  );
  const visualReferences = new Set(
    visualBaselineManifest.flatMap((visualCase) => [
      visualCase.id,
      ...visualCase.variants.map(
        (variant) => `${visualCase.id}:${variant.replaceAll('_', '-')}`,
      ),
    ]),
  );

  for (const coverage of parityCoverage) {
    if (coverage.kind === 'synthetic-fixture') {
      assert.ok(
        coverage.references.every((reference) => fixtureIds.has(reference)),
        `${coverage.parityId} must reference a known fixture`,
      );
    } else if (coverage.kind === 'visual-case') {
      assert.ok(
        coverage.references.every((reference) =>
          visualReferences.has(reference),
        ),
        `${coverage.parityId} must reference a known visual case`,
      );
    } else if (
      coverage.kind === 'contract-test' ||
      coverage.kind === 'static-invariant'
    ) {
      assert.ok(
        coverage.references.every((reference) => {
          const path = reference.split('#', 1)[0];
          return path !== undefined && existsSync(path);
        }),
        `${coverage.parityId} must reference an existing repository file`,
      );
    }
  }
});

test('keeps unresolved unknowns later and links resolved policy evidence', () => {
  const unknowns = parityCoverage.filter((entry) =>
    entry.parityId.startsWith('U-'),
  );

  assert.equal(unknowns.length, 15);
  const attendanceContract = unknowns.find(
    (entry) => entry.parityId === 'U-002',
  );
  assert.equal(attendanceContract?.kind, 'static-invariant');
  assert.deepEqual(attendanceContract?.references, [
    'docs/decisions/0015-aggregate-attendance-continuity.md',
  ]);
  const retentionPolicy = unknowns.find((entry) => entry.parityId === 'U-013');
  assert.equal(retentionPolicy?.kind, 'static-invariant');
  assert.deepEqual(retentionPolicy?.references, [
    'docs/decisions/0013-state-retention-and-recovery.md',
  ]);
  const powerSchoolAdapter = unknowns.find(
    (entry) => entry.parityId === 'U-006',
  );
  assert.equal(powerSchoolAdapter?.kind, 'static-invariant');
  assert.deepEqual(powerSchoolAdapter?.references, [
    'docs/decisions/0010-direct-powerschool-auth-adapter.md',
  ]);
  const googlePolicy = unknowns.find((entry) => entry.parityId === 'U-007');
  assert.equal(googlePolicy?.kind, 'later-verification');
  assert.match(
    googlePolicy?.note ?? '',
    /manually created secondary owned Calendar/u,
  );
  assert.match(googlePolicy?.note ?? '', /no calendar-creation/u);
  assert.match(
    googlePolicy?.laterGate ?? '',
    /secondary Calendar.*primary\/legacy deny fingerprints/u,
  );
  const alertPolicy = unknowns.find((entry) => entry.parityId === 'U-008');
  assert.equal(alertPolicy?.kind, 'later-verification');
  assert.match(alertPolicy?.note ?? '', /ADR-0022.*Telegram/u);
  assert.match(alertPolicy?.laterGate ?? '', /report-only.*final-handoff/u);
  const calendarAdoption = unknowns.find((entry) => entry.parityId === 'U-005');
  assert.equal(calendarAdoption?.kind, 'static-invariant');
  assert.deepEqual(calendarAdoption?.references, [
    'docs/decisions/0016-calendar-read-identity-and-ownership.md',
  ]);
  assert.match(calendarAdoption?.laterGate ?? '', /M-15/u);
  assert.match(calendarAdoption?.note ?? '', /exactly three Tuesday/u);
  const unrelatedGoogleReads = parityCoverage.find(
    (entry) => entry.parityId === 'GC-007',
  );
  assert.doesNotMatch(unrelatedGoogleReads?.laterGate ?? '', /before M-08/u);
  assert.match(unrelatedGoogleReads?.note ?? '', /ADR-0011.*Classroom/u);
  assert.ok(
    unknowns
      .filter(
        (entry) =>
          entry.parityId !== 'U-002' &&
          entry.parityId !== 'U-005' &&
          entry.parityId !== 'U-006' &&
          entry.parityId !== 'U-013',
      )
      .every(
        (entry) =>
          entry.kind === 'later-verification' && entry.references.length === 0,
      ),
  );
});
