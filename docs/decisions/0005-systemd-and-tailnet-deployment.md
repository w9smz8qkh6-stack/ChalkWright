# ADR-0005: systemd and Tailnet-only deployment

- **Status:** Accepted
- **Date:** 2026-08-08

## Context

The legacy display has a working private TV URL and process/schedule behavior.
The replacement must run independently while avoiding public exposure and URL
changes during initial cutover.

## Decision

The repository owns inert systemd service and timer templates. The application
binds only to loopback. Tailscale Serve provides Tailnet-only access and
preserves the existing TV URL/path during initial cutover. Installing/enabling
units or changing routing remains an explicit operational action outside normal
repository work.

## Alternatives considered

- Bind directly to a Tailnet or public interface.
- Keep scheduling under OpenClaw.
- Introduce containers or a second reverse proxy immediately.
- Change the kiosk URL at cutover.

These weaken the dependency boundary, increase exposure/complexity, or add a
user-visible cutover variable.

## Consequences

Units, timers, environment references, timezone/cadence, restart/shutdown,
hardening, health, and missed-run policy must be tested. Tailnet access is not
write authorization; operator mutations keep a separate auth boundary.

## Reversibility

Deployment ownership and routing can be rolled back outside teaching hours if
the exact previous manifests are retained. A later deployment topology requires
a superseding ADR.

## Verification implications

Verify templates offline first, then inspect only approved installed units and
routing at rehearsal/cutover. Assert loopback binding, stable URL/path, expected
timer calendars, graceful shutdown, readiness, and absence of public listeners.

## Later amendment

Accepted [ADR-0022](0022-parallel-production-canary.md) amends the M-17
sequence. The canary uses a separate Tailnet-only URL while the existing TV URL
remains authoritative; preserving/repointing the existing URL now belongs only
to the separately approved final-handoff gate.
