import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';

import { startFixtureBackedMvp } from '../../src/app/mvp-server.js';
import { b407StateInstants } from '../../src/infrastructure/fixture/b407.js';

const token = 'synthetic-operator-token-for-m05';

test('serves the complete fixture-backed B407 slice and cleans temporary state', async () => {
  let runtimeInstant = '2035-04-13T08:00:00Z';
  const application = await startFixtureBackedMvp(
    {
      nodeEnv: 'test',
      logLevel: 'warn',
      host: '127.0.0.1',
      port: 0,
      operatorToken: token,
    },
    process.cwd(),
    { clock: { now: () => runtimeInstant } },
  );
  try {
    assert.equal(existsSync(application.stateDirectory), true);
    const compatibility = await fetch(`${application.origin}/tv`);
    assert.equal(compatibility.status, 200);
    assert.match(await compatibility.text(), /state-in_class_content/u);

    for (const [state, now] of Object.entries(b407StateInstants)) {
      const response = await fetch(
        `${application.origin}/preview/screen-b407?view=display&now=${encodeURIComponent(now)}`,
      );
      assert.equal(response.status, 200, state);
      assert.match(await response.text(), new RegExp(`state-${state}`, 'u'));
    }

    const target = await fetch(`${application.origin}/target/screen-b407`);
    assert.equal(target.status, 200);
    const payload = (await target.json()) as {
      readonly presentationHtml?: string;
      readonly state?: string;
      readonly bellEndsAt?: string;
      readonly dateLabel?: string;
      readonly documentTitle?: string;
      readonly degraded?: boolean;
    };
    assert.equal(payload.state, 'in_class_content');
    assert.equal(payload.bellEndsAt, '2035-04-13T09:00:00Z');
    assert.match(payload.presentationHtml ?? '', /data-carousel/u);
    assert.doesNotMatch(payload.presentationHtml ?? '', /<!doctype/u);
    assert.equal(payload.dateLabel, 'Friday, April 13');
    assert.match(payload.documentTitle ?? '', /Chalkwright$/u);
    assert.equal(payload.degraded, false);

    const pinned = await fetch(
      `${application.origin}/preview/screen-b407?view=display&now=2035-04-13T07%3A55%3A00Z`,
    );
    const pinnedHtml = await pinned.text();
    assert.match(pinnedHtml, /data-pinned-at="2035-04-13T07:55:00Z"/u);
    assert.match(pinnedHtml, /data-target-url=""/u);

    const manifest = await fetch(`${application.origin}/manifest.webmanifest`);
    assert.equal(
      manifest.headers.get('content-type'),
      'application/manifest+json; charset=utf-8',
    );
    assert.equal(
      ((await manifest.json()) as { start_url?: string }).start_url,
      '/tv',
    );

    const qr = await fetch(
      `${application.origin}/qr/screen-b407/meeting-b407-a.png?date=2035-04-13`,
    );
    assert.equal(qr.status, 200);
    assert.equal(qr.headers.get('content-type'), 'image/png');
    assert.deepEqual(
      [...new Uint8Array(await qr.arrayBuffer()).slice(0, 8)],
      [137, 80, 78, 71, 13, 10, 26, 10],
    );

    const checkIn = await fetch(
      `${application.origin}/go/check-in/class-b407-a`,
      { redirect: 'manual' },
    );
    assert.equal(checkIn.status, 302);
    assert.equal(
      checkIn.headers.get('location'),
      'https://fixture.example.invalid/attendance/b407-a',
    );
    const unsupportedAttendanceAlias = await fetch(
      `${application.origin}/go/teacher/class-b407-a`,
      { redirect: 'manual' },
    );
    assert.equal(unsupportedAttendanceAlias.status, 404);

    const unauthorized = await fetch(
      `${application.origin}/overrides/screen-b407`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          screenId: 'screen-b407',
          date: '2035-04-13',
          announcement: 'Synthetic authorized notice',
        }),
      },
    );
    assert.equal(unauthorized.status, 401);
    const override = await fetch(
      `${application.origin}/overrides/screen-b407`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          screenId: 'screen-b407',
          date: '2035-04-13',
          announcement: 'Synthetic authorized notice',
        }),
      },
    );
    assert.equal(override.status, 200);
    const overridden = (await (
      await fetch(`${application.origin}/target/screen-b407`)
    ).json()) as { readonly content?: { readonly cards?: readonly unknown[] } };
    assert.ok((overridden.content?.cards?.length ?? 0) >= 4);

    const holdScope = {
      screenId: 'screen-b407',
      date: '2035-04-13',
      roomId: 'room-b407',
      classId: 'class-b407-a',
      planId: 'effective-b407',
      meetingId: 'meeting-b407-a',
    };
    const held = await fetch(`${application.origin}/hold/screen-b407`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...holdScope,
        heldAt: '2035-04-13T08:00:00Z',
        expiresAt: '2035-04-13T08:01:00Z',
        reasonCode: 'synthetic-http-hold',
      }),
    });
    assert.equal(held.status, 200);
    const unauthorizedTimeTravel = await fetch(
      `${application.origin}/target/screen-b407?preview=true&now=2035-04-14T08%3A00%3A00Z`,
    );
    assert.equal(unauthorizedTimeTravel.status, 400);
    const stillHeld = (await (
      await fetch(`${application.origin}/hold/screen-b407`)
    ).json()) as { record?: { data?: { status?: string } } };
    assert.equal(stillHeld.record?.data?.status, 'held');
    runtimeInstant = '2035-04-13T08:02:00Z';
    await fetch(`${application.origin}/target/screen-b407`);
    const terminalPage = await (
      await fetch(`${application.origin}/hold/screen-b407?view=operator`)
    ).text();
    assert.match(terminalPage, /Carousel is not held/u);
    const terminalRevision = terminalPage.match(
      /name="expectedRevision" value="([^"]+)"/u,
    )?.[1];
    assert.ok(terminalRevision);
    const repeatedHold = await fetch(`${application.origin}/hold/screen-b407`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...holdScope,
        heldAt: '2035-04-13T08:02:00Z',
        reasonCode: 'synthetic-http-repeat',
        expectedRevision: terminalRevision,
      }),
    });
    assert.equal(repeatedHold.status, 200);

    const media = await fetch(`${application.origin}/media/dismissal`);
    assert.equal(media.status, 404);

    const ready = await fetch(`${application.origin}/ready`);
    assert.equal(ready.status, 200);
    assert.equal(
      ((await ready.json()) as { readonly ready?: boolean }).ready,
      true,
    );
  } finally {
    const stateDirectory = application.stateDirectory;
    await application.close();
    assert.equal(existsSync(stateDirectory), false);
  }
});
