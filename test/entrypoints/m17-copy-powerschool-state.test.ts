import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { copyM17PowerSchoolState } from '../../src/entrypoints/m17-copy-powerschool-state.js';
import {
  loadFilteredPowerSchoolState,
  writeFilteredPowerSchoolState,
} from '../../src/infrastructure/powerschool-session/protected-state.js';

test('copies only validated filtered PowerSchool state into a distinct canary root', () => {
  const root = mkdtempSync(join(tmpdir(), 'chalkwright-m17-state-'));
  const source = join(root, 'source');
  const target = join(root, 'target');
  const origin = 'https://powerschool.example.test';
  try {
    chmodSync(root, 0o700);
    writeFilteredPowerSchoolState(source, origin, {
      cookies: [
        {
          name: 'session',
          value: 'synthetic',
          domain: 'powerschool.example.test',
          path: '/',
          expires: 2_000_000_000,
          httpOnly: true,
          secure: true,
          sameSite: 'Lax',
        },
      ],
      origins: [],
    });
    const result = copyM17PowerSchoolState({
      CHALKWRIGHT_M17_POWERSCHOOL_SOURCE_DIRECTORY: source,
      CLASSROOM_HUB_POWERSCHOOL_ROOM_ID: 'C509',
      CLASSROOM_HUB_POWERSCHOOL_ORIGIN: origin,
      CLASSROOM_HUB_POWERSCHOOL_STATUS_PATH: '/teachers/home.html',
      CLASSROOM_HUB_POWERSCHOOL_STATUS_READY_SELECTOR: '#ok',
      CLASSROOM_HUB_POWERSCHOOL_BELL_PATH_TEMPLATE:
        '/teachers/aet_schedulebell.html?target_date={date-us}',
      CLASSROOM_HUB_POWERSCHOOL_BELL_READY_SELECTOR: '#bell',
      CLASSROOM_HUB_POWERSCHOOL_SESSION_DIRECTORY: target,
      CLASSROOM_HUB_POWERSCHOOL_CHROME_EXECUTABLE: '/usr/bin/google-chrome',
      CLASSROOM_HUB_POWERSCHOOL_NAVIGATION_TIMEOUT_SECONDS: '30',
      CLASSROOM_HUB_POWERSCHOOL_ROUTINE_TIMEOUT_SECONDS: '120',
      CLASSROOM_HUB_POWERSCHOOL_MAX_RESPONSE_BYTES: '1048576',
      CLASSROOM_HUB_POWERSCHOOL_UTC_OFFSET: '+07:00',
    });
    assert.equal(result.providerRequests, 0);
    assert.equal(result.profilesCopied, 0);
    assert.equal(
      loadFilteredPowerSchoolState(target, origin).cookies.length,
      1,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
