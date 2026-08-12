# ADR-0004: Separate sensitive material and runtime state

- **Status:** Accepted
- **Date:** 2026-08-08

## Context

The integrations may require OAuth material, browser profiles, and source
observations that can contain student data. Combining them with versioned code
or the normal application database would broaden exposure and backup scope.

## Decision

Git contains only safe source, templates, synthetic/redacted fixtures, and
documentation. Secrets, OAuth data, browser profiles, raw captures, student
records, runtime databases, caches, logs, backups, and generated artifacts live
in separate protected deployment paths governed by least privilege and
retention. Application configuration stores references, not secret values.

## Alternatives considered

- Encrypt credentials inside the application SQLite database.
- Store browser sessions beneath the repository for portability.
- Copy raw legacy state and filter it after import.

Each expands the sensitive-data surface and makes accidental commit, logging,
or backup more likely.

## Consequences

Deployment must provision protected directories and permissions. Backup policy
must distinguish application continuity state from credentials/profiles and
must minimize student data. Missing sensitive material degrades only the
dependent adapter and is reported without values.

## Reversibility

Paths and secret providers can change behind references. Moving sensitive data
into ordinary application state would require a new security decision.

## Verification implications

Run secret/generated-artifact scans; test redaction, file-mode/path policy,
backup exclusions, fixture review, missing-secret behavior, and arbitrary-path
rejection. Never print credential or profile contents during verification.
