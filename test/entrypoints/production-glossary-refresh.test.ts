import assert from 'node:assert/strict';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { EffectiveDayPlan } from '../../src/domain/plans.js';
import { runProductionGlossaryRefresh } from '../../src/entrypoints/production-glossary-refresh.js';
import { SqliteDatabase } from '../../src/infrastructure/sqlite/database.js';
import { SqliteDisplayContentProjection } from '../../src/infrastructure/sqlite/display-content-projection.js';
import { SqliteApplicationStateRepository } from '../../src/infrastructure/sqlite/repository.js';

test('production glossary refresh imports Drive CSV and publishes a provider-free meeting selection', async () => {
  const fixture = createFixture();
  try {
    const database = new SqliteDatabase(fixture.databasePath, {
      migration: { appliedAt: '2035-04-13T00:00:00.000Z' },
    });
    const state = new SqliteApplicationStateRepository(database, {
      clock: { now: () => '2035-04-13T00:10:00.000Z' },
      nextRevision: () => 'plan-revision',
      academicYearEndForDate: () => '2035-06-30',
    });
    assert.equal((await state.storeEffective(fixture.plan)).status, 'stored');
    database.close();
    const output = await runProductionGlossaryRefresh({
      arguments: [],
      environment: fixture.environment,
      now: () => '2035-04-13T01:00:00.000Z',
      transportForRun: () => ({
        async listChildren(request) {
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
                id: 'vocabulary-file-123',
                name: 'Vocabulary.csv',
                mimeType: 'text/csv',
              },
            ],
          };
        },
        async downloadCsv() {
          return new TextEncoder().encode(
            'term,definition,language,lessons,sample_sentence_en,term_vi,definition_vi,sample_sentence_vi,term_ko,definition_ko,sample_sentence_ko,term_zh,definition_zh,sample_sentence_zh\nlayout,The arrangement of a page,en,1,Use layout to organize the page.,bố cục,Cách sắp xếp một trang,Dùng bố cục để sắp xếp trang.,레이아웃,페이지 배열,레이아웃으로 페이지를 구성하세요.,布局,页面的排列方式,使用布局组织页面。\n',
          );
        },
      }),
    });
    assert.deepEqual(output, {
      exitCode: 0,
      status: 'succeeded',
      imported: 1,
      unchangedImports: 0,
      selected: 1,
      unchangedSelections: 0,
      unavailableSelections: 0,
    });
    using verified = new SqliteDatabase(fixture.databasePath, {
      migration: { appliedAt: '2035-04-13T01:01:00.000Z' },
    });
    const card = new SqliteDisplayContentProjection(verified).read(
      'web-design-a' as never,
      '2035-04-13',
      'meeting-a',
    ).vocabularyCard;
    assert.equal(card?.vocabulary?.term, 'layout');
    assert.equal(card?.vocabulary?.vietnamese?.term, 'bố cục');
    assert.deepEqual(
      card?.vocabulary?.translations?.map(
        (translation) => translation.languageCode,
      ),
      ['vi', 'ko', 'zh-Hans'],
    );
    assert.equal(card?.vocabulary?.example, 'Use layout to organize the page.');
  } finally {
    fixture.close();
  }
});

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), 'chalkwright-production-glossary-'));
  const protectedRoot = join(root, 'protected');
  const managedRoot = join(root, 'production');
  const stateRoot = join(managedRoot, 'state');
  const backupDirectory = join(managedRoot, 'backups');
  mkdirSync(protectedRoot, { mode: 0o700 });
  mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
  mkdirSync(backupDirectory, { mode: 0o700 });
  chmodSync(root, 0o700);
  chmodSync(protectedRoot, 0o700);
  const databasePath = join(stateRoot, 'chalkwright.sqlite');
  const productionPath = join(protectedRoot, 'server.json');
  const glossaryPath = join(protectedRoot, 'glossary.json');
  const production = {
    version: 1,
    instanceId: 'chalkwright-test-production',
    roomId: 'room-a',
    screenId: 'screen-a',
    screenLabel: 'Test screen',
    host: '127.0.0.1',
    port: 17_451,
    timeZone: 'UTC',
    academicYearEnd: '2035-06-30',
    managedRoot,
    databasePath,
    backupDirectory,
    operatorTokenReference: join(protectedRoot, 'operator-token'),
    courseMappings: [
      {
        classId: 'web-design-a',
        sectionCode: 'WD-1',
        providerCourseKey: '123456',
      },
    ],
    checkInOpenMinutesBefore: 10,
    dismissalWarningMinutesBefore: 5,
  };
  const glossary = {
    version: 1,
    academicYear: '2034-35',
    academicYearFolderId: 'year-folder-123',
    credentialReferencePath: join(protectedRoot, 'drive-reader.json'),
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
  writeFileSync(productionPath, JSON.stringify(production), { mode: 0o600 });
  writeFileSync(glossaryPath, JSON.stringify(glossary), { mode: 0o600 });
  const plan = {
    contractVersion: '1.0.0',
    effectivePlanId: 'effective-a',
    canonicalPlanId: 'canonical-a',
    date: '2035-04-13',
    timeZone: 'UTC',
    roomId: 'room-a',
    screenId: 'screen-a',
    verification: 'verified',
    meetings: [
      {
        meetingId: 'meeting-a',
        courseKey: 'WD-1',
        blockLabel: 'Block 1',
        checkInOpensAt: '2035-04-13T00:50:00.000Z',
        officialStartsAt: '2035-04-13T01:00:00.000Z',
        checkInClosesAt: '2035-04-13T01:00:00.000Z',
        contentStartsAt: '2035-04-13T01:00:00.000Z',
        dismissalStartsAt: '2035-04-13T01:40:00.000Z',
        officialEndsAt: '2035-04-13T01:45:00.000Z',
      },
    ],
    diagnostics: [],
  } as unknown as EffectiveDayPlan;
  return {
    root,
    databasePath,
    plan,
    environment: {
      CLASSROOM_HUB_PRODUCTION_CONFIG_REFERENCE: productionPath,
      CLASSROOM_HUB_GLOSSARY_CONFIG_REFERENCE: glossaryPath,
    },
    close: () => rmSync(root, { recursive: true, force: true }),
  };
}
