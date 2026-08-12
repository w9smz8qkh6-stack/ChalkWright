# ADR-0007: First-class screens and rooms

- **Status:** Accepted
- **Date:** 2026-08-08
- **Target amendment:** 2026-08-09

## Context

The original production-validation target was B407, but legacy state indicates
multiple displays and room/location mappings. Hard-coding one global classroom
would make later activation risky and could leak plans or overrides across
screens.

## Decision

Rooms and screens are explicit identities. Plans, routes, configuration,
readiness, overrides, holds, and health are scoped to them. On 2026-08-09 the
user identified C509 as the current 2026–27 classroom and production-validation
target. B407 remains the approved offline fixture baseline. This target change
does not alter the identity/isolation decision. Unknown or missing scope returns
not-found/empty diagnostics and never falls back to another room.

## Alternatives considered

- Model only B407 and generalize later.
- Treat route names as unvalidated room identity.
- Share one effective plan and layer client-only differences.

These create migration work later and weaken isolation guarantees now.

## Consequences

Every repository key and route requires scope, fixtures require multiple rooms,
and operator actions must state the target. Additional rooms remain inactive
until separately validated and approved.

## Reversibility

The model can represent one active screen without cost. Collapsing identities
later would require state and route migration and is not expected.

## Verification implications

Use cross-scope negative tests for plans, routes, QR codes, overrides, holds,
health, and imports. Current live evidence is C509-specific; the B407 fixture
and multi-scope synthetic evidence remain valid. The existing TV URL and any
B407 compatibility alias are verified separately at the routing/cutover gate.
