import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { publicationSummary } from './lib/publication-safety.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const summary = publicationSummary(root);
process.stdout.write(`${JSON.stringify(summary)}\n`);
if (summary.status !== 'passed') process.exitCode = 1;
