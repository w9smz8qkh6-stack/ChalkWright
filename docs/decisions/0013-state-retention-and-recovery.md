# ADR-0013: State retention and recovery

- **Status:** Accepted
- **Date:** 2026-08-08

## Context

The application needs durable continuity state without retaining operational or
school-related data indefinitely. Recovery objectives must distinguish the
intended production policy from the narrower synthetic restore exercise used to
verify the M-04 persistence implementation.

## Decision

Create operational backups nightly. Retain 14 daily backups and 8 weekly
backups. Operate toward a four-hour recovery-time objective (RTO) and a
24-hour recovery-point objective (RPO).

Apply these retention periods to application state:

- retain job-run and comparison evidence for 90 days;
- retain attendance summaries and temporary operational state for 30 days;
- retain plans, content, and vocabulary history through their explicitly
  identified academic year and for 90 days after that academic year ends; and
- retain configuration, mappings, and Calendar ownership records while active
  and for one year after they become inactive.

Backups and retained application state must not contain secrets, OAuth data,
browser profiles, raw student records, raw provider captures, logs, generated
artifacts, or other material forbidden by the repository's security boundary.

The synthetic backup-and-restore exercise delivered by M-04 verifies the
repository implementation only. It is not evidence that operational backups,
retention, restore procedures, or the RTO and RPO objectives have been proven
in a deployed environment.

## Alternatives considered

- Retain every state category indefinitely.
- Apply one retention period to all application state.
- Treat the M-04 synthetic restore as proof of operational recovery readiness.

Indefinite or uniform retention would retain more data than operational needs
justify or discard longer-lived configuration and academic continuity too
soon. A synthetic repository test cannot establish deployed scheduling,
storage, monitoring, access control, or recovery timing.

## Consequences

Persistence records need sufficient lifecycle metadata to apply the applicable
retention period. Operational backup automation must support daily and weekly
retention tiers, while restore procedures and monitoring must be evaluated
against the stated objectives without widening the sensitive-data boundary.

## Reversibility

Backup cadence, retention periods, and recovery objectives can be changed by a
superseding decision. Shortening retention requires a reviewed deletion policy;
lengthening it requires a new data-minimization and storage-impact review.

## Verification implications

Use synthetic data to test retention boundaries, backup creation, restoration,
integrity, and exclusion of forbidden material. Operational readiness requires
separately authorized deployment evidence showing scheduled backups, aged-copy
rotation, protected storage, monitored failures, and timed restore exercises.
