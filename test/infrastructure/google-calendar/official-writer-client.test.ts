import assert from 'node:assert/strict';
import {
  chmodSync,
  linkSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  googleCalendarOwnedEventsReadScope,
  googleCalendarOwnedEventsWriteScope,
} from '../../../src/config/google-calendar.js';
import { loadOfficialCalendarMutationTransport } from '../../../src/infrastructure/google-calendar/official-writer-client.js';

test('writer reference is exact, separate, owner-only, and write scoped', () => {
  const root = mkdtempSync(join(tmpdir(), 'm14-calendar-oauth-'));
  const path = join(root, 'authorized-user.json');
  const reference = {
    version: 1,
    type: 'authorized-user',
    clientId: `${'a'.repeat(24)}.apps.googleusercontent.com`,
    clientSecret: 's'.repeat(32),
    refreshToken: 'r'.repeat(32),
    scopes: [googleCalendarOwnedEventsWriteScope],
  };
  try {
    assert.throws(
      () => loadOfficialCalendarMutationTransport(join(root, 'absent.json')),
      /calendar-writer-credential-reference-unsafe/u,
    );
    writeFileSync(path, JSON.stringify(reference), { mode: 0o600 });
    assert.doesNotThrow(() => loadOfficialCalendarMutationTransport(path));

    chmodSync(path, 0o640);
    assert.throws(
      () => loadOfficialCalendarMutationTransport(path),
      /calendar-writer-credential-reference-unsafe/u,
    );
    chmodSync(path, 0o600);

    const hardLink = join(root, 'hard-link.json');
    linkSync(path, hardLink);
    assert.throws(
      () => loadOfficialCalendarMutationTransport(path),
      /calendar-writer-credential-reference-unsafe/u,
    );
    unlinkSync(hardLink);

    const symlink = join(root, 'link.json');
    symlinkSync(path, symlink);
    assert.throws(
      () => loadOfficialCalendarMutationTransport(symlink),
      /calendar-writer-credential-reference-unsafe/u,
    );

    writeFileSync(
      path,
      JSON.stringify({
        ...reference,
        scopes: [googleCalendarOwnedEventsReadScope],
      }),
      { mode: 0o600 },
    );
    assert.throws(
      () => loadOfficialCalendarMutationTransport(path),
      /calendar-writer-credential-reference-invalid/u,
    );

    writeFileSync(path, JSON.stringify({ ...reference, extra: true }), {
      mode: 0o600,
    });
    assert.throws(
      () => loadOfficialCalendarMutationTransport(path),
      /calendar-writer-credential-reference-invalid/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
