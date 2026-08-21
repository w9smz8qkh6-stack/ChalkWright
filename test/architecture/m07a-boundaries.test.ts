import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');

test('passive PowerSchool acquisition cannot import mutation or repair capabilities', () => {
  for (const path of [
    'src/infrastructure/powerschool/adapter.ts',
    'src/infrastructure/powerschool/passive-http.ts',
    'src/infrastructure/powerschool/browser-read.ts',
    'src/infrastructure/powerschool/browser-transport.ts',
    'src/application/read-only/acquire-canonical-plan.ts',
    'src/application/read-only/powerschool-characterization.ts',
    'src/entrypoints/powerschool-characterization.ts',
  ]) {
    const source = read(path);
    for (const forbidden of [
      'calendar-writer',
      'local-command',
      'persistence-write',
      'child_process',
    ]) {
      assert.equal(
        source.toLowerCase().includes(forbidden),
        false,
        `${path}: ${forbidden}`,
      );
    }
    assert.doesNotMatch(source, /from ['"].*authentication-repair/u, path);
    assert.doesNotMatch(
      source,
      /from ['"].*openclaw|openclaw\s+(?:run|invoke)/iu,
      path,
    );
  }
});

test('M-07B source-less preflight cannot construct profile, repair, persistence, or provider mutation capability', () => {
  const application = read(
    'src/application/read-only/powerschool-characterization.ts',
  );
  const entrypoint = read('src/entrypoints/powerschool-characterization.ts');
  const combined = `${application}\n${entrypoint}`.toLowerCase();
  for (const forbidden of [
    'playwright',
    'authentication-repair',
    'calendar-writer',
    'persistence-write',
    'sqlite',
    'node:http',
    'node:https',
    'child_process',
  ]) {
    assert.equal(combined.includes(forbidden), false, forbidden);
  }
  assert.doesNotMatch(
    combined,
    /from ['"].*(?:browser-read|passive-http|browser-transport)/u,
  );
  assert.match(application, /method: 'GET'/u);
  assert.doesNotMatch(application, /method:\s*request/u);
  assert.match(entrypoint, /Source-less M-07B preflight entrypoint/u);
  assert.doesNotMatch(entrypoint, /characterizePowerSchoolOnce/u);
});

test('obsolete managed-profile characterization execution is absent', () => {
  for (const path of [
    'src/entrypoints/powerschool-characterization-supervisor.ts',
    'src/entrypoints/powerschool-characterization-child.ts',
  ]) {
    assert.equal(existsSync(join(root, path)), false, path);
  }
  const browser = read('src/infrastructure/powerschool/browser-read.ts');
  assert.doesNotMatch(browser, /managed-powerschool|\.openclaw-workonly/iu);
});

test('browser boundary contains no active DOM or form interaction API', () => {
  const source = `${read('src/infrastructure/powerschool/browser-read.ts')}\n${read('src/infrastructure/powerschool/browser-transport.ts')}`;
  for (const api of [
    '.click(',
    '.fill(',
    '.press(',
    '.type(',
    '.evaluate(',
    '.dispatchEvent(',
    '.setInputFiles(',
    '.selectOption(',
  ]) {
    assert.equal(source.includes(api), false, api);
  }
  assert.match(source, /method !== 'GET'.*method !== 'HEAD'/s);
});

test('M-07A adapter is not reachable from production entrypoints', () => {
  for (const path of [
    'src/index.ts',
    'src/entrypoints/job.ts',
    'src/entrypoints/rehearsal.ts',
  ]) {
    assert.equal(read(path).includes('powerschool'), false, path);
  }
});

test('provider-neutral contracts and persisted state expose no browser profile or cookie shape', () => {
  for (const path of [
    'src/domain/plans.ts',
    'src/contracts/v1/schedule.ts',
    'src/ports/read-sources.ts',
    'src/infrastructure/sqlite/migrations.ts',
  ]) {
    const source = read(path).toLowerCase();
    for (const forbidden of [
      'userdata',
      'browserprofile',
      'cookieheader',
      'playwright',
    ]) {
      assert.equal(source.includes(forbidden), false, `${path}: ${forbidden}`);
    }
  }
});
