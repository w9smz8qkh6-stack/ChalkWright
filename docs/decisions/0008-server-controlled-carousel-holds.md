# ADR-0008: Server-controlled carousel holds

- **Status:** Accepted
- **Date:** 2026-08-08

## Context

The legacy pause survives normal polling for the same meeting but is client-
local and disappears on reload. The desired operator control must survive TV
reloads without affecting other screens.

## Decision

Carousel holds are persisted server-side, scoped to screen and meeting/plan
identity, and exposed through a separately authorized local operator command.
A hold may be explicitly indefinite or have a configured safety expiry. Release,
expiry, meeting change, and stale-plan invalidation are auditable. Existing
swipe and pause/resume interactions remain available through initial parity.

## Alternatives considered

- Keep client-local pause only.
- Persist pause in browser storage.
- Use one global hold for all displays.
- Require every hold to be indefinite or every hold to expire.

These do not meet reload continuity, auditable control, screen isolation, or
the accepted operator choice.

## Consequences

SQLite stores hold state/audit metadata, display responses include effective
hold state, and mutating routes need authorization and bounded inputs. Operators
must be able to see and release holds safely.

## Reversibility

Holds can be disabled without changing base plans or carousel content. Existing
client controls provide a fallback before production activation.

## Verification implications

Test reload persistence, release, expiry, explicit indefinite hold, meeting
change, stale plan, authorization, audit redaction, concurrent commands, and
strict cross-screen isolation.
