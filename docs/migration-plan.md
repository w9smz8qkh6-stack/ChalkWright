# Migration execution plan

## Purpose and control rules

This is a dependency-ordered implementation plan, not authorization to run it.
The repository currently remains documentation-only with respect to migration.
Any future execution must comply with these controls:

- A legacy behavior is preserved unless its retirement is explicitly approved.
- PowerSchool and Google Classroom are read-only in every phase.
- Calendar is the only planned external write surface, and only verified
  application-owned events are in scope.
- A phase label never grants permission to inspect live data, operate services,
  install units, change routing, or write externally.
- Shadow mode has no mutation ports. Calendar work cannot begin until source
  reads and authentication gates have completed successfully.
- Only one Calendar writer may own a scope. Cutover and rollback occur outside
  teaching hours under an approved runbook.
- Secrets, OAuth material, browser profiles, raw student records, logs, runtime
  state, databases, fixtures derived from sensitive data, and generated
  artifacts remain outside Git.

The [migration strategy](migration-strategy.md) explains why the phases exist.
The [legacy parity inventory](legacy-parity-inventory.md) is the authoritative
behavior ledger. This plan provides the work order and evidence gates.

## Requirements

| ID    | Requirement                                                                                                                                                    |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R-001 | Preserve every discovered legacy behavior unless retirement is explicitly approved.                                                                            |
| R-002 | Make the steady-state application independent of OpenClaw runtime, scheduling, plugins, browser services, databases, and paths.                                |
| R-003 | Keep PowerSchool and Google Classroom read-only and place source/authentication checks before any Calendar mutation.                                           |
| R-004 | Build one deterministic canonical day plan that is independent of Calendar and presentation.                                                                   |
| R-005 | Preserve the existing B407 TV URL, routes, state machine, timing, content, media, controls, and failure behavior at initial cutover.                           |
| R-006 | Model screens and rooms as isolated first-class entities; B407 remains the offline fixture baseline and C509 is the user-identified current production target. |
| R-007 | Use SQLite for versioned application state while keeping secrets, profiles, raw captures, and logs separate.                                                   |
| R-008 | Preserve safe configuration, mappings, ownership, content, overrides, vocabulary history, attendance links, and required run continuity.                       |
| R-009 | Make preview and comparison structurally side-effect-free.                                                                                                     |
| R-010 | Add screen-scoped, server-controlled carousel holds that survive reload and support release, expiry, or approved indefinite hold.                              |
| R-011 | Reconcile only verified application-owned Calendar events, with deterministic no-ops and exactly one writer per scope.                                         |
| R-012 | Preserve health, readiness, freshness, last-known-good, job ledger, alert deduplication/repeat/recovery, backup, and restore behavior.                         |
| R-013 | Use repository-owned, inert systemd service/timer definitions and a loopback listener exposed only through Tailnet routing.                                    |
| R-014 | Prove parity with sanitized fixtures, contract tests, visual evidence, read-only integration tests, and mutation-disabled shadow comparison.                   |
| R-015 | Require an outside-hours cutover, explicit rollback criteria, a stabilization interval, and a dependency audit before legacy removal.                          |
| R-016 | Minimize student data in storage, fixtures, logs, metrics, alerts, and comparison reports.                                                                     |
| R-017 | Preserve ambiguous legacy capabilities and state as open decisions rather than silently dropping them.                                                         |
| R-018 | Keep version-sensitive implementation decisions tied to locked/runtime versions and canonical documentation.                                                   |

## Stage A — Offline development

These steps require no credentials, network access, live services, live state,
or external data. All fixtures must be synthetic or irreversibly redacted and
reviewed.

### M-01 — Freeze contracts and sanitized evidence

**Implementation status:** approved and committed after review of the
[M-01 evidence package](migration/m01-review-package.md).

- **Objective:** Turn the parity inventory into executable, reviewable
  contracts before implementation narrows the behavior surface.
- **Scope:** Behavior IDs, route schemas, timing tables, safe state shapes,
  visual states, Calendar intent shapes, normalization rules, synthetic fixture
  policy, and a retirement decision log.
- **Prerequisites:** Approved planning documents and the current safe evidence
  register.
- **Expected components:** Versioned TypeScript contracts; synthetic fixture
  builders; redaction/secret checks; contract and visual-baseline manifests.
- **Verification:** Every parity ID has a fixture, static rule, visual case, or
  explicitly named later verification gate; fixture review detects no secrets,
  student data, private URLs, or live identifiers.
- **Parity evidence:** All inventory IDs, especially `PS-007`, `PLAN-004`,
  `HTTP-001`, and unresolved `U-001` through `U-015`.
- **Side-effect boundary:** Repository files only. No live reads or writes.
- **Rollback:** Revert only the new contracts/fixtures; the inventory remains
  authoritative.
- **Completion gate:** The user approves the coverage map and no behavior is
  marked retired by omission.

### M-02 — Establish domain ports and canonical plan types

**Implementation status:** approved by the user on 2026-08-08 and promoted as
the M-02 baseline; see the [review package](migration/m02-review-package.md).

- **Objective:** Make acquisition, domain logic, persistence, presentation,
  Calendar projection, and operations independently replaceable and testable.
- **Scope:** Observation/result types, provenance and freshness, class/room/
  screen identity, canonical/effective plans, mutation-free preview, Calendar
  intents, job outcomes, and typed error categories.
- **Prerequisites:** M-01.
- **Expected components:** Pure domain package; read-only source ports;
  persistence ports; separate local-command and Calendar-writer ports; injected
  clock and identifier factories.
- **Verification:** Architecture tests prevent domain modules from importing
  adapters; preview/comparison types cannot receive writer ports; compile-time
  examples cover success, degraded, skipped, repair-required, and failed states.
- **Parity evidence:** `CAL-001`, `GC-001`, `PLAN-001`, `PRE-003`, `SEC-002`.
- **Side-effect boundary:** Repository files and tests only.
- **Rollback:** Remove the unadopted contracts without transforming state.
- **Completion gate:** An ADR-aligned contract review confirms the canonical
  plan is independent of Calendar, UI, and OpenClaw.

### M-03 — Implement pure plan, state, and enrichment behavior

**Implementation status:** approved and finalized as the M-03 baseline; see the
[M-03 review package](migration/m03-review-package.md).

- **Objective:** Reproduce schedule normalization and effective display
  behavior without I/O.
- **Scope:** Bell parsing; mappings; timing boundaries; all eight display
  states; next-class-day wording; assignments; objectives; content precedence;
  vocabulary selection; attendance-link resolution; overrides; preview; and
  Calendar intent planning.
- **Prerequisites:** M-01 and M-02.
- **Expected components:** Pure functions with injected clock/randomness;
  deterministic fingerprints; golden tests for normal, special, empty, stale,
  invalid, gap, and multi-room cases.
- **Verification:** Boundary tests at minus/equal/plus one second; repeated runs
  are byte-stable after documented normalization; cross-room fixtures never
  leak; preview calls no mutation spies.
- **Parity evidence:** `PS-007`; `CAL-003`, `CAL-004`, `CAL-006`; `GC-002`,
  `GC-004`, `GC-005`; all `PLAN-*`, `CONTENT-*`, `VOC-*`, `ATT-001` through
  `ATT-003`, `PRE-*`, and `OVR-001` through `OVR-002`.
- **Side-effect boundary:** Memory-only tests. No filesystem, database, browser,
  network, or external calls.
- **Rollback:** Delete or revise pure modules; no persisted data exists.
- **Completion gate:** Every offline parity case is explained as exact match,
  approved correction, normalization-only difference, or still-open blocker.

### M-04 — Add SQLite schema, migrations, and continuity importer

**Implementation status:** completed after three adversarial review rounds and
an independent final review with no remaining P0/P1 or material P2 finding; see
the [M-04 review package](migration/m04-review-package.md). The local baseline
is approved, while all live migration and operational work remains later.

- **Objective:** Provide transactional, versioned state without importing
  sensitive or unnecessary legacy material.
- **Scope:** Normalized schedule observations with provenance/freshness,
  configuration snapshots, mappings, canonical/effective plans, content,
  vocabulary/history, attendance links, overrides, holds, ownership candidates,
  job runs, comparison evidence, migrations, backup/restore, and retention hooks.
- **Prerequisites:** M-02, M-03, and the accepted `U-013` policy in
  [ADR-0013](decisions/0013-state-retention-and-recovery.md).
- **Expected components:** Forward-only migrations; repositories; transaction
  boundaries; integrity checks; idempotent importer; allowlisted field mapping;
  redacted rejection report; backup/restore commands.
- **Verification:** Empty-to-current and each-version migration tests;
  idempotent repeated import; semantic no-op tests; corrupt-input rejection;
  integrity check; backup and restore rehearsal using synthetic state.
- **Parity evidence:** `PS-008`, `CAL-006`, `CAL-008`, `CONTENT-001`, `VOC-002`,
  `OVR-001`, `DISP-006`, `HEALTH-002`, and all `PERSIST-*`.
- **Side-effect boundary:** Test databases in temporary directories only. No
  legacy database is opened or copied during this step.
- **Rollback:** Restore the pre-migration test database or discard temporary
  databases; migrations never run against production here.
- **Completion gate:** Schema review confirms secrets/profiles/raw captures/logs
  have no columns or import paths and restore meets the approved objective.

### M-05 — Implement HTTP contracts, TV surface, and local controls

**Implementation status:** the offline, fixture-backed implementation and
automated quality gate are complete. With explicit user approval for the
fallback, repository-local headless Chrome 150 recorded and agent-inspected the
required viewport, interaction, network, media, and accessibility evidence.
The evidence is retained outside Git for user review. This does not constitute
human visual approval or authorize production route activation or live
integration.

- **Objective:** Match the user-visible and operator-visible behavior before
  adding live integrations.
- **Scope:** Display, target, day-plan, preview, override, hold, QR, media,
  asset, manifest, health, and readiness routes; responsive kiosk UI; headers;
  timeouts; polling/backoff; countdown; carousel; local authorization.
- **Prerequisites:** completed M-03 and M-04 baselines and accepted ADR-0009.
- **Expected components:** Loopback HTTP server; route/controller modules;
  local assets; media range handler; screen-scoped hold service; stable error
  envelope; graceful shutdown; browser-based acceptance harness.
- **Verification:** Route/header snapshots; GET/HEAD/method matrix; media
  200/206/416 cases; auth/body/path bounds; all eight visual states at approved
  viewports; reload/hold/expiry/cross-screen tests; offline asset test; failure
  retains the last successful display.
- **Parity evidence:** `ATT-003` through `ATT-005`, all `PRE-*`, all `OVR-*`, all
  `DISP-*`, all `HTTP-*`, all `MEDIA-*`, `HEALTH-001`, `SEC-001`, and `SEC-002`.
- **Side-effect boundary:** Local temporary SQLite state and browser DOM only;
  source and Calendar adapters are fixtures.
- **Rollback:** Stop the development process and discard temporary state; no
  routing or installed service is touched.
- **Completion gate:** Automated contracts pass; representative sanitized
  states are rendered and agent-inspected at the required viewports; screenshots
  and evidence are retained for one user review. Human acceptance remains a
  later production-promotion gate and is never inferred from agent inspection.

### M-06 — Build operations, diagnostics, and deployment artifacts

**Implementation status:** the offline repository baseline is complete and
independently reviewed. Exact timer clocks/timezone, deployment activation,
live alert delivery, cross-process delivery serialization, and full brief
semantics remain unresolved; no service or route was inspected or changed.
The user approved commit `61e2d699e8efa745ba1590e2465af5a3406f94a4` on
2026-08-09 as the M-06 checkpoint.

- **Objective:** Make process ownership, scheduling, health, alert decisions,
  and recovery explicit before any host activation.
- **Scope:** Typed job registry; run ledger; readiness/freshness; issue
  fingerprinting; morning/evening brief contracts; alert decisions with fake
  transport; backup/integrity jobs; inert service/timer templates;
  install/cutover validation scripts.
- **Prerequisites:** M-04 and M-05; alert transport may remain an injected fake.
- **Expected components:** Bounded job CLI; systemd templates; environment file
  contract; offline unit verifier; cadence fixtures; dependency and secret
  scans; redacted diagnostics.
- **Verification:** Unknown jobs fail; timer calendars match approved intended
  cadences; brief content/redaction/failure fixtures pass;
  new/repeat/same/recovery/send-failure alert tests pass; service binds loopback;
  unit security analysis is reviewed without installing units.
- **Parity evidence:** `HEALTH-003`, `ALERT-001`, all `OPS-*`, all `PERSIST-*`,
  `NET-001`, and `DEP-001`.
- **Side-effect boundary:** Repository templates and isolated development
  processes only. Do not install, enable, start, or edit host units/routing.
- **Rollback:** Remove templates/scripts or stop isolated processes.
- **Completion gate:** Offline operational rehearsal passes and all host-facing
  actions remain explicit future runbook steps.

### M-07A — Qualify the direct PowerSchool adapter synthetically

**Implementation status:** complete and independently reviewed. This is an
entirely offline synthetic qualification, not live characterization. The user
approved commit `8190805` on 2026-08-09.

- **Objective:** Resolve ADR-0010 and implement the smallest repository-owned,
  read-only adapter that preserves authentication/session, transport,
  provenance, redaction, and repair boundaries without OpenClaw.
- **Scope:** Exact `playwright-core` plus installed Chrome; protected-profile
  reference boundary; cached/live auth status; separate explicit repair;
  SSO/manual blockers; bounded same-origin HTTP-first acquisition; dynamic-page
  browser fallback; timeout/cooloff; minimal normalized schedule observations;
  canonical-plan integration.
- **Prerequisites:** M-01 through approved M-06; authorization for repository
  edits, official documentation research, local synthetic servers, and
  temporary synthetic browser profiles. No credential or live-provider access.
- **Expected components:** Read-only adapter and ports; local synthetic
  PowerSchool-like server that rejects mutation methods; temporary-profile
  fixture harness; executable architecture/security tests; accepted ADR-0010;
  pending review package.
- **Verification:** Synthetic authenticated/expired/cached/live/repair/blocker/
  timeout/cooloff cases; HTTP/browser transport matrix; unexpected method/form
  mutation detection; provenance and redaction; bounded inputs; canonical-plan
  pipeline; architecture tests excluding profile/cookie/browser details from
  domain and SQLite contracts.
- **Parity evidence:** synthetic qualification for `PS-001` through `PS-009`;
  `PS-010`, `PS-011`, and `U-001` remain preserved without product exposure;
  `U-006` is resolved by ADR-0010 and synthetic evidence.
- **Side-effect boundary:** Repository edits and disposable loopback servers,
  temporary SQLite, and temporary browser profiles only. No live PowerSchool,
  protected profile, private data, source write, Calendar, service, routing, or
  deployment access.
- **Rollback:** Revert the repository commit and discard only its temporary
  synthetic state. No provider or host-operational state exists to roll back.
- **Completion gate:** Focused adapter/security/architecture tests, full quality
  gate, secret/artifact audits, and independent review are clean; one local
  commit is created and M-07B/M-08 do not begin.

## Stage B — Authorized read-only integration testing

These steps require separate authorization and configured protected credentials
or profiles. They may read only the minimum necessary fields and must not
operate production services, timers, routing, or Calendar events.

### M-07B — Characterize the direct PowerSchool adapter read-only

- **Implementation status:** Approved by the user on 2026-08-09 as commit
  `7582a820ebd3ae31df9a19131dabc5b35f93a665`. After an initial zero-request
  profile gate, the user authorized one managed-profile session in the final
  2026-08-09 04:24–05:24 UTC window. A fixed process-group supervisor proved
  forced teardown/quiescence before access. The run made one authorized status
  `GET`, received `authentication-required`, entered cooloff, and stopped before
  any bell read or repair.

- **Objective:** Characterize the accepted M-07A adapter against the minimum
  authorized real read surface without broadening its passive capabilities.
- **Scope:** Read-only status and bell-surface characterization, protected
  profile lifecycle validation, transport selection, provenance, and redaction.
- **Prerequisites:** Clean M-07A commit plus a new authorization naming the
  PowerSchool environment/origin; the exact allowed read-only account and
  protected profile reference; the allowlisted status and bell paths/fields;
  permitted time window and request budget; whether an explicit interactive
  repair attempt is allowed; approved evidence retention/redaction; and the
  operator who will review any SSO/manual blocker. Authorization must restate
  that writes, student search, Scoresheet, Calendar, services, routing, and
  deployment are excluded.
- **Expected components:** A sanitized characterization record and any fixture
  corrections demonstrated by the authorized reads. Protected state remains
  external and is never committed or persisted in application SQLite.
- **Verification:** Audit the bounded read-only request log for zero form
  submissions/source mutations, confirm observed transport/provenance and safe
  auth failure, and scan all retained evidence for sensitive material.
- **Parity evidence:** read-only characterization for `PS-001` through `PS-009`.
  `PS-010`, `PS-011`, and `U-001` remain excluded unless separately decided and
  authorized.
- **Side-effect boundary:** The user authorized Chrome's unavoidable incidental
  writes inside the designated managed profile for this one supervised run
  only. The live child accepted no repair or interaction capability and the
  process supervisor confirmed complete browser-process quiescence before
  returning. This does not authorize future profile access, PowerSchool
  mutation, or Calendar calls.
- **Recorded future cadence:** Classroom Hub's standalone Linux
  application/service must eventually own a Sunday-through-Friday 07:20
  Asia/Ho_Chi_Minh refresh, with Saturday excluded. M-07B adds no scheduler
  artifact, does not activate anything, and does not replace the legacy reader.
- **Rollback:** Disable the direct adapter and retain fixture/transitional read
  ports; remove only the newly created isolated profile if separately approved.
- **Completion gate:** The authorized read-only audit passes, any blocker is
  recorded without workaround, and the direct adapter remains independent of
  OpenClaw runtime control.

### M-07C — Integrate filtered-session bootstrap and passive collection

**Supplemental checkpoint:** M-07C was not named in the original approved
sequence. It is inserted after M-07B without renumbering M-08 onward because
M-07B stopped safely at `authentication-required` and a later prototype proved
a narrower filtered-session method. It gates PowerSchool evidence for M-10 but
does not gate implementation of M-08 or M-09.

- **Objective:** Prepare a clean, reviewable offline implementation that can
  bootstrap a PowerSchool session with an operator once and then perform
  credential-free routine status/bell reads from filtered state.
- **Scope:** Separate visible manual bootstrap and passive collector entry
  points; fresh temporary profile per operation; PowerSchool-only cookie and
  exact-origin storage filtering; atomic owner-only external state; exact
  status/bell `GET` contracts; approved normalization; request/byte/time/process
  bounds; deterministic lock; cleanup and architecture tests.
- **Prerequisites:** Approved M-07B implementation and method evidence; clean
  baseline worktree. Offline work may use only synthetic loopback origins and
  disposable profiles. Live providers, credentials, 1Password, retained
  profiles, services, and schedulers require separate authorization.
- **Expected components:** Filtered-state store; operator-present bootstrap;
  credential/repair-free passive collector; fixed child workers and
  process-group supervisors; synthetic provider harness; ADR-0014; review
  package and safe configuration placeholders.
- **Verification:** Synthetic filtering and cleanup on every path; exact
  authenticated and expired-state behavior; routine foreign
  origin/path/query/method, redirect, popup, download, service-worker, budget,
  timeout, concurrency, and hostile-filesystem failures; exact
  parsing/provenance; full offline quality gate; independent review. Manual SSO
  is browser-native and is bounded by operator presence, timeout, disposable
  profile cleanup, exact success marker, and filtered output rather than a
  per-request network policy.
- **Parity evidence:** strengthens the implementation path for `PS-001` through
  `PS-009` and resolves the revised `U-006` profile lifecycle. It does not
  expose `PS-010`, `PS-011`, or the broader `U-001` surface.
- **Side-effect boundary:** Repository edits, local synthetic servers, and
  temporary browser profiles only. No PowerSchool/Google/1Password/credential,
  service, Calendar, scheduler, routing, deployment, push, or pull-request
  action.
- **Recorded future cadence:** Sunday through Friday at 07:20
  Asia/Ho_Chi_Minh, Saturday excluded. The requirement remains inert; exact
  systemd syntax, missed-run semantics, installation, and activation are
  deferred.
- **Rollback:** Remove the offline implementation and discard only synthetic
  temporary state. No provider or host-operational state exists to roll back.
- **Completion gate:** Offline gates and independent review are clean. Stop for
  a separately authorized live gate consisting of one operator-present
  bootstrap followed by exact status/bell reads from saved state with no
  1Password, Google, credential, repair, or operator involvement in the routine
  phase.

### M-08 — Implement and qualify Google Classroom reads

**Implementation status:** the accepted least-privilege model, offline
adapter/cache/refresh qualification, dedicated external OAuth grant, bounded
live scope/read audit, and mutation-free stable-TV-latency observation are
complete; see the [M-08 review package](migration/m08-review-package.md). M-08
is promoted. Operational registration remains deferred.

- **Objective:** Provide least-privilege Classroom enrichment independent of
  the TV request path and OpenClaw batching.
- **Scope:** Course mapping, published coursework normalization, bounded read
  batches, cache/freshness, partial failure, throttling, and retry backoff.
- **Prerequisites:** M-03 through M-06; accepted Google client/scopes ADR;
  explicit read-only integration authorization.
- **Expected components:** Read-only Classroom adapter; credential reference;
  cache repository; async refresh job; allowlisted operations; redacted result
  wrapper.
- **Verification:** Scope/command allowlist audit; fixture tests for order,
  partial failure, timeout, stale/wrong-date data, and backoff; authorized read-
  only run confirms zero Classroom mutations and stable TV latency.
- **Parity evidence:** `GC-001` through `GC-006`; `GC-007` remains an explicit
  product-scope question under `U-001`.
- **Side-effect boundary:** Classroom reads and local SQLite cache updates only.
  No Google Classroom writes and no Calendar writer port.
- **Rollback:** Disable refresh and retain the prior valid cache; remove the
  credential reference, not credential material, from configuration.
- **Completion gate:** Read-only/scopes audit and failure-isolation tests pass;
  unresolved general Google reads are not silently removed.

### M-09 — Validate attendance and continuity imports safely

**Implementation status:** the offline synthetic implementation, disposable
SQLite evidence, and user acceptance of ADR-0015 are complete; see the
[M-09 review package](migration/m09-review-package.md). M-09 is promoted. No
legacy state copy has been authorized or read. M-10 was subsequently promoted
and led to the separately promoted M-11 and M-12 checkpoints.

- **Objective:** Resolve incomplete attendance evidence and prove safe state
  continuity without inspecting submissions or raw student data.
- **Scope:** Synthetic route/link/matrix contracts; allowlisted import of safe
  state shapes; provenance/count comparison; ambiguous field report.
- **Prerequisites:** M-01, M-04, M-05; resolution plan for `U-002`; explicit
  authorization before reading any legacy state copy.
- **Expected components:** Synthetic attendance fixtures; import adapters that
  accept exported safe shapes; redacted reconciliation report; unsupported-
  field quarantine.
- **Verification:** Direct-vs-wrapper link precedence, redirects, QR scoping,
  roster-first matrix shape, repeatable import, and no raw submissions/student
  rows in repository or diagnostics.
- **Parity evidence:** all `ATT-*`, `PERSIST-002`, `U-002`, and `U-012`.
- **Side-effect boundary:** Read-only access to an explicitly approved safe
  export; writes only to a disposable/replacement SQLite database.
- **Rollback:** Restore/discard the imported database; leave legacy sources
  unchanged.
- **Completion gate:** The user accepts the attendance contract/evidence or the
  unresolved behavior blocks promotion.

### M-10 — Run the read-only integration gate

**Implementation status:** promoted. The bounded mutation-free orchestration
contract and synthetic integration evidence are recorded in the
[M-10 review package](migration/m10-review-package.md). Follow-up metadata
established that the current classroom is C509, not B407, and that all 12 active
current-term Classroom mappings are new. The corrected join recognizes an exact
delimiter-bounded PowerSchool code embedded in the Classroom section field,
while preserving canonical room identity and UTC instants. A protected
2026-08-11 retry planned all three C509 meetings, refreshed all three matching
Classroom courses into temporary in-memory cache, and reported zero differences,
source mutations, or Calendar capability. M-11 was separately authorized on
2026-08-10 for one isolated seven-day observation window.

- **Objective:** Prove that direct adapters produce usable canonical plans and
  failure classifications without external mutations.
- **Scope:** Representative dates/scopes; authentication success/failure;
  freshness; mapping gaps; cache retention; multi-room isolation; resource use;
  redacted diagnostic output.
- **Prerequisites:** M-07B, the supplemental M-07C live gate, M-08, M-09, and
  explicit execution authorization.
- **Expected components:** Mutation-spy/null Calendar adapter; integration test
  manifest; redacted result summary; permission/scope inventory.
- **Verification:** Source audit reports zero writes; auth failure produces no
  Calendar intents eligible for execution; outputs satisfy fixtures or record
  a named parity difference; sensitive-data scan passes.
- **Parity evidence:** `PS-001` through `PS-009`, `CAL-007`, `GC-001` through
  `GC-006`, `PLAN-001`, `PLAN-007`, `HEALTH-002`, and `PERSIST-003`.
- **Side-effect boundary:** Authorized source reads and local test-state writes
  only. Calendar execution is absent, not merely disabled by convention.
- **Rollback:** Stop integration jobs and restore the prior test database/cache.
- **Completion gate:** All differences are explained and approved; no source
  write or sensitive-data handling violation occurred.

## Stage C — Authorized mutation-disabled shadow operation

Shadow operation uses live read inputs only after authorization, but cannot
write to Calendar or source systems. It must not change the production URL,
service owner, timers, or kiosk configuration.

### M-11 — Deploy an isolated shadow instance

**Implementation status:** promoted under the user-approved accelerated
qualification gate; the fixed 2026-08-11 through 2026-08-17 observation remains
active as supplemental evidence. The isolated service uses a separate
loopback port, protected environment and SQLite tree, mutation-disabled
PowerSchool/Classroom jobs, backup unit, and six exact Sunday-through-Friday
07:20 Asia/Ho_Chi_Minh timer events. `Persistent=false` prevents catch-up after
the authorized window. One exact Tuesday credential-free PowerSchool plan,
Classroom refresh, zero-mutation ledger, and local shadow projection succeeded
without changing the timer, host clock, production route, or provider state.
The remaining scheduled runs are supplemental rather than a promotion gate.
M-11 stopped before M-12 until the user separately authorized M-12 on
2026-08-10; see the [M-11 review package](migration/m11-review-package.md).

- **Objective:** Exercise the complete replacement on production cadence
  without becoming a production server or writer.
- **Scope:** Separate loopback port, protected environment, SQLite database,
  read adapters, repository-owned shadow unit/timers, resource bounds, health,
  backup, and run ledger.
- **Prerequisites:** M-06 and M-10; approved shadow duration/cadence; explicit
  service installation authorization; verified separation from production.
- **Expected components:** Shadow-specific unit/timers and paths; Calendar null
  adapter; instance identity; writer-disabled invariant; redacted operations
  dashboard/report.
- **Verification:** Unit/process inspection proves distinct port/state; writer
  interface is not constructed; no TV route/routing change; restart and backup
  rehearsal succeeds; missed/failed runs are observable.
- **Parity evidence:** `OPS-001` through `OPS-003`, `HEALTH-*`, `ALERT-001`,
  `PERSIST-*`, `NET-001`, and `U-003`.
- **Side-effect boundary:** Approved host process/unit/state changes plus source
  reads. No Calendar mutations, production routing changes, or source writes.
- **Rollback:** Disable/remove only the shadow units after approval and restore
  or archive its state under the approved retention policy.
- **Completion gate:** A pre-observation audit confirms strict isolation and
  mutation-disabled operation. The user-approved accelerated qualification
  also records one successful read-only source/cache/projection sequence with
  zero external mutations; the fixed observation remains supplemental.

### M-12 — Compare plans, display behavior, and operations

- **Objective:** Identify unexplained behavior differences across real schedule
  variation before any writer or route changes.
- **Scope:** Canonical/effective plans, all display states, timing boundaries,
  content/vocabulary/attendance links, routes, visual baselines, failure/LKG,
  jobs, readiness, and alert decisions.
- **Prerequisites:** M-11 and approved sanitized comparison access.
- **Expected components:** Normalized diff engine; behavior-ID attribution;
  redacted comparison database/report; synthetic visual capture; difference
  triage workflow.
- **Verification:** Representative normal, changed, gap, no-class, future-day,
  stale-cache, and auth-failure cases run; zero unexplained material differences
  for the approved duration; every accepted difference has explicit approval.
- **Parity evidence:** All non-Calendar inventory IDs, especially `PLAN-*`,
  `CONTENT-*`, `VOC-*`, `ATT-*`, `PRE-*`, `OVR-*`, `DISP-*`, and `HTTP-*`.
- **Side-effect boundary:** Read-only production comparison plus shadow state.
  Comparison output contains no sensitive values or private URLs.
- **Rollback:** Pause shadow schedules and retain the production legacy path
  unchanged; discard unsafe comparison artifacts immediately if detected.
- **Completion gate:** User-approved zero-unexplained-difference window and
  visual acceptance, or promotion stops.

Promoted checkpoint (2026-08-10): M-12's strict
value-free comparator, behavior-ID triage, exact seven-scenario manifest, and
redacted SQLite projection pass focused offline tests. A sanitized loopback
comparison found that the legacy service has no current-room or
Tuesday reference data and exposed an empty-day normalization gap on the
no-class Monday. The user clarified that an authenticated empty schedule means
no classes; the integration now produces and stores a verified empty plan under
that exact-date contract, with browser-level offline coverage and no Google
traffic. The user approved the unchanged legacy source, documentation, and
93-test suite as the alternative behavioral reference where current live
legacy data is absent, and directed the work to continue without another
PowerSchool login after the filtered session was rejected. The prior successful
credential-free Tuesday read remains live acquisition evidence; the exact
empty-day correction is established offline. Live empty-day readiness and
session longevity are deferred, not claimed complete. A subsequent source-level
visual parity audit confirmed the same eight named states, including attendance
as `pre_checkin`, but found three material replacement gaps: legacy `idle` and
`post_end` share a horse-backed Coming Up scene with two countdowns; legacy
`day_complete` shows the next available class-day schedule; and legacy
`pre_checkin` includes class code/link plus the complete aggregate attendance
summary. Those three gaps are now corrected through the existing typed
presentation boundary using the reference markup, CSS decisions, local media,
and complete bounded data. The actual shadow now reads its next effective plan
and validated aggregate attendance continuity from local SQLite, and missing
links no longer suppress independent class-code or count fields. Fresh
disposable Chrome 150 evidence covers 1920×1080, effective 200% reflow,
keyboard focus, and reduced motion; it is bound to exact source/build and PNG
digests and is free of horizontal overflow, console errors, or unexpected
requests. The initial synthetic horse WebM was rejected during human review and
replaced with the exact 4,591,479-byte MP4 named by the latest legacy source.
The user explicitly accepted the corrected exact-horse-media visual and then
approved the comparison result and M-12 promotion on 2026-08-10. M-12 is
promoted. The user subsequently established the remaining roadmap as an active
goal with autonomous safe offline and read-only progress, beginning M-13. See
the [M-13 review package](migration/m13-review-package.md).

### M-13 — Audit Calendar intent and ownership without writes

**Implementation status:** promoted on 2026-08-10 after explicit user approval.
The `events.list` adapter configured for the intended owned-event
read scope, strong private-marker
ownership classifier, fixed projection/day-window policy, explicit hash-bound
adoption manifest, dry-run evidence, and pure lease simulator are implemented.
No Calendar writer,
operational registration, deployment, routing, or M-14 capability exists. The
bounded read-only ownership inventory, value-free three-meeting Tuesday
comparison, typed dry run, full offline gate, and independent review are
complete. The user approved scope `classroom-hub-c509-2026-27`, the three
hash-bound candidate dispositions, three future description-only replacements,
the dry-run evidence, M-13 promotion, and deferral of direct-grant verification
until before operational use. No Calendar write or M-14 live execution was
authorized by that decision.

- **Objective:** Prove desired intents, ownership classification, no-op
  behavior, and authentication gating against real-shaped observations without
  mutating Calendar.
- **Scope:** Read-only event listing if separately authorized; legacy ownership
  candidates; ambiguous quarantine; create/replace/delete/no-op intent diff;
  writer lease simulation; notification policy.
- **Prerequisites:** M-10 through M-12; approved Calendar identity/scopes design;
  resolution procedure for `U-005`; no writer credentials in shadow runtime.
- **Expected components:** Read-only Calendar adapter; ownership auditor;
  dry-run planner; lease simulator; redacted counts/receipts; ambiguous-event
  report.
- **Verification:** Every proposed mutation targets a verified owned identity;
  unrelated/ambiguous events receive no intent; exact matches are no-ops;
  auth failure and lease conflict call no writer; retries converge in fixtures.
- **Parity evidence:** all `CAL-*`, `OPS-004`, `SEC-001`, and `U-005`.
- **Side-effect boundary:** Calendar reads only if authorized; local shadow
  state only. No Calendar writer credential or command is available.
- **Rollback:** Stop the audit and discard/re-redact unsafe reports; Calendar
  and the legacy writer remain unchanged.
- **Completion gate:** Ownership audit is clean, ambiguous events have explicit
  dispositions, and the user approves the dry-run evidence.

## Stage D — Separately authorized controlled Calendar writes

This stage is not authorized by completing earlier work. It requires a named
scope, approved test calendar or production trial, credential/scope review,
operator availability, and a verified single-writer mechanism.

### M-14 — Qualify the Calendar writer in a non-production scope

**Implementation status (2026-08-10):** the user first authorized offline
writer construction, then separately authorized the exact Auto Lesson 2
non-production Calendar, distinct owned-events grant, and bounded live gate.
The isolated exact-method adapter, approval/ownership guard, deterministic
idempotency, durable SQLite lease/journal, dry-run-default command parser,
sanitized receipts, separately approved rollback executor, synthetic tests,
and complete offline gate are clean. The authorized offline implementation is
complete. The actual provider grant was verified as exactly
`calendar.events.owned`; the hash-bound qualification completed five forward,
four rollback, and one final cleanup mutation with injected-failure convergence
and zero remaining owned test events. Independent review is clean. On
2026-08-10 the user accepted ADR-0017, accepted the
no-additional-live-noop evidence disposition with an exact read-only semantic
no-op preflight required before any M-15 production mutation, and explicitly
promoted M-14. The one-off live evidence was separately authorized before ADR
acceptance; the later acceptance closes M-14 but does not authorize M-15. See
the [M-14 review package](migration/m14-review-package.md).

- **Objective:** Prove the external writer and convergence behavior without
  risk to production events.
- **Scope:** Create/no-op/replace/delete; ownership markers; timezones;
  notification suppression; fingerprints; partial failures; retries; leases;
  receipts; and rollback.
- **Prerequisites:** M-13; accepted Calendar ownership and writer ADRs; approved
  non-production scope and credential; backup/cleanup runbook.
- **Expected components:** Calendar writer adapter; lease store; ownership
  guard; execution journal; idempotency keys; reconciliation CLI with dry-run
  default and explicit execute mode.
- **Verification:** Synthetic/non-production scenarios prove one writer,
  bounded ownership, exact no-op, safe convergence after injected failures,
  notification suppression, and complete receipts.
- **Parity evidence:** `CAL-002` through `CAL-009`, `OPS-004`, and `SEC-001`.
- **Side-effect boundary:** Only explicitly owned events in the approved
  non-production Calendar scope. PowerSchool/Classroom remain read-only.
- **Rollback:** Delete or restore only test events identified by strong test
  ownership markers; revoke/disable the writer configuration.
- **Completion gate:** Independent review maps every mutation to an approved
  intent and cleanup/rollback succeeds.

### M-15 — Run a bounded production writer trial

**Implementation status (2026-08-10):** promoted after successful bounded
trial and explicit evidence acceptance.
The exact Tuesday scope, promoted M-13 candidate set, M-14 writer grant, fresh
backup requirement, OpenClaw legacy-writer exclusion check, exact promoted
candidate-set/fresh-audit binding, protected prepare/approval state, durable
trial journal, GET-only semantic no-op
preflight, three replacement-only executor, readback, and automatic
compensation are implemented offline. The full offline gate is clean. The
legacy writer is disabled and quiescent, and authorized list/exact-event reads
reproduced the exact three-candidate set and completed the required GET-only
semantic no-op preflight. The user accepted ADR-0018 and the exact short-lived
execute fingerprint. All three approved replacements completed with exact
readback, zero creates/deletes, no rollback, and three rollback-ready snapshots.
The legacy writer remains disabled and quiescent. The user accepted the exact
trial evidence and rollback readiness and explicitly promoted M-15. The user's
continuing roadmap goal authorizes safe offline and read-only M-16 preparation,
but not deployment, routing, activation, kiosk changes, or cutover.

- **Objective:** Prove one-scope production reconciliation while retaining a
  short, controlled fallback to the legacy writer.
- **Scope:** One approved Calendar/date range; preflight reads; legacy-writer
  exclusion; replacement writer; receipts; immediate verification; rollback.
- **Prerequisites:** M-14; outside-hours window; approved ownership set and
  trial runbook; fresh backup; operator present; mutually exclusive writer
  control verified.
- **Expected components:** Signed preflight checklist; writer handoff/lease;
  bounded execute manifest; post-run readback; rollback manifest.
- **Verification:** Legacy writer is inactive before replacement acquisition;
  all reads/auth pass before execution; mutation counts and readback exactly
  match approved intents; unrelated events remain unchanged.
- **Parity evidence:** all `CAL-*`, `OPS-004`, `NET-002`, and `U-009`.
- **Side-effect boundary:** Verified application-owned events in the named
  production trial scope only. No other Calendar/source/service/routing change.
- **Rollback:** Disable replacement writer, restore owned events from the
  approved manifest if needed, then re-enable the legacy writer only after
  confirming no replacement lease/process remains.
- **Completion gate:** User accepts trial evidence and rollback readiness; any
  unexplained event change blocks cutover.

## Stage E — Separately authorized production cutover

### M-16 — Rehearse cutover and rollback

**Status:** Promoted on 2026-08-12 after the user accepted the final runbook,
exact targets, four-hour recovery evidence, physical candidate disposition,
confirmed alert recipient, and bounded qualification result. Promotion grants
no M-17 authority.

**Implementation status (2026-08-12):** promoted. The exact
16-step isolated switch/rollback manifest, single-writer guard, real SQLite
backup/integrity/restore exercise, full eight-state smoke suite, and finite
legacy `/classroom-screen` compatibility family are implemented. An inert,
provider-free non-fixture production reader now composes the persistent SQLite
display path behind a protected exact-shape configuration, but no service,
deployment, route, scheduler, or provider path invokes it. Chrome 150 now
renders all eight accepted states without overflow, external requests, browser
errors, or hidden keyboard focus at the documented native 3840×2160 output and
both legacy-required 1920×1080 and 1366×768 viewports. User-supplied photos identify the physical display as a Hikvision
`DS-D5C75RB/A` interactive flat panel with a built-in Android computer rather
than this Ubuntu host and confirm Fully Kiosk Browser `1.60.1-play`. Its exact
Android WebView provider/version and effective CSS viewport are runtime-dependent
and cannot be established from product literature. A brief on-device candidate
render/readiness smoke remains a stop condition immediately before M-17 route
cutover. The current
exact-tree rehearsal passed in 241 ms with a 9 ms rollback, one maximum writer,
and zero external mutations or live operational changes. Read-only inventory
bound sanitized route, service, scheduler, writer, and kiosk observations.
The failed replacement refresh now has an accepted ADR-0020 JIT repair
architecture. Protected references were provisioned during a separately
authorized preflight. One bounded read completed, but the browser failed closed
at a policy violation; after an offline iframe-classification fix, the exact-
origin retry stopped at unavailable 1Password desktop authority before browser
launch. The user then authorized a bounded headless retry through the existing
protected legacy 1Password service account. Fixed secret reads completed
without a prompt, but the first browser attempt stopped fail-closed at an
unexpected identity transition. The replacement now gives delayed standard
steps a tested ten-second no-action grace. The separately authorized retry did
not produce replacement state, and an immediate credential-free routine read
again confirmed expiry; its exact final sanitized worker classification was
lost during the cross-task handoff, so no narrower cause is claimed. A later
source-only legacy comparison added offline-tested recognition for the explicit
password and authenticator choices on Google's challenge-selection path,
without broadening unknown-challenge behavior. A separately authorized attempt
with that refinement again stopped at `unexpected-challenge` and wrote no
state. A final source-only comparison then added the legacy lane's one-time
explicit `Try another way` transition before the already-bounded authenticator
selection; synthetic coverage is clean, but this latest refinement remains
offline-qualified. A separately authorized attempt then exercised it but again
stopped at `unexpected-challenge` without writing state. No provider mutation
or replacement state write occurred. A separately authorized diagnostic now
maps another unexpected challenge to one closed value-free category without
retaining page content or adding browser actions; its provider attempt remains
bounded and non-retrying. That attempt returned `browser-rejected`, wrote no
state, and proves the current automated browser launch—not another unknown form
step—is the blocker. A separately approved and version-verified fresh-profile
direct-CDP attempt also returned `browser-rejected` and wrote no state. An
initial application-owned bridge from the legacy managed profile retained only
11 PowerSchool-host cookies, but routine validation rejected that state. The
user then authorized one legacy `repair_auth` invocation followed by the same
filtered bridge and routine read. Its preflight found the legacy profile already
authenticated, so no credential retrieval, Google login, or new sign-in
occurred. The clean credential-free collector then returned a fresh verified
three-period C509 observation for 2026-08-11. This closes M-16's PowerSchool
filtered-state reuse question without promoting the replacement JIT browser or
adopting the legacy profile/bridge as steady-state architecture. Because local
Asia/Ho_Chi_Minh time was already 2026-08-12, the result is prior-day evidence;
the separately authorized 2026-08-12 routine read then failed closed with
`repair-required/session-state-rejected` without invoking repair, Google,
1Password, credentials, or a retry. Current-day readiness and filtered-session
longevity remain M-16 gates, with no repeated operator sign-in requested.
An offline source comparison then found that the proven legacy session-HTTP
reader supplies a browser user-agent and same-origin referrer while the
replacement used Node's default request identity. The replacement now derives
its bounded identity from installed Chrome, preserves exact-origin referrer and
cookie rotation across independent runs, and returns separate value-free
status-stage and bell-stage rejection codes. Synthetic Chrome is clean; no
provider retry accompanied that correction. A later authorized non-repairing
gate confirmed the legacy managed profile was already authenticated and
retained 11 filtered PowerSchool cookies without sign-in or credential access.
The first conditional 2026-08-12 routine read failed closed at the exact status
boundary with `status-session-state-rejected`, so the second was not attempted.
Current-day readiness and longevity remain open pending offline diagnosis; no
additional provider read or repeated operator sign-in is requested.
A separately authorized value-free diagnostic then classified that exact
status response as a redirect rather than a 401, 403, marker mismatch, browser
failure, or response-policy failure. The redirect was not followed and its
destination and content were not retained. At that checkpoint M-16 remained
unpromoted while the strict fail-closed redirect boundary and current-day
readiness gate remained open.
Exact Node 24.15/Undici 7.24 and Fetch-standard verification plus a final
authorized non-following diagnostic narrowed the redirect to HTTP 302 at the
exact same-origin path `/oidc/openid_connect_login`, with 11 applicable cookies
for each approved provider path. PowerSchool's public SIS 25.1 documentation
identifies that exact path as its external-identity-provider authentication
endpoint. The tenant's exact SIS version is unavailable, so the collector
classifies only the documented authentication role, keeps the redirect blocked,
and made no bell request. At that checkpoint current-day readiness remained
open without requesting another operator sign-in.
The user subsequently accepted ADR-0021 and authorized an offline-only
persistent compatibility lane based on the proven legacy schedule-reader/auth
lifecycle. Its separate worker retains a dedicated owner-only Google-bearing
Chrome profile, may complete silent OIDC, receives no credentials or form-action
API, and reads only the exact status/bell surfaces through the existing
normalizer. The explicit ADR-0020 repair worker alone may target that profile.
Installed-Chrome synthetic repair, silent renewal, exact read, normalization,
interactive-state refusal, environment scrubbing, and inert-wiring evidence is
clean. No live profile/provider access occurred during that offline
qualification. M-16 remained unpromoted pending an exact exclusive
profile-lifecycle decision, one separately authorized current-date read, and
the remaining kiosk/configuration/route/runbook gates.
A later separately authorized gate preserved the active legacy profile under
its existing OpenClaw owner and used only its fixed bell/repair interfaces. The
first 2026-08-12 refresh returned repair-required and stopped. One authorized
non-forced legacy repair then authenticated without a manual sign-in, and the
conditional exact-date read returned four periods via session HTTP. Only
status/date/count/source were retained and no PowerSchool business-data
mutation occurred. This closes M-16's current-date read gate through the
approved temporary legacy compatibility source; repository-owned profile
handoff/service wiring remains deferred. At that checkpoint M-16 was still
unpromoted pending the kiosk, protected configuration, private route, and final
runbook approvals; the later read-only preflight below resolves route identity
but not handoff approval.
Accepted ADR-0012 fixes the alert semantics;
its direct adapter is offline-qualified and unwired without provisioning a
destination. Safe legacy source inspection now binds Classroom enrichment to
an asynchronous `pre_checkin`/`in_class_content` trigger, a 30-second success
throttle, 60/120/240/480/900-second failure backoff, and last-known-good
retention. An offline-only handler now validates local target state and selects
exactly one mapped current class before source construction.
The user accepted ADR-0019, the inert target proposal, and its non-catch-up
scheduler policy on 2026-08-11. Two isolated inert candidates now implement the
exact 07:20 Sunday-through-Friday plan refresh and 30-second active-class
Classroom evaluation offline, with no catch-up, cross-provider authority, or
activation path. An authorized 2026-08-12 read-only preflight subsequently
bound the existing private route without exposing its hostname: one non-Funnel
`/classroom-screen` handler proxies to loopback port 20790, is owned by active
`classroom-screen.service`, and returned 200 on four status-only local probes.
At that read-only checkpoint every future production root/reference and the
`classroom-hub` service identity was absent. A later separately authorized
inert provisioning step created the non-login identity, owner-only core
configuration/state directories, five protected core files, and an unextracted
SHA-bound runtime archive. It made zero provider requests and installed or
started no production unit. Alert delivery, executable deployment, replacement
readiness, the port-4317 handoff, activation, route change, and user completion
approval remain gated.
The user accepted 18:00–20:00
Asia/Ho_Chi_Minh as the outside-class-hours maintenance window with bounded
operator/stop conditions. M-17 has not
begun. See the [M-16 review package](migration/m16-review-package.md).

A separately authorized candidate gate subsequently deployed the pinned inert
runtime, initialized protected production state, and completed a real read-only
plan refresh for the current Ho Chi Minh City date. The plan job succeeded; the
after-hours Classroom evaluation skipped before provider construction; and the
transient loopback candidate returned 200 for display, health, and readiness.
A separate non-Funnel Tailnet listener exposed the candidate without changing
the legacy listener/backend. Physical Fully Kiosk evidence first exposed and
then verified correction of a temporary preview asset-routing error. The final
styled in-class preview showed no visible clipping, and the candidate listener
was removed while the legacy display remained healthy. The live-time candidate
correctly selected `day_complete`; its waiting copy reflects the already
deferred evening next-class-day source, not a missing current-day plan. This
closes the M-16 on-device render/readiness gate. An
offline-only provisioner now SHA-binds the fixed legacy alert source and can
atomically separate its destination and existing protected bot authority into
three service-owned files without network, delivery, service, timer, or routing
capability. The user subsequently approved its exact proposal fingerprint. The
fixed inert release installed from the expected predecessor, the provisioner
created three protected files while printing no value and making no request,
and the isolated service-user qualification reported one attempted/delivered
fixed message with zero service, route, or application-state changes. No retry
occurred, no production service is installed/active, and the adapter remains
absent from all jobs/services. The user confirmed the intended recipient and
explicitly approved the final runbook, exact targets, recovery evidence,
candidate disposition, and M-16 promotion on 2026-08-12. The Telegram
qualification exercised a direct host-native adapter, not an OpenClaw runtime
dependency. ADR-0022 places exact adapter/job wiring only in M-17's later
final-handoff gate; candidate alerts remain report-only.

- **Objective:** Demonstrate the entire operational switch within the approved
  recovery objective before touching production ownership.
- **Scope:** Configuration freeze, backups/checksums, service/timer inventory,
  URL/routing target, writer handoff, B407 smoke suite, rollback ordering,
  communications, and stopping conditions.
- **Prerequisites:** M-12 and M-15; decisions for `U-003`, `U-004`, `U-009`,
  `U-010`, and `U-013`; approved runbook and maintenance window.
- **Expected components:** Idempotent bounded helper scripts where suitable;
  signed checklist; before/after manifests; dry-run unit/routing commands;
  timed rehearsal evidence.
- **Verification:** Isolated rehearsal meets recovery objective, restores route
  and writer ownership, passes backup restore/integrity, and never permits two
  writers.
- **Parity evidence:** `DISP-001`, `OPS-001`, `OPS-002`, `OPS-004`, `NET-*`,
  `PERSIST-*`, and `DEP-001`.
- **Side-effect boundary:** Rehearsal environment only unless a separately
  approved no-op/read-only production preflight is named.
- **Rollback:** Rehearsal itself executes and verifies the rollback sequence.
- **Completion gate:** User approves the measured runbook, recovery time, and
  exact production targets.

### M-17 — Run an isolated production canary, then hand off

**Current status (2026-08-19):** The user confirmed that Chalkwright's latest
state completed the operational handoff: it is the working preferred production
application. The legacy application remains available as a fallback, but is
obsolete for production use. The detailed record below preserves the preceding
canary and readiness evidence.

**Historical implementation record:** Parallel-canary architecture accepted through ADR-0022 and the exact
offline implementation passed its independent review in a clean isolated lane.
Protected provisioning, exact digest-bound installation, isolated-state
initialization, filtered PowerSchool-state recovery, provider preflights,
provider-free semantic comparison, corrected activation, and the separate
Tailnet route are complete. Release `sha256:9986bbad...a8362` passed plan,
Classroom, integrity, backup, health, and readiness gates, created exactly three
owned events in `Auto Lesson 2`, and started five isolated timers for the exact
initial observation window. Immediate convergence observed all three events and
completed zero further mutations. Subsequent reviewed recovery reached inactive
release `sha256:8616eaf3...59b0`; its objective-card, authenticated-bell, and
bounded future-day corrections passed, but the latest activation stopped when
a later future plan could not be persisted. Cleanup left the candidate stopped,
its Tailnet route absent, and no live activation manifest. ADR-0024 now accepts
application-owned PowerSchool repair. Its protected provisioning completed
without OpenClaw. A prior repair unit reported process success, but later
diagnosis proved that its wrapper exited without running because its direct-
invocation test did not recognize the installed `current` symlink; that report
is not retained as repair evidence. A following credential-free
job reached the separately known future-plan persistence failure only after
successful current and future PowerSchool acquisition. A later repeat exposed
a repair/routine user-agent mismatch: repair reached the exact bell page, but
the fresh routine bell GET was redirected to authentication. Normalizing both
lanes to the same installed-Chrome identity did not resolve the live tenant's
rejection of Node session replay. The next offline correction therefore keeps
Node's bounded exact reads as the primary path but, only for the exact bell
authentication redirect, retries that one document GET through
application-owned Chrome with all redirects, identity requests, and
subresources blocked at the protocol boundary. Its first live run remained
repair-required. The next installed correction preserved only exact
PowerSchool-partitioned cookies from the complete browser cookie API instead of
discarding their CHIPS partition key through the narrower `storageState()`
projection. It preserves Chromium's complete locked-version exact-origin or
immediate schemeful-parent partition key, confines its use to the browser lane,
and refuses response cookies whose `Partitioned` attribute cannot be
reconstructed without broadening. Registrable-domain derivation uses the
exact-pinned Public Suffix List implementation rather than a DNS-label
heuristic. The retained-profile correction then composed the accepted
Chalkwright-owned retained-profile collector into the
credential-free plan entrypoint. It grants no repair secret, form-fill, or
legacy authority, but preserves browser-bound session material and bounded
silent identity renewal. Its first inert live qualification failed before
provider access because of the no-op repair wrapper and an omitted fixed Google
identity-origin assignment. The current offline correction fixes both startup
contracts. A subsequently authorized one-time protected migration moved the
quiescent legacy PowerSchool profile into Chalkwright's dedicated retained-
profile root with no continuing legacy runtime or path dependency. The
following credential-free read failed closed at the browser request policy.
The current offline correction retains that policy and exposes only a fixed,
value-free violation class for the next diagnostic. A successful retained-
session exact-plan read remains the live gate, while future-plan persistence
remains separately unresolved.
The subsequent offline parity correction validates the complete derived
canonical contract before persistence, rejects a too-short dismissal window at
acquisition, and lets bounded future lookup continue past that unusable date.
It also wires copied local lesson/vocabulary content, independent attendance
URLs, and richer legacy presentation behavior without an OpenClaw runtime
dependency. Live confirmation of the former persistence failure remains open.
The user accepted the
physical Fully Kiosk course-title, stable-poll, and next-class-day preview
corrections. Before the later handoff, the legacy route, Calendar, units,
state, alerts, and authoritative role remained unchanged. The subsequent
status update above supersedes that checkpoint.

- **Objective:** Evaluate Classroom Hub beside the authoritative legacy app on
  a separate Tailnet URL and secondary Calendar before a separately approved
  route, scheduler, writer, and alert handoff.
- **Scope:** Two internal gates within M-17. The parallel-canary gate uses
  distinct candidate units/timers, loopback/Tailnet target, SQLite state,
  backups, leases, journals, ownership markers, protected references, and a
  manually created secondary owned Calendar. The final-handoff gate may later
  transfer only explicitly approved legacy ownership.
- **Prerequisites:** Successful M-16; accepted ADR-0022; exact candidate
  manifest; fresh plan/input/readiness; valid backup; approved observation
  duration/cadence; exact secondary-Calendar and legacy/primary deny bindings;
  operators available; and all stop conditions green.
- **Expected components:** Immutable canary manifest; exact-shape isolation
  checks; staggered provider-read jobs; report-only alerts; semantic comparison
  that ignores only provider-generated IDs; health/route/writer probes;
  timestamped redacted receipts; candidate-only stop/removal; and a separately
  fingerprinted final-handoff manifest.
- **Verification:** The legacy URL, Calendar, jobs, alerts, and state remain
  unchanged while the candidate URL and Calendar operate without collision.
  Required display states, media, controls, preview, holds, health, readiness,
  refresh freshness, backup/restart, and Calendar semantics pass for the
  approved active-school-day interval. No candidate operation references
  `primary` or the legacy Calendar, no duplicate writer exists within either
  Calendar scope, and no unrelated service/job changes.
- **Parity evidence:** All inventory IDs required for MVP, with explicit signed
  dispositions for unresolved or later-scope items.
- **Side-effect boundary:** The canary may affect only its exact approved units,
  timers, separate loopback/Tailnet URL, candidate deployment/state paths, and
  secondary owned Calendar. Source systems remain read-only. The legacy route,
  Calendar, jobs, state, and alerts remain untouched until the final-handoff
  gate. Telegram stays unwired and report-only during the canary.
- **Rollback:** Stop/remove only candidate timers, services, and its separate
  Tailnet mapping; retain candidate Calendar evidence unless a separately
  approved owned-event cleanup is authorized. Because legacy ownership was not
  displaced, canary rollback never restores or rewrites legacy state. The later
  final handoff retains the M-16 four-hour rollback objective and ordering.
- **Completion gate:** The user accepts the canary comparison and chooses the
  permanent Calendar disposition, then separately approves and observes the
  final handoff with no unexplained parity, ownership, routing, or alert defect.

### M-18 — Stabilize and remove legacy dependencies

- **Objective:** Earn steady-state confidence before deleting rollback paths or
  OpenClaw dependencies.
- **Scope:** Approved stabilization interval; displays; adapter freshness;
  Calendar convergence; jobs/alerts; database integrity/backups; dependency
  scans; operating docs; explicit legacy retirement/removal plan.
- **Prerequisites:** M-17 and approved stabilization duration/metrics.
- **Expected components:** Daily/interval review report; restore test; path,
  process, unit, timer, import, and route dependency scanner; removal checklist.
- **Verification:** No material incidents or unexplained differences for the
  approved interval; backup restore succeeds; every inventory item is verified
  or explicitly retired; dependency scan finds no required OpenClaw edge.
- **Parity evidence:** `DEP-001`, all `HEALTH-*`, `ALERT-001`, `OPS-*`,
  `PERSIST-*`, plus the complete inventory disposition ledger.
- **Side-effect boundary:** Observation first. Legacy removal is a separate,
  explicitly approved destructive operation limited to named artifacts.
- **Rollback:** Before removal, revert to the validated cutover rollback. After
  removal, restore only from approved retained backups/runbook.
- **Completion gate:** User explicitly approves the end of stabilization and
  each legacy retirement/removal action; steady state is self-contained.

### Post-roadmap distribution direction

The approved M-01 through M-18 sequence remains unchanged. After the initial
deployment is stable and self-contained, general open-source distribution may
add a separately planned setup and configuration track. It should provide one
versioned human-facing non-secret configuration, guided provider/room/screen/
course/Calendar setup, schema validation, fixture-backed preflight, diagnostics,
upgrade, backup/export, and reversible installation without requiring source,
systemd, or generated-runtime-file edits.

This future layer must generate or reference the existing strict runtime
contracts rather than replace their security boundaries. Credentials, OAuth
grants, browser profiles, tokens, and private provider values remain external;
no default may select a live route, provider, Calendar, or mutation target.
This direction does not add, renumber, or authorize a current migration
milestone and does not expand M-17 or M-18.

## Requirements-to-plan traceability

| Requirement | Primary parity evidence                       | Decision records                       | Plan steps                                             |
| ----------- | --------------------------------------------- | -------------------------------------- | ------------------------------------------------------ |
| R-001       | Entire inventory                              | ADR-0006                               | M-01, M-03, M-12, M-17, M-18                           |
| R-002       | `DEP-001`                                     | ADR-0001                               | M-02, M-06, M-07A/M-07B/M-07C, M-11, M-18              |
| R-003       | `PS-001`, `CAL-007`, `GC-001`                 | ADR-0003                               | M-02, M-07A/M-07B/M-07C, M-08, M-10, M-13 through M-15 |
| R-004       | `CAL-001`, all `PLAN-*`                       | ADR-0002                               | M-02 through M-04                                      |
| R-005       | `DISP-*`, `HTTP-*`, `MEDIA-*`, `NET-002`      | ADR-0005                               | M-05, M-12, M-16, M-17                                 |
| R-006       | `PLAN-002`, `OVR-001`, `DISP-006`             | ADR-0007                               | M-02 through M-05, M-12                                |
| R-007       | `PERSIST-*`                                   | ADR-0002, ADR-0004                     | M-04, M-06, M-11, M-16                                 |
| R-008       | `CONTENT-001`, `VOC-002`, `PERSIST-002`       | ADR-0002                               | M-01, M-04, M-09                                       |
| R-009       | `PRE-001` through `PRE-003`, `CAL-007`        | ADR-0003, ADR-0006                     | M-02, M-03, M-05, M-12, M-13                           |
| R-010       | `DISP-005`, `DISP-006`                        | ADR-0008                               | M-04, M-05, M-12                                       |
| R-011       | all `CAL-*`                                   | ADR-0003, ADR-0006                     | M-03, M-13 through M-17                                |
| R-012       | `HEALTH-*`, `ALERT-001`, `OPS-*`, `PERSIST-*` | ADR-0002, ADR-0005                     | M-04, M-06, M-11, M-12, M-16 through M-18              |
| R-013       | `OPS-001`, `OPS-002`, `NET-001`, `NET-002`    | ADR-0005                               | M-06, M-11, M-16, M-17                                 |
| R-014       | Every acceptance-test column                  | ADR-0006                               | M-01, M-03 through M-05, M-10, M-12 through M-17       |
| R-015       | `OPS-004`, `DEP-001`                          | ADR-0006                               | M-11, M-15 through M-18                                |
| R-016       | `PERSIST-003`, `SEC-001`                      | ADR-0004                               | Every step; focused gates in M-01, M-04, M-10, M-12    |
| R-017       | `U-001` through `U-015`                       | ADR index                              | M-01, phase-specific prerequisites, M-18               |
| R-018       | Versioned contracts and tooling               | ADR index and proposed technology ADRs | M-01, M-05 through M-08, M-14, M-16                    |

## Promotion evidence package

Before any stage advances, retain a safely redacted evidence package containing:

1. exact locked/runtime versions and the canonical documentation consulted;
2. test, type-check, formatting, build, contract, and migration results;
3. parity-ID coverage and unexplained-difference counts;
4. source-read and external-mutation audit summaries;
5. database integrity, backup, restore, and retention results where applicable;
6. service/timer/route/writer ownership manifests where applicable;
7. approved exceptions, retirements, open unknowns, and stop conditions; and
8. rollback evidence for any stage that changes external or host state.

Evidence must identify what was actually exercised. A passing fixture does not
prove a live permission boundary, a read-only live test does not prove writer
safety, and a successful cutover does not by itself prove stabilization.
