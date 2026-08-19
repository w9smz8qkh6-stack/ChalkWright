import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  parseProtectedEnvironment,
  selectCopyEnvironment,
} from '../../scripts/operations/copy-m17-powerschool-state.mjs';

test('selects only routine PowerSchool settings for the privilege-dropped copy', () => {
  const parsed = parseProtectedEnvironment(
    'CLASSROOM_HUB_POWERSCHOOL_ROOM_ID="room-c509"\n' +
      'CLASSROOM_HUB_POWERSCHOOL_ORIGIN="https://synthetic.example"\n' +
      'CLASSROOM_HUB_POWERSCHOOL_STATUS_PATH="/teachers/home.html"\n' +
      'CLASSROOM_HUB_POWERSCHOOL_STATUS_READY_SELECTOR="body"\n' +
      'CLASSROOM_HUB_POWERSCHOOL_BELL_PATH_TEMPLATE="/teachers/aet_schedulebell.html?target_date={date-us}"\n' +
      'CLASSROOM_HUB_POWERSCHOOL_BELL_READY_SELECTOR="body"\n' +
      'CLASSROOM_HUB_POWERSCHOOL_SESSION_DIRECTORY="/var/lib/chalkwright/canary-powerschool-session"\n' +
      'UNRELATED_SECRET_REFERENCE="must-not-pass"\n',
  );
  const selected = selectCopyEnvironment(parsed);
  assert.equal(
    selected.CHALKWRIGHT_M17_POWERSCHOOL_SOURCE_DIRECTORY,
    '/var/lib/classroom-hub/powerschool-session',
  );
  assert.equal(selected.UNRELATED_SECRET_REFERENCE, undefined);
  assert.throws(() =>
    selectCopyEnvironment({
      ...parsed,
      CLASSROOM_HUB_POWERSCHOOL_SESSION_DIRECTORY:
        '/var/lib/classroom-hub/powerschool-session',
    }),
  );
});

test('launcher is fixed-path, drops privilege, and starts no service', () => {
  const source = readFileSync(
    'scripts/operations/copy-m17-powerschool-state.mjs',
    'utf8',
  );
  assert.match(source, /process\.setgid\(destination\.gid\)/u);
  assert.match(source, /process\.setuid\(destination\.uid\)/u);
  assert.match(source, /process\.setgroups\(\[\]\)/u);
  assert.ok(
    source.indexOf('process.setuid(destination.uid)') <
      source.indexOf('await import('),
  );
  assert.ok(
    source.indexOf('await import(') <
      source.indexOf('copyM17PowerSchoolState(environment)'),
  );
  assert.match(
    source,
    /file:\/\/\/opt\/chalkwright-canary\/current\/dist\/entrypoints\/m17-copy-powerschool-state\.js/u,
  );
  assert.match(source, /readlinkSync\(current\)/u);
  assert.match(source, /releases\/\$\{releaseSha256\}/u);
  assert.doesNotMatch(source, /\.\.\/\.\.\/dist/u);
  assert.match(source, /opened\.uid !== 0/u);
  assert.match(source, /opened\.gid !== 0/u);
  assert.match(source, /opened\.mode & 0o777/u);
  assert.doesNotMatch(
    source,
    /systemctl|systemd-run|child_process|execFile|execSync|spawn/u,
  );
});
