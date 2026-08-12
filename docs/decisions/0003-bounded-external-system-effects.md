# ADR-0003: Bounded external-system effects

- **Status:** Accepted
- **Date:** 2026-08-08

## Context

The product needs school schedule and Classroom context, while Calendar
reconciliation is an approved output. A mistaken command or broad ownership
rule could alter source records or unrelated events.

## Decision

PowerSchool and Google Classroom adapters expose read operations only.
Authentication and every required source read must succeed before Calendar
execution becomes eligible. Calendar writes are limited to strongly verified
application-owned events in an explicit scope, require a single-writer lease,
and suppress attendee notifications. Preview, tests, and shadow comparison are
constructed without mutation ports.

## Alternatives considered

- Rely on conventions while using general-purpose clients.
- Permit partial Calendar reconciliation as each source date is acquired.
- Treat title/description matching as sufficient ownership.

Those options fail closed-loop safety: they permit accidental writes, partial
mutation after later auth failure, or over-claiming unrelated events.

## Consequences

Adapters and credentials must use least privilege, writer APIs require explicit
intent and ownership types, and ambiguous legacy events are quarantined. Some
runs will be skipped rather than partially useful; this is intentional.

## Reversibility

The boundary may be made stricter without migration. Expanding source writes or
ownership requires a new ADR and explicit user authorization.

## Verification implications

Use static command/scope allowlists, mutation spies, auth-failure injection,
mixed owned/unrelated/ambiguous fixtures, concurrent lease tests, dry runs,
notification-policy assertions, and post-write readback.
