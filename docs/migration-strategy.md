# Migration strategy

## Strategy summary

Migrate by capturing contracts, building a side-effect-free domain replacement,
importing continuity state, and progressively proving equivalence. The legacy
system remains the production authority until shadow evidence is complete.
Calendar always has one active writer. Cutover occurs outside teaching hours
with a tested rollback, followed by a stabilization window before OpenClaw
dependencies are removed.

No phase advances because code exists. It advances only when its evidence and
stopping conditions are satisfied.

## Phase 0 — Contract and evidence capture

**Rationale:** undocumented behavior is the largest parity risk.

- Freeze the behavior IDs in the
  [legacy parity inventory](legacy-parity-inventory.md).
- Convert sanitized legacy examples into golden fixtures for bell schedules,
  mappings, plans, states, content, assignment caches, attendance links,
  overrides, vocabulary history, routes, health, and Calendar intents.
- Capture visual baselines for representative TV sizes and states without
  student data or private URLs.
- Define comparison normalization rules for timestamps, generated IDs,
  ordering, and known legacy defects.

**Advance evidence:** every known behavior has a fixture/test target or an
explicit later live-verification gate; fixture provenance and redaction are
reviewed.

**Stop if:** evidence requires credentials, raw student data, or live mutations;
an ownership contract is ambiguous; or a legacy behavior cannot be safely
characterized.

## Phase 1 — Offline domain kernel

**Rationale:** prove business behavior independently of transport and storage.

- Define typed contracts for observations, mappings, canonical plans, effective
  screen plans, display states, content cards, holds, and Calendar intents.
- Port schedule normalization, timing/state selection, next-class-day logic,
  assignment normalization, objective generation, vocabulary rotation,
  attendance-link resolution, overrides, and carousel timing into pure modules.
- Run golden fixtures against legacy outputs.

**Advance evidence:** deterministic tests cover all offline parity IDs,
including invalid and stale inputs, with no network, filesystem, database, or
clock dependence outside injected ports.

**Stop if:** a difference cannot be classified as a defect, approved change,
normalization artifact, or unresolved parity gap.

## Phase 2 — SQLite state and continuity import

**Rationale:** state continuity must be solved before integration and cutover.

- Introduce versioned SQLite migrations, transactions, integrity checks,
  backup/restore, and retention.
- Import validated copies of configuration, mappings, ownership records,
  content, vocabulary and history, attendance links, overrides, and required
  run state. Do not import secrets, profiles, raw captures, logs, or unnecessary
  student data.
- Preserve original opaque identities and provenance where continuity depends
  on them.
- Make imports repeatable and comparison-only until explicitly promoted.

**Advance evidence:** import is idempotent; row/count/field reconciliation
matches sanitized source-shape reports; rollback restores the pre-import
database; rejected fields are reported without sensitive values.

**Stop if:** data ownership is ambiguous, a migration would lose behavior, or
the backup/restore rehearsal fails.

## Phase 3 — Transitional and direct read adapters

**Rationale:** decouple domain progress from the hardest authentication work
without making transitional dependencies permanent.

- Implement fixture adapters first.
- Add transitional read adapters for existing safe local outputs where needed.
- Build direct PowerSchool and Google Classroom adapters behind the same ports.
- Keep authentication/profile material separate and repair explicit.
- Record freshness, provenance, transport, and repair-required outcomes.

**Advance evidence:** direct and transitional adapters normalize the same safe
inputs to equivalent observations; source permissions and command surfaces are
read-only; authentication failure produces no Calendar intent execution.

**Stop if:** an adapter needs a write scope, leaks sensitive payloads, bypasses
profile isolation, or cannot distinguish stale/auth-failed data.

## Phase 4 — Application routes and TV parity

**Rationale:** preserve the user-visible contract before production integration.

The first bounded deliverable in this phase is the offline
[B407 Classroom Display MVP](b407-display-mvp.md). It proves the complete
fixture-backed display/operator slice without claiming the later minimum viable
replacement, production readiness, or live-system parity.

- Implement current routes, response shapes, headers, media/range behavior,
  preview, override authorization, manifest/assets, and responsive TV UI.
- Preserve the initial TV path, display states, timing, polling/backoff,
  countdowns, transitions, media, pause/swipe controls, and last successful
  display.
- Add server-controlled holds without removing current manual controls.

**Advance evidence:** contract tests and recorded visual review pass for all
states at required viewport sizes; reload and failure tests prove hold and
last-known-good behavior.

**Stop if:** the TV route, timing boundary, content selection, media, or
operator workflow differs without approval.

## Phase 5 — Read-only shadow execution

**Rationale:** live inputs reveal mapping, calendar, and special-day cases that
fixtures miss.

- Run replacement acquisition, plan generation, display selection, and
  Calendar **intent** generation on the production cadence with mutation ports
  disabled.
- Compare legacy and replacement outputs by behavior ID and retain redacted
  difference records.
- Exercise normal days, schedule changes, gaps, stale caches, auth failure,
  no-class days, and future-day preview.

**Advance evidence:** zero unexplained material differences across the
user-approved shadow window; readiness and alerting are stable; resource use is
acceptable.

**Stop if:** any source write occurs, sensitive data enters comparison output,
auth failure does not fail closed, or unexplained differences recur.

## Phase 6 — Controlled Calendar writer qualification

**Rationale:** Calendar is the only approved external mutation surface and the
highest cutover risk.

- Import/verify legacy ownership state without claiming ambiguous events.
- Prove dry-run create/replace/delete intents against owned events only.
- Add a mutually exclusive writer lease/guard shared by legacy and replacement
  operations.
- Exercise no-op, changed-time, duplicate, partial failure, retry, and recovery
  scenarios in a non-production fixture/calendar scope before any production
  write.
- During a controlled production trial, disable the legacy writer for the
  chosen scope before enabling the replacement writer.

**Advance evidence:** ownership audit is clean; authentication preflight and
writer exclusivity are demonstrated; every receipt maps to an approved intent;
rollback is rehearsed.

**Stop if:** ownership is ambiguous, two writers can run, a delete is broader
than the owned set, or a partial failure cannot converge safely.

## Phase 7 — Parallel production canary and outside-hours handoff

**Rationale:** prove the complete replacement under production conditions
without displacing the legacy fallback or allowing two writers on one Calendar.

- Freeze configuration and capture backups/checksums.
- Activate the replacement first on a separate Tailnet URL, manually created
  secondary owned Calendar, distinct state roots, and distinct units/timers.
- Keep the legacy route, Calendar, jobs, alerts, and state authoritative and
  unchanged during the approved canary interval.
- Stagger bounded read-only provider jobs, keep candidate alerts report-only,
  and compare normalized plans, display states, health, and Calendar semantics.
- Run bounded physical Fully Kiosk checks against the candidate while retaining
  the legacy URL as the normal page.
- Only after separate approval, stop/disable the exact legacy jobs and route
  bindings, promote the chosen Calendar target, repoint the existing URL, and
  activate routine alerts using the rehearsed single-writer order.

**Advance evidence:** signed canary and handoff checklists; isolated route,
state, scheduler, alert, and Calendar targets; clean smoke tests; approved
active-school-day comparison; no same-scope double writes; and no unexplained
material parity regression.

**Stop/rollback if:** isolation or readiness fails, route/visual behavior
changes materially, Calendar ownership or writer state is uncertain, the
candidate touches a legacy target, or final-handoff recovery cannot complete
inside the approved window. Canary rollback stops only the candidate; final-
handoff rollback follows the M-16 restoration order.

## Phase 8 — Stabilization and dependency removal

**Rationale:** rollback value is highest immediately after cutover; dependency
removal should wait until confidence is earned.

- Keep legacy code/state read-only and rollback-capable for the approved
  stabilization window.
- Monitor display, integrations, timers, alerts, SQLite integrity, backups, and
  Calendar convergence.
- Resolve remaining parity differences before removing adapters.
- Remove OpenClaw routes, schedules, plugins, browser-runtime dependencies,
  databases, and directory references only after a dependency scan and explicit
  approval.

**Complete evidence:** the steady-state dependency audit is empty; restoration
and backup tests pass; all inventory dispositions are verified or explicitly
retired; operating docs describe only the new owner.

## State continuity strategy

| Legacy state                         | Treatment                                                                                         |
| ------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Safe configuration and timing values | Validate, normalize, and import with provenance.                                                  |
| Class/room/course mappings           | Preserve opaque identities and mapping history; reject ambiguous duplicates.                      |
| Calendar ownership/fingerprints      | Import as legacy ownership candidates; verify before adoption.                                    |
| Content and date overrides           | Preserve ordering, card types, durations, and scope.                                              |
| Vocabulary and selection history     | Preserve meeting idempotency and rotation history.                                                |
| Attendance/check-in link contracts   | Preserve only required current/continuity fields; never copy response bodies.                     |
| Local overrides                      | Import display/date/class scopes and authorization-independent payloads.                          |
| Assignment cache                     | Import only fresh, minimal normalized cache entries; otherwise refresh read-only.                 |
| Job/reconciliation state             | Preserve fingerprints and outcomes needed for no-op/recovery behavior.                            |
| Secrets, OAuth, cookies, profiles    | Do not import; configure separate protected locations.                                            |
| Raw captures, logs, student exports  | Do not import into application state. Retain only under existing approved policy if still needed. |

## Key risks and mitigations

| Risk                                                       | Mitigation                                                                                           |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Hidden parity behavior                                     | Preserve-by-default inventory, golden fixtures, shadow diff, explicit retirement approval.           |
| Calendar overreach or double writer                        | Strong ownership markers, single-writer lease, dry-run audit, outside-hours cutover.                 |
| Auth expiry during reconciliation                          | Complete reads/auth preflight before mutation; zero-write failure path.                              |
| Legacy fallback masks bad source data                      | Label provenance and verification state; compare verified and fallback plans separately.             |
| Attendance contract is incompletely implemented/documented | Treat as an open parity gate; inspect only safe contract shapes and require dedicated fixtures.      |
| Visual regressions                                         | Preserve route/assets first, capture viewport baselines, record human visual approval.               |
| SQLite corruption or bad migration                         | Transactions, integrity checks, pre-migration backup, restore rehearsal, last-known-good snapshots.  |
| Sensitive data in fixtures/telemetry                       | Synthetic/redacted fixture review and automated secret/PII checks.                                   |
| Scheduler drift                                            | Repository-owned units/timers, explicit timezone, run ledger, missed-run policy, cadence comparison. |
| Premature OpenClaw removal                                 | Transitional ports and stabilization gate; dependency scan before removal.                           |

## Assumptions requiring confirmation

- The exact shadow and stabilization durations will be approved before those
  phases begin.
- The existing TV URL can be repointed through Tailscale Serve without changing
  the client bookmark/kiosk configuration.
- A least-privilege direct Google credential path and a direct PowerSchool
  browser/auth path can be established without importing existing secrets.
- Legacy Calendar ownership candidates can be distinguished safely from
  unrelated events.
- The required alert destination and operator identity model will be selected
  before production operations move.
