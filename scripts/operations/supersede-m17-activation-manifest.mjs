import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rejectedManifests = Object.freeze({
  'sha256:2fda6668afbd28b2b3ee843e5ed42438cab30dacfdb496eb4c37e8ab74e925b2':
    '/etc/chalkwright/canary/rejected-activation-manifest-2fda6668afbd28b2b3ee843e5ed42438cab30dacfdb496eb4c37e8ab74e925b2.json',
  'sha256:e84fdcc9a9ba7155d5b6382a3f191eae4f3f94f490228af418db52280e332a65':
    '/etc/chalkwright/canary/rejected-activation-manifest-e84fdcc9a9ba7155d5b6382a3f191eae4f3f94f490228af418db52280e332a65.json',
  'sha256:3ef42b8d902a61b9add8afd6f15812f2076810050f9d275371d165922b2230bb':
    '/etc/chalkwright/canary/rejected-activation-manifest-3ef42b8d902a61b9add8afd6f15812f2076810050f9d275371d165922b2230bb.json',
  'sha256:69ccff3c358f0edd3cbd7a09f9e4d3ec8ccfac20eb2fe12a56f052903da99f7f':
    '/etc/chalkwright/canary/rejected-activation-manifest-69ccff3c358f0edd3cbd7a09f9e4d3ec8ccfac20eb2fe12a56f052903da99f7f.json',
  'sha256:41cc8a7ea7e73ba514862bdf72faaaa287ec19f28e6f603a4ae7dfbc475435d9':
    '/etc/chalkwright/canary/rejected-activation-manifest-41cc8a7ea7e73ba514862bdf72faaaa287ec19f28e6f603a4ae7dfbc475435d9.json',
});
const manifestPath = '/etc/chalkwright/canary/activation-manifest.json';
const candidateTailnetTargetHash =
  'sha256:6e6997a560c68f2f52894a4bb63a07615edc63b0e7e1b33dd80e19a04a8a7056';
const candidateUnits = Object.freeze([
  'chalkwright-canary-calendar-sync.service',
  'chalkwright-canary-calendar-sync.timer',
  'chalkwright-canary-classroom-refresh.service',
  'chalkwright-canary-classroom-refresh.timer',
  'chalkwright-canary-plan-refresh.service',
  'chalkwright-canary-plan-refresh.timer',
  'chalkwright-canary-backup.service',
  'chalkwright-canary-backup.timer',
  'chalkwright-canary-integrity.service',
  'chalkwright-canary-integrity.timer',
  'chalkwright-canary-calendar-preflight.service',
  'chalkwright-canary-classroom-preflight.service',
  'chalkwright-canary-plan-preflight.service',
  'chalkwright-canary-comparison.service',
  'chalkwright-canary-comparison-observation.service',
  'chalkwright-canary.service',
]);

export function supersedeM17ActivationManifest(options = {}) {
  const livePath = options.manifestPath ?? manifestPath;
  const verifyInactive = options.verifyInactive ?? verifyCandidateInactive;
  const verifyRouteAbsent =
    options.verifyRouteAbsent ?? verifyCandidateRouteAbsent;
  const afterArchiveValidated = options.afterArchiveValidated ?? (() => {});
  const beforeRename = options.beforeRename ?? (() => {});
  const expectedTailnetTargetHash =
    options.expectedTailnetTargetHash ?? candidateTailnetTargetHash;
  verifyInactive();
  const source = readProtectedManifest(livePath);
  let manifest;
  try {
    manifest = JSON.parse(source.text);
  } catch {
    throw new Error('m17-supersede-manifest-invalid');
  }
  const actualFingerprint = digest(manifest);
  const expectedFingerprint =
    options.expectedFingerprint ??
    (Object.hasOwn(rejectedManifests, actualFingerprint)
      ? actualFingerprint
      : undefined);
  const rejectedPath =
    options.archivePath ??
    (expectedFingerprint === undefined
      ? undefined
      : rejectedManifests[expectedFingerprint]);
  if (
    expectedFingerprint === undefined ||
    rejectedPath === undefined ||
    actualFingerprint !== expectedFingerprint ||
    digestText(manifest.tailnetTarget) !== expectedTailnetTargetHash
  )
    throw new Error('m17-supersede-manifest-mismatch');
  verifyRouteAbsent(manifest.tailnetTarget);
  assertAbsent(rejectedPath);
  let moved = false;
  try {
    beforeRename();
    renameSync(livePath, rejectedPath);
    moved = true;
    const archived = lstatSync(rejectedPath);
    if (
      archived.dev !== source.stat.dev ||
      archived.ino !== source.stat.ino ||
      !archived.isFile() ||
      archived.isSymbolicLink() ||
      archived.nlink !== 1 ||
      archived.uid !== source.stat.uid ||
      archived.gid !== source.stat.gid ||
      (archived.mode & 0o777) !== 0o600
    )
      throw new Error('m17-supersede-archive-invalid');
    const archivedSource = readProtectedManifest(rejectedPath);
    let archivedManifest;
    try {
      archivedManifest = JSON.parse(archivedSource.text);
    } catch {
      throw new Error('m17-supersede-archive-invalid');
    }
    if (
      archivedSource.stat.dev !== source.stat.dev ||
      archivedSource.stat.ino !== source.stat.ino ||
      digest(archivedManifest) !== expectedFingerprint ||
      archivedManifest.tailnetTarget !== manifest.tailnetTarget
    )
      throw new Error('m17-supersede-archive-invalid');
    afterArchiveValidated();
    fsyncDirectory(dirname(livePath));
  } catch (error) {
    if (moved) restoreManifest(livePath, rejectedPath, source.stat);
    throw error;
  }
  return {
    status: 'm17-rejected-activation-manifest-archived',
    archivedFingerprint: expectedFingerprint,
    providerRequests: 0,
    servicesChanged: 0,
    routeChanges: 0,
    valuesPrinted: 0,
  };
}

function digestText(value) {
  if (typeof value !== 'string') return undefined;
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function readProtectedManifest(path) {
  let descriptor;
  try {
    const before = lstatSync(path);
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      before.nlink !== 1 ||
      before.uid === 0 ||
      before.gid === 0 ||
      (before.mode & 0o777) !== 0o600 ||
      before.size < 2 ||
      before.size > 32 * 1024 ||
      realpathSync(path) !== path
    )
      throw new Error('m17-supersede-manifest-unsafe');
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = fstatSync(descriptor);
    if (
      !opened.isFile() ||
      opened.nlink !== 1 ||
      opened.uid !== before.uid ||
      opened.gid !== before.gid ||
      (opened.mode & 0o777) !== 0o600 ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      opened.size !== before.size
    )
      throw new Error('m17-supersede-manifest-unsafe');
    return { text: readFileSync(descriptor, 'utf8'), stat: opened };
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function verifyCandidateInactive() {
  for (const unit of candidateUnits) {
    const result = spawnSync(
      '/usr/bin/systemctl',
      ['show', '--property=ActiveState', '--value', unit],
      {
        encoding: 'utf8',
        env: { LANG: 'C', LC_ALL: 'C', SYSTEMD_COLORS: '0' },
        killSignal: 'SIGKILL',
        maxBuffer: 4096,
        timeout: 5_000,
      },
    );
    const state = result.stdout.trim();
    if (
      result.error !== undefined ||
      result.status !== 0 ||
      (state !== 'inactive' && state !== 'failed')
    )
      throw new Error('m17-supersede-candidate-active');
  }
}

function verifyCandidateRouteAbsent(target) {
  const parsed = new URL(target);
  const result = spawnSync(
    '/usr/bin/tailscale',
    ['serve', 'status', '--json'],
    {
      encoding: 'utf8',
      env: { HOME: '/nonexistent', LANG: 'C', LC_ALL: 'C' },
      killSignal: 'SIGKILL',
      maxBuffer: 256 * 1024,
      timeout: 10_000,
    },
  );
  if (result.error !== undefined || result.status !== 0)
    throw new Error('m17-supersede-route-state-unavailable');
  let status;
  try {
    status = JSON.parse(result.stdout);
  } catch {
    throw new Error('m17-supersede-route-state-invalid');
  }
  const serialized = JSON.stringify(status);
  if (
    serialized.includes(parsed.host) ||
    serialized.includes('127.0.0.1:4319') ||
    serialized.includes('localhost:4319')
  )
    throw new Error('m17-supersede-candidate-route-present');
}

function assertAbsent(path) {
  try {
    lstatSync(path);
  } catch (error) {
    if (error && error.code === 'ENOENT') return;
    throw error;
  }
  throw new Error('m17-supersede-archive-exists');
}

function restoreManifest(livePath, rejectedPath, sourceStat) {
  try {
    assertAbsent(livePath);
    const archived = lstatSync(rejectedPath);
    if (archived.dev !== sourceStat.dev || archived.ino !== sourceStat.ino)
      throw new Error('m17-supersede-restore-identity-invalid');
    renameSync(rejectedPath, livePath);
    fsyncDirectory(dirname(livePath));
  } catch {
    throw new Error('m17-supersede-restore-failed');
  }
}

function fsyncDirectory(path) {
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY);
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function digest(value) {
  return `sha256:${createHash('sha256').update(stable(value)).digest('hex')}`;
}

function stable(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
    .join(',')}}`;
}

async function main() {
  if (
    process.argv.slice(2).join(' ') !== '--apply' ||
    process.geteuid?.() !== 0
  )
    throw new Error('m17-supersede-usage-invalid');
  process.stdout.write(`${JSON.stringify(supersedeM17ActivationManifest())}\n`);
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? ''))
  main().catch((error) => {
    process.stderr.write(
      `${JSON.stringify({ status: 'rejected', code: error instanceof Error && /^m17-[a-z0-9-]+$/u.test(error.message) ? error.message : 'm17-supersede-failed' })}\n`,
    );
    process.exitCode = 1;
  });
