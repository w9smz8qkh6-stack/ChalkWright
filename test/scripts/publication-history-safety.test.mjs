import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  auditReachableGitHistory,
  summarizeHistoryAudit,
} from '../../scripts/lib/publication-history-safety.mjs';

test('accepts history containing only safe source and noreply metadata', () => {
  const repository = createRepository();
  writeFileSync(join(repository, 'README.md'), '# Safe project\n', 'utf8');
  commit(repository, 'safe baseline');

  assert.deepEqual(summarizeHistoryAudit(repository), {
    status: 'accepted',
    issueCount: 0,
    issues: [],
    valuesPrinted: 0,
  });
});

test('reports private history by code and path without returning values', () => {
  const repository = createRepository();
  const personalPath = ['/home', '/bren/private'].join('');
  const privateKeyMarker = ['-----BEGIN', 'PRIVATE KEY-----'].join(' ');
  writeFileSync(
    join(repository, 'unsafe.txt'),
    `${personalPath}\n${privateKeyMarker}\n`,
    'utf8',
  );
  commit(repository, 'unsafe baseline', 'maintainer@personal.invalid.test');

  const issues = auditReachableGitHistory(repository);
  assert.ok(
    issues.some(
      (issue) =>
        issue.code === 'history-personal-home-path' &&
        issue.path === 'unsafe.txt',
    ),
  );
  assert.ok(
    issues.some(
      (issue) =>
        issue.code === 'history-private-key-material' &&
        issue.path === 'unsafe.txt',
    ),
  );
  assert.ok(
    issues.some(
      (issue) =>
        issue.code === 'history-private-author-email' &&
        issue.path === '<commit-metadata>',
    ),
  );
  assert.equal(JSON.stringify(issues).includes(personalPath), false);
  assert.equal(JSON.stringify(issues).includes('maintainer@'), false);
});

function createRepository() {
  const repository = mkdtempSync(join(tmpdir(), 'classroom-hub-history-'));
  git(repository, ['init', '--quiet']);
  git(repository, ['config', 'user.name', 'Classroom Hub Test']);
  git(repository, [
    'config',
    'user.email',
    '12345+classroom-hub@users.noreply.github.com',
  ]);
  return repository;
}

function commit(repository, message, email) {
  if (email !== undefined) git(repository, ['config', 'user.email', email]);
  git(repository, ['add', '.']);
  git(repository, ['commit', '--quiet', '-m', message]);
}

function git(repository, arguments_) {
  execFileSync('git', arguments_, {
    cwd: repository,
    stdio: ['ignore', 'ignore', 'ignore'],
  });
}
