# ADR-0006: Parity-first migration and single writer

- **Status:** Accepted
- **Date:** 2026-08-08

## Context

Legacy behavior is broader than its high-level documentation, and the Calendar
projection can be damaged by concurrent reconcilers. A big-bang rewrite would
make omissions, regressions, and rollback difficult to distinguish.

## Decision

Migration proceeds through inventory, synthetic contracts, offline domain
tests, continuity import, read-only integrations, mutation-disabled shadow
comparison, non-production writer qualification, bounded writer trial,
outside-hours cutover, and stabilization. Legacy remains production authority
until cutover. Exactly one Calendar writer owns any scope during trial, cutover,
and rollback. Retirement is explicit; silence preserves behavior.

## Alternatives considered

- Big-bang replacement.
- Route traffic first and fix parity gaps afterward.
- Run both Calendar reconcilers and compare their results.

These increase classroom interruption, hide omissions, or create external
double-write risk.

## Consequences

The migration takes longer and requires comparison evidence, writer leases,
stop conditions, and retained rollback paths. It supports narrow, reversible
promotion and makes accepted differences visible.

## Reversibility

High through shadow because production is untouched. Writer trial and cutover
require explicit manifests and rollback. Legacy removal waits until the approved
stabilization gate.

## Verification implications

Trace every behavior to evidence and a gate; require zero unexplained material
shadow differences; rehearse writer conflict, cutover, and rollback; scan for
dependencies before removal.

## Later amendment

Accepted [ADR-0022](0022-parallel-production-canary.md) permits concurrent
legacy and candidate writers only on two disjoint, exact-bound Calendars with
separate state and leases. It does not weaken the prohibition on two writers
targeting the same Calendar. M-17 now requires a parallel canary before its
separately approved final handoff.
