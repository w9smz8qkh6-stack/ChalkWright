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
      !isExactOfflineTelegramAdapter(relativePath, source)
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
