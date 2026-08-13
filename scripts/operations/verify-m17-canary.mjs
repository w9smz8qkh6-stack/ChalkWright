import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXPECTED = [
  'canary-manifest.json',
  'chalkwright-canary-backup.service.in',
  'chalkwright-canary-backup.timer.in',
  'chalkwright-canary-calendar-sync.service.in',
  'chalkwright-canary-calendar-sync.timer.in',
  'chalkwright-canary-calendar-preflight.service.in',
  'chalkwright-canary-classroom-refresh.service.in',
  'chalkwright-canary-classroom-refresh.timer.in',
  'chalkwright-canary-classroom-preflight.service.in',
  'chalkwright-canary-comparison.service.in',
  'chalkwright-canary-comparison-observation.service.in',
  'chalkwright-canary-integrity.service.in',
  'chalkwright-canary-integrity.timer.in',
  'chalkwright-canary-plan-refresh.service.in',
  'chalkwright-canary-plan-refresh.timer.in',
  'chalkwright-canary-plan-preflight.service.in',
  'chalkwright-canary.service.in',
].sort();
const HARDENING = [
  'NoNewPrivileges=true',
  'PrivateDevices=true',
  'PrivateTmp=true',
  'ProtectClock=true',
  'ProtectControlGroups=true',
  'ProtectHome=true',
  'ProtectHostname=true',
  'ProtectKernelLogs=true',
  'ProtectKernelModules=true',
  'ProtectKernelTunables=true',
  'ProtectSystem=strict',
  'RestrictRealtime=true',
  'RestrictSUIDSGID=true',
];

function serviceAssignments(content, key) {
  const assignments = [];
  let section = '';
  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();
    const sectionMatch = /^\[([^\]]+)\]$/u.exec(line);
    if (sectionMatch) {
      section = sectionMatch[1];
      continue;
    }
    if (section !== 'Service' || line.startsWith('#') || line.length === 0)
      continue;
    const assignment = /^([^=]+)=(.*)$/u.exec(line);
    if (assignment && assignment[1].trim() === key)
      assignments.push(assignment[2].trim());
  }
  return assignments;
}

function requireExactServiceAssignment(errors, file, content, key, value) {
  const assignments = serviceAssignments(content, key);
  if (assignments.length !== 1 || assignments[0] !== value)
    errors.push(`${file} must contain exactly one ${key}=${value}`);
}

export function verifyM17Canary(repositoryRoot) {
  const directory = join(resolve(repositoryRoot), 'systemd/m17');
  const files = readdirSync(directory).sort();
  const errors = [];
  if (JSON.stringify(files) !== JSON.stringify(EXPECTED))
    errors.push('exact artifact set drifted');
  const units = files.filter((name) => /\.(service|timer)\.in$/u.test(name));
  for (const file of units) {
    const content = readFileSync(join(directory, file), 'utf8');
    if (/^\[Install\]$/mu.test(content))
      errors.push(`${file} must remain inert`);
    if (
      !content.includes(
        'chalkwright-template-status=m17-offline-qualified-inert',
      )
    )
      errors.push(`${file} status missing`);
    if (
      /\/var\/lib\/classroom-hub\/production|\/opt\/classroom-hub\/|\/etc\/classroom-hub\/|classroom-screen|Telegram/iu.test(
        content,
      )
    )
      errors.push(`${file} crosses a legacy/final-production boundary`);
    if (file.endsWith('.service.in'))
      for (const required of HARDENING) {
        const separator = required.indexOf('=');
        requireExactServiceAssignment(
          errors,
          file,
          content,
          required.slice(0, separator),
          required.slice(separator + 1),
        );
      }
  }
  const server = readFileSync(
    join(directory, 'chalkwright-canary.service.in'),
    'utf8',
  );
  for (const value of [
    'IPAddressDeny=any',
    'IPAddressAllow=localhost',
    'InaccessiblePaths=-/etc/chalkwright/canary/providers',
    'ReadWritePaths=/var/lib/chalkwright/canary-production',
  ])
    if (!server.includes(value)) errors.push(`server missing ${value}`);
  const plan = readFileSync(
    join(directory, 'chalkwright-canary-plan-refresh.service.in'),
    'utf8',
  );
  requireExactServiceAssignment(
    errors,
    'chalkwright-canary-plan-refresh.service.in',
    plan,
    'RestrictNamespaces',
    'user pid net',
  );
  for (const file of [
    'chalkwright-canary-plan-refresh.service.in',
    'chalkwright-canary-classroom-refresh.service.in',
    'chalkwright-canary-calendar-sync.service.in',
    'chalkwright-canary-integrity.service.in',
    'chalkwright-canary-backup.service.in',
  ]) {
    const content = readFileSync(join(directory, file), 'utf8');
    if (
      !content.includes(
        'ExecCondition=/usr/bin/node /opt/chalkwright-canary/current/dist/entrypoints/m17-canary-activation-manifest.js --verify-current /etc/chalkwright/canary/activation-manifest.json',
      )
    )
      errors.push(`${file} observation-window guard drifted`);
  }
  if (
    !server.includes(
      'ExecStart=/usr/bin/node /opt/chalkwright-canary/current/dist/entrypoints/m17-canary-server.js',
    )
  )
    errors.push('server observation-window wrapper drifted');
  const calendar = readFileSync(
    join(directory, 'chalkwright-canary-calendar-sync.service.in'),
    'utf8',
  );
  if (
    !calendar.includes('m17-canary-calendar-sync.js --execute') ||
    !calendar.includes('calendar.json')
  )
    errors.push('calendar exact capability drifted');
  const preflight = readFileSync(
    join(directory, 'chalkwright-canary-calendar-preflight.service.in'),
    'utf8',
  );
  if (!preflight.includes('m17-canary-calendar-sync.js --preflight'))
    errors.push('Calendar preflight is not mechanically read-only');
  const classroom = readFileSync(
    join(directory, 'chalkwright-canary-classroom-refresh.service.in'),
    'utf8',
  );
  if (!classroom.includes('SuccessExitStatus=2'))
    errors.push('Classroom inactive skip is not healthy');
  const comparison = readFileSync(
    join(directory, 'chalkwright-canary-comparison.service.in'),
    'utf8',
  );
  if (
    !comparison.includes('m17-canary-comparison.js --preactivation') ||
    !comparison.includes('RestrictAddressFamilies=AF_UNIX') ||
    !comparison.includes('InaccessiblePaths=-/etc/chalkwright/canary/providers')
  )
    errors.push('comparison capability isolation drifted');
  const observationComparison = readFileSync(
    join(directory, 'chalkwright-canary-comparison-observation.service.in'),
    'utf8',
  );
  if (
    !observationComparison.includes('m17-canary-comparison.js') ||
    observationComparison.includes('--preactivation') ||
    !observationComparison.includes(
      'ExecCondition=/usr/bin/node /opt/chalkwright-canary/current/dist/entrypoints/m17-canary-activation-manifest.js --verify-current /etc/chalkwright/canary/activation-manifest.json',
    ) ||
    !observationComparison.includes('RestrictAddressFamilies=AF_UNIX') ||
    !observationComparison.includes(
      'InaccessiblePaths=-/etc/chalkwright/canary/providers',
    )
  )
    errors.push('continued comparison capability isolation drifted');
  for (const [file, job] of [
    ['chalkwright-canary-integrity.service.in', 'sqlite-integrity'],
    ['chalkwright-canary-backup.service.in', 'sqlite-backup'],
  ]) {
    const content = readFileSync(join(directory, file), 'utf8');
    if (
      !content.includes('/etc/chalkwright/canary/jobs/maintenance.env') ||
      !content.includes(`dist/entrypoints/job.js ${job}`) ||
      !content.includes('RestrictAddressFamilies=AF_UNIX') ||
      !content.includes('InaccessiblePaths=-/etc/chalkwright/canary/providers')
    )
      errors.push(`${file} maintenance isolation drifted`);
  }
  for (const [file, schedule] of [
    [
      'chalkwright-canary-plan-refresh.timer.in',
      'OnCalendar=Mon..Fri,Sun *-*-* 07:25:00 Asia/Ho_Chi_Minh',
    ],
    [
      'chalkwright-canary-calendar-sync.timer.in',
      'OnCalendar=Mon..Fri,Sun *-*-* 07:28:00 Asia/Ho_Chi_Minh',
    ],
    [
      'chalkwright-canary-integrity.timer.in',
      'OnCalendar=*-*-* 18:35:00 Asia/Ho_Chi_Minh',
    ],
    [
      'chalkwright-canary-backup.timer.in',
      'OnCalendar=*-*-* 18:40:00 Asia/Ho_Chi_Minh',
    ],
  ]) {
    const content = readFileSync(join(directory, file), 'utf8');
    if (!content.includes(schedule) || !content.includes('Persistent=false'))
      errors.push(`${file} cadence drifted`);
  }
  const manifest = JSON.parse(
    readFileSync(join(directory, 'canary-manifest.json'), 'utf8'),
  );
  if (
    manifest.calendarSummary !== 'Auto Lesson 2' ||
    manifest.display.port !== 4319 ||
    manifest.alertMode !== 'report-only' ||
    manifest.display.legacyRoutePolicy !== 'deny-change' ||
    manifest.buildPolicy !== 'sha256-bound-release' ||
    manifest.stopCommand !==
      '/opt/chalkwright-canary/current/scripts/operations/stop-m17-canary.sh' ||
    manifest.observationPolicy !== 'explicit-1h-to-14d-window'
  )
    errors.push('manifest isolation policy drifted');
  if (
    JSON.stringify(manifest.stopOrder) !==
    JSON.stringify([
      'chalkwright-canary-classroom-refresh.timer',
      'chalkwright-canary-calendar-sync.timer',
      'chalkwright-canary-backup.timer',
      'chalkwright-canary-integrity.timer',
      'chalkwright-canary-plan-refresh.timer',
      'chalkwright-canary-calendar-sync.service',
      'chalkwright-canary-calendar-preflight.service',
      'chalkwright-canary-comparison.service',
      'chalkwright-canary-comparison-observation.service',
      'chalkwright-canary-classroom-preflight.service',
      'chalkwright-canary-classroom-refresh.service',
      'chalkwright-canary-plan-preflight.service',
      'chalkwright-canary-plan-refresh.service',
      'chalkwright-canary-backup.service',
      'chalkwright-canary-integrity.service',
      'chalkwright-canary.service',
    ])
  )
    errors.push('manifest candidate stop order drifted');
  if (errors.length)
    throw new Error(
      `M-17 canary verification failed:\n${errors.map((e) => `- ${e}`).join('\n')}`,
    );
  return {
    status: 'verified-inert',
    files: files.length,
    servicesStarted: 0,
    routeChanges: 0,
    providerRequests: 0,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.stdout.write(`${JSON.stringify(verifyM17Canary(process.cwd()))}\n`);
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'm17-verification-failed'}\n`,
    );
    process.exitCode = 1;
  }
}
