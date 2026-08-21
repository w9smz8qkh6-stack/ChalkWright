import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { ClassId } from '../../../src/domain/identities.js';
import { stableSerialize } from '../../../src/domain/pure-values.js';
import { vocabularySelectionRecordKey } from '../../../src/domain/vocabulary.js';
import { SqliteDatabase } from '../../../src/infrastructure/sqlite/database.js';
import { SqliteDisplayContentProjection } from '../../../src/infrastructure/sqlite/display-content-projection.js';
import { SqliteApplicationStateRepository } from '../../../src/infrastructure/sqlite/repository.js';

function checksum(value: unknown): string {
  return createHash('sha256').update(stableSerialize(value)).digest('hex');
}

test('projects copied static lesson content and complete meeting-scoped bilingual vocabulary without provider access', () => {
  const root = mkdtempSync(join(tmpdir(), 'chalkwright-content-projection-'));
  try {
    using database = new SqliteDatabase(join(root, 'state.sqlite'), {
      migration: { appliedAt: '2035-04-13T00:00:00.000Z' },
    });
    const content = {
      snapshotId: 'content-alpha',
      classId: 'class-alpha',
      screenId: 'screen-alpha',
      roomId: 'room-alpha',
      date: '2035-04-13',
      refreshedAt: '2035-04-13T00:10:00.000Z',
      items: [
        {
          type: 'bellringer',
          title: 'Bellringer: Inspect the mechanism',
          lines: ['Use the lesson reference diagram.'],
          durationSeconds: 12,
        },
      ],
      diagnostics: [],
    };
    const vocabulary = {
      selectionId: 'vocabulary-alpha',
      classId: 'class-alpha',
      meetingKey: 'meeting-alpha',
      date: '2035-04-13',
      term: 'iteration',
      definition: 'A repeated process.',
      source: 'subject',
      partOfSpeech: 'noun',
      example: 'The design improves with each iteration.',
      vietnamese: {
        term: 'sự lặp lại',
        definition: 'Một quá trình được lặp lại.',
      },
      selectionContext: {
        assignmentRefs: [],
        classroomCourseId: 'course-alpha',
        meetingDate: '2035-04-13',
        vocabularyPolicy: 'unused_focused',
        vocabularyReuse: 'new',
        candidateCount: 1,
        usedCandidateCount: 0,
        unusedCandidateCount: 1,
      },
    };
    const insert = database.connection.prepare(
      `INSERT INTO continuity_records(
         collection, identity, checksum, record_json, source_reference, imported_at
       ) VALUES (?, ?, ?, ?, ?, ?)`,
    );
    insert.run(
      'contentSnapshots',
      content.snapshotId,
      checksum(content),
      stableSerialize(content),
      'fixture:content',
      '2035-04-13T00:20:00.000Z',
    );
    const olderContent = {
      ...content,
      snapshotId: 'content-older',
      refreshedAt: '2035-04-13T00:05:00.000Z',
      items: [
        {
          type: 'bellringer',
          title: 'Older copied lesson',
          lines: ['This must not replace the newer snapshot.'],
        },
      ],
    };
    insert.run(
      'contentSnapshots',
      olderContent.snapshotId,
      checksum(olderContent),
      stableSerialize(olderContent),
      'fixture:older-content',
      '2035-04-13T00:21:00.000Z',
    );
    insert.run(
      'vocabularySelections',
      vocabulary.selectionId,
      checksum(vocabulary),
      stableSerialize(vocabulary),
      'fixture:vocabulary',
      '2035-04-13T00:20:00.000Z',
    );

    const projection = new SqliteDisplayContentProjection(database).read(
      'class-alpha' as ClassId,
      '2035-04-13',
      'meeting-alpha',
    );
    assert.equal(projection.staticContent.items?.[0]?.type, 'bellringer');
    assert.equal(
      projection.staticContent.items?.[0]?.title,
      'Bellringer: Inspect the mechanism',
    );
    assert.equal(
      projection.vocabularyCard?.vocabulary?.vietnamese?.term,
      'sự lặp lại',
    );
    assert.equal(projection.vocabularyCard?.vocabulary?.partOfSpeech, 'noun');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('prefers a validated native meeting selection over copied continuity vocabulary', async () => {
  const root = mkdtempSync(join(tmpdir(), 'chalkwright-native-vocabulary-'));
  try {
    using database = new SqliteDatabase(join(root, 'state.sqlite'), {
      migration: { appliedAt: '2035-04-13T00:00:00.000Z' },
    });
    const repository = new SqliteApplicationStateRepository(database, {
      clock: { now: () => '2035-04-13T01:00:00.000Z' },
      nextRevision: () => 'native-vocabulary-revision',
    });
    const classId = 'class-alpha' as ClassId;
    const result = await repository.storeRecord({
      kind: 'vocabulary-selection',
      recordKey: vocabularySelectionRecordKey(classId, 'meeting-alpha'),
      scope: {
        date: '2035-04-13',
        classId,
        meetingId: 'meeting-alpha',
      },
      data: {
        selection: {
          candidate: {
            term: 'semantic HTML',
            definition: 'Markup that communicates meaning.',
            source: 'class',
            partOfSpeech: 'noun',
            vietnamese: {
              term: 'HTML ngữ nghĩa',
              definition: 'Mã đánh dấu truyền đạt ý nghĩa.',
            },
          },
          accent: 'ink',
          durationSeconds: 12,
          diagnostics: [],
        },
      },
    });
    assert.equal(result.status, 'stored');
    const projected = new SqliteDisplayContentProjection(database).read(
      classId,
      '2035-04-13',
      'meeting-alpha',
    );
    assert.equal(projected.vocabularyCard?.vocabulary?.term, 'semantic HTML');
    assert.equal(
      projected.vocabularyCard?.vocabulary?.vietnamese?.term,
      'HTML ngữ nghĩa',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
