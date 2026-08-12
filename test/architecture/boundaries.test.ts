import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import test from 'node:test';

const repositoryRoot = resolve('.');
const sourceRoot = resolve(repositoryRoot, 'src');
const domainRoot = resolve(sourceRoot, 'domain');
const contractsRoot = resolve(sourceRoot, 'contracts/v1');
const portsRoot = resolve(sourceRoot, 'ports');
const readOnlyApplicationRoot = resolve(sourceRoot, 'application/read-only');
const allowedReadOnlyPortFiles = new Set([
  resolve(sourceRoot, 'ports/persistence-read.js'),
  resolve(sourceRoot, 'ports/read-only.js'),
  resolve(sourceRoot, 'ports/read-sources.js'),
]);

function typeScriptFilesUnder(directory: string): readonly string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);

    if (entry.isDirectory()) {
      return typeScriptFilesUnder(path);
    }

    return entry.isFile() && path.endsWith('.ts') ? [path] : [];
  });
}

function importedModules(source: string): readonly string[] {
  const staticImports = [
    ...source.matchAll(
      /\b(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/g,
    ),
  ].flatMap((match) => (match[1] === undefined ? [] : [match[1]]));
  const dynamicImports = [
    ...source.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g),
  ].flatMap((match) => (match[1] === undefined ? [] : [match[1]]));

  return [...staticImports, ...dynamicImports];
}

function isWithin(path: string, directory: string): boolean {
  return path === directory || path.startsWith(`${directory}${sep}`);
}

test('keeps the domain import graph pure and provider-neutral', () => {
  for (const file of typeScriptFilesUnder(domainRoot)) {
    for (const moduleName of importedModules(readFileSync(file, 'utf8'))) {
      assert.ok(
        moduleName.startsWith('.'),
        `${file} cannot import external runtime package ${moduleName}`,
      );

      const importedPath = resolve(dirname(file), moduleName);
      assert.ok(
        isWithin(importedPath, domainRoot) ||
          isWithin(importedPath, contractsRoot),
        `${file} imports outside the pure domain/contract boundary: ${moduleName}`,
      );
      assert.doesNotMatch(
        moduleName,
        /adapter|calendar|display|http|infrastructure|openclaw|provider|ui/i,
      );
    }
  }
});

test('keeps port contracts independent of adapters and runtime frameworks', () => {
  for (const file of typeScriptFilesUnder(portsRoot)) {
    for (const moduleName of importedModules(readFileSync(file, 'utf8'))) {
      assert.ok(
        moduleName.startsWith('.'),
        `${file} cannot import external runtime package ${moduleName}`,
      );

      const importedPath = resolve(dirname(file), moduleName);
      assert.ok(
        isWithin(importedPath, portsRoot) ||
          isWithin(importedPath, domainRoot) ||
          isWithin(importedPath, contractsRoot),
        `${file} imports an implementation outside the port boundary: ${moduleName}`,
      );
    }
  }
});

test('keeps read-only orchestration unable to import mutation capabilities', () => {
  for (const file of typeScriptFilesUnder(readOnlyApplicationRoot)) {
    const source = readFileSync(file, 'utf8');

    assert.doesNotMatch(
      source,
      /calendar-writer|local-command|persistence-write|PlanSnapshotWriter|CalendarWriterPort|LocalCommandPort/,
      `${file} must not receive or import a mutation capability`,
    );

    for (const moduleName of importedModules(source)) {
      assert.ok(
        moduleName.startsWith('.'),
        `${file} cannot import external runtime package ${moduleName}`,
      );

      const importedPath = resolve(dirname(file), moduleName);
      assert.ok(
        isWithin(importedPath, readOnlyApplicationRoot) ||
          isWithin(importedPath, domainRoot) ||
          isWithin(importedPath, contractsRoot) ||
          allowedReadOnlyPortFiles.has(importedPath),
        `${file} imports a capability outside the read-only allowlist: ${moduleName}`,
      );
    }
  }
});

test('keeps mutation ports out of the read-only port surface', () => {
  const readOnlyExports = readFileSync('src/ports/read-only.ts', 'utf8');

  assert.match(readOnlyExports, /persistence-read/);
  assert.match(readOnlyExports, /read-sources/);
  assert.doesNotMatch(
    readOnlyExports,
    /calendar-writer|local-command|persistence-write/,
  );

  for (const file of [
    'src/ports/persistence-read.ts',
    'src/ports/read-only.ts',
    'src/ports/read-sources.ts',
  ]) {
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(
      source,
      /calendar-writer|local-command|persistence-write|CalendarWriterPort|LocalCommandPort|PlanSnapshotWriter/,
      `${file} must remain transitively read-only`,
    );

    for (const moduleName of importedModules(source)) {
      const importedPath = resolve(dirname(resolve(file)), moduleName);
      assert.ok(
        isWithin(importedPath, domainRoot) ||
          isWithin(importedPath, contractsRoot) ||
          allowedReadOnlyPortFiles.has(importedPath),
        `${file} imports a port outside the transitive read-only allowlist: ${moduleName}`,
      );
    }
  }
});

test('keeps the canonical plan module independent of output technologies', () => {
  const planSource = readFileSync('src/domain/plans.ts', 'utf8');

  assert.doesNotMatch(planSource, /contracts\/v1\/(?:calendar|display)/);
  assert.doesNotMatch(planSource, /openclaw/i);
});
