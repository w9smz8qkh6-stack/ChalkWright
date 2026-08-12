import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Bind the complete TypeScript source, compiled JavaScript, and fixed build files. */
export function completeRuntimeImplementationFingerprint(options: {
  readonly anchorSourcePath: string;
  readonly errorCode: string;
  readonly additionalRepositoryPaths?: readonly string[];
}): string {
  const repositoryRoot = runtimeRepositoryRoot(
    options.anchorSourcePath,
    options.errorCode,
  );
  const compiledRoot = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../..',
  );
  const sourcePaths = collectRegularFiles(
    join(repositoryRoot, 'src'),
    '.ts',
    options.errorCode,
  );
  const compiledPaths = collectRegularFiles(
    compiledRoot,
    '.js',
    options.errorCode,
  );
  const fixedPaths = [
    join(repositoryRoot, 'package.json'),
    join(repositoryRoot, 'package-lock.json'),
    join(repositoryRoot, 'tsconfig.json'),
    join(repositoryRoot, 'tsconfig.build.json'),
  ];
  const hash = createHash('sha256');
  hashFiles(hash, 'source', repositoryRoot, sourcePaths, options.errorCode);
  hashFiles(hash, 'build', compiledRoot, compiledPaths, options.errorCode);
  hashFiles(hash, 'fixed', repositoryRoot, fixedPaths, options.errorCode);
  const additionalPaths = collectAdditionalRepositoryPaths(
    repositoryRoot,
    options.additionalRepositoryPaths ?? [],
    options.errorCode,
  );
  hashFiles(
    hash,
    'additional',
    repositoryRoot,
    additionalPaths,
    options.errorCode,
  );
  return `sha256:${hash.digest('hex')}`;
}

function collectAdditionalRepositoryPaths(
  repositoryRoot: string,
  relativePaths: readonly string[],
  errorCode: string,
): string[] {
  const files: string[] = [];
  const visit = (path: string): void => {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error(errorCode);
    if (stat.isFile()) {
      if (stat.nlink !== 1) throw new Error(errorCode);
      files.push(path);
      return;
    }
    if (!stat.isDirectory()) throw new Error(errorCode);
    for (const entry of readdirSync(path, { withFileTypes: true }))
      visit(join(path, entry.name));
  };
  try {
    for (const relativePath of relativePaths) {
      if (
        relativePath.length === 0 ||
        relativePath.startsWith('/') ||
        relativePath.split('/').includes('..')
      )
        throw new Error(errorCode);
      visit(join(repositoryRoot, relativePath));
    }
    return [...new Set(files)].sort();
  } catch (error) {
    if (error instanceof Error && error.message === errorCode) throw error;
    throw new Error(errorCode);
  }
}

function collectRegularFiles(
  root: string,
  suffix: string,
  errorCode: string,
): string[] {
  const files: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(errorCode);
      if (entry.isDirectory()) {
        visit(path);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(suffix)) files.push(path);
    }
  };
  try {
    visit(root);
    return files.sort();
  } catch (error) {
    if (error instanceof Error && error.message === errorCode) throw error;
    throw new Error(errorCode);
  }
}

function hashFiles(
  hash: ReturnType<typeof createHash>,
  kind: string,
  root: string,
  paths: readonly string[],
  errorCode: string,
): void {
  try {
    for (const path of paths) {
      const stat = lstatSync(path);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
        throw new Error(errorCode);
      const bytes = readFileSync(path);
      const relativePath = path.startsWith(`${root}/`)
        ? path.slice(root.length + 1)
        : path;
      hash.update(`${kind}:${relativePath}:${bytes.length}:`);
      hash.update(bytes);
    }
  } catch (error) {
    if (error instanceof Error && error.message === errorCode) throw error;
    throw new Error(errorCode);
  }
}

function runtimeRepositoryRoot(
  anchorSourcePath: string,
  errorCode: string,
): string {
  let candidate = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 7; depth += 1) {
    if (
      existsSync(join(candidate, 'package-lock.json')) &&
      existsSync(join(candidate, anchorSourcePath))
    )
      return candidate;
    const parent = dirname(candidate);
    if (parent === candidate) break;
    candidate = parent;
  }
  throw new Error(errorCode);
}
