import { lstatSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const excludedDirectories = new Set([
  '.git',
  '.test-dist',
  'coverage',
  'dist',
  'node_modules',
]);

function candidatePaths(root, directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    const name = relative(root, path);
    if (entry.isSymbolicLink()) return [name];
    if (entry.isDirectory())
      return excludedDirectories.has(entry.name)
        ? []
        : candidatePaths(root, path);
    return entry.isFile() ? [name] : [];
  });
}

const artifactSuffixes = [
  '.sqlite',
  '.sqlite3',
  '.db',
  '.db3',
  '.log',
  '.pem',
  '.key',
  '.p12',
  '.pfx',
];
const forbiddenSegments = [
  '/browser-profile/',
  '/credentials/',
  '/runtime-state/',
  '/backups/',
];
const binaryExtensions = new Set([
  '.webm',
  '.mp4',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
]);
const deliberateSecretFixture = 'test/scripts/fixture-safety.test.mjs';
const offlineTelegramAdapter =
  'src/infrastructure/operations/telegram-alert-transport.ts';
const telegramQualificationEntrypoint =
  'src/entrypoints/m16-alert-live-qualification.ts';

export function verifyRepositorySafety(repositoryRoot = defaultRoot) {
  const root = resolve(repositoryRoot);
  const candidates = candidatePaths(root, root).sort();
  const findings = [];

  for (const relativePath of candidates) {
    const normalized = `/${relativePath.toLowerCase()}`;
    if (
      artifactSuffixes.some((suffix) => normalized.endsWith(suffix)) ||
      forbiddenSegments.some((segment) => normalized.includes(segment)) ||
      (/^\.env(?:\.|$)/u.test(relativePath) && relativePath !== '.env.example')
    ) {
      findings.push(`${relativePath}: forbidden artifact path`);
      continue;
    }
    const path = resolve(root, relativePath);
    if (lstatSync(path).isSymbolicLink()) {
      findings.push(`${relativePath}: symbolic link is not allowed`);
      continue;
    }
    const size = statSync(path).size;
    if (size > 2_000_000) {
      findings.push(`${relativePath}: unexpected candidate size`);
      continue;
    }
    if (binaryExtensions.has(extname(relativePath).toLowerCase())) continue;
    const source = readFileSync(path, 'utf8');
    if (
      relativePath !== deliberateSecretFixture &&
      (/-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/u.test(source) ||
        /\b(?:sk|xox[baprs])-[A-Za-z0-9_-]{20,}\b/u.test(source))
    ) {
      findings.push(`${relativePath}: credential-shaped material`);
    }
  }

  const operationalSources = candidates.filter((path) =>
    /^(?:src\/(?:application\/operations|domain\/operations|entrypoints\/(?:job|rehearsal)\.ts|infrastructure\/operations|ports\/operations\.ts)|scripts\/operations|systemd\/)/u.test(
      path,
    ),
  );
  for (const relativePath of operationalSources) {
    const source = readFileSync(resolve(root, relativePath), 'utf8');
    if (
      /(?:from\s+|import\s*)['"](?:child_process|node:child_process|node:http|node:https|openclaw|@google|googleapis|powerschool)/iu.test(
        source,
      ) &&
      relativePath !== 'scripts/operations/verify-repository-safety.mjs' &&
      !isExactOfflineTelegramAdapter(relativePath, source) &&
      !isExactM17ManifestSupersession(relativePath, source)
    ) {
      findings.push(`${relativePath}: forbidden operational dependency`);
    }
  }

  for (const relativePath of candidates.filter((path) =>
    /^src\/.*\.(?:ts|mts|cts)$/u.test(path),
  )) {
    if (
      relativePath === offlineTelegramAdapter ||
      relativePath === telegramQualificationEntrypoint
    )
      continue;
    const source = readFileSync(resolve(root, relativePath), 'utf8');
    if (
      /(?:from\s+|import\s*)['"][^'"]*(?:telegram-alert-transport|config\/alert-delivery)(?:\.js)?['"]/u.test(
        source,
      )
    )
      findings.push(
        `${relativePath}: offline alert authority must remain unwired`,
      );
  }

  if (findings.length > 0) throw new Error(findings.join('\n'));
  return { candidates: candidates.length };
}

function isExactOfflineTelegramAdapter(relativePath, source) {
  if (relativePath !== offlineTelegramAdapter) return false;
  const required = [
    "import { request as httpsRequest } from 'node:https';",
    "const telegramHost = 'api.telegram.org';",
    "readonly method: 'POST';",
    'const requestTimeoutMs = 10_000;',
    'const maximumResponseBytes = 16 * 1024;',
    'path: `/bot${token}/sendMessage`,',
    "method: 'POST',",
    'agent: false,',
    'maxHeaderSize: 8 * 1024,',
  ];
  return (
    required.every((value) => source.includes(value)) &&
    (source.match(/from ['"]node:https['"]/gu)?.length ?? 0) === 1 &&
    !/(?:from\s+|import\s*)['"](?:child_process|node:child_process|node:http|openclaw|@google|googleapis|powerschool)['"]/iu.test(
      source,
    )
  );
}

function isExactM17ManifestSupersession(relativePath, source) {
  if (
    relativePath !== 'scripts/operations/supersede-m17-activation-manifest.mjs'
  )
    return false;
  const required = [
    "'sha256:2fda6668afbd28b2b3ee843e5ed42438cab30dacfdb496eb4c37e8ab74e925b2':",
    "'sha256:e84fdcc9a9ba7155d5b6382a3f191eae4f3f94f490228af418db52280e332a65':",
    "'sha256:3ef42b8d902a61b9add8afd6f15812f2076810050f9d275371d165922b2230bb':",
    "'sha256:69ccff3c358f0edd3cbd7a09f9e4d3ec8ccfac20eb2fe12a56f052903da99f7f':",
    "'sha256:41cc8a7ea7e73ba514862bdf72faaaa287ec19f28e6f603a4ae7dfbc475435d9':",
    "'sha256:c3b9540d6e30ef6a4e8d5e73b6ccd69a80c59f251f1d4d74ad7e9cafbace53da':",
    "const manifestPath = '/etc/chalkwright/canary/activation-manifest.json';",
    "'sha256:6e6997a560c68f2f52894a4bb63a07615edc63b0e7e1b33dd80e19a04a8a7056'",
    'digestText(manifest.tailnetTarget) !== expectedTailnetTargetHash',
    "'/usr/bin/systemctl',",
    "['show', '--property=ActiveState', '--value', unit]",
    "env: { LANG: 'C', LC_ALL: 'C', SYSTEMD_COLORS: '0' }",
    'timeout: 5_000,',
    "'/usr/bin/tailscale',",
    "['serve', 'status', '--json']",
    "env: { HOME: '/nonexistent', LANG: 'C', LC_ALL: 'C' }",
    'timeout: 10_000,',
    "killSignal: 'SIGKILL',",
    "serialized.includes('127.0.0.1:4319')",
    'constants.O_RDONLY | constants.O_NOFOLLOW',
    'renameSync(livePath, rejectedPath);',
    'digest(archivedManifest) !== expectedFingerprint',
    'fsyncDirectory(dirname(livePath));',
    'restoreManifest(livePath, rejectedPath, source.stat);',
  ];
  return (
    required.every((value) => source.includes(value)) &&
    (source.match(/from ['"]node:child_process['"]/gu)?.length ?? 0) === 1 &&
    (source.match(/spawnSync\s*\(/gu)?.length ?? 0) === 2 &&
    !/\b(?:execFile|execSync|fork|spawn)\s*\(/u.test(source) &&
    !/\b(?:rmSync|unlinkSync)\s*\(|systemctl',\s*\['(?:start|stop|enable|disable)|tailscale',\s*\['serve',\s*'(?:set|reset)'/u.test(
      source,
    )
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const result = verifyRepositorySafety();
    process.stdout.write(
      `Verified ${result.candidates} candidate paths for forbidden artifacts and operational dependencies.\n`,
    );
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'repository safety verification failed'}\n`,
    );
    process.exitCode = 1;
  }
}
