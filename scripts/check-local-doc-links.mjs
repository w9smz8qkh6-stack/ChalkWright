import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ignoredDirectories = new Set([
  '.git',
  '.test-dist',
  'coverage',
  'dist',
  'node_modules',
]);

function markdownFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) {
      if (ignoredDirectories.has(entry.name)) {
        return [];
      }

      return markdownFiles(resolve(directory, entry.name));
    }

    const path = resolve(directory, entry.name);
    return entry.isFile() && extname(path).toLowerCase() === '.md'
      ? [path]
      : [];
  });
}

function headingSlug(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/<[^>]*>/g, '')
    .replace(/[`*_~]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function anchorsFor(path) {
  const counts = new Map();
  const anchors = new Set();
  const contents = readFileSync(path, 'utf8');

  for (const match of contents.matchAll(/^#{1,6}\s+(.+?)\s*#*$/gm)) {
    const base = headingSlug(match[1]);
    const count = counts.get(base) ?? 0;
    counts.set(base, count + 1);
    anchors.add(count === 0 ? base : `${base}-${count}`);
  }

  return anchors;
}

function parseDestination(raw) {
  const destination = raw.trim().replace(/^<|>$/g, '');
  const match = destination.match(/^(\S+?)(?:\s+["'][^"']*["'])?$/);
  return match?.[1] ?? destination;
}

const failures = [];
let checkedLinks = 0;

for (const sourcePath of markdownFiles(repositoryRoot)) {
  const contents = readFileSync(sourcePath, 'utf8');

  for (const match of contents.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
    const destination = parseDestination(match[1]);

    if (
      destination === '' ||
      /^(?:https?:|mailto:|tel:|data:)/i.test(destination)
    ) {
      continue;
    }

    const [encodedPath, encodedAnchor] = destination.split('#', 2);
    let decodedPath;
    let decodedAnchor;

    try {
      decodedPath = decodeURIComponent(encodedPath);
      decodedAnchor = encodedAnchor
        ? decodeURIComponent(encodedAnchor).toLowerCase()
        : undefined;
    } catch {
      failures.push(
        `${relative(repositoryRoot, sourcePath)}: invalid encoding in ${destination}`,
      );
      continue;
    }

    const targetPath = decodedPath
      ? resolve(dirname(sourcePath), decodedPath)
      : sourcePath;
    checkedLinks += 1;

    if (!existsSync(targetPath)) {
      failures.push(
        `${relative(repositoryRoot, sourcePath)}: missing ${destination}`,
      );
      continue;
    }

    if (statSync(targetPath).isDirectory()) {
      failures.push(
        `${relative(repositoryRoot, sourcePath)}: link must name a file: ${destination}`,
      );
      continue;
    }

    if (
      decodedAnchor &&
      extname(targetPath).toLowerCase() === '.md' &&
      !anchorsFor(targetPath).has(decodedAnchor)
    ) {
      failures.push(
        `${relative(repositoryRoot, sourcePath)}: missing anchor #${decodedAnchor} in ${relative(repositoryRoot, targetPath)}`,
      );
    }
  }
}

if (failures.length > 0) {
  failures.forEach((failure) => process.stderr.write(`${failure}\n`));
  process.exitCode = 1;
} else {
  process.stdout.write(`Verified ${checkedLinks} local documentation links.\n`);
}
