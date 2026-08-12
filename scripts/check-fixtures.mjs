import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

import {
  inspectFixtureText,
  scanFixtureDirectory,
} from './lib/fixture-safety.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixtureDirectory = resolve(repositoryRoot, 'test/fixtures');
const m05Fixture = resolve(
  repositoryRoot,
  'src/infrastructure/fixture/b407.ts',
);
const findings = [
  ...scanFixtureDirectory(fixtureDirectory),
  ...inspectFixtureText(readFileSync(m05Fixture, 'utf8'), m05Fixture),
];

if (findings.length > 0) {
  for (const finding of findings) {
    process.stderr.write(`${finding.source}: rejected by ${finding.ruleId}\n`);
  }

  process.exitCode = 1;
} else {
  process.stdout.write('Synthetic fixture safety check passed.\n');
}
