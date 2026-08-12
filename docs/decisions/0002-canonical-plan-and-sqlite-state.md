# ADR-0002: Canonical day plan and SQLite state

- **Status:** Accepted
- **Date:** 2026-08-08

## Context

Legacy behavior is spread across source captures, generated catalogs, caches,
Calendar events, JSON files, and plugin databases. Calendar cannot safely act
as both the application's input and output.

## Decision

A typed canonical day plan is the normalized application source of truth after
validated source observations, mappings, and local policy. Screen-specific
overlays derive effective plans without changing the canonical plan. SQLite is
the single-host application state store for versioned safe configuration,
plans, mappings, content, ownership, overrides, vocabulary history, holds, job
runs, and comparison evidence.

## Alternatives considered

- Continue with multiple atomic JSON state files.
- Use Calendar as the schedule database.
- Introduce a network database at the start.

JSON does not provide adequate cross-record transactions or queryable
migrations. Calendar would invert the accepted source/output relationship. A
network database adds an unnecessary service for the initial one-host scope.

## Consequences

The application needs explicit schemas, forward migrations, integrity checks,
transactions, backups, restore tests, provenance, and retention. SQLite is not
a credential store and does not absorb every legacy artifact.

## Reversibility

The repository interface keeps a later database change possible. Export and
migration tooling would be required; the canonical domain types remain stable.

## Verification implications

Test empty-to-current and version-to-version migrations, semantic no-ops,
concurrency boundaries, corrupt-input behavior, idempotent continuity import,
integrity, backup, restore, and screen-scope isolation.
