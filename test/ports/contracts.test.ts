import assert from 'node:assert/strict';
import test from 'node:test';

import type { Clock, IdentifierFactory } from '../../src/domain/determinism.js';
import {
  actionableErrorCategories,
  type ActionableError,
} from '../../src/domain/errors.js';
import type { ClassId, RoomId, ScreenId } from '../../src/domain/identities.js';
import type { EnrichmentObservation } from '../../src/domain/observations.js';
import type { CanonicalPlan } from '../../src/domain/plans.js';
import type {
  CalendarWriteRequest,
  CalendarWriterPort,
} from '../../src/ports/calendar-writer.js';
import type {
  EnrichmentObservationSource,
  ScheduleObservationSource,
} from '../../src/ports/read-sources.js';
import type { PlanSnapshotReader } from '../../src/ports/persistence-read.js';
import type { ReadOnlyOrchestrationDependencies } from '../../src/application/read-only/dependencies.js';
import {
  localCommandKinds,
  type LocalCommandRequest,
} from '../../src/ports/local-command.js';

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <
    Value,
  >() => Value extends Right ? 1 : 2
    ? true
    : false;

const scheduleSourceIsReadOnly: Equal<
  keyof ScheduleObservationSource,
  'readSchedule'
> = true;
const enrichmentSourceIsReadOnly: Equal<
  keyof EnrichmentObservationSource<unknown>,
  'readEnrichment'
> = true;
const planReaderIsReadOnly: Equal<
  keyof PlanSnapshotReader,
  'findCanonical' | 'findEffective'
> = true;
const readOnlyDependenciesHaveNoMutationPorts: Equal<
  keyof ReadOnlyOrchestrationDependencies<unknown>,
  'clock' | 'enrichment' | 'identifiers' | 'plans' | 'schedules'
> = true;
const canonicalPlanHasNoOutputTechnologyFields: Equal<
  Extract<
    keyof CanonicalPlan,
    | 'calendarEventId'
    | 'calendarEvents'
    | 'displayState'
    | 'openClawState'
    | 'renderedHtml'
    | 'screenId'
  >,
  never
> = true;
const calendarWriterIsIsolated: Equal<keyof CalendarWriterPort, 'reconcile'> =
  true;
const deterministicServicesAreInjected: Equal<keyof Clock, 'now'> &
  Equal<keyof IdentifierFactory, 'next'> = true;
const localCommandInputIsBounded: Equal<
  keyof LocalCommandRequest,
  'commandId' | 'deadlineAt' | 'kind' | 'scopeId'
> = true;
const calendarWriterAcceptsOnlyItsRequest: Equal<
  Parameters<CalendarWriterPort['reconcile']>,
  [request: CalendarWriteRequest]
> = true;
const actionableErrorsExposeOnlyRedactedFields: Equal<
  keyof ActionableError,
  'category' | 'code' | 'diagnostics' | 'message' | 'retryable'
> = true;
const enrichmentCarriesRequiredObservationMetadata: Equal<
  keyof EnrichmentObservation<unknown>,
  | 'classId'
  | 'contractVersion'
  | 'diagnostics'
  | 'freshness'
  | 'observedForDate'
  | 'observationId'
  | 'provenance'
  | 'value'
  | 'verification'
> = true;
const classIsNotRoom: ClassId extends RoomId ? true : false = false;
const roomIsNotScreen: RoomId extends ScreenId ? true : false = false;

test('exposes read-only source and preview dependency surfaces', () => {
  assert.equal(scheduleSourceIsReadOnly, true);
  assert.equal(enrichmentSourceIsReadOnly, true);
  assert.equal(planReaderIsReadOnly, true);
  assert.equal(readOnlyDependenciesHaveNoMutationPorts, true);
  assert.equal(canonicalPlanHasNoOutputTechnologyFields, true);
  assert.equal(calendarWriterIsIsolated, true);
  assert.equal(deterministicServicesAreInjected, true);
  assert.equal(localCommandInputIsBounded, true);
  assert.equal(calendarWriterAcceptsOnlyItsRequest, true);
  assert.equal(actionableErrorsExposeOnlyRedactedFields, true);
  assert.equal(enrichmentCarriesRequiredObservationMetadata, true);
  assert.equal(classIsNotRoom, false);
  assert.equal(roomIsNotScreen, false);
});

test('preserves actionable error categories without arbitrary detail fields', () => {
  assert.deepEqual(actionableErrorCategories, [
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
  ]);
});

test('bounds local commands without process or filesystem inputs', () => {
  const request: LocalCommandRequest = {
    commandId: 'synthetic-command',
    kind: 'collect-compatibility-snapshot',
    deadlineAt: '2035-02-20T05:00:05Z',
    scopeId: 'synthetic-scope',
  };

  assert.deepEqual(localCommandKinds, [
    'collect-compatibility-snapshot',
    'render-operator-brief',
  ]);
  assert.deepEqual(Object.keys(request).sort(), [
    'commandId',
    'deadlineAt',
    'kind',
    'scopeId',
  ]);
  assert.equal('executable' in request, false);
  assert.equal('arguments' in request, false);
  assert.equal('environment' in request, false);
  assert.equal('path' in request, false);
});
