import assert from 'node:assert/strict';
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { verifySystemdArtifacts } from '../../scripts/operations/verify-systemd.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..', '..');

test('verifies the repository systemd and cadence artifacts offline', () => {
  assert.deepEqual(verifySystemdArtifacts(repositoryRoot), {
    services: 7,
    inertTimerTemplates: 9,
    jobs: 10,
  });
});

test('rejects M-16 provider authority mixing, catch-up, cadence, and activation drift', () => {
  const cases = [
    {
      file: 'systemd/classroom-hub-production-plan-refresh.timer.in',
      from: 'Persistent=false',
      to: 'Persistent=true',
      expected: 'Persistent=false',
    },
    {
      file: 'systemd/classroom-hub-production-classroom-refresh.timer.in',
      from: 'OnActiveSec=30s',
      to: 'OnBootSec=30s',
      expected: 'OnActiveSec=30s',
    },
    {
      file: 'systemd/classroom-hub-production-plan-refresh.timer.in',
      from: 'Mon..Fri,Sun *-*-* 07:20:00 Asia/Ho_Chi_Minh',
      to: 'Mon..Fri *-*-* 06:20:00 Asia/Ho_Chi_Minh',
      expected: 'OnCalendar=',
    },
    {
      file: 'systemd/classroom-hub-production-classroom-refresh.service.in',
      from: '/etc/classroom-hub/jobs/production-classroom-refresh.env',
      to: '/etc/classroom-hub/jobs/production-plan-refresh.env',
      expected: 'EnvironmentFile=',
    },
    {
      file: 'systemd/classroom-hub-production-plan-refresh.service.in',
      from: '\n# Accepted policy candidate only.',
      to: '\n[Install]\nWantedBy=timers.target\n\n# Accepted policy candidate only.',
      expected: 'must not have [Install]',
    },
  ];
  for (const item of cases) {
    const fixture = copyFixture();
    try {
      replace(fixture, item.file, item.from, item.to);
      assert.throws(
        () => verifySystemdArtifacts(fixture),
        (error) =>
          error instanceof Error && error.message.includes(item.expected),
      );
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  }
});

test('fails closed when a service weakens loopback, environment, or execution boundaries', () => {
  for (const [label, from, to] of [
    [
      'non-loopback IP policy',
      'IPAddressAllow=localhost',
      'IPAddressAllow=any',
    ],
    [
      'ambient environment file',
      'Environment=NODE_ENV=production',
      'EnvironmentFile=/etc/classroom-hub/classroom-hub.env\nEnvironment=NODE_ENV=production',
    ],
    [
      'shell wrapper',
      '/usr/bin/node /opt/classroom-hub/dist/entrypoints/production-server.js',
      '/bin/sh -c npm start',
    ],
    [
      'provider path exposure',
      'InaccessiblePaths=-/etc/classroom-hub/providers',
      'InaccessiblePaths=',
    ],
    [
      'broad writable state',
      'ReadWritePaths=/var/lib/classroom-hub/production',
      'ReadWritePaths=/var/lib/classroom-hub',
    ],
  ]) {
    const fixture = copyFixture();
    try {
      replace(fixture, 'systemd/classroom-hub.service.in', from, to);
      assert.throws(
        () => verifySystemdArtifacts(fixture),
        (error) =>
          error instanceof Error &&
          error.message.includes(
            label === 'public bind'
              ? 'public/wildcard bind'
              : 'classroom-hub.service.in',
          ),
      );
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  }
});

test('rejects drift between the bounded registry, manifest, and timer templates', () => {
  const cases = [
    {
      file: 'systemd/cadence-manifest.json',
      from: '"operations-report"',
      to: '"unknown-job"',
      expected: 'bounded job names mismatch',
    },
    {
      file: 'systemd/classroom-hub-operations-report.timer.in',
      from: 'classroom-hub-job@operations-report.service',
      to: 'classroom-hub-job@alert-evaluate.service',
      expected: 'Unit=classroom-hub-job@operations-report.service',
    },
    {
      file: 'systemd/classroom-hub-sqlite-backup.timer.in',
      from: '{{ON_CALENDAR_PENDING_CONFIRMATION}} {{TIME_ZONE_PENDING_CONFIRMATION}}',
      to: '*-*-* 02:00:00',
      expected: 'OnCalendar=',
    },
  ];
  for (const item of cases) {
    const fixture = copyFixture();
    try {
      replace(fixture, item.file, item.from, item.to);
      assert.throws(
        () => verifySystemdArtifacts(fixture),
        (error) =>
          error instanceof Error && error.message.includes(item.expected),
      );
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  }
});

test('rejects activation-ready timers, install sections, secrets, and deferred-job timers', () => {
  const cases = [
    {
      mutate(fixture) {
        cpSync(
          join(fixture, 'systemd/classroom-hub-alert-evaluate.timer.in'),
          join(fixture, 'systemd/classroom-hub-alert-evaluate.timer'),
        );
      },
      expected: 'activation-ready timer files mismatch',
    },
    {
      mutate(fixture) {
        const file = 'systemd/classroom-hub-job@.service.in';
        replace(
          fixture,
          file,
          '\n# Validation template only',
          '\n[Install]\nWantedBy=multi-user.target\n\n# Validation template only',
        );
      },
      expected: 'must not have an [Install] section',
    },
    {
      mutate(fixture) {
        const file = 'systemd/classroom-hub.service.in';
        replace(
          fixture,
          file,
          'Environment=NODE_ENV=production',
          'Environment=NODE_ENV=production\nEnvironment=API_TOKEN=synthetic',
        );
      },
      expected: 'inline secret material',
    },
    {
      mutate(fixture) {
        const file = 'systemd/cadence-manifest.json';
        replace(
          fixture,
          file,
          '"name": "calendar-reconcile",\n      "implementation": "deferred-writer",\n      "schedule": "pending-confirmation",\n      "timerTemplate": null',
          '"name": "calendar-reconcile",\n      "implementation": "deferred-writer",\n      "schedule": "pending-confirmation",\n      "timerTemplate": "classroom-hub-calendar-reconcile.timer.in"',
        );
      },
      expected: 'gives a deferred integration a timer template',
    },
  ];

  for (const item of cases) {
    const fixture = copyFixture();
    try {
      item.mutate(fixture);
      assert.throws(
        () => verifySystemdArtifacts(fixture),
        (error) =>
          error instanceof Error && error.message.includes(item.expected),
      );
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  }
});

test('rejects an activation-ready service that launches the disposable fixture server', () => {
  const fixture = copyFixture();
  try {
    const pending = join(fixture, 'systemd/classroom-hub.service.in');
    const activationReady = join(fixture, 'systemd/classroom-hub.service');
    cpSync(pending, activationReady);
    replace(
      fixture,
      'systemd/classroom-hub.service',
      '/usr/bin/node /opt/classroom-hub/dist/entrypoints/production-server.js',
      '/usr/bin/npm start --silent',
    );
    assert.throws(
      () => verifySystemdArtifacts(fixture),
      (error) =>
        error instanceof Error &&
        error.message.includes('disposable fixture npm start server'),
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('rejects shadow service capability or hardening drift', () => {
  const cases = [
    {
      file: 'systemd/classroom-hub-shadow.service',
      from: 'EnvironmentFile=/etc/classroom-hub/shadow/server.env',
      to: 'EnvironmentFile=/etc/classroom-hub/shadow/refresh.env',
      expected: 'least-authority shadow environment',
    },
    {
      file: 'systemd/classroom-hub-shadow.service',
      from: 'User=classroom-hub',
      to: 'User=local-operator',
      expected: 'dedicated classroom-hub service account',
    },
    {
      file: 'systemd/classroom-hub-shadow.service',
      from: 'IPAddressDeny=any',
      to: 'IPAddressDeny=',
      expected: 'allow only loopback IP traffic',
    },
    {
      file: 'systemd/classroom-hub-shadow-backup.service',
      from: 'ProtectKernelTunables=true',
      to: 'ProtectKernelTunables=false',
      expected: 'ProtectKernelTunables=true',
    },
    {
      file: 'systemd/classroom-hub-shadow-refresh.service',
      from: 'RestrictNamespaces=user pid net',
      to: 'RestrictNamespaces=false',
      expected: 'RestrictNamespaces=user pid net',
    },
    {
      file: 'systemd/classroom-hub-shadow-refresh.service',
      from: 'RestrictNamespaces=user pid net',
      to: 'RestrictNamespaces=user pid net mnt',
      expected: 'exactly one RestrictNamespaces=user pid net',
    },
    {
      file: 'systemd/classroom-hub-shadow-refresh.service',
      from: 'RestrictNamespaces=user pid net',
      to: 'RestrictNamespaces=user pid net\nRestrictNamespaces=mnt',
      expected: 'exactly one RestrictNamespaces=user pid net',
    },
  ];
  for (const item of cases) {
    const fixture = copyFixture();
    try {
      replace(fixture, item.file, item.from, item.to);
      assert.throws(
        () => verifySystemdArtifacts(fixture),
        (error) =>
          error instanceof Error && error.message.includes(item.expected),
      );
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  }
});

function copyFixture() {
  const root = mkdtempSync(join(tmpdir(), 'classroom-hub-systemd-'));
  cpSync(join(repositoryRoot, 'systemd'), join(root, 'systemd'), {
    recursive: true,
  });
  return root;
}

function replace(root, relativePath, from, to) {
  const path = join(root, relativePath);
  const content = readFileSync(path, 'utf8');
  assert.ok(
    content.includes(from),
    `fixture source not found in ${relativePath}`,
  );
  writeFileSync(path, content.replace(from, to), 'utf8');
}
