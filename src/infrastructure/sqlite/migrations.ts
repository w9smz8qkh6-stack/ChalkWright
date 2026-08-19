import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import { isIsoInstant } from '../../domain/runtime-validation.js';

export interface SchemaMigration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}

export const schemaMigrations: readonly SchemaMigration[] = [
  {
    version: 1,
    name: 'application-state',
    sql: `
      CREATE TABLE plan_snapshots (
        snapshot_id TEXT PRIMARY KEY,
        plan_kind TEXT NOT NULL CHECK (plan_kind IN ('canonical', 'effective')),
        plan_id TEXT NOT NULL,
        canonical_plan_id TEXT NOT NULL DEFAULT '',
        date_scope TEXT NOT NULL,
        room_id TEXT NOT NULL,
        screen_id TEXT NOT NULL DEFAULT '',
        contract_version TEXT NOT NULL,
        verification TEXT NOT NULL CHECK (verification IN ('verified', 'unverified', 'synthetic')),
        payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
        semantic_hash TEXT NOT NULL,
        revision TEXT NOT NULL,
        academic_year_end TEXT,
        created_at TEXT NOT NULL,
        superseded_at TEXT
      ) STRICT;

      CREATE UNIQUE INDEX plan_snapshots_current_canonical_scope
        ON plan_snapshots(date_scope, room_id)
        WHERE plan_kind = 'canonical' AND superseded_at IS NULL;
      CREATE UNIQUE INDEX plan_snapshots_current_effective_scope
        ON plan_snapshots(date_scope, screen_id)
        WHERE plan_kind = 'effective' AND superseded_at IS NULL;
      CREATE INDEX plan_snapshots_history_scope
        ON plan_snapshots(plan_kind, date_scope, room_id, screen_id, created_at DESC);

      CREATE TABLE application_records (
        record_id TEXT PRIMARY KEY,
        record_kind TEXT NOT NULL CHECK (record_kind IN (
          'schedule-observation', 'configuration', 'mapping', 'content', 'vocabulary-selection',
          'vocabulary-history', 'attendance', 'override', 'hold',
          'calendar-ownership-candidate', 'calendar-reconciliation-state',
          'job-run', 'comparison-evidence', 'temporary-operational-state'
        )),
        record_key TEXT NOT NULL,
        date_scope TEXT NOT NULL DEFAULT '',
        screen_id TEXT NOT NULL DEFAULT '',
        room_id TEXT NOT NULL DEFAULT '',
        class_id TEXT NOT NULL DEFAULT '',
        meeting_id TEXT NOT NULL DEFAULT '',
        plan_id TEXT NOT NULL DEFAULT '',
        payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
        semantic_hash TEXT NOT NULL,
        revision TEXT NOT NULL,
        academic_year_end TEXT,
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
        created_at TEXT NOT NULL,
        superseded_at TEXT,
        expires_at TEXT
      ) STRICT;

      CREATE UNIQUE INDEX application_records_current_scope
        ON application_records(
          record_kind, record_key, date_scope, screen_id, room_id, class_id,
          meeting_id, plan_id
        ) WHERE superseded_at IS NULL;
      CREATE UNIQUE INDEX application_records_current_hold_scope
        ON application_records(date_scope, screen_id, meeting_id, plan_id)
        WHERE record_kind = 'hold' AND superseded_at IS NULL;
      CREATE INDEX application_records_retention
        ON application_records(record_kind, expires_at, superseded_at);
      CREATE INDEX application_records_scope
        ON application_records(
          record_kind, date_scope, screen_id, room_id, class_id, meeting_id,
          plan_id, created_at DESC
        );
    `,
  },
  {
    version: 2,
    name: 'import-evidence',
    sql: `
      CREATE TABLE import_runs (
        import_id TEXT PRIMARY KEY,
        source_reference TEXT NOT NULL,
        semantic_hash TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('imported', 'unchanged', 'rejected')),
        accepted_count INTEGER NOT NULL CHECK (accepted_count >= 0),
        rejected_count INTEGER NOT NULL CHECK (rejected_count >= 0),
        started_at TEXT NOT NULL,
        finished_at TEXT NOT NULL
      ) STRICT;

      CREATE UNIQUE INDEX import_runs_idempotency
        ON import_runs(source_reference, semantic_hash);

      CREATE TABLE import_rejections (
        import_id TEXT NOT NULL REFERENCES import_runs(import_id) ON DELETE CASCADE,
        ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
        category TEXT NOT NULL CHECK (category IN (
          'malformed-input', 'unknown-field', 'forbidden-field', 'corrupt-record'
        )),
        code TEXT NOT NULL,
        field_path TEXT NOT NULL,
        PRIMARY KEY (import_id, ordinal)
      ) STRICT;

      CREATE TABLE continuity_records (
        collection TEXT NOT NULL CHECK (collection IN (
          'configurationSnapshots', 'mappings', 'scheduleObservations', 'canonicalPlans',
          'effectivePlans', 'contentSnapshots', 'vocabularySelections',
          'vocabularyHistory', 'attendanceAggregates', 'scopedOverrides',
          'carouselHolds', 'calendarOwnershipCandidates', 'jobRuns',
          'comparisonEvidence', 'temporaryOperationalState'
        )),
        identity TEXT NOT NULL,
        checksum TEXT NOT NULL,
        record_json TEXT NOT NULL CHECK (json_valid(record_json)),
        source_reference TEXT NOT NULL,
        imported_at TEXT NOT NULL,
        PRIMARY KEY (collection, identity)
      ) STRICT;

      CREATE INDEX import_runs_retention ON import_runs(finished_at);
      CREATE INDEX continuity_records_source
        ON continuity_records(source_reference, imported_at);
    `,
  },
  {
    version: 3,
    name: 'operations-state',
    sql: `
      CREATE TABLE application_records_v3 (
        record_id TEXT PRIMARY KEY,
        record_kind TEXT NOT NULL CHECK (record_kind IN (
          'schedule-observation', 'configuration', 'mapping', 'content', 'vocabulary-selection',
          'vocabulary-history', 'attendance', 'override', 'hold',
          'calendar-ownership-candidate', 'calendar-reconciliation-state',
          'alert-state', 'job-run', 'comparison-evidence', 'temporary-operational-state'
        )),
        record_key TEXT NOT NULL,
        date_scope TEXT NOT NULL DEFAULT '',
        screen_id TEXT NOT NULL DEFAULT '',
        room_id TEXT NOT NULL DEFAULT '',
        class_id TEXT NOT NULL DEFAULT '',
        meeting_id TEXT NOT NULL DEFAULT '',
        plan_id TEXT NOT NULL DEFAULT '',
        payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
        semantic_hash TEXT NOT NULL,
        revision TEXT NOT NULL,
        academic_year_end TEXT,
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
        created_at TEXT NOT NULL,
        superseded_at TEXT,
        expires_at TEXT
      ) STRICT;

      INSERT INTO application_records_v3
        SELECT * FROM application_records;
      DROP TABLE application_records;
      ALTER TABLE application_records_v3 RENAME TO application_records;

      CREATE UNIQUE INDEX application_records_current_scope
        ON application_records(
          record_kind, record_key, date_scope, screen_id, room_id, class_id,
          meeting_id, plan_id
        ) WHERE superseded_at IS NULL;
      CREATE UNIQUE INDEX application_records_current_hold_scope
        ON application_records(date_scope, screen_id, meeting_id, plan_id)
        WHERE record_kind = 'hold' AND superseded_at IS NULL;
      CREATE INDEX application_records_retention
        ON application_records(record_kind, expires_at, superseded_at);
      CREATE INDEX application_records_scope
        ON application_records(
          record_kind, date_scope, screen_id, room_id, class_id, meeting_id,
          plan_id, created_at DESC
        );
    `,
  },
  {
    version: 4,
    name: 'classroom-enrichment-cache',
    sql: `
      CREATE TABLE classroom_enrichment_cache (
        class_id TEXT NOT NULL,
        observed_for_date TEXT NOT NULL,
        payload_json TEXT CHECK (payload_json IS NULL OR json_valid(payload_json)),
        semantic_hash TEXT,
        refreshed_at TEXT,
        expires_at TEXT,
        consecutive_failures INTEGER NOT NULL DEFAULT 0
          CHECK (consecutive_failures BETWEEN 0 AND 32),
        last_attempt_at TEXT NOT NULL,
        next_attempt_at TEXT,
        last_error_code TEXT,
        PRIMARY KEY (class_id, observed_for_date),
        CHECK ((payload_json IS NULL) = (semantic_hash IS NULL)),
        CHECK ((payload_json IS NULL) = (refreshed_at IS NULL)),
        CHECK ((payload_json IS NULL) = (expires_at IS NULL))
      ) STRICT;

      CREATE INDEX classroom_enrichment_cache_refresh
        ON classroom_enrichment_cache(next_attempt_at, expires_at);
    `,
  },
  {
    version: 5,
    name: 'calendar-writer-coordination',
    sql: `
      CREATE TABLE calendar_writer_leases (
        scope_id TEXT PRIMARY KEY,
        lease_id TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        acquired_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        CHECK (length(scope_id) BETWEEN 1 AND 128),
        CHECK (length(lease_id) BETWEEN 1 AND 128),
        CHECK (length(owner_id) BETWEEN 1 AND 128),
        CHECK (acquired_at < expires_at)
      ) STRICT;

      CREATE TABLE calendar_execution_journal (
        execution_fingerprint TEXT PRIMARY KEY,
        manifest_fingerprint TEXT NOT NULL,
        scope_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
        started_at TEXT NOT NULL,
        finished_at TEXT,
        CHECK (length(execution_fingerprint) = 71),
        CHECK (length(manifest_fingerprint) = 71),
        CHECK (length(scope_id) BETWEEN 1 AND 128),
        CHECK (
          (status = 'running' AND finished_at IS NULL) OR
          (status IN ('succeeded', 'failed') AND finished_at IS NOT NULL)
        )
      ) STRICT;

      CREATE TABLE calendar_execution_steps (
        execution_fingerprint TEXT NOT NULL
          REFERENCES calendar_execution_journal(execution_fingerprint)
          ON DELETE CASCADE,
        intent_id TEXT NOT NULL,
        intent_kind TEXT NOT NULL
          CHECK (intent_kind IN ('no-op', 'create', 'replace', 'delete')),
        status TEXT NOT NULL
          CHECK (status IN ('pending', 'attempted', 'succeeded', 'failed')),
        outcome TEXT
          CHECK (outcome IS NULL OR outcome IN (
            'no-op', 'mutated', 'already-converged', 'refused'
          )),
        provider_reference_hash TEXT,
        error_code TEXT,
        PRIMARY KEY (execution_fingerprint, intent_id),
        CHECK (length(intent_id) BETWEEN 1 AND 128),
        CHECK (
          provider_reference_hash IS NULL OR
          length(provider_reference_hash) = 71
        ),
        CHECK (error_code IS NULL OR length(error_code) BETWEEN 1 AND 128)
      ) STRICT;

      CREATE INDEX calendar_execution_journal_scope
        ON calendar_execution_journal(scope_id, started_at DESC);
    `,
  },
  {
    version: 6,
    name: 'bounded-calendar-intent-identities',
    sql: `
      CREATE TABLE calendar_execution_steps_v6 (
        execution_fingerprint TEXT NOT NULL
          REFERENCES calendar_execution_journal(execution_fingerprint)
          ON DELETE CASCADE,
        intent_id TEXT NOT NULL,
        intent_kind TEXT NOT NULL
          CHECK (intent_kind IN ('no-op', 'create', 'replace', 'delete')),
        status TEXT NOT NULL
          CHECK (status IN ('pending', 'attempted', 'succeeded', 'failed')),
        outcome TEXT
          CHECK (outcome IS NULL OR outcome IN (
            'no-op', 'mutated', 'already-converged', 'refused'
          )),
        provider_reference_hash TEXT,
        error_code TEXT,
        PRIMARY KEY (execution_fingerprint, intent_id),
        CHECK (length(intent_id) BETWEEN 1 AND 512),
        CHECK (
          provider_reference_hash IS NULL OR
          length(provider_reference_hash) = 71
        ),
        CHECK (error_code IS NULL OR length(error_code) BETWEEN 1 AND 128)
      ) STRICT;

      INSERT INTO calendar_execution_steps_v6(
        execution_fingerprint, intent_id, intent_kind, status, outcome,
        provider_reference_hash, error_code
      )
      SELECT execution_fingerprint, intent_id, intent_kind, status, outcome,
             provider_reference_hash, error_code
      FROM calendar_execution_steps;

      DROP TABLE calendar_execution_steps;
      ALTER TABLE calendar_execution_steps_v6 RENAME TO calendar_execution_steps;
    `,
  },
  {
    version: 7,
    name: 'offline-glossary-catalog',
    sql: `
      CREATE TABLE glossary_sources (
        source_glossary_id TEXT PRIMARY KEY,
        class_id TEXT NOT NULL,
        class_name TEXT,
        academic_year TEXT NOT NULL,
        unit_key TEXT,
        lesson_topic TEXT,
        source_reference TEXT NOT NULL,
        source_format TEXT NOT NULL CHECK (source_format IN ('csv', 'manual')),
        content_hash TEXT NOT NULL,
        imported_at TEXT NOT NULL,
        CHECK (length(source_glossary_id) BETWEEN 1 AND 256),
        CHECK (length(class_id) BETWEEN 1 AND 128),
        CHECK (class_name IS NULL OR length(class_name) BETWEEN 1 AND 256),
        CHECK (length(academic_year) BETWEEN 4 AND 32),
        CHECK (unit_key IS NULL OR length(unit_key) BETWEEN 1 AND 128),
        CHECK (lesson_topic IS NULL OR length(lesson_topic) BETWEEN 1 AND 512),
        CHECK (length(source_reference) BETWEEN 1 AND 2048),
        CHECK (length(content_hash) = 71)
      ) STRICT;

      CREATE TABLE glossary_entries (
        entry_id TEXT PRIMARY KEY,
        source_glossary_id TEXT NOT NULL REFERENCES glossary_sources(source_glossary_id)
          ON DELETE CASCADE,
        source_row_key TEXT NOT NULL,
        source_language TEXT NOT NULL,
        term TEXT NOT NULL,
        definition TEXT NOT NULL,
        part_of_speech TEXT,
        example TEXT,
        pronunciation TEXT,
        created_at TEXT NOT NULL,
        CHECK (length(entry_id) BETWEEN 1 AND 256),
        CHECK (length(source_row_key) BETWEEN 1 AND 256),
        CHECK (length(source_language) BETWEEN 2 AND 35),
        CHECK (length(term) BETWEEN 1 AND 512),
        CHECK (length(definition) BETWEEN 1 AND 8192),
        CHECK (part_of_speech IS NULL OR length(part_of_speech) BETWEEN 1 AND 128),
        CHECK (example IS NULL OR length(example) BETWEEN 1 AND 8192),
        CHECK (pronunciation IS NULL OR length(pronunciation) BETWEEN 1 AND 512),
        UNIQUE (source_glossary_id, source_row_key)
      ) STRICT;

      CREATE TABLE glossary_translations (
        translation_id TEXT PRIMARY KEY,
        entry_id TEXT NOT NULL REFERENCES glossary_entries(entry_id) ON DELETE CASCADE,
        language_code TEXT NOT NULL,
        translated_term TEXT,
        translated_definition TEXT,
        translated_part_of_speech TEXT,
        translated_example TEXT,
        origin TEXT NOT NULL CHECK (origin IN ('teacher', 'machine')),
        review_status TEXT NOT NULL CHECK (review_status IN ('unreviewed', 'reviewed', 'rejected')),
        generator_reference TEXT,
        created_at TEXT NOT NULL,
        CHECK (length(translation_id) BETWEEN 1 AND 256),
        CHECK (length(language_code) BETWEEN 2 AND 35),
        CHECK (translated_term IS NOT NULL OR translated_definition IS NOT NULL OR translated_part_of_speech IS NOT NULL OR translated_example IS NOT NULL),
        CHECK (translated_term IS NULL OR length(translated_term) BETWEEN 1 AND 512),
        CHECK (translated_definition IS NULL OR length(translated_definition) BETWEEN 1 AND 8192),
        CHECK (translated_part_of_speech IS NULL OR length(translated_part_of_speech) BETWEEN 1 AND 128),
        CHECK (translated_example IS NULL OR length(translated_example) BETWEEN 1 AND 8192),
        CHECK (generator_reference IS NULL OR length(generator_reference) BETWEEN 1 AND 512),
        CHECK ((origin = 'teacher' AND generator_reference IS NULL) OR origin = 'machine')
      ) STRICT;

      CREATE TABLE glossary_media (
        media_id TEXT PRIMARY KEY,
        entry_id TEXT NOT NULL REFERENCES glossary_entries(entry_id) ON DELETE CASCADE,
        translation_id TEXT REFERENCES glossary_translations(translation_id) ON DELETE CASCADE,
        language_code TEXT NOT NULL,
        media_role TEXT NOT NULL CHECK (media_role IN (
          'term-pronunciation', 'definition-pronunciation',
          'translated-term-pronunciation', 'translated-definition-pronunciation',
          'illustration', 'supplementary'
        )),
        mime_type TEXT NOT NULL,
        byte_length INTEGER NOT NULL,
        content_sha256 TEXT NOT NULL,
        content BLOB NOT NULL,
        origin TEXT NOT NULL CHECK (origin IN ('teacher', 'machine')),
        review_status TEXT NOT NULL CHECK (review_status IN ('unreviewed', 'reviewed', 'rejected')),
        attribution TEXT,
        license_reference TEXT,
        created_at TEXT NOT NULL,
        CHECK (length(media_id) BETWEEN 1 AND 256),
        CHECK (length(language_code) BETWEEN 2 AND 35),
        CHECK (length(mime_type) BETWEEN 3 AND 128),
        CHECK (byte_length BETWEEN 1 AND 5242880),
        CHECK (length(content_sha256) = 71),
        CHECK (length(content) = byte_length),
        CHECK (attribution IS NULL OR length(attribution) BETWEEN 1 AND 2048),
        CHECK (license_reference IS NULL OR length(license_reference) BETWEEN 1 AND 2048),
        CHECK (
          (media_role IN ('translated-term-pronunciation', 'translated-definition-pronunciation') AND translation_id IS NOT NULL) OR
          (media_role NOT IN ('translated-term-pronunciation', 'translated-definition-pronunciation') AND translation_id IS NULL)
        )
      ) STRICT;

      CREATE TABLE glossary_import_runs (
        import_id TEXT PRIMARY KEY,
        source_glossary_id TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('imported', 'unchanged', 'rejected')),
        accepted_count INTEGER NOT NULL CHECK (accepted_count >= 0),
        rejected_count INTEGER NOT NULL CHECK (rejected_count >= 0),
        imported_at TEXT NOT NULL,
        FOREIGN KEY (source_glossary_id) REFERENCES glossary_sources(source_glossary_id)
      ) STRICT;

      CREATE INDEX glossary_sources_class_scope
        ON glossary_sources(class_id, academic_year, unit_key);
      CREATE INDEX glossary_entries_source
        ON glossary_entries(source_glossary_id, term);
      CREATE INDEX glossary_translations_entry
        ON glossary_translations(entry_id, language_code);
      CREATE INDEX glossary_media_entry
        ON glossary_media(entry_id, translation_id, media_role);
    `,
  },
] as const;

const migrationTableSql = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    checksum TEXT NOT NULL,
    applied_at TEXT NOT NULL
  ) STRICT;
`;

export function migrationChecksum(migration: SchemaMigration): string {
  return createHash('sha256')
    .update(`${migration.version}\n${migration.name}\n${migration.sql}`)
    .digest('hex');
}

export interface MigrationOptions {
  readonly appliedAt: string;
  readonly targetVersion?: number;
  readonly beforeCommit?: (
    migration: SchemaMigration,
    database: DatabaseSync,
  ) => unknown;
}

interface AppliedMigrationRow {
  readonly version: number;
  readonly name: string;
  readonly checksum: string;
}

function rollback(database: DatabaseSync): void {
  if (database.isTransaction) database.exec('ROLLBACK');
}

function isThenable(value: unknown): boolean {
  if (
    value === null ||
    (typeof value !== 'object' && typeof value !== 'function')
  )
    return false;
  try {
    return typeof Reflect.get(value, 'then') === 'function';
  } catch {
    return true;
  }
}

export function applyMigrations(
  database: DatabaseSync,
  options: MigrationOptions,
): number {
  if (!isIsoInstant(options.appliedAt))
    throw new Error('schema-migration-applied-at-invalid');
  database.exec(migrationTableSql);
  const rows = database
    .prepare(
      'SELECT version, name, checksum FROM schema_migrations ORDER BY version',
    )
    .all() as unknown as AppliedMigrationRow[];
  for (const [index, row] of rows.entries()) {
    const expected = schemaMigrations[index];
    if (
      expected === undefined ||
      row.version !== index + 1 ||
      row.name !== expected.name ||
      row.checksum !== migrationChecksum(expected)
    ) {
      throw new Error('schema-migration-history-invalid');
    }
  }
  const userVersion = Number(
    (
      database.prepare('PRAGMA user_version').get() as unknown as {
        readonly user_version?: number;
      }
    ).user_version,
  );
  if (userVersion !== rows.length) {
    throw new Error('schema-user-version-mismatch');
  }
  const targetVersion = options.targetVersion ?? schemaMigrations.length;
  if (
    !Number.isInteger(targetVersion) ||
    targetVersion < 0 ||
    targetVersion > schemaMigrations.length
  ) {
    throw new Error('schema-migration-target-invalid');
  }
  if (rows.length > targetVersion) {
    throw new Error('schema-downgrade-not-supported');
  }
  for (const migration of schemaMigrations.slice(rows.length, targetVersion)) {
    try {
      database.exec('BEGIN IMMEDIATE');
      database.exec(migration.sql);
      database
        .prepare(
          `INSERT INTO schema_migrations(version, name, checksum, applied_at)
           VALUES (?, ?, ?, ?)`,
        )
        .run(
          migration.version,
          migration.name,
          migrationChecksum(migration),
          options.appliedAt,
        );
      database.exec(`PRAGMA user_version = ${migration.version}`);
      const callbackResult = options.beforeCommit?.(migration, database);
      if (isThenable(callbackResult))
        throw new Error('async-sqlite-migration-callback-not-supported');
      database.exec('COMMIT');
    } catch (error) {
      rollback(database);
      throw error;
    }
  }
  const finalUserVersion = Number(
    (
      database.prepare('PRAGMA user_version').get() as unknown as {
        readonly user_version?: number;
      }
    ).user_version,
  );
  if (finalUserVersion !== targetVersion) {
    throw new Error('schema-user-version-mismatch');
  }
  return targetVersion;
}
