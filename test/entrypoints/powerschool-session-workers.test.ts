import assert from 'node:assert/strict';
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import type { ScheduleObservation } from '../../src/contracts/v1/schedule.js';
import { powerSchoolJitHeadlessEnvironmentName } from '../../src/config/powerschool-repair.js';
import { runPowerSchoolJitRepairWorker } from '../../src/entrypoints/powerschool-jit-repair-child.js';
import { runPowerSchoolJitRepairSupervisor } from '../../src/entrypoints/powerschool-jit-repair.js';
import { runPowerSchoolBellWorker } from '../../src/entrypoints/powerschool-bell-collector-child.js';
import { runPowerSchoolBellSupervisor } from '../../src/entrypoints/powerschool-bell-collector.js';
import { runPowerSchoolCompatibilityBellWorker } from '../../src/entrypoints/powerschool-compatibility-bell-collector-child.js';
import { runPowerSchoolCompatibilityBellSupervisor } from '../../src/entrypoints/powerschool-compatibility-bell-collector.js';
import { runPowerSchoolBootstrapWorker } from '../../src/entrypoints/powerschool-session-bootstrap-child.js';
import { runPowerSchoolBootstrapSupervisor } from '../../src/entrypoints/powerschool-session-bootstrap.js';
import { powerSchoolOnePasswordServiceAccountEnvironmentName } from '../../src/infrastructure/one-password/service-account-authority.js';
import { encodePowerSchoolRepairSecretPacket } from '../../src/infrastructure/powerschool-session/repair-secret-packet.js';
import { runQuiescentChild } from '../../src/infrastructure/process/quiescent-child.js';

function routineEnvironment(): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    CLASSROOM_HUB_POWERSCHOOL_ROOM_ID: 'room-synthetic',
    CLASSROOM_HUB_POWERSCHOOL_ORIGIN: 'https://powerschool.invalid',
    CLASSROOM_HUB_POWERSCHOOL_STATUS_PATH: '/teachers/home.html',
    CLASSROOM_HUB_POWERSCHOOL_STATUS_READY_SELECTOR: '#status-ready',
    CLASSROOM_HUB_POWERSCHOOL_BELL_PATH_TEMPLATE:
      '/teachers/aet_schedulebell.html?target_date={date-us}',
    CLASSROOM_HUB_POWERSCHOOL_BELL_READY_SELECTOR: '#bell-ready',
    CLASSROOM_HUB_POWERSCHOOL_SESSION_DIRECTORY:
      '/tmp/classroom-hub-m07c-worker-session',
    CLASSROOM_HUB_POWERSCHOOL_GOOGLE_PASSWORD: 'must-be-scrubbed',
    CLASSROOM_HUB_POWERSCHOOL_IDENTITY_ORIGIN: 'https://accounts.google.com',
    OP_SERVICE_ACCOUNT_TOKEN: 'must-be-scrubbed',
  };
}

function bootstrapEnvironment(): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    DISPLAY: ':99',
    ...routineEnvironment(),
    CLASSROOM_HUB_POWERSCHOOL_IDENTITY_ORIGIN: 'https://accounts.google.com',
  };
}

function compatibilityEnvironment(): NodeJS.ProcessEnv {
  return {
    ...bootstrapEnvironment(),
    CLASSROOM_HUB_POWERSCHOOL_COMPATIBILITY_PROFILE_DIRECTORY:
      '/tmp/classroom-hub-m07c-compatibility-profile',
  };
}

function repairReference(directory: string): string {
  mkdirSync(directory, { mode: 0o700 });
  chmodSync(directory, 0o700);
  const path = join(directory, 'repair-references.json');
  writeFileSync(
    path,
    JSON.stringify({
      version: 1,
      usernameReference: 'op://Synthetic/Google/username',
      passwordReference: 'op://Synthetic/Google/password',
      totpReference: 'op://Synthetic/Google/one-time password?attribute=otp',
    }),
    { mode: 0o600 },
  );
  return path;
}

const observation: ScheduleObservation = {
  contractVersion: '1.0.0',
  observationId: 'schedule-synthetic',
  observedForDate: '2035-04-13',
  kind: 'normal',
  verification: 'verified',
  periods: [],
  provenance: {
    source: 'powerschool',
    method: 'browser-read',
    observedAt: '2035-04-13T07:00:00.000Z',
    verification: 'verified',
    sourceReference: 'powerschool-bell-schedule',
  },
  freshness: {
    state: 'fresh',
    observedAt: '2035-04-13T07:00:00.000Z',
  },
  diagnostics: [],
};

test('routine worker scrubs forbidden authority before constructing a source', async () => {
  const environment = routineEnvironment();
  const result = await runPowerSchoolBellWorker({
    arguments: ['2035-04-13'],
    environment,
    sourceFactory: ({ config, environment: childEnvironment }) => {
      assert.equal(config.overallTimeoutMs, 115_000);
      assert.equal('identityOrigin' in config, false);
      assert.equal(
        'CLASSROOM_HUB_POWERSCHOOL_GOOGLE_PASSWORD' in childEnvironment,
        false,
      );
      assert.equal('OP_SERVICE_ACCOUNT_TOKEN' in childEnvironment, false);
      return {
        readSchedule: async () => ({ status: 'observed', observation }),
      };
    },
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.result?.status, 'observed');
});

test('persistent compatibility worker retains only browser-session authority', async () => {
  const environment = compatibilityEnvironment();
  environment.CLASSROOM_HUB_POWERSCHOOL_REPAIR_REFERENCE =
    '/tmp/must-not-reach-compatibility-worker';
  const result = await runPowerSchoolCompatibilityBellWorker({
    arguments: ['2035-04-13'],
    environment,
    sourceFactory: ({ config, environment: childEnvironment }) => {
      assert.equal(config.overallTimeoutMs, 115_000);
      assert.equal(
        config.persistentProfileDirectory,
        '/tmp/classroom-hub-m07c-compatibility-profile',
      );
      assert.equal(
        'CLASSROOM_HUB_POWERSCHOOL_REPAIR_REFERENCE' in childEnvironment,
        false,
      );
      assert.equal(
        'CLASSROOM_HUB_POWERSCHOOL_GOOGLE_PASSWORD' in childEnvironment,
        false,
      );
      assert.equal('OP_SERVICE_ACCOUNT_TOKEN' in childEnvironment, false);
      return {
        readSchedule: async () => ({ status: 'observed', observation }),
      };
    },
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.result?.status, 'observed');
});

test('persistent compatibility supervisor forwards only its fixed environment', async () => {
  const controller = new AbortController();
  const result = await runPowerSchoolCompatibilityBellSupervisor({
    arguments: ['2035-04-13'],
    environment: compatibilityEnvironment(),
    signal: controller.signal,
    childRunner: async (options) => {
      assert.equal(options.deadlineMs, 120_000);
      assert.equal(options.terminationGraceMs, 2_000);
      assert.equal(options.signal, controller.signal);
      assert.equal(
        options.environment
          .CLASSROOM_HUB_POWERSCHOOL_COMPATIBILITY_PROFILE_DIRECTORY,
        '/tmp/classroom-hub-m07c-compatibility-profile',
      );
      assert.equal(
        'CLASSROOM_HUB_POWERSCHOOL_GOOGLE_PASSWORD' in options.environment,
        false,
      );
      assert.equal('OP_SERVICE_ACCOUNT_TOKEN' in options.environment, false);
      return {
        status: 'completed',
        output: JSON.stringify({
          exitCode: 0,
          result: { status: 'observed', observation },
        }),
      };
    },
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.result?.status, 'observed');
});

test('manual worker accepts no credential authority or automation input', async () => {
  const environment = bootstrapEnvironment();
  const result = await runPowerSchoolBootstrapWorker({
    arguments: ['2035-04-13'],
    environment,
    bootstrap: async ({ config, browserEnvironment }) => {
      assert.equal(config.overallTimeoutMs, 295_000);
      assert.equal(config.identityOrigin, 'https://accounts.google.com');
      assert.equal(
        'CLASSROOM_HUB_POWERSCHOOL_GOOGLE_PASSWORD' in browserEnvironment!,
        false,
      );
      assert.equal('OP_SERVICE_ACCOUNT_TOKEN' in browserEnvironment!, false);
      return { status: 'authenticated' };
    },
  });
  assert.deepEqual(result, {
    exitCode: 0,
    result: { status: 'authenticated' },
  });
});

test('routine supervisor passes only the fixed passive environment to its process group', async () => {
  const controller = new AbortController();
  const result = await runPowerSchoolBellSupervisor({
    arguments: ['2035-04-13'],
    environment: routineEnvironment(),
    signal: controller.signal,
    childRunner: async (options) => {
      assert.equal(options.deadlineMs, 120_000);
      assert.equal(options.signal, controller.signal);
      assert.equal(
        'CLASSROOM_HUB_POWERSCHOOL_IDENTITY_ORIGIN' in options.environment,
        false,
      );
      assert.equal(
        'CLASSROOM_HUB_POWERSCHOOL_GOOGLE_PASSWORD' in options.environment,
        false,
      );
      assert.equal('OP_SERVICE_ACCOUNT_TOKEN' in options.environment, false);
      assert.equal(options.arguments.length, 2);
      return {
        status: 'completed',
        output: JSON.stringify({
          exitCode: 3,
          result: {
            status: 'repair-required',
            error: {
              category: 'authentication-repair-required',
              code: 'session-state-missing',
              message: 'Repair required.',
              retryable: false,
              diagnostics: [],
            },
          },
        }),
      };
    },
  });
  assert.equal(result.exitCode, 3);
  assert.equal(result.result?.status, 'repair-required');
});

test('bootstrap supervisor forwards desktop state but no secret authority', async () => {
  const controller = new AbortController();
  const result = await runPowerSchoolBootstrapSupervisor({
    arguments: ['2035-04-13'],
    environment: bootstrapEnvironment(),
    signal: controller.signal,
    childRunner: async (options) => {
      assert.equal(options.deadlineMs, 300_000);
      assert.equal(options.signal, controller.signal);
      assert.equal(options.environment.DISPLAY, ':99');
      assert.equal(
        options.environment.CLASSROOM_HUB_POWERSCHOOL_IDENTITY_ORIGIN,
        'https://accounts.google.com',
      );
      assert.equal(
        'CLASSROOM_HUB_POWERSCHOOL_GOOGLE_PASSWORD' in options.environment,
        false,
      );
      assert.equal('OP_SERVICE_ACCOUNT_TOKEN' in options.environment, false);
      return {
        status: 'completed',
        output: JSON.stringify({
          exitCode: 0,
          result: { status: 'authenticated' },
        }),
      };
    },
  });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.result, { status: 'authenticated' });
});

test('JIT repair worker decodes only its bounded packet and scrubs ambient authority', async () => {
  const packet = encodePowerSchoolRepairSecretPacket({
    username: Buffer.from('teacher@example.invalid'),
    password: Buffer.from('synthetic-password'),
    totp: Buffer.from('123456'),
  });
  const environment = bootstrapEnvironment();
  environment.CLASSROOM_HUB_POWERSCHOOL_REPAIR_REFERENCE =
    '/tmp/must-not-reach-worker';
  environment[powerSchoolJitHeadlessEnvironmentName] = '0';
  const result = await runPowerSchoolJitRepairWorker({
    arguments: ['2035-04-13'],
    packet,
    environment,
    repair: async ({ config, credentials, browserEnvironment, headless }) => {
      assert.equal(config.overallTimeoutMs, 295_000);
      assert.equal(headless, false);
      assert.deepEqual(credentials, {
        username: 'teacher@example.invalid',
        password: 'synthetic-password',
        totp: '123456',
      });
      assert.equal(
        'CLASSROOM_HUB_POWERSCHOOL_REPAIR_REFERENCE' in browserEnvironment!,
        false,
      );
      assert.equal('OP_SERVICE_ACCOUNT_TOKEN' in browserEnvironment!, false);
      assert.equal(
        powerSchoolJitHeadlessEnvironmentName in browserEnvironment!,
        false,
      );
      return { status: 'authenticated', phoneApprovalObserved: false };
    },
  });
  assert.equal(
    packet.every((byte) => byte === 0),
    true,
  );
  assert.deepEqual(result, {
    exitCode: 0,
    result: { status: 'authenticated', phoneApprovalObserved: false },
  });
});

test('JIT repair worker can target the persistent compatibility profile without exposing its setting to Chrome', async () => {
  const packet = encodePowerSchoolRepairSecretPacket({
    username: Buffer.from('teacher@example.invalid'),
    password: Buffer.from('synthetic-password'),
    totp: Buffer.from('123456'),
  });
  const result = await runPowerSchoolJitRepairWorker({
    arguments: ['--persistent-compatibility', '2035-04-13'],
    packet,
    environment: compatibilityEnvironment(),
    repair: async ({ persistentProfileDirectory, browserEnvironment }) => {
      assert.equal(
        persistentProfileDirectory,
        '/tmp/classroom-hub-m07c-compatibility-profile',
      );
      assert.equal(
        'CLASSROOM_HUB_POWERSCHOOL_COMPATIBILITY_PROFILE_DIRECTORY' in
          browserEnvironment!,
        false,
      );
      return { status: 'authenticated', phoneApprovalObserved: false };
    },
  });
  assert.equal(
    packet.every((byte) => byte === 0),
    true,
  );
  assert.equal(result.exitCode, 0);
});

test('JIT repair supervisor requires presence confirmation and sends secrets only through stdin', async () => {
  const parent = mkdtempSync(join(tmpdir(), 'jit-repair-supervisor-'));
  try {
    const serviceAccountDirectory = join(parent, 'service-account');
    mkdirSync(serviceAccountDirectory, { mode: 0o700 });
    const serviceAccountPath = join(serviceAccountDirectory, 'legacy-op.env');
    const serviceAccountValue = `ops_${'Synthetic0123456789'.repeat(4)}`;
    writeFileSync(
      serviceAccountPath,
      `OP_SERVICE_ACCOUNT_TOKEN=${serviceAccountValue}\n`,
      { mode: 0o600 },
    );
    const environment: NodeJS.ProcessEnv = {
      ...bootstrapEnvironment(),
      CLASSROOM_HUB_POWERSCHOOL_SESSION_DIRECTORY: join(parent, 'session'),
      CLASSROOM_HUB_POWERSCHOOL_COMPATIBILITY_PROFILE_DIRECTORY: join(
        parent,
        'compatibility-profile',
      ),
      CLASSROOM_HUB_POWERSCHOOL_REPAIR_REFERENCE: repairReference(
        join(parent, 'config'),
      ),
      [powerSchoolOnePasswordServiceAccountEnvironmentName]: serviceAccountPath,
    };
    let secretReads = 0;
    let observedServiceAccountToken: Buffer | undefined;
    assert.deepEqual(
      await runPowerSchoolJitRepairSupervisor({
        arguments: ['2035-04-13'],
        environment,
        secretReader: async () => {
          secretReads += 1;
          throw new Error('must-not-run');
        },
      }),
      { exitCode: 64, errorCode: 'repair-usage-invalid' },
    );
    assert.equal(secretReads, 0);

    const invalidDisplayMode = await runPowerSchoolJitRepairSupervisor({
      arguments: ['--operator-present', '2035-04-13'],
      environment: {
        ...environment,
        [powerSchoolJitHeadlessEnvironmentName]: 'headed',
      },
      secretReader: async () => {
        secretReads += 1;
        throw new Error('must-not-run');
      },
    });
    assert.deepEqual(invalidDisplayMode, {
      exitCode: 64,
      errorCode: 'repair-config-invalid',
    });
    assert.equal(secretReads, 0);

    const result = await runPowerSchoolJitRepairSupervisor({
      arguments: ['--operator-present', '2035-04-13'],
      environment,
      secretReader: async ({ references, serviceAccountToken }) => {
        secretReads += 1;
        assert.ok(serviceAccountToken);
        observedServiceAccountToken = serviceAccountToken;
        assert.equal(
          serviceAccountToken.toString('ascii'),
          serviceAccountValue,
        );
        assert.equal(
          references.usernameReference,
          'op://Synthetic/Google/username',
        );
        await new Promise<void>((resolve) => setTimeout(resolve, 20));
        return {
          username: Buffer.from('teacher@example.invalid'),
          password: Buffer.from('synthetic-password'),
          totp: Buffer.from('123456'),
        };
      },
      childRunner: async (options) => {
        assert.ok(options.deadlineMs <= 300_000);
        assert.ok(options.deadlineMs < 299_990);
        assert.ok(options.deadlineMs > 295_000);
        assert.equal(options.terminationGraceMs, 2_000);
        assert.equal(
          options.environment
            .CLASSROOM_HUB_POWERSCHOOL_BOOTSTRAP_TIMEOUT_SECONDS,
          '299',
        );
        assert.equal(options.arguments.length, 2);
        assert.equal(
          options.arguments.some((argument) =>
            /teacher|synthetic-password|123456/u.test(argument),
          ),
          false,
        );
        assert.equal(
          'CLASSROOM_HUB_POWERSCHOOL_REPAIR_REFERENCE' in options.environment,
          false,
        );
        assert.equal(
          'CLASSROOM_HUB_POWERSCHOOL_COMPATIBILITY_PROFILE_DIRECTORY' in
            options.environment,
          false,
        );
        assert.equal(
          powerSchoolOnePasswordServiceAccountEnvironmentName in
            options.environment,
          false,
        );
        assert.equal('OP_SERVICE_ACCOUNT_TOKEN' in options.environment, false);
        assert.equal(
          options.environment[powerSchoolJitHeadlessEnvironmentName],
          '1',
        );
        assert.ok(options.input);
        options.input.fill(0);
        return {
          status: 'completed',
          output: JSON.stringify({
            exitCode: 0,
            result: {
              status: 'authenticated',
              phoneApprovalObserved: false,
            },
          }),
        };
      },
    });
    assert.equal(secretReads, 1);
    assert.ok(observedServiceAccountToken);
    assert.equal(
      observedServiceAccountToken.every((byte) => byte === 0),
      true,
    );
    assert.deepEqual(result, {
      exitCode: 0,
      result: { status: 'authenticated', phoneApprovalObserved: false },
    });

    environment[powerSchoolJitHeadlessEnvironmentName] = '0';
    const headedResult = await runPowerSchoolJitRepairSupervisor({
      arguments: ['--operator-present', '2035-04-13'],
      environment,
      secretReader: async () => ({
        username: Buffer.from('teacher@example.invalid'),
        password: Buffer.from('synthetic-password'),
        totp: Buffer.from('123456'),
      }),
      childRunner: async (options) => {
        assert.equal(
          options.environment[powerSchoolJitHeadlessEnvironmentName],
          '0',
        );
        options.input?.fill(0);
        return {
          status: 'completed',
          output: JSON.stringify({
            exitCode: 0,
            result: { status: 'authenticated', phoneApprovalObserved: false },
          }),
        };
      },
    });
    assert.equal(headedResult.exitCode, 0);
    delete environment[powerSchoolJitHeadlessEnvironmentName];

    const persistentResult = await runPowerSchoolJitRepairSupervisor({
      arguments: [
        '--operator-present',
        '--persistent-compatibility',
        '2035-04-13',
      ],
      environment,
      secretReader: async () => {
        secretReads += 1;
        return {
          username: Buffer.from('teacher@example.invalid'),
          password: Buffer.from('synthetic-password'),
          totp: Buffer.from('123456'),
        };
      },
      childRunner: async (options) => {
        assert.deepEqual(options.arguments.slice(1), [
          '--persistent-compatibility',
          '2035-04-13',
        ]);
        assert.equal(
          options.environment
            .CLASSROOM_HUB_POWERSCHOOL_COMPATIBILITY_PROFILE_DIRECTORY,
          join(parent, 'compatibility-profile'),
        );
        assert.equal(
          'CLASSROOM_HUB_POWERSCHOOL_REPAIR_REFERENCE' in options.environment,
          false,
        );
        assert.equal('OP_SERVICE_ACCOUNT_TOKEN' in options.environment, false);
        options.input?.fill(0);
        return {
          status: 'completed',
          output: JSON.stringify({
            exitCode: 0,
            result: {
              status: 'authenticated',
              phoneApprovalObserved: false,
            },
          }),
        };
      },
    });
    assert.equal(secretReads, 2);
    assert.equal(persistentResult.exitCode, 0);

    const diagnostic = await runPowerSchoolJitRepairSupervisor({
      arguments: ['--operator-present', '2035-04-13'],
      environment,
      secretReader: async () => ({
        username: Buffer.from('teacher@example.invalid'),
        password: Buffer.from('synthetic-password'),
        totp: Buffer.from('123456'),
      }),
      childRunner: async (options) => {
        options.input?.fill(0);
        return {
          status: 'completed',
          output: JSON.stringify({
            exitCode: 1,
            result: {
              status: 'failed',
              code: 'unexpected-challenge',
              challengeCategory: 'browser-rejected',
            },
          }),
        };
      },
    });
    assert.deepEqual(diagnostic, {
      exitCode: 1,
      result: {
        status: 'failed',
        code: 'unexpected-challenge',
        challengeCategory: 'browser-rejected',
      },
    });

    const policyDiagnostic = await runPowerSchoolJitRepairSupervisor({
      arguments: ['--operator-present', '2035-04-13'],
      environment,
      secretReader: async () => ({
        username: Buffer.from('teacher@example.invalid'),
        password: Buffer.from('synthetic-password'),
        totp: Buffer.from('123456'),
      }),
      childRunner: async (options) => {
        options.input?.fill(0);
        return {
          status: 'completed',
          output: JSON.stringify({
            exitCode: 1,
            result: {
              status: 'failed',
              code: 'repair-policy-violation',
              policyReason: 'powerschool-method-blocked',
            },
          }),
        };
      },
    });
    assert.deepEqual(policyDiagnostic, {
      exitCode: 1,
      result: {
        status: 'failed',
        code: 'repair-policy-violation',
        policyReason: 'powerschool-method-blocked',
      },
    });

    const malformedDiagnostic = await runPowerSchoolJitRepairSupervisor({
      arguments: ['--operator-present', '2035-04-13'],
      environment,
      secretReader: async () => ({
        username: Buffer.from('teacher@example.invalid'),
        password: Buffer.from('synthetic-password'),
        totp: Buffer.from('123456'),
      }),
      childRunner: async (options) => {
        options.input?.fill(0);
        return {
          status: 'completed',
          output: JSON.stringify({
            exitCode: 1,
            result: {
              status: 'failed',
              code: 'unexpected-challenge',
            },
          }),
        };
      },
    });
    assert.deepEqual(malformedDiagnostic, {
      exitCode: 1,
      result: { status: 'failed', code: 'browser-unavailable' },
    });
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test('real JIT child preserves a sanitized non-success envelope over IPC', async () => {
  const parent = mkdtempSync(join(tmpdir(), 'jit-repair-child-ipc-'));
  try {
    const worker = fileURLToPath(
      new URL(
        '../../src/entrypoints/powerschool-jit-repair-child.js',
        import.meta.url,
      ),
    );
    const packet = Buffer.from('{}');
    const result = await runQuiescentChild({
      executable: process.execPath,
      arguments: [worker, '2035-04-13'],
      cwd: process.cwd(),
      environment: {
        ...bootstrapEnvironment(),
        CLASSROOM_HUB_POWERSCHOOL_SESSION_DIRECTORY: join(parent, 'session'),
      } as Record<string, string>,
      deadlineMs: 10_000,
      terminationGraceMs: 1_000,
      input: packet,
    });
    assert.deepEqual(result, {
      status: 'completed',
      output: JSON.stringify({
        exitCode: 64,
        errorCode: 'repair-input-invalid',
      }),
    });
    assert.equal(
      packet.every((byte) => byte === 0),
      true,
    );
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test('invalid date is rejected before environment access', async () => {
  const throwingEnvironment = new Proxy(
    {},
    { get: () => assert.fail('environment must not be read') },
  );
  assert.deepEqual(
    await runPowerSchoolBellSupervisor({
      arguments: ['not-a-date'],
      environment: throwingEnvironment,
    }),
    { exitCode: 64, errorCode: 'collector-usage-invalid' },
  );
});

test('real supervised child preserves a sanitized repair-required result', async () => {
  const parent = mkdtempSync(join(tmpdir(), 'm07c-worker-spawn-'));
  try {
    const result = await runPowerSchoolBellSupervisor({
      arguments: ['2035-04-13'],
      environment: {
        ...routineEnvironment(),
        CLASSROOM_HUB_POWERSCHOOL_SESSION_DIRECTORY: join(parent, 'session'),
      },
    });
    assert.equal(result.exitCode, 3);
    assert.equal(result.result?.status, 'repair-required');
    if (result.result?.status === 'repair-required') {
      assert.equal(result.result.error.code, 'session-state-missing');
    }
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});
