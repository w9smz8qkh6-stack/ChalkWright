# M-02 domain ports and canonical-plan review package

- **Plan step:** M-02 — Establish domain ports and canonical plan types
- **Status:** Approved and promoted as the M-02 baseline
- **Prerequisite:** Approved M-01 contract and synthetic-evidence baseline
- **Evidence boundary:** Repository-only types, static checks, and synthetic tests

## Scope delivered

M-02 adds enforceable capability boundaries without implementing acquisition,
plan derivation, persistence, presentation, Calendar execution, local process
execution, or operations. No dependency was added.

The pure domain package defines:

- nominal class, room, and screen identities;
- injected clocks and identifier factories;
- provider-neutral observation metadata and enrichment envelopes carrying
  provenance, freshness, verification, and diagnostics;
- the frozen canonical-plan boundary and a separate screen-scoped effective
  plan;
- redacted actionable-error categories; and
- exhaustive typed job results for succeeded, degraded, skipped,
  repair-required, and failed outcomes.

Capability-specific ports define:

- read-only schedule and enrichment observation sources;
- implementation-neutral plan snapshot readers and writers in separate modules;
- an isolated Calendar writer that accepts only inert v1 reconciliation intents;
- a bounded local-command request with no executable, arguments, environment,
  working directory, or arbitrary path; and
- a read-only port barrel that deliberately excludes every writer capability.

Preview and comparison contracts live under `src/application/read-only/` and
receive only the clock, identifier factory, observation readers, and plan
snapshot reader. They cannot import a Calendar writer, local-command port, or
persistence writer.

## Enforced architecture

The boundary suite is executable, not advisory. It fails when:

- a domain module imports a non-relative package or anything outside the domain
  and frozen-contract trees;
- a domain import names an adapter, Calendar, display, HTTP, infrastructure,
  OpenClaw, provider, or UI dependency;
- a port contract imports an adapter, external runtime package, or module outside
  the port, domain, and frozen-contract trees;
- preview/comparison source mentions or imports a mutation capability;
- the read-only port surface exports a Calendar writer, local-command port, or
  persistence writer; or
- the canonical-plan module imports Calendar, display, or OpenClaw contracts.

Compile-time equality examples additionally freeze the exact read-only method
surfaces, prove mutation ports are absent from read-only dependency keys, keep
the Calendar writer to one explicit `reconcile` capability, verify injected
clock/identifier services, and reject output-technology fields on the canonical
plan. Executable examples exercise every job-result discriminant and the
repair-required zero-mutation invariant.

## M-02 parity evidence

| Parity ID  | M-02 evidence                                                                                                     | Remaining behavioral gate                |
| ---------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `CAL-001`  | Canonical-plan type and import/key architecture tests contain no Calendar authority or output fields.             | M-03 deterministic plan tests            |
| `GC-001`   | The enrichment source exposes only `readEnrichment`; provider commands and SDKs are outside the boundary.         | M-08 scope and integration audit         |
| `PLAN-001` | Nominal identities plus canonical/effective plan types extend the approved synthetic core fixtures.               | M-03 schedule-to-plan golden tests       |
| `PRE-003`  | Preview/comparison dependency and import tests structurally exclude all writer ports.                             | M-03 mutation-spy and M-05 route tests   |
| `SEC-002`  | Existing fixture safety remains active; bounded local-command data cannot carry process or arbitrary-path inputs. | M-03 validation and M-05 fuzz/path tests |

The executable parity map points these IDs at their M-02 evidence while
retaining the named later behavioral gates. M-02 establishes boundaries only;
it does not claim later behavior is implemented.

## Assumptions and unresolved decisions

- M-01 v1 contracts remain the versioned exchange vocabulary. M-02 refines
  internal capability boundaries without changing their serialized shapes.
- Enrichment value schemas, plan derivation, identity parsing/validation, and
  effective-plan overlay rules belong to M-03.
- Transaction semantics, revisions, concurrency, SQLite schema, and migrations
  remain M-04 decisions behind the persistence ports.
- Calendar lease acquisition, ownership validation, execution receipts, and
  adapter technology remain later Calendar stages. The writer port alone does
  not authorize execution.
- Local-command kinds are limited to compatibility evidence and operator-brief
  categories. Their implementation, process allowlist, timeout policy, and
  activation remain unresolved later operational work.
- Error messages are contractually redacted, but construction-time validation
  and logging policy remain later implementation work.
- Proposed ADRs for UI delivery, PowerSchool adapter technology, Google client
  and scopes, and alert transport remain proposed. M-02 does not select or
  depend on any of them.

## Approval record

M-02 was approved by the user on 2026-08-08 after review of the actual
contracts, ports, architecture tests, parity updates, and documentation, plus
an independent complete quality-gate run. The approved snapshot is the
prerequisite capability baseline for M-03. Approval does not authorize M-04 or
any live-system or external-state work.
