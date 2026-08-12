import { execFileSync } from 'node:child_process';
import { basename } from 'node:path';

const MAX_SCANNED_BLOB_BYTES = 8 * 1024 * 1024;
const MAX_PUBLISHED_BLOB_BYTES = 10 * 1024 * 1024;
const PERSONAL_HOME = ['/home', '/bren'].join('');
const PROTECTED_LEGACY = ['.openclaw-workonly', '/secrets'].join('');
const PRIVATE_EVIDENCE = ['.codex', '/visualizations/'].join('');

const CONTENT_RULES = [
  ['history-personal-home-path', Buffer.from(PERSONAL_HOME)],
  ['history-protected-path', Buffer.from(PROTECTED_LEGACY)],
  ['history-private-evidence-path', Buffer.from(PRIVATE_EVIDENCE)],
  [
    'history-private-key-material',
    Buffer.from(['-----BEGIN', 'PRIVATE KEY-----'].join(' ')),
  ],
  [
    'history-private-key-material',
    Buffer.from(['-----BEGIN', 'RSA PRIVATE KEY-----'].join(' ')),
  ],
];

const SECRET_PATTERNS = [
  /"(?:client_secret|refresh_token|private_key)"\s*:\s*"(?!placeholder|example|redacted)[^"\r\n]{16,}"/iu,
  /\b(?:github_pat_[A-Za-z0-9_]{30,}|ghp_[A-Za-z0-9]{30,})\b/u,
  /\bops_[A-Za-z0-9_-]{40,}\b/u,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/u,
  /\bAKIA[A-Z0-9]{16}\b/u,
  /\b\d{6,12}:[A-Za-z0-9_-]{24,}\b/u,
];

const RUNTIME_PATH =
  /(?:^|\/)(?:cookies?|login data|local state|storage-state\.json|[^/]+\.(?:sqlite3?|db|log|pem|p12))$/iu;

/** Audits every blob and author identity reachable from every local Git ref. */
export function auditReachableGitHistory(repositoryRoot) {
  const issues = new Map();
  const add = (code, path, count = 1) => {
    const key = `${code}\0${path}`;
    const existing = issues.get(key);
    issues.set(key, {
      code,
      path,
      count: (existing?.count ?? 0) + count,
    });
  };

  const objectLines = runGit(repositoryRoot, ['rev-list', '--objects', '--all'])
    .toString('utf8')
    .split('\n')
    .filter(Boolean);
  const pathsByObject = new Map();
  for (const line of objectLines) {
    const separator = line.indexOf(' ');
    if (separator < 0) continue;
    const objectId = line.slice(0, separator);
    const path = line.slice(separator + 1);
    if (path.length === 0) continue;
    const paths = pathsByObject.get(objectId) ?? new Set();
    paths.add(path);
    pathsByObject.set(objectId, paths);
  }

  for (const [objectId, paths] of pathsByObject) {
    const type = runGit(repositoryRoot, ['cat-file', '-t', objectId])
      .toString('ascii')
      .trim();
    if (type !== 'blob') continue;
    const sizeText = runGit(repositoryRoot, ['cat-file', '-s', objectId])
      .toString('ascii')
      .trim();
    const size = Number.parseInt(sizeText, 10);
    for (const path of paths) {
      if (RUNTIME_PATH.test(path)) add('history-runtime-artifact', path);
      if (size > MAX_PUBLISHED_BLOB_BYTES) add('history-oversized-blob', path);
    }
    if (
      !Number.isSafeInteger(size) ||
      size < 0 ||
      size > MAX_SCANNED_BLOB_BYTES
    )
      continue;
    const content = runGit(repositoryRoot, ['cat-file', 'blob', objectId], {
      encoding: 'buffer',
      maxBuffer: MAX_SCANNED_BLOB_BYTES + 1024,
    });
    for (const [code, needle] of CONTENT_RULES) {
      if (content.includes(needle)) {
        for (const path of paths) add(code, path);
      }
    }
    if (content.includes(0)) continue;
    const text = content.toString('utf8');
    if (SECRET_PATTERNS.some((pattern) => pattern.test(text))) {
      for (const path of paths) add('history-secret-material', path);
    }
  }

  const authorLines = runGit(repositoryRoot, [
    'log',
    '--all',
    '--format=%ae%n%ce',
  ])
    .toString('utf8')
    .split('\n')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const privateEmails = new Set(
    authorLines.filter((email) => !isPublicationSafeEmail(email)),
  );
  if (privateEmails.size > 0)
    add(
      'history-private-author-email',
      '<commit-metadata>',
      privateEmails.size,
    );

  return [...issues.values()].sort(
    (left, right) =>
      left.code.localeCompare(right.code) ||
      left.path.localeCompare(right.path),
  );
}

export function summarizeHistoryAudit(repositoryRoot) {
  const issues = auditReachableGitHistory(repositoryRoot);
  return Object.freeze({
    status: issues.length === 0 ? 'accepted' : 'rejected',
    issueCount: issues.length,
    issues,
    valuesPrinted: 0,
  });
}

function isPublicationSafeEmail(email) {
  return (
    email.endsWith('@users.noreply.github.com') ||
    email.endsWith('@example.com') ||
    email.endsWith('@example.invalid') ||
    email.endsWith('.invalid') ||
    email.endsWith('@localhost')
  );
}

function runGit(repositoryRoot, arguments_, overrides = {}) {
  try {
    return execFileSync('git', arguments_, {
      cwd: repositoryRoot,
      encoding: 'buffer',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
      ...overrides,
    });
  } catch {
    throw new Error(
      `publication-history-git-${basename(arguments_[0])}-failed`,
    );
  }
}
