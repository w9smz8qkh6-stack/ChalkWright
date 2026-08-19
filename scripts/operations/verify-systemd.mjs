import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const EXPECTED_JOB_NAMES = [
  'source-auth-preflight',
  'classroom-refresh',
  'calendar-reconcile',
  'operations-report',
  'alert-evaluate',
  'brief-morning',
  'brief-evening',
  'sqlite-backup',
  'sqlite-integrity',
  'state-retention',
];

const EXPECTED_ACTIVATION_READY_SERVICES = [
  'classroom-hub-shadow-backup.service',
  'classroom-hub-shadow-refresh.service',
  'classroom-hub-shadow.service',
];
const EXPECTED_ACTIVATION_READY_TIMERS = ['classroom-hub-shadow-refresh.timer'];
const EXPECTED_PENDING_SERVICE_TEMPLATES = [
  'classroom-hub-job@.service.in',
  'classroom-hub-production-classroom-refresh.service.in',
  'classroom-hub-production-plan-refresh.service.in',
  'classroom-hub.service.in',
];
const M16_TIMER_TEMPLATES = [
  'classroom-hub-production-classroom-refresh.timer.in',
  'classroom-hub-production-plan-refresh.timer.in',
];

const REQUIRED_HARDENING = {
  NoNewPrivileges: 'true',
  PrivateDevices: 'true',
  PrivateTmp: 'true',
  ProtectClock: 'true',
  ProtectControlGroups: 'true',
  ProtectHome: 'true',
  ProtectHostname: 'true',
  ProtectKernelLogs: 'true',
  ProtectKernelModules: 'true',
  ProtectKernelTunables: 'true',
  ProtectSystem: 'strict',
  RestrictNamespaces: 'true',
  RestrictRealtime: 'true',
  RestrictSUIDSGID: 'true',
};

const REQUIRED_SHADOW_HARDENING = {
  ...REQUIRED_HARDENING,
  ProtectHome: 'read-only',
};

const SHADOW_SERVER_ENVIRONMENT = '/etc/classroom-hub/shadow/server.env';
const SHADOW_REFRESH_ENVIRONMENT = '/etc/classroom-hub/shadow/refresh.env';
const SHADOW_PROVIDER_PATHS = [
  SHADOW_REFRESH_ENVIRONMENT,
  '/etc/classroom-hub/shadow/legacy.env',
  '/etc/classroom-hub/providers/google-classroom/authorized-user.json',
  '/var/lib/classroom-hub/powerschool-session',
];

const REQUIRED_ENVIRONMENT_FILE = '/etc/classroom-hub/classroom-hub.env';
const PRODUCTION_CONFIG_ENVIRONMENT =
  'CLASSROOM_HUB_PRODUCTION_CONFIG_REFERENCE=/etc/classroom-hub/server/production-server.json';
const PRODUCTION_SERVER_COMMAND =
  '/usr/bin/node /opt/classroom-hub/dist/entrypoints/production-server.js';
const REQUIRED_LOOPBACK_ENVIRONMENT = 'CLASSROOM_HUB_HOST=127.0.0.1';
const REQUIRED_SCHEDULE_PLACEHOLDER =
  '{{ON_CALENDAR_PENDING_CONFIRMATION}} {{TIME_ZONE_PENDING_CONFIRMATION}}';
const REQUIRED_JOB_PLACEHOLDER =
  '{{CLASSROOM_HUB_BOUNDED_JOB_COMMAND_PENDING}}';
const REQUIRED_PERSISTENT_PLACEHOLDER = '{{PERSISTENT_PENDING_CONFIRMATION}}';
const REQUIRED_RUNTIME_MAX_PLACEHOLDER =
  '{{RUNTIME_MAX_SEC_PENDING_CONFIRMATION}}';

export function verifySystemdArtifacts(repositoryRoot) {
  const systemdDirectory = join(resolve(repositoryRoot), 'systemd');
  const errors = [];
  const fail = (message) => errors.push(message);
  const files = readdirSync(systemdDirectory).sort();
  const serviceFiles = files.filter((name) => name.endsWith('.service'));
  const pendingServiceTemplates = files.filter((name) =>
    name.endsWith('.service.in'),
  );
  const timerFiles = files.filter((name) => name.endsWith('.timer'));
  const timerTemplates = files.filter((name) => name.endsWith('.timer.in'));

  for (const file of serviceFiles) {
    const content = readFileSync(join(systemdDirectory, file), 'utf8');
    if (/^ExecStart=\/usr\/bin\/npm start(?:\s|$)/mu.test(content)) {
      fail(`${file} must not activate the disposable fixture npm start server`);
    }
  }
  equalList(
    serviceFiles,
    EXPECTED_ACTIVATION_READY_SERVICES,
    'activation-ready service templates',
    fail,
  );
  equalList(
    pendingServiceTemplates,
    EXPECTED_PENDING_SERVICE_TEMPLATES,
    'pending service templates',
    fail,
  );
  equalList(
    timerFiles,
    EXPECTED_ACTIVATION_READY_TIMERS,
    'activation-ready timer files',
    fail,
  );

  verifyShadowArtifacts(systemdDirectory, fail);

  const manifestPath = join(systemdDirectory, 'cadence-manifest.json');
  const manifest = readJson(manifestPath, fail);
  if (manifest !== undefined) {
    verifyManifest(
      manifest,
      timerTemplates.filter((name) => !M16_TIMER_TEMPLATES.includes(name)),
      fail,
    );
  }
  const m16Manifest = readJson(
    join(systemdDirectory, 'm16-production-cadence-manifest.json'),
    fail,
  );
  if (m16Manifest !== undefined)
    verifyM16ProductionArtifacts(systemdDirectory, m16Manifest, fail);
  verifyPermanentProductionArtifacts(systemdDirectory, fail);

  const service = readUnit(
    join(systemdDirectory, 'classroom-hub.service.in'),
    fail,
  );
  if (service !== undefined) {
    verifyService(
      service,
      {
        file: 'classroom-hub.service.in',
        templateStatus: 'pending-m16-approval',
        descriptionPrefix: 'INERT pending M-16 ',
        type: 'exec',
        execStart: PRODUCTION_SERVER_COMMAND,
        environmentFile: undefined,
        requiredEnvironments: [
          'NODE_ENV=production',
          PRODUCTION_CONFIG_ENVIRONMENT,
        ],
        restart: 'on-failure',
        runtimeMaxSec: undefined,
        addressFamilies: 'AF_UNIX AF_INET AF_INET6',
        readWritePaths: '/var/lib/classroom-hub/production',
        inaccessiblePaths: '-/etc/classroom-hub/providers',
        loopbackIpOnly: true,
      },
      fail,
    );
  }

  const jobService = readUnit(
    join(systemdDirectory, 'classroom-hub-job@.service.in'),
    fail,
  );
  if (jobService !== undefined) {
    verifyService(
      jobService,
      {
        file: 'classroom-hub-job@.service.in',
        templateStatus: 'pending-confirmation',
        descriptionPrefix: 'INERT pending ',
        type: 'oneshot',
        execStart: REQUIRED_JOB_PLACEHOLDER,
        environmentFile: REQUIRED_ENVIRONMENT_FILE,
        requiredEnvironments: [
          'NODE_ENV=production',
          REQUIRED_LOOPBACK_ENVIRONMENT,
        ],
        restart: undefined,
        runtimeMaxSec: REQUIRED_RUNTIME_MAX_PLACEHOLDER,
        addressFamilies: 'AF_UNIX',
        readWritePaths: '/var/lib/classroom-hub',
        inaccessiblePaths: undefined,
        loopbackIpOnly: false,
      },
      fail,
    );
  }

  if (manifest !== undefined && Array.isArray(manifest.jobs)) {
    for (const job of manifest.jobs) {
      if (!isRecord(job) || typeof job.timerTemplate !== 'string') continue;
      const timer = readUnit(join(systemdDirectory, job.timerTemplate), fail);
      if (timer !== undefined) verifyTimer(timer, job, manifest, fail);
    }
  }

  for (const file of files) {
    if (
      !file.endsWith('.service') &&
      !file.endsWith('.service.in') &&
      !file.endsWith('.timer') &&
      !file.endsWith('.timer.in')
    ) {
      continue;
    }
    const content = readFileSync(join(systemdDirectory, file), 'utf8');
    verifyForbiddenContent(file, content, fail);
  }

  if (errors.length > 0) {
    throw new Error(
      `systemd artifact verification failed:\n${errors
        .map((error) => `- ${error}`)
        .join('\n')}`,
    );
  }

  return Object.freeze({
    services: serviceFiles.length + pendingServiceTemplates.length,
    inertTimerTemplates: timerTemplates.length,
    jobs: EXPECTED_JOB_NAMES.length,
  });
}

function verifyPermanentProductionArtifacts(directory, fail) {
  const production = join(directory, 'production');
  const expected = [
    'chalkwright-backup.service.in',
    'chalkwright-backup.timer.in',
    'chalkwright-calendar-sync.service.in',
    'chalkwright-calendar-sync.timer.in',
    'chalkwright-classroom-refresh.service.in',
    'chalkwright-classroom-refresh.timer.in',
    'chalkwright-deploy.service.in',
    'chalkwright-deploy.timer.in',
    'chalkwright-integrity.service.in',
    'chalkwright-integrity.timer.in',
    'chalkwright-plan-refresh.service.in',
    'chalkwright-plan-refresh.timer.in',
    'chalkwright-powerschool-repair.service.in',
    'chalkwright.service.in',
  ];
  let files;
  try {
    files = readdirSync(production).sort();
  } catch {
    fail('permanent production systemd directory is missing');
    return;
  }
  equalList(files, expected, 'permanent production templates', fail);
  for (const file of expected) {
    const content = readFileSync(join(production, file), 'utf8');
    if (
      !content.startsWith(
        '# chalkwright-template-status=permanent-production-inert\n',
      )
    )
      fail(`${file} is missing its inert status marker`);
    if (/^\[Install\]/mu.test(content))
      fail(`${file} must remain inert without an Install section`);
    verifyForbiddenContent(`production/${file}`, content, fail);
  }
  const service = readFileSync(
    join(production, 'chalkwright.service.in'),
    'utf8',
  );
  for (const required of [
    'WorkingDirectory=/opt/chalkwright/current',
    'CLASSROOM_HUB_PRODUCTION_CONFIG_REFERENCE=/etc/chalkwright/production/server.json',
    'ExecStart=/usr/bin/node /opt/chalkwright/current/dist/entrypoints/production-server.js',
    'IPAddressDeny=any',
    'IPAddressAllow=localhost',
  ])
    if (!service.includes(required))
      fail(`chalkwright.service.in is missing ${required}`);
  const calendar = readFileSync(
    join(production, 'chalkwright-calendar-sync.service.in'),
    'utf8',
  );
  for (const required of [
    'CHALKWRIGHT_PRODUCTION_CALENDAR_CONFIG_REFERENCE=/etc/chalkwright/production/calendar.json',
    'ExecStart=/usr/bin/node /opt/chalkwright/current/dist/entrypoints/production-calendar-sync.js --execute',
  ])
    if (!calendar.includes(required))
      fail(`chalkwright-calendar-sync.service.in is missing ${required}`);
  const repair = readFileSync(
    join(production, 'chalkwright-powerschool-repair.service.in'),
    'utf8',
  );
  for (const required of [
    'EnvironmentFile=/etc/chalkwright/production/jobs/powerschool-repair.env',
    'ExecStart=/usr/bin/node /opt/chalkwright/current/dist/entrypoints/m17-powerschool-repair.js',
    'ReadWritePaths=/var/lib/chalkwright/production-session /var/lib/chalkwright/production-powerschool-profile',
  ])
    if (!repair.includes(required))
      fail(`chalkwright-powerschool-repair.service.in is missing ${required}`);
  for (const name of [
    'chalkwright-backup.service.in',
    'chalkwright-integrity.service.in',
  ]) {
    const content = readFileSync(join(production, name), 'utf8');
    for (const required of [
      'EnvironmentFile=/etc/chalkwright/production/jobs/maintenance.env',
      'ExecStart=/usr/bin/node /opt/chalkwright/current/dist/entrypoints/job.js',
      'ReadWritePaths=/var/lib/chalkwright/production',
    ])
      if (!content.includes(required)) fail(`${name} is missing ${required}`);
  }
  const deploy = readFileSync(
    join(production, 'chalkwright-deploy.service.in'),
    'utf8',
  );
  for (const required of [
    'User=root',
    'NoNewPrivileges=false',
    'ExecStart=/opt/chalkwright/current/scripts/operations/deploy-production-from-main.sh',
    'ReadWritePaths=/opt/chalkwright /var/lib/chalkwright/deploy',
  ])
    if (!deploy.includes(required))
      fail(`chalkwright-deploy.service.in is missing ${required}`);
  const deployTimer = readFileSync(
    join(production, 'chalkwright-deploy.timer.in'),
    'utf8',
  );
  for (const required of ['OnUnitActiveSec=1min', 'Persistent=false'])
    if (!deployTimer.includes(required))
      fail(`chalkwright-deploy.timer.in is missing ${required}`);
}

function verifyShadowArtifacts(directory, fail) {
  const server = readFileSync(
    join(directory, 'classroom-hub-shadow.service'),
    'utf8',
  );
  const refresh = readFileSync(
    join(directory, 'classroom-hub-shadow-refresh.service'),
    'utf8',
  );
  const timer = readFileSync(
    join(directory, 'classroom-hub-shadow-refresh.timer'),
    'utf8',
  );
  const backup = readFileSync(
    join(directory, 'classroom-hub-shadow-backup.service'),
    'utf8',
  );
  for (const [file, content, environmentFile, namespacePolicy] of [
    ['classroom-hub-shadow.service', server, SHADOW_SERVER_ENVIRONMENT, 'true'],
    [
      'classroom-hub-shadow-refresh.service',
      refresh,
      SHADOW_REFRESH_ENVIRONMENT,
      'user pid net',
    ],
    [
      'classroom-hub-shadow-backup.service',
      backup,
      SHADOW_SERVER_ENVIRONMENT,
      'true',
    ],
  ]) {
    if (!content.includes(`EnvironmentFile=${environmentFile}`))
      fail(`${file} must require its least-authority shadow environment`);
    if (
      assignmentValues(content, 'User').length !== 1 ||
      assignmentValues(content, 'User')[0] !== 'classroom-hub' ||
      assignmentValues(content, 'Group').length !== 1 ||
      assignmentValues(content, 'Group')[0] !== 'classroom-hub'
    )
      fail(`${file} must run as the dedicated classroom-hub service account`);
    if (!content.includes('ReadWritePaths=/var/lib/classroom-hub-shadow'))
      fail(`${file} must confine writes to shadow state`);
    if (
      /calendar-reconcile|CLASSROOM_HUB_CALENDAR|OPERATOR_TOKEN/iu.test(content)
    )
      fail(`${file} must not receive Calendar or operator mutation capability`);
    for (const [directive, value] of Object.entries({
      ...REQUIRED_SHADOW_HARDENING,
      RestrictNamespaces: namespacePolicy,
    })) {
      const assignments = assignmentValues(content, directive);
      if (assignments.length !== 1 || assignments[0] !== value)
        fail(`${file} must set exactly one ${directive}=${value}`);
    }
  }
  if (server.includes(`EnvironmentFile=${SHADOW_REFRESH_ENVIRONMENT}`))
    fail(
      'shadow server must not load the provider-capable refresh environment',
    );
  if (backup.includes(`EnvironmentFile=${SHADOW_REFRESH_ENVIRONMENT}`))
    fail(
      'shadow backup must not load the provider-capable refresh environment',
    );
  for (const [file, content] of [
    ['classroom-hub-shadow.service', server],
    ['classroom-hub-shadow-backup.service', backup],
  ]) {
    for (const path of SHADOW_PROVIDER_PATHS) {
      if (!content.includes(`-${path}`))
        fail(`${file} must make protected provider path inaccessible`);
    }
  }
  if (
    !server.includes('IPAddressDeny=any') ||
    !server.includes('IPAddressAllow=localhost')
  )
    fail('shadow server must allow only loopback IP traffic');
  if (!server.includes('dist/entrypoints/shadow-server.js'))
    fail('shadow service must use the non-fixture shadow server entrypoint');
  for (const job of ['source-auth-preflight', 'classroom-refresh']) {
    if (!refresh.includes(`dist/entrypoints/shadow-job.js ${job}`))
      fail(`shadow refresh must run ${job}`);
  }
  if (!refresh.includes('TimeoutStartSec=6min'))
    fail('shadow refresh must have an effective oneshot start deadline');
  if (!backup.includes('TimeoutStartSec=2min'))
    fail('shadow backup must have an effective oneshot start deadline');
  const expectedDates = [
    'Tue 2026-08-11',
    'Wed 2026-08-12',
    'Thu 2026-08-13',
    'Fri 2026-08-14',
    'Sun 2026-08-16',
    'Mon 2026-08-17',
  ];
  const calendarLines = timer
    .split(/\r?\n/u)
    .filter((line) => line.startsWith('OnCalendar='));
  if (
    calendarLines.length !== expectedDates.length ||
    !expectedDates.every((date) =>
      calendarLines.includes(`OnCalendar=${date} 07:20:00 Asia/Ho_Chi_Minh`),
    )
  )
    fail(
      'shadow timer must contain only the approved seven-day Sunday-through-Friday window',
    );
  if (!timer.includes('Persistent=false'))
    fail(
      'shadow timer must not catch up after the approved observation window',
    );
}

function assignmentValues(content, directive) {
  const prefix = `${directive}=`;
  return content
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.startsWith(prefix))
    .map((line) => line.slice(prefix.length));
}

function verifyManifest(manifest, timerTemplates, fail) {
  exactKeys(
    manifest,
    ['schemaVersion', 'status', 'timeZone', 'schedulePlaceholder', 'jobs'],
    'cadence manifest',
    fail,
  );
  if (manifest.schemaVersion !== 1)
    fail('cadence manifest schemaVersion must be 1');
  if (manifest.status !== 'pending-confirmation') {
    fail('cadence manifest status must be pending-confirmation');
  }
  if (!isRecord(manifest.timeZone)) {
    fail('cadence manifest timeZone must be an object');
  } else {
    exactKeys(
      manifest.timeZone,
      ['status', 'value', 'requirement'],
      'cadence manifest timeZone',
      fail,
    );
    if (
      manifest.timeZone.status !== 'pending-confirmation' ||
      manifest.timeZone.value !== null ||
      manifest.timeZone.requirement !== 'deployment IANA timezone'
    ) {
      fail('cadence manifest timezone must remain explicitly unresolved');
    }
  }
  if (manifest.schedulePlaceholder !== REQUIRED_SCHEDULE_PLACEHOLDER) {
    fail('cadence manifest uses an unexpected schedule placeholder');
  }
  if (!Array.isArray(manifest.jobs)) {
    fail('cadence manifest jobs must be an array');
    return;
  }

  const names = [];
  const declaredTemplates = [];
  for (const [index, job] of manifest.jobs.entries()) {
    const label = `cadence manifest jobs[${index}]`;
    if (!isRecord(job)) {
      fail(`${label} must be an object`);
      continue;
    }
    exactKeys(
      job,
      ['name', 'implementation', 'schedule', 'timerTemplate'],
      label,
      fail,
    );
    if (typeof job.name !== 'string') {
      fail(`${label}.name must be a string`);
      continue;
    }
    names.push(job.name);
    if (
      job.implementation !== 'offline' &&
      job.implementation !== 'deferred-provider' &&
      job.implementation !== 'deferred-writer'
    ) {
      fail(`${label}.implementation is invalid`);
    }
    if (
      job.schedule !== 'pending-confirmation' &&
      job.schedule !== 'on-demand-prerequisite'
    ) {
      fail(`${label}.schedule is invalid`);
    }
    if (job.implementation !== 'offline' && job.timerTemplate !== null) {
      fail(`${label} gives a deferred integration a timer template`);
    }
    if (
      job.schedule === 'on-demand-prerequisite' &&
      job.timerTemplate !== null
    ) {
      fail(`${label} gives an on-demand prerequisite a timer template`);
    }
    if (
      job.implementation === 'offline' &&
      job.schedule === 'pending-confirmation' &&
      typeof job.timerTemplate !== 'string'
    ) {
      fail(`${label} is missing its inert timer template`);
    }
    if (typeof job.timerTemplate === 'string') {
      const expected = `classroom-hub-${job.name}.timer.in`;
      if (job.timerTemplate !== expected) {
        fail(`${label}.timerTemplate must be ${expected}`);
      }
      declaredTemplates.push(job.timerTemplate);
    } else if (job.timerTemplate !== null) {
      fail(`${label}.timerTemplate must be a string or null`);
    }
  }

  equalList(names, EXPECTED_JOB_NAMES, 'bounded job names', fail);
  equalList(
    [...declaredTemplates].sort(),
    [...timerTemplates].sort(),
    'cadence manifest timer templates',
    fail,
  );
}

function verifyM16ProductionArtifacts(directory, manifest, fail) {
  exactKeys(
    manifest,
    [
      'schemaVersion',
      'status',
      'timeZone',
      'missedRunPolicy',
      'jobs',
      'deferred',
    ],
    'M-16 production cadence manifest',
    fail,
  );
  if (
    manifest.schemaVersion !== 1 ||
    manifest.status !== 'approved-inert' ||
    manifest.timeZone !== 'Asia/Ho_Chi_Minh' ||
    manifest.missedRunPolicy !== 'no-catch-up'
  )
    fail('M-16 production cadence manifest policy is invalid');
  if (!Array.isArray(manifest.jobs) || manifest.jobs.length !== 2) {
    fail('M-16 production cadence manifest must declare exactly two jobs');
    return;
  }
  const expectedJobs = [
    {
      name: 'production-plan-refresh',
      authority: 'powerschool-read-only',
      schedule: 'Mon..Fri,Sun *-*-* 07:20:00 Asia/Ho_Chi_Minh',
      serviceTemplate: 'classroom-hub-production-plan-refresh.service.in',
      timerTemplate: 'classroom-hub-production-plan-refresh.timer.in',
      persistent: false,
      execStart:
        '/usr/bin/node /opt/classroom-hub/dist/entrypoints/production-plan-refresh.js',
      environmentFile: '/etc/classroom-hub/jobs/production-plan-refresh.env',
      timeoutStart: '3min',
      namespacePolicy: 'user pid net',
      readWritePaths:
        '/var/lib/classroom-hub/production /var/lib/classroom-hub/powerschool-session',
      inaccessiblePaths:
        '-/etc/classroom-hub/providers/google-classroom -/etc/classroom-hub/providers/google-calendar -/etc/classroom-hub/providers/alert-delivery',
      memoryMax: '768M',
      tasksMax: '192',
    },
    {
      name: 'production-classroom-refresh',
      authority: 'classroom-read-only-active-class-only',
      schedule: '30-seconds-after-activation-or-prior-run-completion',
      serviceTemplate: 'classroom-hub-production-classroom-refresh.service.in',
      timerTemplate: 'classroom-hub-production-classroom-refresh.timer.in',
      persistent: false,
      execStart:
        '/usr/bin/node /opt/classroom-hub/dist/entrypoints/production-classroom-refresh.js',
      environmentFile:
        '/etc/classroom-hub/jobs/production-classroom-refresh.env',
      timeoutStart: '1min',
      namespacePolicy: 'true',
      readWritePaths: '/var/lib/classroom-hub/production',
      inaccessiblePaths:
        '-/etc/classroom-hub/providers/powerschool -/etc/classroom-hub/providers/google-calendar -/etc/classroom-hub/providers/alert-delivery',
      memoryMax: '384M',
      tasksMax: '64',
    },
  ];
  const seen = [];
  for (const [index, expected] of expectedJobs.entries()) {
    const job = manifest.jobs[index];
    const label = `M-16 production cadence jobs[${index}]`;
    if (!isRecord(job)) {
      fail(`${label} must be an object`);
      continue;
    }
    exactKeys(
      job,
      [
        'name',
        'authority',
        'schedule',
        'serviceTemplate',
        'timerTemplate',
        'persistent',
      ],
      label,
      fail,
    );
    for (const key of [
      'name',
      'authority',
      'schedule',
      'serviceTemplate',
      'timerTemplate',
      'persistent',
    ]) {
      if (job[key] !== expected[key]) fail(`${label}.${key} is invalid`);
    }
    seen.push(job.timerTemplate);
    verifyM16ProviderService(
      readUnit(join(directory, expected.serviceTemplate), fail),
      expected,
      fail,
    );
    verifyM16Timer(
      readUnit(join(directory, expected.timerTemplate), fail),
      expected,
      fail,
    );
  }
  equalList(
    [...seen].sort(),
    [...M16_TIMER_TEMPLATES].sort(),
    'M-16 production timer templates',
    fail,
  );
  const expectedDeferred = [
    'protected-powerschool-reference-provisioning-and-live-repair',
    'protected-classroom-reference-provisioning',
    'telegram-alert-provisioning-and-wiring',
    'morning-and-daily-brief-native-delivery',
    'maintenance-timer-finalization',
    'calendar-writer-cutover',
  ];
  if (!Array.isArray(manifest.deferred))
    fail('M-16 production cadence deferred gates must be an array');
  else
    equalList(
      manifest.deferred,
      expectedDeferred,
      'M-16 production cadence deferred gates',
      fail,
    );
}

function verifyM16ProviderService(unit, expected, fail) {
  if (unit === undefined) return;
  const file = expected.serviceTemplate;
  const service = unit.sections.get('Service');
  if (unit.sections.has('Install')) fail(`${file} must not have [Install]`);
  if (service === undefined) {
    fail(`${file} is missing [Service]`);
    return;
  }
  if (
    !unit.content.includes('# classroom-hub-template-status=approved-m16-inert')
  )
    fail(`${file} is missing the approved inert marker`);
  const description = first(unit.sections.get('Unit'), 'Description');
  if (
    description === undefined ||
    !description.startsWith('INERT approved M-16 ')
  )
    fail(`${file} must identify itself as an inert M-16 candidate`);
  for (const [directive, value] of Object.entries({
    Type: 'oneshot',
    User: 'classroom-hub',
    Group: 'classroom-hub',
    WorkingDirectory: '/opt/classroom-hub',
    EnvironmentFile: expected.environmentFile,
    ExecStart: expected.execStart,
    TimeoutStartSec: expected.timeoutStart,
    TimeoutStopSec: '30s',
    UMask: '0077',
    InaccessiblePaths: expected.inaccessiblePaths,
    ReadWritePaths: expected.readWritePaths,
    RestrictAddressFamilies: 'AF_UNIX AF_INET AF_INET6',
    RestrictNamespaces: expected.namespacePolicy,
    MemoryMax: expected.memoryMax,
    TasksMax: expected.tasksMax,
  }))
    expectOne(service, directive, value, file, fail);
  expectOne(service, 'Environment', 'NODE_ENV=production', file, fail);
  for (const [directive, value] of Object.entries(REQUIRED_HARDENING)) {
    if (directive === 'RestrictNamespaces') continue;
    expectOne(service, directive, value, file, fail);
  }
  if (service.has('Restart') || service.has('RuntimeMaxSec'))
    fail(`${file} must not restart or outlive its oneshot deadline`);
}

function verifyM16Timer(unit, expected, fail) {
  if (unit === undefined) return;
  const file = expected.timerTemplate;
  const timer = unit.sections.get('Timer');
  if (unit.sections.has('Install')) fail(`${file} must not have [Install]`);
  if (timer === undefined) {
    fail(`${file} is missing [Timer]`);
    return;
  }
  if (
    !unit.content.includes('# classroom-hub-template-status=approved-m16-inert')
  )
    fail(`${file} is missing the approved inert marker`);
  expectOne(timer, 'Persistent', 'false', file, fail);
  expectOne(timer, 'AccuracySec', '1s', file, fail);
  expectOne(
    timer,
    'Unit',
    expected.serviceTemplate.replace(/\.in$/u, ''),
    file,
    fail,
  );
  if (expected.name === 'production-plan-refresh') {
    expectOne(timer, 'OnCalendar', expected.schedule, file, fail);
    if (timer.has('OnActiveSec') || timer.has('OnUnitInactiveSec'))
      fail(`${file} must be wall-clock only`);
  } else {
    expectOne(timer, 'OnActiveSec', '30s', file, fail);
    expectOne(timer, 'OnUnitInactiveSec', '30s', file, fail);
    if (timer.has('OnCalendar')) fail(`${file} must be monotonic only`);
  }
}

function verifyService(unit, expected, fail) {
  const unitSection = unit.sections.get('Unit');
  const service = unit.sections.get('Service');
  if (service === undefined) {
    fail(`${expected.file} is missing [Service]`);
    return;
  }
  if (unit.sections.has('Install')) {
    fail(`${expected.file} must not have an [Install] section`);
  }
  if (
    !unit.content.includes(
      `# classroom-hub-template-status=${expected.templateStatus}`,
    )
  )
    fail(`${expected.file} has the wrong inert template status`);
  const description = first(unitSection, 'Description');
  if (
    description === undefined ||
    !description.startsWith(expected.descriptionPrefix)
  )
    fail(`${expected.file} must identify itself as an inert template`);
  if (
    expected.file === 'classroom-hub-job@.service.in' &&
    ((unitSection?.get('After') ?? []).includes('network-online.target') ||
      (unitSection?.get('Wants') ?? []).includes('network-online.target'))
  ) {
    fail(`${expected.file} must not acquire a network dependency`);
  }
  expectOne(service, 'Type', expected.type, expected.file, fail);
  expectOne(service, 'User', 'classroom-hub', expected.file, fail);
  expectOne(service, 'Group', 'classroom-hub', expected.file, fail);
  expectOne(service, 'ExecStart', expected.execStart, expected.file, fail);
  if (expected.environmentFile === undefined) {
    if (service.has('EnvironmentFile'))
      fail(`${expected.file} must not load an ambient environment file`);
  } else {
    expectOne(
      service,
      'EnvironmentFile',
      expected.environmentFile,
      expected.file,
      fail,
    );
  }
  const environments = service.get('Environment') ?? [];
  for (const value of expected.requiredEnvironments) {
    if (!environments.includes(value))
      fail(`${expected.file} is missing Environment=${value}`);
  }
  if (
    (service.get('EnvironmentFile') ?? []).some((value) =>
      value.startsWith('-'),
    )
  ) {
    fail(`${expected.file} must require, not optionally load, EnvironmentFile`);
  }
  expectOne(
    service,
    'WorkingDirectory',
    '/opt/classroom-hub',
    expected.file,
    fail,
  );
  expectOne(service, 'TimeoutStopSec', '30s', expected.file, fail);
  expectOne(service, 'UMask', '0077', expected.file, fail);
  expectOne(
    service,
    'ReadWritePaths',
    expected.readWritePaths,
    expected.file,
    fail,
  );
  expectOne(
    service,
    'RestrictAddressFamilies',
    expected.addressFamilies,
    expected.file,
    fail,
  );
  for (const [key, value] of Object.entries(REQUIRED_HARDENING)) {
    expectOne(service, key, value, expected.file, fail);
  }
  if (expected.inaccessiblePaths === undefined) {
    if (service.has('InaccessiblePaths'))
      fail(`${expected.file} has an unexpected inaccessible-path policy`);
  } else {
    expectOne(
      service,
      'InaccessiblePaths',
      expected.inaccessiblePaths,
      expected.file,
      fail,
    );
  }
  if (expected.loopbackIpOnly) {
    expectOne(service, 'IPAddressDeny', 'any', expected.file, fail);
    expectOne(service, 'IPAddressAllow', 'localhost', expected.file, fail);
  } else if (service.has('IPAddressDeny') || service.has('IPAddressAllow')) {
    fail(`${expected.file} has an unexpected IP address policy`);
  }

  if (expected.restart === undefined) {
    if (service.has('Restart') || service.has('RestartSec')) {
      fail(`${expected.file} must not restart bounded oneshot jobs`);
    }
  } else {
    expectOne(service, 'Restart', expected.restart, expected.file, fail);
    expectOne(service, 'RestartSec', '5s', expected.file, fail);
  }
  if (expected.runtimeMaxSec === undefined) {
    if (service.has('RuntimeMaxSec')) {
      fail(
        `${expected.file} must not bound the long-running service with RuntimeMaxSec`,
      );
    }
  } else {
    expectOne(
      service,
      'RuntimeMaxSec',
      expected.runtimeMaxSec,
      expected.file,
      fail,
    );
  }
}

function verifyTimer(unit, job, manifest, fail) {
  const file = job.timerTemplate;
  const timer = unit.sections.get('Timer');
  if (unit.sections.has('Install'))
    fail(`${file} must not have an [Install] section`);
  if (timer === undefined) {
    fail(`${file} is missing [Timer]`);
    return;
  }
  if (
    !unit.content.includes(
      '# classroom-hub-template-status=pending-confirmation',
    )
  ) {
    fail(`${file} is missing the pending-confirmation marker`);
  }
  if (!/^# classroom-hub-evidence=\S.+$/mu.test(unit.content)) {
    fail(`${file} is missing its evidence marker`);
  }
  const description = first(unit.sections.get('Unit'), 'Description');
  if (
    description === undefined ||
    !description.startsWith('INERT pending-confirmation ')
  ) {
    fail(`${file} must identify itself as INERT and pending-confirmation`);
  }
  expectOne(timer, 'OnCalendar', manifest.schedulePlaceholder, file, fail);
  expectOne(timer, 'Persistent', REQUIRED_PERSISTENT_PLACEHOLDER, file, fail);
  expectOne(timer, 'Unit', `classroom-hub-job@${job.name}.service`, file, fail);
}

function verifyForbiddenContent(file, content, fail) {
  const forbidden = [
    [/\b(?:bash|dash|zsh|fish|sh)\s+(?:-[a-z]*c\b|\/)/iu, 'shell execution'],
    [/\bopenclaw\b/iu, 'OpenClaw dependency'],
    [/\btailscale\b/iu, 'Tailscale command or dependency'],
    [
      /^(?:ExecStart|ExecStartPre|ExecStartPost)=.*\b(?:systemctl|install|enable)\b/mu,
      'installation/activation command',
    ],
    [/(?:0\.0\.0\.0|(?<!:)::(?!1))/u, 'public/wildcard bind'],
    [
      /(?:TOKEN|SECRET|PASSWORD|CREDENTIAL|API_KEY)\s*=/iu,
      'inline secret material',
    ],
  ];
  for (const [pattern, label] of forbidden) {
    if (pattern.test(content)) fail(`${file} contains forbidden ${label}`);
  }
}

function readJson(path, fail) {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'));
    if (!isRecord(value)) {
      fail(`${path} must contain a JSON object`);
      return undefined;
    }
    return value;
  } catch (error) {
    fail(`${path} is not valid JSON: ${redactedError(error)}`);
    return undefined;
  }
}

function readUnit(path, fail) {
  let content;
  try {
    content = readFileSync(path, 'utf8');
  } catch (error) {
    fail(`${path} cannot be read: ${redactedError(error)}`);
    return undefined;
  }
  const sections = new Map();
  let current;
  for (const [index, rawLine] of content.split(/\r?\n/u).entries()) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#') || line.startsWith(';')) continue;
    const sectionMatch = /^\[([A-Za-z]+)\]$/u.exec(line);
    if (sectionMatch !== null) {
      current = new Map();
      if (sections.has(sectionMatch[1])) {
        fail(`${path}:${index + 1} repeats [${sectionMatch[1]}]`);
      }
      sections.set(sectionMatch[1], current);
      continue;
    }
    const assignment = /^([A-Za-z][A-Za-z0-9]*)=(.*)$/u.exec(line);
    if (current === undefined || assignment === null) {
      fail(`${path}:${index + 1} is not a supported unit assignment`);
      continue;
    }
    const values = current.get(assignment[1]) ?? [];
    values.push(assignment[2]);
    current.set(assignment[1], values);
  }
  return { content, sections };
}

function expectOne(section, key, expected, file, fail) {
  const values = section.get(key) ?? [];
  if (values.length !== 1 || values[0] !== expected) {
    fail(`${file} requires exactly ${key}=${expected}`);
  }
}

function first(section, key) {
  return section?.get(key)?.[0];
}

function exactKeys(value, expected, label, fail) {
  const actual = Object.keys(value).sort();
  equalList(actual, [...expected].sort(), `${label} keys`, fail);
}

function equalList(actual, expected, label, fail) {
  if (
    actual.length !== expected.length ||
    actual.some((value, index) => value !== expected[index])
  ) {
    fail(`${label} mismatch (expected ${expected.join(', ') || 'none'})`);
  }
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function redactedError(error) {
  return error instanceof Error ? error.name : 'unknown error';
}

const scriptPath = fileURLToPath(import.meta.url);
if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const repositoryRoot = resolve(dirname(scriptPath), '..', '..');
  const result = verifySystemdArtifacts(repositoryRoot);
  process.stdout.write(
    `Verified ${result.services} service artifacts, ${result.inertTimerTemplates} pending timer templates, and ${result.jobs} bounded jobs.\n`,
  );
}
