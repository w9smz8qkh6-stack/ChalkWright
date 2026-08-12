# ADR-0023: Chalkwright public identity and compatibility migration

- Status: Accepted
- Date: 2026-08-12

## Context

The migration began under the working name Classroom Hub. That name is now
embedded in environment variables, service accounts, filesystem paths, URLs,
Calendar ownership markers, tests, and historical evidence. The intended
public application and repository name is Chalkwright.

## Decision

Use **Chalkwright** for the package, current user interface, public
documentation, and eventual GitHub repository. Preserve existing
`CLASSROOM_HUB_*`, `classroom-hub` operational paths, compatibility URLs, and
ownership markers until each can be migrated with explicit aliases, rollback,
and upgrade tests. Preserve historical evidence under its original name.

Do not bundle the private dismissal video. Support optional site-owned media as
an external digest-bound production configuration reference, with a
repository-owned poster fallback when absent.

## Consequences

- Public readers see one stable product name immediately.
- Existing qualified deployments and ownership records do not silently drift.
- Internal renaming remains visible technical debt, not a claim of completion.
- A future compatibility release can deprecate old identifiers without forcing
  a flag-day migration.

## Verification

Current UI and package metadata say Chalkwright. Tests preserve old route/path
aliases where compatibility is intentional. Publication checks reject bundled
uncleared media, and configured external media is exact-shape, bounded, and
digest verified.
