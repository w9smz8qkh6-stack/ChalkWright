import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { acquireCanonicalPlan } from '../../../src/application/read-only/acquire-canonical-plan.js';
import type { Clock } from '../../../src/domain/determinism.js';
import type { ClassId, RoomId } from '../../../src/domain/identities.js';
import { PowerSchoolScheduleAdapter } from '../../../src/infrastructure/powerschool/adapter.js';
import { PowerSchoolAuthentication } from '../../../src/infrastructure/powerschool/auth.js';
import { PassiveBrowserReadSession } from '../../../src/infrastructure/powerschool/browser-read.js';
import { PowerSchoolBrowserTransport } from '../../../src/infrastructure/powerschool/browser-transport.js';
import { PassiveSameOriginHttpReader } from '../../../src/infrastructure/powerschool/passive-http.js';
import {
  startPowerSchoolLikeServer,
  syntheticPowerSchoolBrowserPolicy,
} from '../../support/powerschool-like-server.js';

const clock: Clock = { now: () => '2035-04-13T07:00:00.000Z' };
const roomId = 'room-b407' as RoomId;

test('synthetic HTTP and browser reads feed the canonical pipeline without source mutations', async () => {
  const server = await startPowerSchoolLikeServer();
  const profile = mkdtempSync(
    join(tmpdir(), 'classroom-hub-powerschool-profile-'),
  );
  let session: PassiveBrowserReadSession | undefined;
  try {
    session = await PassiveBrowserReadSession.launch({
      userDataDir: profile,
      allowedOrigin: server.origin,
      timeoutMs: 5_000,
      maxBodyBytes: 128 * 1024,
      ...syntheticPowerSchoolBrowserPolicy(),
    });
    const browser = new PowerSchoolBrowserTransport(session, server.origin);
    await session.read('/session/valid');
    const http = new PassiveSameOriginHttpReader({
      origin: server.origin,
      authenticationProbePath: '/schedule/static',
      allowedPathTemplates: [
        '/schedule/static',
        '/schedule/static?date={date}',
        '/schedule/dynamic?date={date}',
      ],
      maximumTimeoutMs: 5_000,
      maximumBodyBytes: 128 * 1024,
      cookies: browser,
    });
    const authentication = new PowerSchoolAuthentication(clock, http, {
      failureThreshold: 2,
      cooloffMs: 60_000,
      liveProbeTimeoutMs: 2_000,
    });
    assert.equal(
      (await authentication.getStatus({ probe: true })).state,
      'authenticated',
    );
    assert.equal((await browser.read('/sso')).status, 'repair-required');
    assert.equal((await browser.read('/manual')).status, 'repair-required');
    const staticSource = new PowerSchoolScheduleAdapter({
      authentication,
      http,
      browser,
      clock,
      schedulePathTemplate: '/schedule/static?date={date}',
      utcOffset: 'Z',
    });

    const observed = await staticSource.readSchedule({
      date: '2035-04-13',
      roomId,
    });
    assert.equal(observed.status, 'observed');
    if (observed.status !== 'observed') return;
    assert.equal(observed.observation.provenance.method, 'session-http');
    assert.equal(
      observed.observation.provenance.sourceReference,
      'powerschool-bell-schedule',
    );
    assert.equal(JSON.stringify(observed).includes('synthetic_session'), false);
    assert.equal(JSON.stringify(observed).includes('<table'), false);

    const firstPeriod = observed.observation.periods[0];
    assert.ok(firstPeriod);
    const planned = await acquireCanonicalPlan(staticSource, {
      date: '2035-04-13',
      roomId,
      mappings: [
        {
          classId: 'class-synthetic-1' as ClassId,
          sectionCode: firstPeriod.courseKey,
          roomId,
          periodId: firstPeriod.periodId,
        },
      ],
      timing: {
        timeZone: 'America/Chicago',
        checkInOpenMinutesBefore: 10,
        dismissalWarningMinutesBefore: 5,
      },
    });
    assert.equal(planned.status, 'planned');
    if (planned.status === 'planned') {
      assert.deepEqual(planned.plan.sourceObservationIds, [
        observed.observation.observationId,
      ]);
    }

    const dynamicSource = new PowerSchoolScheduleAdapter({
      authentication,
      http,
      browser,
      clock,
      schedulePathTemplate: '/schedule/dynamic?date={date}',
      utcOffset: 'Z',
    });
    const dynamic = await dynamicSource.readSchedule({
      date: '2035-04-13',
      roomId,
    });
    assert.equal(dynamic.status, 'observed');
    if (dynamic.status === 'observed') {
      assert.equal(dynamic.observation.provenance.method, 'browser-read');
    }
    assert.deepEqual(server.mutationAttempts, []);
  } finally {
    await session?.close();
    await server.close();
    rmSync(profile, { recursive: true, force: true });
  }
});

test('expired synthetic sessions return repair-required without browser fallback or mutation', async () => {
  const server = await startPowerSchoolLikeServer();
  const profile = mkdtempSync(
    join(tmpdir(), 'classroom-hub-powerschool-profile-'),
  );
  let session: PassiveBrowserReadSession | undefined;
  try {
    session = await PassiveBrowserReadSession.launch({
      userDataDir: profile,
      allowedOrigin: server.origin,
      timeoutMs: 5_000,
      maxBodyBytes: 128 * 1024,
      ...syntheticPowerSchoolBrowserPolicy(),
    });
    const browser = new PowerSchoolBrowserTransport(session, server.origin);
    await session.read('/session/expired');
    const http = new PassiveSameOriginHttpReader({
      origin: server.origin,
      authenticationProbePath: '/schedule/static',
      allowedPathTemplates: [
        '/schedule/static',
        '/schedule/static?date={date}',
      ],
      maximumTimeoutMs: 5_000,
      maximumBodyBytes: 128 * 1024,
      cookies: browser,
    });
    const authentication = new PowerSchoolAuthentication(clock, http, {
      failureThreshold: 2,
      cooloffMs: 60_000,
      liveProbeTimeoutMs: 2_000,
    });
    assert.equal(
      (await authentication.getStatus({ probe: true })).state,
      'expired',
    );
    const source = new PowerSchoolScheduleAdapter({
      authentication,
      http,
      browser,
      clock,
      schedulePathTemplate: '/schedule/static?date={date}',
      utcOffset: 'Z',
    });
    const result = await source.readSchedule({ date: '2035-04-13', roomId });
    assert.equal(result.status, 'repair-required');
    assert.deepEqual(server.mutationAttempts, []);
  } finally {
    await session?.close();
    await server.close();
    rmSync(profile, { recursive: true, force: true });
  }
});
