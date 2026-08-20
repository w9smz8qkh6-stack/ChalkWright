import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { runM17PowerSchoolRepair } from '../../src/entrypoints/m17-powerschool-repair.js';
import { writeNewProtectedJson } from '../../src/infrastructure/filesystem/protected-json.js';

function config(root: string) {
  return {
    version: 1,
    instanceId: 'chalkwright-c509-canary-production',
    roomId: 'room-c509',
    screenId: 'screen-c509-canary-production',
    screenLabel: 'C509 Classroom Display',
    host: '127.0.0.1',
    port: 4319,
    timeZone: 'Asia/Ho_Chi_Minh',
    academicYearEnd: '2027-06-30',
    managedRoot: join(root, 'canary-production'),
    databasePath: join(
      root,
      'canary-production',
      'state',
      'chalkwright.sqlite',
    ),
    backupDirectory: join(root, 'canary-production', 'backups'),
    operatorTokenReference: join(root, 'operator-token'),
    courseMappings: [
      {
        classId: 'class-c509',
        sectionCode: 'Synthetic C509',
        providerCourseKey: '123456789',
        attendanceClassCode: 'C509',
      },
    ],
    checkInOpenMinutesBefore: 5,
    dismissalWarningMinutesBefore: 5,
  };
}

test('invokes only the native persistent repair lane for the HCM local date', async () => {
  const root = mkdtempSync(join(tmpdir(), 'm17-native-repair-'));
  try {
    chmodSync(root, 0o700);
    const reference = join(root, 'server.json');
    writeNewProtectedJson(reference, config(root));
    let received: readonly string[] = [];
    const output = await runM17PowerSchoolRepair({
      arguments: [],
      environment: { CLASSROOM_HUB_PRODUCTION_CONFIG_REFERENCE: reference },
      now: () => '2026-08-14T17:30:00.000Z',
      supervisor: async (options) => {
        received = options.arguments;
        assert.equal(
          options.environment?.CLASSROOM_HUB_PRODUCTION_CONFIG_REFERENCE,
          reference,
        );
        return {
          exitCode: 0,
          result: { status: 'authenticated', phoneApprovalObserved: false },
        };
      },
    });
    assert.deepEqual(received, [
      '--operator-present',
      '--persistent-compatibility',
      '2026-08-15',
    ]);
    assert.deepEqual(output, {
      exitCode: 0,
      status: 'authenticated',
      phoneApprovalObserved: false,
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('fails closed before repair for arguments or invalid production policy', async () => {
  let calls = 0;
  const supervisor = async () => {
    calls += 1;
    return {
      exitCode: 0 as const,
      result: {
        status: 'authenticated' as const,
        phoneApprovalObserved: false,
      },
    };
  };
  assert.equal(
    (
      await runM17PowerSchoolRepair({
        arguments: ['2026-08-14'],
        environment: {},
        supervisor,
      })
    ).code,
    'm17-repair-usage-invalid',
  );
  assert.equal(
    (
      await runM17PowerSchoolRepair({
        arguments: [],
        environment: {},
        supervisor,
      })
    ).code,
    'm17-repair-config-invalid',
  );
  assert.equal(calls, 0);
});

test('accepts only a validated controller-supplied local date', async () => {
  let received: readonly string[] = [];
  const output = await runM17PowerSchoolRepair({
    arguments: [],
    environment: { CHALKWRIGHT_M17_REPAIR_DATE: '2026-08-15' },
    supervisor: async (options) => {
      received = options.arguments;
      return {
        exitCode: 0,
        result: { status: 'authenticated', phoneApprovalObserved: false },
      };
    },
  });
  assert.deepEqual(received, [
    '--operator-present',
    '--persistent-compatibility',
    '2026-08-15',
  ]);
  assert.equal(output.status, 'authenticated');
  assert.equal(
    (
      await runM17PowerSchoolRepair({
        arguments: [],
        environment: { CHALKWRIGHT_M17_REPAIR_DATE: 'invalid' },
      })
    ).code,
    'm17-repair-config-invalid',
  );
});

test('retains only a finite policy reason from a failed repair', async () => {
  const output = await runM17PowerSchoolRepair({
    arguments: [],
    environment: { CHALKWRIGHT_M17_REPAIR_DATE: '2026-08-15' },
    supervisor: async () => ({
      exitCode: 1,
      result: {
        status: 'failed',
        code: 'repair-policy-violation',
        policyReason: 'powerschool-method-blocked',
      },
    }),
  });
  assert.deepEqual(output, {
    exitCode: 1,
    status: 'failed',
    code: 'repair-policy-violation-powerschool-method-blocked',
  });
});

test('installed-release symlink invocation executes the repair entrypoint', () => {
  const root = mkdtempSync(join(tmpdir(), 'm17-repair-entrypoint-link-'));
  try {
    chmodSync(root, 0o755);
    const link = join(root, 'm17-powerschool-repair.js');
    symlinkSync(
      fileURLToPath(
        new URL(
          '../../src/entrypoints/m17-powerschool-repair.js',
          import.meta.url,
        ),
      ),
      link,
    );
    const result = spawnSync(process.execPath, [link], {
      encoding: 'utf8',
      env: { NODE_ENV: 'test' },
      timeout: 5_000,
    });
    assert.equal(result.status, 64, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      exitCode: 64,
      status: 'rejected',
      code: 'm17-repair-config-invalid',
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
