import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const changelog = readFileSync(resolve(repositoryRoot, 'CHANGELOG.md'), 'utf8');

const failures = [];

if (!/^# Changelog\s*$/m.test(changelog)) {
  failures.push('CHANGELOG.md must contain a top-level Changelog heading.');
}

if (!/^## \[Unreleased\]\s*$/m.test(changelog)) {
  failures.push('CHANGELOG.md must contain an [Unreleased] section.');
}

if (failures.length > 0) {
  failures.forEach((failure) => process.stderr.write(`${failure}\n`));
  process.exitCode = 1;
} else {
  process.stdout.write('CHANGELOG.md structure is valid.\n');
}
