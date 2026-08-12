import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { summarizeHistoryAudit } from './lib/publication-history-safety.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

try {
  const result = summarizeHistoryAudit(repositoryRoot);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.status !== 'accepted') process.exitCode = 1;
} catch {
  process.stdout.write(
    `${JSON.stringify({
      status: 'rejected',
      issueCount: 1,
      issues: [
        {
          code: 'publication-history-audit-failed',
          path: '<git-history>',
          count: 1,
        },
      ],
      valuesPrinted: 0,
    })}\n`,
  );
  process.exitCode = 1;
}
