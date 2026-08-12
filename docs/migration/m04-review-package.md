# M-04 SQLite persistence and continuity review package

- **Plan step:** M-04 — Add SQLite schema, migrations, and continuity importer
- **Status:** Completed after three adversarial review rounds and an independent
  final review; approved for the local M-04 baseline
- **Prerequisite:** Approved M-03 baseline (`f1dc4b9`) and accepted U-013 policy
  in [ADR-0013](../decisions/0013-state-retention-and-recovery.md)
- **Evidence boundary:** Repository code and synthetic databases beneath test
  temporary directories only

## Scope delivered

The candidate adds the infrastructure boundary for versioned application state
without adding a package dependency or accessing legacy/runtime databases.

- `src/ports/application-state.ts` defines a finite union of safe application
  record kinds and database-neutral reader/writer capabilities. The union
  covers normalized schedule observations with provenance/freshness,
  configuration, mappings, content, vocabulary selections/history,
  attendance aggregates and links, overrides, screen/meeting/plan holds, Calendar
  ownership candidates and successful reconciliation state, job runs,
  comparison evidence, and temporary operational state.
- `src/infrastructure/sqlite/migrations.ts` defines two numbered, forward-only
  migrations. Version 1 creates plan snapshots and scoped application records;
  version 2 adds continuity-import runs, redacted rejections, and accepted
  continuity records.
- `src/infrastructure/sqlite/database.ts` owns the SQLite connection,
  mode-`0600` database files, migrations, bounded synchronous transactions,
  foreign-key enforcement, and integrity/foreign-key checks.
- `src/infrastructure/sqlite/repository.ts` implements the plan and
  application-state ports. It retains version history, permits one current
  canonical row per date/room and one current effective row per date/screen,
  treats semantic repeats as no-ops only after validating stored payloads,
  validates payload hashes, identity, complete row/query scope, and complete
  runtime contracts on read, and can return the most recent valid historical
  value when a newer row is corrupt within the requested scope. Holds never
  recover superseded state.
- `src/application/persistence/continuity-importer.ts` accepts a versioned,
  explicitly allowlisted safe-continuity document and produces a deterministic
  prevalidated import batch. It rejects unknown, malformed, conflicting, or
  forbidden material using structural paths and stable codes rather than input
  values.
- `src/infrastructure/sqlite/continuity-import.ts` applies one prevalidated
  batch and its import-run evidence atomically. Repeated source/hash imports and
  already-present identical records are semantic no-ops; identity/checksum
  conflicts or corrupt stored JSON/checksum pairs reject without changing
  continuity records.
- `src/infrastructure/sqlite/backup.ts` creates integrity-checked SQLite
  backups, writes checksum/catalog metadata, restores only to a new managed
  target, selects and prunes the accepted backup tiers, and calculates the
  approved application-data retention boundaries.

This scope does not add provider adapters, HTTP behavior, operational job
scheduling, Calendar execution, or live migration behavior.

## Independent-review corrections

The initial candidate passed its quality gate but failed an adversarial review.
The first correction pass addressed its eight reported gaps:

1. runtime validation is total and serialization-safe for hostile objects and
   exact dense JSON structures;
2. safe-state reads bind payload identity/full scope to row and query metadata;
3. continuity enums, nested contracts, plan invariants, and stored-row schema
   validation are exact at the documented synthetic boundary;
4. expiry pruning rejects a non-normalized cutoff before any transaction;
5. semantic no-ops validate stored payloads rather than trusting stored hashes;
6. backup pruning recomputes byte length and SHA-256 before any deletion;
7. holds are plan-bound, concurrency-safe, and preserve audited lifecycle
   transitions instead of deleting or resurrecting history; and
8. Calendar state advancement is correlated to the complete successful job
   result rather than its category alone.

A second adversarial review confirmed those areas were substantially corrected
and exposed four remaining fail-closed gaps. This candidate additionally:

9. rejects stale-hold invalidation before `heldAt` and revalidates every
   internally constructed state record before transaction writes;
10. requires every nested configuration snapshot value rather than accepting a
    partial policy/configuration record;
11. takes one descriptor-only detached continuity snapshot before validation,
    identity extraction, and cloning, rejecting accessors and other non-data
    structures; and
12. requires a real canonical UTC instant before calculating configuration
    retention; and
13. permits a released or expired hold to begin a new lifecycle only through a
    revision-checked transition, while retaining the prior terminal revision.

A third independent re-review then exposed fail-closed gaps outside the payload
validators. The candidate now also:

14. validates repository-generated clock instants, revisions, academic-year
    dates, and migration application instants before any corresponding write;
15. requires Calendar advancement to have a scoped requested date, a clean
    successful outcome with all attempted mutations completed, and no error or
    incident codes; and
16. rejects promise and promise-like migration/transaction callbacks before
    commit so asynchronous work cannot escape the synchronous transaction.

## SQLite schema and migration contract

The current schema contains six application-owned tables:

| Table                 | Purpose and material constraints                                                                                                                                                                                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `schema_migrations`   | Ordered version, name, SHA-256 migration checksum, and application instant. Applied history must be contiguous and byte-compatible with the repository migration, and its length must equal SQLite `PRAGMA user_version`.                                                                              |
| `plan_snapshots`      | Canonical/effective plan JSON plus explicit date, room, screen, contract version, verification, semantic hash, revision, academic-year end, creation, and supersession metadata. Partial unique indexes permit one current canonical row per date/room and one current effective row per date/screen.  |
| `application_records` | Allowlisted application-state JSON plus normalized date/screen/room/class/meeting/plan scope, semantic hash, revision, activity, expiry, creation, and supersession metadata. Partial unique indexes permit one current row per kind/key/full scope and one current hold per date/screen/meeting/plan. |
| `import_runs`         | Source reference, semantic hash, imported/unchanged/rejected status, redacted counts, and bounded timing evidence, with a source/hash idempotency constraint.                                                                                                                                          |
| `import_rejections`   | Ordered rejection category, stable code, and structural field path; the foreign key cascades from its import run.                                                                                                                                                                                      |
| `continuity_records`  | Allowlisted collection, identity, checksum, validated JSON, source reference, and import instant, unique by collection and identity.                                                                                                                                                                   |

All domain tables are `STRICT`; JSON columns require valid JSON; enum/count
columns use checks; and query/retention indexes are explicit. Migration 0, 1,
and 2 targets are tested. Each unapplied migration runs inside its own
`BEGIN IMMEDIATE` transaction, records its checksum only inside that
transaction, and rolls back fully on failure. Downgrades, gaps, checksum/name
changes, invalid targets, nested transactions, and asynchronous transaction
callbacks fail closed. Migration application instants are validated before the
ledger table is created, and promise-like migration callbacks roll back the
schema, ledger, and `user_version` together.

Every open/migration attempt also requires the contiguous checksummed ledger
and `PRAGMA user_version` to agree before applying work. Each committed
migration advances both transactionally; mismatches in either direction fail
closed.

Forward-only means rollback uses a verified pre-migration backup or a discarded
test database, not an unreviewed down migration.

## Repository and transaction behavior

Plan and safe-state writes use SHA-256 over stable serialization to distinguish
a semantic no-op from a new revision. A changed write supersedes the prior
current row and inserts the replacement in one immediate transaction. Multi-
record writes are all-or-nothing. Calendar reconciliation state can advance
with a job-run record only when the run is clean and successful, all attempted
mutations completed, error and incident codes are empty, and its complete
date-bearing scope, output fingerprint, latest-state reference, completion
instant, and requested date match the proposed state. Generated write instants,
revision identifiers, and academic-year boundaries validate before their first
state-changing statement.

The repository validates every mandatory root, scope, data, and nested field;
exact keys; types; finite numbers; enums; real ISO dates; normalized UTC
instants; required IANA timezones; scope relationships; forbidden material;
serialized size; contract version; and semantic hash. Sparse or augmented
arrays, accessors, cycles, proxies, undefined/non-finite values, and other
objects that cannot round-trip exactly fail closed without escaping repository
error handling. Readers bind the payload kind, key, and full scope to both row
metadata and the query, then skip invalid/corrupt rows, preserving
last-known-good behavior only when valid history exists in that same scope.
Effective reads require the screen's expected room, so a room reassignment can
never recover an older row from the screen's prior room. SQLite details remain
behind the M-02 persistence ports.

Holds require date, screen, meeting, and effective-plan identity. Releases,
safety expiries, meeting changes, and stale-plan invalidations supersede the
held row with an auditable transition instead of deleting hold history.
Superseded hold history is never used as last-known-good state, and expected-
revision writes plus a unique current hold scope reject stale concurrent
commands. Invalidation cannot precede `heldAt`; every internally constructed
record passes the same safe-state validator before writing. Instant
relationships use epoch ordering rather than lexical spelling. Generic expiry
pruning excludes hold history and validates its normalized cutoff instant
before opening the transaction. A released or expired hold can be activated
again for the same plan/meeting only by presenting the current terminal
revision and a new `heldAt` at or after that terminal transition; generic and
stale writes remain rejected.

## Continuity import boundary

The format currently allowlists these 15 collections:

1. configuration snapshots;
2. mappings;
3. normalized schedule observations with provenance and freshness;
4. canonical plans;
5. effective plans;
6. content snapshots;
7. vocabulary selections;
8. vocabulary history;
9. attendance aggregates and links;
10. scoped overrides;
11. carousel holds;
12. Calendar ownership candidates;
13. job runs;
14. comparison evidence; and
15. temporary operational state.

Validation is recursive and exact: top-level, record, and nested fields outside
the schema are rejected. Forbidden storage-surface names, absolute/file paths,
and recognizable credential material are rejected independently of the
allowlist. Reports contain only category, stable code, and structural path.
Identical duplicate identities collapse; conflicting duplicates reject the
document; accepted operations have deterministic collection/identity order,
record checksums, and batch identity. Planning never mutates its input.

Application accepts only an opaque, bounded source reference rather than a file
path or free-form label. One immediate transaction inserts the safe records and
the import-run evidence. An injected failure rolls both back. Rejected plans
persist only the already-redacted structural report; repeated source/hash
attempts reuse the first import result, while the same records from another
source produce an `unchanged` run. A different checksum for an existing
collection/identity rejects before any continuity record changes. Before an
existing record can be considered identical, the stored JSON must parse and
it must still satisfy the exact schema for its collection and identity, and its
recomputed canonical checksum must equal its stored checksum. Malformed,
schema-invalid, identity-mismatched, or tampered rows produce a stable redacted
`existing-record-corrupt` rejection.

Continuity planning first creates one descriptor-only detached snapshot.
Accessors are never invoked, and sparse/augmented arrays, symbols,
non-enumerable properties, exotic objects, and other non-data structures fail
closed before repeated reads can occur. Validation, identity extraction,
cloning, and checksum generation therefore observe one stable snapshot.

Continuity schemas require all six frozen configuration values and enforce the
frozen enum sets, recursive nested domain contracts, normalized dates/instants/
timezones, count relationships, canonical/effective meeting equality/order
invariants, deterministic meeting order, and plan-bound carousel holds. The
collection records remain purpose-built continuity wrappers; their nested
domain values follow the frozen contracts.

The importer accepts only supplied data. It does not open, inspect, copy, or
transform a legacy database, browser profile, provider capture, student row, or
runtime path. Applying an explicitly authorized real continuity export and
reconciling its counts/shapes remains M-09 work.

## Backup, restore, and retention

[ADR-0013](../decisions/0013-state-retention-and-recovery.md) governs the
implemented policy hooks:

- create one operational recovery point nightly and retain 14 distinct daily
  plus 8 older weekly recovery points;
- target a four-hour RTO and 24-hour RPO;
- retain job runs/comparison evidence for 90 days and attendance summaries/
  temporary operational state for 30 days;
- retain plans, content, and vocabulary through an explicitly supplied academic
  year end plus 90 days; and
- retain active configuration, mappings, and Calendar ownership, then retain
  them for one year after supersession/inactivation.

The backup implementation validates that the database and backup directory are
inside a dedicated non-root managed directory, rejects relative, escaping,
symlink, arbitrary external, and backup-nested restore paths, and never
overwrites a restore target. Creation checks source and resulting SQLite
integrity, creates mode-`0600` database/catalog files, and records a SHA-256
checksum without recording the source database path. Restore checks catalog
shape, catalog/file identity, checksum, integrity, and foreign keys before
creating a new mode-`0600` database.

Retention selection keeps distinct daily and weekly recovery points. Pruning
loads every candidate through the catalog parser, requires exact managed
backup/sidecar paths, validates the catalog shape, recomputes each backup's byte
length and SHA-256 identity, and requires caller metadata to agree with the
parsed catalog. Retention selection then uses the parsed catalog timestamps and
metadata. Every candidate is validated before the first selected artifact is
deleted, so malformed, missing, symlinked, path-mismatched, identity-mismatched,
size-mismatched, or byte-tampered candidates cause zero deletions.
Application retention is deliberately exposed as expiry metadata, boundary
calculators, and bounded pruning hooks; operational scheduling and proof of
policy execution belong to later deployment milestones.
Configuration retention refuses impossible, date-only, offset, or otherwise
non-canonical supersession instants before calendar-year arithmetic.

All backup/restore evidence in M-04 uses synthetic temporary state. It proves
the repository implementation path only. It does not prove an operational
backup schedule, protected deployment storage, monitoring, restoration runbook,
or achievement of the RTO/RPO objectives.

## `node:sqlite` decision

The implementation uses Node's built-in `node:sqlite` `DatabaseSync` and
`backup` APIs. This keeps the single-host adapter small and avoids a native or
JavaScript database package, install lifecycle, transitive dependencies, and a
second version surface. Synchronous access is confined to the infrastructure
adapter and short explicit transactions; asynchronous or nested callbacks are
rejected rather than holding a transaction across uncontrolled work.

The observed and newly declared minimum runtime is Node.js 24.15.0. Its
version-matched `node:sqlite` documentation and detected embedded SQLite
version are generated into `docs/tooling.md`; `.codex/environment.md` records
the same working-environment contract. This intentionally avoids claiming
support for earlier Node 22/24 releases with a different `node:sqlite` surface.

## Parity classification

“Exact” below is limited to the M-04 persistence boundary. Provider reads,
rendering, operational scheduling, production backup execution, and Calendar
mutation retain their later gates.

| Parity ID     | Classification                        | M-04 result and remaining gate                                                                                                                                                                                                                                      |
| ------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PS-008`      | exact at persistence boundary         | Versioned normalized schedule observations retain provenance, freshness, verification, diagnostics, and periods without raw captures; corrupt current state is skipped for valid history. Live acquisition remains an adapter concern.                              |
| `CAL-006`     | exact at persistence boundary         | Stored payloads must validate before a semantic no-op; a fingerprint advances only with a clean successful job whose date-bearing scope, output, state reference, completion, requested date, and completed mutation count match. Calendar execution remains later. |
| `CAL-008`     | exact at persistence boundary         | Typed job outcomes and redacted error codes are stored independently of Calendar execution; degraded/skipped/repair-required/failed runs cannot advance the clean fingerprint. Execution receipts remain later.                                                     |
| `CONTENT-001` | exact at persistence boundary         | Versioned scoped content is represented in safe state and continuity import without acquiring provider or presentation behavior.                                                                                                                                    |
| `VOC-002`     | exact at persistence boundary         | Vocabulary selection/history and deterministic selection context are allowlisted and versioned; preview still cannot write.                                                                                                                                         |
| `OVR-001`     | exact at persistence boundary         | Display/date override scope is validated and versioned without changing M-03 resolution semantics.                                                                                                                                                                  |
| `DISP-006`    | exact at persistence boundary         | Holds require date/screen/meeting/plan scope, survive reload, support indefinite/timed and repeat lifecycles, validate chronology/internal records, reject generic/stale transitions, and never recover superseded state. Auth/UI remains M-05.                     |
| `HEALTH-002`  | exact at persistence boundary         | Serialization-safe contract/hash/identity/scope validation permits LKG only in the exact query scope; holds intentionally do not fall back. Database integrity is inspectable; readiness presentation remains M-05/M-06.                                            |
| `PERSIST-001` | replace equivalently                  | SQLite transactions, ledger/`user_version` agreement, validated generated metadata, payload-verified no-ops, byte-verified catalogs, canonical retention instants, and new-target restore replace the legacy atomic-file/backup contract.                           |
| `PERSIST-002` | exact for the safe synthetic contract | One accessor-free snapshot feeds complete configuration and exact enum/nested/temporal/plan schemas; stored rows pass collection, identity, JSON, and checksum validation. Real reconciliation remains M-09.                                                        |
| `PERSIST-003` | preserved and strengthened            | Finite schemas, recursive forbidden-material checks, path confinement, redacted errors, and repository fixture checks keep prohibited material out of application state and Git. Deployment permission/exclusion audit remains later.                               |

No legacy behavior is retired or silently reclassified by this candidate.

## Verification matrix

| Area                       | Synthetic evidence                                                                                                                                                                                                                                                    |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Migrations                 | empty-to-current, every explicit target, version 1 to current, retained data, invalid application instants, injected/async/thenable rollback, history checksum/gap rejection, ledger/`user_version` mismatches in both directions, downgrade/invalid target rejection |
| Transactions and integrity | successful commit, thrown rollback, nested/promise/thenable rejection, foreign-key enforcement, SQLite integrity and foreign-key checks                                                                                                                               |
| Repository                 | complete row/payload/query scope binding, corruption-aware no-ops, adversarial serialization inputs, generated-metadata validation/rollback, normalized prune cutoff, scoped LKG, and clean Calendar run/state correlation                                            |
| Holds                      | plan binding, reload, indefinite/timed and repeat lifecycles, release/expiry/invalidation chronology, internal revalidation, millisecond-safe ordering, stale/generic-write rejection, concurrency, isolation, and no historical resurrection                         |
| Continuity import          | complete configuration values, descriptor-only snapshot, accessor/non-data rejection, all 15 collections, exact nested/temporal/plan contracts, deterministic identity/hash/order, and stored-row validation                                                          |
| Backup/restore             | source/result integrity, checksum/catalog round trip, mode `0600`, new-target-only restore, unsafe paths, actual byte-length/checksum validation before pruning, byte tamper, and zero-deletion failures                                                              |
| Retention                  | 14 daily plus 8 distinct weekly points, all-candidates-before-delete validation, 90/30-day thresholds, academic-year plus 90 days, canonical-instant one-year configuration boundary, and non-deleting hold transitions                                               |

The complete `npm run check`, focused compiled M-04 tests, and
`git diff --check` were required before closure. Repository tests alone did not
approve the candidate; closure followed an independent review of the complete
working-tree diff under the user's authorized checkpoint goal.

The latest post-re-review verification passed the focused validation,
persistence, architecture, and parity suites; the complete suite passed all 152 repository
subtests. The final `npm run check` passed documentation, fixture safety,
formatting, strict types, production build, and smoke checks. `git diff --check`
passed, the index was empty before the baseline commit, and the artifact scan found no database, backup,
log, key, credential, or `.env` files; the only credential-shaped match was an
explicitly synthetic rejection fixture. Passing tests do not substitute for
independent review.

## Assumptions and unresolved decisions

- The accepted U-013 values govern policy calculations, but operational backup
  cadence, protected directories, monitoring, pruning ownership, runbook, and
  timed RTO/RPO evidence are not established in M-04.
- An academic-year end must be supplied explicitly. The implementation refuses
  to infer it from a date or current wall clock.
- Deployment code must assign and prune record expiry consistently with
  ADR-0013. M-04 supplies storage metadata and hooks, not a scheduled retention
  job.
- Runtime database and backup paths remain deployment configuration. M-04 tests
  only confined temporary directories and does not authorize a production path.
- Import source selection, authorization, safe export production, real count/
  shape reconciliation, and ambiguous legacy-field handling remain M-09.
- Calendar ownership candidates are evidence, not authorization to mutate
  Calendar. No writer activation or live Calendar state is part of M-04.

## Review record

The independent final review found no remaining P0/P1 or material P2 defect and
confirmed that M-04 remained within its persistence-only boundary. The user's
checkpoint goal authorized local closure after that result and the complete
quality gate. This approval does not authorize live continuity import,
production backup operation, Calendar execution, or operational recovery
claims.
