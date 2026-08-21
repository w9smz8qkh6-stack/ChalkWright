import assert from 'node:assert/strict';
import test from 'node:test';

import { importDriveGlossaryCourse } from '../../../src/application/glossary/import-drive.js';
import type { GlossaryCatalogImport } from '../../../src/domain/glossary.js';
import type { GlossaryCatalog } from '../../../src/ports/glossary-catalog.js';

test('resolves the year/course/Glossaries hierarchy and imports every CSV', async () => {
  const listed: string[] = [];
  const stored: GlossaryCatalogImport[] = [];
  const catalog: GlossaryCatalog = {
    async replaceSource(input) {
      stored.push(input);
      return { status: 'imported', acceptedCount: 1, rejectedCount: 0 };
    },
    async listClassSources() {
      return [];
    },
    async loadSource() {
      return undefined;
    },
    async loadMedia() {
      return undefined;
    },
  };
  const result = await importDriveGlossaryCourse({
    course: {
      classId: 'web-design-a' as never,
      subject: 'Web Design',
      courseName: 'Web Design',
      defaultLanguage: 'en',
    },
    academicYear: '2026-27',
    academicYearFolderId: 'year-folder-123',
    importedAt: '2035-04-13T01:00:00.000Z',
    requestTimeoutMs: 5_000,
    maximumPages: 2,
    maximumFiles: 12,
    signal: new AbortController().signal,
    catalog,
    transport: {
      async listChildren(request) {
        listed.push(request.parentId);
        if (request.parentId === 'year-folder-123')
          return {
            files: [
              {
                id: 'course-folder-123',
                name: 'Web Design',
                mimeType: 'application/vnd.google-apps.folder',
              },
            ],
          };
        if (request.parentId === 'course-folder-123')
          return {
            files: [
              {
                id: 'glossary-folder-123',
                name: 'Glossaries',
                mimeType: 'application/vnd.google-apps.folder',
              },
            ],
          };
        return {
          files: [
            {
              id: 'unit-2-file-123',
              name: 'Unit 2 Vocabulary.csv',
              mimeType: 'text/csv',
            },
            {
              id: 'unit-1-file-123',
              name: 'Unit 1 Vocabulary.csv',
              mimeType: 'text/csv',
            },
            { id: 'notes-file-123', name: 'Notes.txt', mimeType: 'text/plain' },
          ],
        };
      },
      async downloadCsv(request) {
        assert.match(request.fileId, /^unit-[12]-file-123$/u);
        return new TextEncoder().encode(
          `Term,Definition\n${request.fileId},Page arrangement\n`,
        );
      },
    },
  });
  assert.deepEqual(listed, [
    'year-folder-123',
    'course-folder-123',
    'glossary-folder-123',
  ]);
  assert.deepEqual(
    result.map((item) => item.status),
    ['imported', 'imported'],
  );
  assert.deepEqual(
    stored.map((item) => item.source.unitKey),
    ['1', '2'],
  );
  assert.deepEqual(
    stored.map((item) => item.entries[0]?.term),
    ['unit-1-file-123', 'unit-2-file-123'],
  );
  assert.equal(
    stored[0]?.source.sourceReference,
    'google-drive:glossary-folder-123/unit-1-file-123',
  );
});

test('rejects ambiguous exact course folders without downloading', async () => {
  let downloaded = false;
  await assert.rejects(
    importDriveGlossaryCourse({
      course: {
        classId: 'web-design-a' as never,
        subject: 'Web Design',
        courseName: 'Web Design',
        defaultLanguage: 'en',
      },
      academicYear: '2026-27',
      academicYearFolderId: 'year-folder-123',
      importedAt: '2035-04-13T01:00:00.000Z',
      requestTimeoutMs: 5_000,
      maximumPages: 2,
      maximumFiles: 12,
      signal: new AbortController().signal,
      catalog: {} as GlossaryCatalog,
      transport: {
        async listChildren() {
          return {
            files: ['course-folder-123', 'course-folder-456'].map((id) => ({
              id,
              name: 'Web Design',
              mimeType: 'application/vnd.google-apps.folder',
            })),
          };
        },
        async downloadCsv() {
          downloaded = true;
          return new Uint8Array();
        },
      },
    }),
    /glossary-drive-course-folder-ambiguous/u,
  );
  assert.equal(downloaded, false);
});

test('resolves an explicit bounded path below the course folder', async () => {
  const listed: string[] = [];
  await importDriveGlossaryCourse({
    course: {
      classId: 'computer-fundamentals' as never,
      subject: 'Computer Fundamentals',
      courseName: 'Computer Fundamentals (Grade 6)',
      className: 'Computer Fundamentals',
      defaultLanguage: 'en',
      glossaryFolderPath: [
        'Grade 6 CodeHS',
        'Additional Resources',
        'Unit Glossaries',
      ],
    },
    academicYear: '2026-27',
    academicYearFolderId: 'year-folder-123',
    importedAt: '2035-04-13T01:00:00.000Z',
    requestTimeoutMs: 5_000,
    maximumPages: 2,
    maximumFiles: 12,
    signal: new AbortController().signal,
    catalog: {
      async replaceSource(input) {
        return {
          status: 'imported',
          acceptedCount: input.entries.length,
          rejectedCount: 0,
        };
      },
      async listClassSources() {
        return [];
      },
      async loadSource() {
        return undefined;
      },
      async loadMedia() {
        return undefined;
      },
    },
    transport: {
      async listChildren(request) {
        listed.push(request.parentId);
        const child = new Map([
          [
            'year-folder-123',
            ['course-folder', 'Computer Fundamentals (Grade 6)'],
          ],
          ['course-folder', ['codehs-folder', 'Grade 6 CodeHS']],
          ['codehs-folder', ['resources-folder', 'Additional Resources']],
          ['resources-folder', ['glossary-folder', 'Unit Glossaries']],
        ]).get(request.parentId);
        if (child !== undefined)
          return {
            files: [
              {
                id: child[0]!,
                name: child[1]!,
                mimeType: 'application/vnd.google-apps.folder',
              },
            ],
          };
        return {
          files: [
            {
              id: 'unit-file-123',
              name: 'Unit 1 Glossary.csv',
              mimeType: 'text/csv',
            },
          ],
        };
      },
      async downloadCsv() {
        return new TextEncoder().encode(
          'Term,Definition\nAlgorithm,A sequence of steps\n',
        );
      },
    },
  });
  assert.deepEqual(listed, [
    'year-folder-123',
    'course-folder',
    'codehs-folder',
    'resources-folder',
    'glossary-folder',
  ]);
});
