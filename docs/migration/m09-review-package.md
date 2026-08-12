# M-09 review package: attendance and continuity safety

- **Status:** offline implementation and attendance contract accepted; any safe
  export read remains separately gated
- **Date:** 2026-08-09
- **Integration branch:** `codex/m07c-clean-integration`
- **Approved repository baseline:**
  `efeb37edc5b8be6fa35746b38db37aa4dfa85b4f`
- **External effects:** none; only synthetic fixtures and temporary SQLite

## Roadmap fit

M-09 is the existing roadmap milestone after M-08. It does not renumber or
collapse the roadmap. M-08 and M-09 both gate M-10's read-only multi-source
integration. The fixture-backed usable-display checkpoint was reached at M-05;
the minimum viable replacement still requires M-10 through M-18 integration,
shadow, comparison, Calendar ownership/writer, rollback, cutover, and
stabilization gates.

The handoff and roadmap agree on offline synthetic work and on separate
authorization before any legacy-state read. The user accepted ADR-0015's
bounded attendance contract on 2026-08-09, satisfying M-09's completion gate.
This promoted M-09 but granted no authority for M-10 or a legacy-state read.
The user later authorized the bounded M-10 checkpoint; that later authorization
does not authorize a legacy-state read.

## Accepted attendance contract

The existing attendance-link resolver is now used consistently by target,
preview, and QR controller paths. It skips invalid and credential-bearing URLs
while preserving direct-prefilled, direct-responder, wrapper, then quick-link
precedence. The fixture-backed compatibility controller redirects only the
evidenced `check-in` target. Unknown `/go/*` targets return not-found rather
than being guessed; they are not marked retired.

The synthetic teacher matrix is a pure transient contract:

- one through 100 opaque learner keys, in roster order;
- one through 200 ordered meeting/date columns;
- no more than 20,000 complete cells;
- exactly one `P`, `T`, or `A` value for every learner/meeting pair; and
- no name, email, submission, response body, raw provider value, persistence,
  route, or diagnostic capability.

Missing, duplicate, foreign, invalid, sparse, accessor-backed, extra-field, or
over-budget input fails closed. Missing marks are not inferred as absences
because that legacy meaning is not evidenced.

## Aggregate continuity contract

An explicitly supplied safe export contains a version, export time, and at
most 500 candidate aggregate records. Each candidate is passed independently
through the existing M-04 allowlisted continuity planner. Accepted records
contain only attendance/class/meeting/date identifiers, safe links, summary
counts, and explicit attendance-scoped provenance. Missing or unsafe
provenance, unknown/forbidden fields, corrupt values, and duplicate identities
quarantine the complete record.

Quarantine evidence contains only the record index, stable category/code, and
safe structural path. Reconciliation exposes only source, accepted,
quarantined, inserted, and unchanged counts plus stable mismatch codes. It does
not echo record identities or values. The generic M-04 attendance schema
remains backward compatible because provenance is optional there; the M-09
safe-export adapter requires it before promotion.

## Offline evidence

Synthetic tests prove:

- validated direct-versus-wrapper link selection across display and QR paths;
- the known check-in redirect and not-found behavior for unsupported aliases;
- roster-first immutable matrix output and exact P/T/A completeness;
- rejection of identity-bearing fields, foreign/duplicate/missing cells,
  unordered meetings, hostile accessors/sparse arrays, and input budgets;
- aggregate-only record acceptance, whole-record quarantine, bounded
  attendance provenance, duplicate quarantine, and value-free reports;
- transactional import into disposable SQLite, deterministic repeated-import
  no-op behavior, and count-only reconciliation; and
- architecture guards preventing matrix/learner rows from entering persistence
  or HTTP modules.

The existing M-03/M-05 QR scope, missing-link, route-family, method, and redirect
tests and the M-04 generic importer/storage tests remain intact. `npm run check`
passed all 437 tests, production build, startup smoke, and the 6/6 offline
operations rehearsal. Documentation resolved 89 local links, repository safety
checked 285 candidate paths, and `git diff --check` passed.

## Parity and unresolved decisions

- `ATT-001` through `ATT-005`: synthetic implementation evidence is present;
  real compatibility behavior remains subject to later authorized comparison.
- `ATT-006`: the roster-first P/T/A shape is proved synthetically under the
  accepted transient, no-persistence contract in ADR-0015.
- `PERSIST-002`: safe aggregate attendance import, quarantine, provenance,
  reconciliation, and repeatability are proved with disposable state. No real
  legacy export was opened.
- `U-002`: resolved for the replacement MVP by the user-accepted synthetic
  aggregate-only/transient-matrix contract in ADR-0015.
- `U-012`: remains open. The application continues first-class scope modeling,
  but no active non-B407 room/display is inferred.

## Deferred rather than completed

- reading, copying, exporting, or comparing any legacy attendance state;
- raw submissions, student names/emails/identifiers, roster rows, or audit rows;
- determining whether a missing legacy mark means absent;
- undocumented teacher/Classroom/quick compatibility aliases;
- the real active non-B407 room/display inventory;
- live routes, provider access, deployment, services, timers, routing, or
  background jobs; and
- M-10 live qualification and every later roadmap milestone.

## Accepted completion gate

On 2026-08-09 the user accepted this bounded contract:

1. learner-level P/T/A rows are transient only and never durable application
   state;
2. durable continuity is aggregate-only with explicit provenance and
   whole-record quarantine;
3. only the evidenced `check-in` compatibility alias is active; unknown aliases
   stay not-found pending evidence; and
4. `U-012` remains a later mapping-inventory decision.

M-09 is therefore promoted. The acceptance did not authorize a legacy export
read; M-10 was authorized separately afterward. If real-export reconciliation is desired, the next action must
separately authorize one reviewed safe-shape export and a disposable
replacement database only.
