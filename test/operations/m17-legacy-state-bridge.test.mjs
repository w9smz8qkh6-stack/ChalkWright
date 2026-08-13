import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  parseOpenClawCookieEnvelope,
  parseOpenClawLocalStorageEvaluation,
  parseProtectedEnvironment,
  selectRoutineEnvironment,
} from '../../scripts/operations/refresh-m17-powerschool-state-from-legacy.mjs';

test('M-17 legacy bridge selects only fixed passive PowerSchool settings', () => {
  const parsed = parseProtectedEnvironment(
    'CLASSROOM_HUB_POWERSCHOOL_ROOM_ID="room-c509"\n' +
      'CLASSROOM_HUB_POWERSCHOOL_ORIGIN="https://synthetic.example"\n' +
      'CLASSROOM_HUB_POWERSCHOOL_SESSION_DIRECTORY="/var/lib/chalkwright/canary-powerschool-session"\n' +
      'UNRELATED_SECRET="must-not-pass"\n',
  );
  const selected = selectRoutineEnvironment(parsed);
  assert.equal(selected.UNRELATED_SECRET, undefined);
  assert.equal(
    selected.CLASSROOM_HUB_POWERSCHOOL_SESSION_DIRECTORY,
    '/var/lib/chalkwright/canary-powerschool-session',
  );
});

test('M-17 legacy bridge accepts only the exact OpenClaw JSON cookie envelope', () => {
  const cookies = [{ name: 'synthetic', value: 'not-private' }];
  assert.deepEqual(
    parseOpenClawCookieEnvelope(
      JSON.stringify({ ok: true, targetId: 'synthetic-target', cookies }),
    ),
    { cookies, targetId: 'synthetic-target' },
  );
  for (const invalid of [
    cookies,
    { ok: false, targetId: 'synthetic-target', cookies },
    { ok: true, targetId: 1, cookies },
    { ok: true, targetId: 'synthetic-target', cookies: {} },
    { ok: true, targetId: 'synthetic-target', cookies, extra: true },
  ])
    assert.throws(
      () => parseOpenClawCookieEnvelope(JSON.stringify(invalid)),
      /m17-legacy-bridge-envelope-invalid/u,
    );
});

test('M-17 legacy bridge atomically binds storage to the exact PowerSchool origin', () => {
  const targetId = 'synthetic-target';
  const origin = 'https://synthetic.example';
  const envelope = {
    ok: true,
    result: { origin, values: { synthetic: 'not-private' } },
    targetId,
    url: `${origin}/teachers/home.html`,
  };
  assert.deepEqual(
    parseOpenClawLocalStorageEvaluation(
      JSON.stringify(envelope),
      targetId,
      origin,
    ),
    [{ name: 'synthetic', value: 'not-private' }],
  );
  assert.throws(
    () =>
      parseOpenClawLocalStorageEvaluation(
        JSON.stringify({
          ...envelope,
          result: { ...envelope.result, origin: 'https://foreign.example' },
        }),
        targetId,
        origin,
      ),
    /m17-legacy-bridge-origin-invalid/u,
  );
  assert.throws(
    () =>
      parseOpenClawLocalStorageEvaluation(
        JSON.stringify({ ...envelope, url: 'https://foreign.example/' }),
        targetId,
        origin,
      ),
    /m17-legacy-bridge-origin-invalid/u,
  );
});

test('M-17 legacy bridge has fixed arguments, drops root before imports, and scrubs output', () => {
  const source = readFileSync(
    'scripts/operations/refresh-m17-powerschool-state-from-legacy.mjs',
    'utf8',
  );
  assert.match(source, /approvedOpenClawVersion = 'OpenClaw 2026\.6\.11/u);
  assert.match(
    source,
    /operatorHomeReference =\s*'\/etc\/chalkwright\/migration\/legacy-operator-home'/u,
  );
  assert.doesNotMatch(source, /\/home\/bren/u);
  assert.match(
    source,
    /Object\.keys\(window\.localStorage\)\.map\(\(key\) => \[key, window\.localStorage\.getItem\(key\)\]\)/u,
  );
  assert.doesNotMatch(
    source,
    /localStorage\.(?:setItem|removeItem|clear)|\bfetch\s*\(|XMLHttpRequest|WebSocket/iu,
  );
  assert.match(source, /'browser',\s*'--json',\s*'--browser-profile'/u);
  assert.match(source, /action === 'cookies'/u);
  assert.match(source, /action === 'local-storage-evaluation'/u);
  assert.match(source, /'evaluate',\s*'--fn',\s*localStorageEvaluation/u);
  assert.match(source, /resultOrigin !== powerSchoolOrigin/u);
  assert.match(source, /responseOrigin !== powerSchoolOrigin/u);
  assert.match(source, /envelope\.ok !== true/u);
  assert.match(source, /'cookies,ok,targetId'/u);
  assert.match(source, /setprivExecutable = '\/usr\/bin\/setpriv'/u);
  assert.match(source, /`--reuid=\$\{uid\}`/u);
  assert.match(source, /`--regid=\$\{gid\}`/u);
  assert.match(source, /'--clear-groups'/u);
  assert.match(source, /'--inh-caps=-all'/u);
  assert.match(source, /'--bounding-set=-all'/u);
  assert.match(source, /'--no-new-privs'/u);
  assert.match(source, /operator\.gid === 0/u);
  assert.match(source, /destination\.gid === 0/u);
  assert.match(source, /state\.nlink !== 1/u);
  assert.match(source, /state\.uid !== 0/u);
  assert.match(source, /state\.gid !== 0/u);
  assert.match(source, /\(state\.mode & 0o777\) !== 0o644/u);
  assert.match(source, /process\.setgroups\(\[\]\)/u);
  assert.match(source, /process\.setuid\(uid\)/u);
  assert.ok(
    source.indexOf('dropPrivileges(destination.uid, destination.gid)') <
      source.indexOf('await Promise.all'),
  );
  assert.match(source, /for \(const buffer of captured\) buffer\.fill\(0\)/u);
  assert.match(source, /result\.stderr\?\.fill\(0\)/u);
  assert.match(source, /acquirePowerSchoolSessionLock/u);
  assert.match(source, /writeFilteredPowerSchoolState/u);
  assert.doesNotMatch(source, /1password|op:\/\/|googleapis/iu);
  assert.doesNotMatch(source, /systemctl|tailscale|calendar/iu);
});
