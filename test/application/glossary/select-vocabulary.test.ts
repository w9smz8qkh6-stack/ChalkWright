import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { selectGlossaryVocabularyForPlan } from '../../../src/application/glossary/select-vocabulary.js';
import { normalizeGlossaryCsv } from '../../../src/application/glossary/csv-normalizer.js';
import { vocabularySelectionRecordKey } from '../../../src/domain/vocabulary.js';
import type { EffectiveDayPlan } from '../../../src/domain/plans.js';
import { SqliteClassroomEnrichmentCache } from '../../../src/infrastructure/sqlite/classroom-cache.js';
import { SqliteDatabase } from '../../../src/infrastructure/sqlite/database.js';
import { SqliteGlossaryCatalog } from '../../../src/infrastructure/sqlite/glossary-catalog.js';
import { SqliteApplicationStateRepository } from '../../../src/infrastructure/sqlite/repository.js';

test('selects and records one local glossary word per meeting, then reuses it', async () => {
  const root = mkdtempSync(join(tmpdir(), 'chalkwright-vocabulary-select-'));
  try {
    using database = new SqliteDatabase(join(root, 'state.sqlite'), {
      migration: { appliedAt: '2035-04-13T00:00:00.000Z' },
    });
    const catalog = new SqliteGlossaryCatalog(database);
    await catalog.replaceSource(
      normalizeGlossaryCsv({
        importId: 'import-a',
        source: {
          sourceGlossaryId: 'web-design-main',
          classId: 'web-design-a' as never,
          academicYear: '2034-35',
          sourceReference: 'google-drive:folder/file',
          importedAt: '2035-04-13T00:10:00.000Z',
        },
        defaultLanguage: 'en',
        csv: new TextEncoder().encode(
          'Term,Definition,Vietnamese Word,Vietnamese Definition\nlayout,The arrangement of a page,bố cục,Cách sắp xếp một trang\ncontrast,Visible difference,độ tương phản,Sự khác biệt dễ thấy\n',
        ),
      }),
    );
    let revision = 0;
    const state = new SqliteApplicationStateRepository(database, {
      clock: { now: () => '2035-04-13T01:00:00.000Z' },
      nextRevision: () => `selection-${++revision}`,
      academicYearEndForDate: () => '2035-06-30',
    });
    const plan = {
      contractVersion: '1.0.0',
      effectivePlanId: 'effective-a',
      canonicalPlanId: 'canonical-a',
      date: '2035-04-13',
      timeZone: 'Asia/Ho_Chi_Minh',
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
    const options = {
      plan,
      observedAt: '2035-04-13T01:00:00.000Z' as const,
      academicYear: '2034-35',
      academicYearEnd: '2035-06-30',
      courseConfigs: [
        {
          classId: 'web-design-a' as never,
          subject: 'Web Design',
          courseName: 'Web Design',
          defaultLanguage: 'en',
        },
      ],
      courseMappings: [
        {
          classId: 'web-design-a' as never,
          sectionCode: 'WD-1',
          providerCourseKey: '123456',
          roomId: 'room-a' as never,
        },
      ],
      catalog,
      classroomCache: new SqliteClassroomEnrichmentCache(database),
      state,
    };
    assert.deepEqual(await selectGlossaryVocabularyForPlan(options), {
      selected: 1,
      unchanged: 0,
      unavailable: 0,
    });
    assert.deepEqual(await selectGlossaryVocabularyForPlan(options), {
      selected: 0,
      unchanged: 1,
      unavailable: 0,
    });
    await catalog.replaceSource(
      normalizeGlossaryCsv({
        importId: 'import-b',
        source: {
          sourceGlossaryId: 'web-design-main',
          classId: 'web-design-a' as never,
          academicYear: '2034-35',
          sourceReference: 'google-drive:folder/file',
          importedAt: '2035-04-13T00:20:00.000Z',
        },
        defaultLanguage: 'en',
        csv: new TextEncoder().encode(
          'Term,Definition,Vietnamese Word,Vietnamese Definition\nLayout,The updated arrangement of a page,Bố cục,Cách sắp xếp trang đã cập nhật\nContrast,Updated visible difference,Độ tương phản,Sự khác biệt dễ thấy đã cập nhật\n',
        ),
      }),
    );
    assert.deepEqual(await selectGlossaryVocabularyForPlan(options), {
      selected: 1,
      unchanged: 0,
      unavailable: 0,
    });
    const refreshed = await state.findRecord({
      kind: 'vocabulary-selection',
      recordKey: vocabularySelectionRecordKey(
        'web-design-a' as never,
        'meeting-a' as never,
      ),
      date: plan.date,
      classId: 'web-design-a' as never,
      meetingId: 'meeting-a' as never,
    });
    assert.equal(refreshed?.kind, 'vocabulary-selection');
    if (refreshed?.kind !== 'vocabulary-selection')
      throw new Error('selection-missing');
    assert.match(refreshed.data.selection.candidate?.term ?? '', /^[A-Z]/u);
    assert.match(
      refreshed.data.selection.candidate?.definition ?? '',
      /updated/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
