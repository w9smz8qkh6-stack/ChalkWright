import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { loadGoogleDriveGlossaryConfig } from '../../src/config/google-drive-glossary.js';

function payload(root: string) {
  return {
    version: 1,
    academicYear: '2026-27',
    academicYearFolderId: 'year-folder-123',
    credentialReferencePath: join(root, 'drive-reader.json'),
    requestTimeoutSeconds: 15,
    maximumPagesPerSource: 3,
    maximumFilesPerCourse: 20,
    courses: [
      {
        classId: 'web-design-a',
        subject: 'Web Design',
        courseName: 'Web Design',
        defaultLanguage: 'en',
      },
    ],
  };
}

test('loads a protected exact hierarchy mapping without reading credentials', () => {
  const root = mkdtempSync(join(tmpdir(), 'chalkwright-glossary-config-'));
  const path = join(root, 'glossary.json');
  try {
    chmodSync(root, 0o700);
    writeFileSync(path, JSON.stringify(payload(root)), { mode: 0o600 });
    const config = loadGoogleDriveGlossaryConfig(path, '/repository');
    assert.equal(config.academicYearFolderId, 'year-folder-123');
    assert.equal(config.courses[0]?.courseName, 'Web Design');
    assert.equal(config.maximumFilesPerCourse, 20);
    assert.equal(config.requestTimeoutMs, 15_000);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects duplicate class bindings and unexpected fields', () => {
  const root = mkdtempSync(join(tmpdir(), 'chalkwright-glossary-config-'));
  const path = join(root, 'glossary.json');
  try {
    chmodSync(root, 0o700);
    const base = payload(root);
    for (const value of [
      {
        ...base,
        courses: [...base.courses, { ...base.courses[0] }],
      },
      { ...base, unexpected: true },
    ]) {
      writeFileSync(path, JSON.stringify(value), { mode: 0o600 });
      assert.throws(
        () => loadGoogleDriveGlossaryConfig(path, '/repository'),
        /glossary-config-invalid|protected-json-invalid/u,
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
