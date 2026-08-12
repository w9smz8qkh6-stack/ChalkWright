import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const toolingIndex = readFileSync(
  resolve(repositoryRoot, 'docs/tooling.md'),
  'utf8',
);
const urls = [
  ...new Set(
    [...toolingIndex.matchAll(/\]\((https:\/\/[^)]+)\)/g)].map(
      (match) => match[1],
    ),
  ),
];

async function request(url, method) {
  const response = await fetch(url, {
    method,
    redirect: 'follow',
    headers: {
      'user-agent': 'classroom-hub-doc-link-check/1.0',
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (response.ok) {
    await response.body?.cancel();
    return;
  }

  await response.body?.cancel();
  throw new Error(`${method} returned HTTP ${response.status}`);
}

async function check(url) {
  try {
    await request(url, 'HEAD');
  } catch (headError) {
    try {
      await request(url, 'GET');
    } catch (getError) {
      throw new Error(`${url}: ${headError.message}; ${getError.message}`);
    }
  }

  process.stdout.write(`ok ${url}\n`);
}

const results = await Promise.allSettled(urls.map(check));
const failures = results.filter((result) => result.status === 'rejected');

if (failures.length > 0) {
  for (const failure of failures) {
    process.stderr.write(`${failure.reason.message}\n`);
  }

  process.exitCode = 1;
} else {
  process.stdout.write(
    `Verified ${urls.length} canonical documentation links.\n`,
  );
}
