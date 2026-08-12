# ADR-0015: Aggregate-only attendance continuity and transient matrix

- **Status:** Accepted
- **Date:** 2026-08-09
- **Decision scope:** M-09 offline attendance and continuity contract

## Context

The parity inventory preserves link precedence, QR and compatibility routes,
and a teacher attendance matrix, but the authoritative legacy attendance
implementation was not available. Inspecting live submissions or raw student
rows is outside the safe evidence boundary. Existing M-03 through M-05 code
already models attendance links and aggregate counts, and M-04 can import those
safe aggregate shapes.

M-09 needs a testable contract without turning raw attendance, roster, or
submission data into application state. It also must not guess undocumented
`/go/*` aliases or which non-B407 rooms are active.

## Decision

- Resolve emitted attendance URLs through the existing validated precedence:
  direct prefilled, direct responder, wrapper, then quick link. Invalid or
  credential-bearing URLs are skipped.
- Preserve only the evidenced `/go/check-in/:class` compatibility redirect.
  Unknown targets return not-found until safe evidence or explicit user
  acceptance defines them; this is quarantine, not retirement.
- Model the teacher matrix as a transient pure value. Inputs use bounded opaque
  learner and meeting keys, ordered meetings, and exactly one `P`, `T`, or `A`
  cell for every roster/meeting pair. Names, emails, submissions, response
  bodies, and provider payloads are outside the contract.
- Do not persist or expose matrix rows through HTTP or diagnostics. Durable
  attendance continuity contains only class/meeting/date identifiers, safe
  links, aggregate counts, and explicit bounded provenance.
- Plan an explicitly supplied safe export record by record. Unsupported,
  malformed, identity-bearing, duplicate, or provenance-free records are
  quarantined whole. Reports contain only record indexes, stable codes, safe
  structural paths, and counts; input values and record identities are omitted.
- Reconciliation compares only source, accepted, quarantined, inserted, and
  unchanged counts. A repeated import must be a semantic no-op.
- Continue to model screens and rooms as first-class scopes, but do not infer
  which real non-B407 scopes are active. `U-012` remains open.

## Alternatives considered

- **Persist the P/T/A matrix:** rejected because learner-level rows are not
  required for the display MVP and increase privacy, retention, and diagnostic
  risk.
- **Infer absence from a missing mark:** deferred because the missing-cell
  meaning is not evidenced. The offline contract fails closed instead.
- **Implement plausible teacher/Classroom redirect aliases:** rejected pending
  authoritative evidence or explicit product acceptance.
- **Inspect legacy submissions or a live attendance system:** excluded from
  this checkpoint. A later safe-export read requires separate authorization.

## Consequences

The offline contract can prove shape, ordering, route, quarantine, provenance,
and idempotency behavior without retaining student data. It cannot prove how a
real legacy export names fields, whether missing marks mean absence, or which
additional compatibility aliases and rooms are required.

The user accepted this contract on 2026-08-09. It resolves `U-002` for the
replacement's MVP boundary without claiming live legacy parity. Any future
evidence that materially changes this boundary requires a superseding decision;
it does not silently widen the accepted data surface.

## Verification implications

Synthetic tests must cover link precedence, redirect allowlisting, QR scope,
roster/meeting ordering, exact P/T/A completeness, hostile shapes, per-record
quarantine, explicit provenance, repeatable SQLite application, count-only
reconciliation, and architectural absence of learner rows from persistence and
HTTP modules. No legacy state or provider access is required for this offline
evidence.
