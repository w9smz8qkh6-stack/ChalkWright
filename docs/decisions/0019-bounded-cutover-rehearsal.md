# ADR-0019: Bounded cutover and rollback rehearsal

- **Status:** Accepted
- **Date:** 2026-08-10
- **Accepted:** 2026-08-11

## Context

M-15 proved a bounded Calendar writer trial, but production ownership still
belongs to the legacy service and scheduler surfaces. M-16 must demonstrate the
complete switch and rollback order without changing those live surfaces. The
existing Tailnet bookmark is mounted at `/classroom-screen`, the legacy and
replacement writers must never overlap, and accepted ADR-0013 sets a four-hour
recovery-time objective.

Read-only inventory found one current Tailnet handler for the preserved mount,
the active legacy display service, the isolated replacement shadow units, and
the relevant OpenClaw schedules. It also found a failed replacement refresh
unit and no running process from which the exact production kiosk browser and
viewport could be established. Those observations are stop conditions, not
details to infer.

## Decision

Use one immutable, SHA-256-bound cutover manifest and the following order:

1. freeze configuration and verify the exact route, service, scheduler,
   writer-scope, and kiosk references;
2. verify the baseline and create/check a fresh SQLite backup;
3. disable and quiesce the legacy writer before acquiring the replacement
   writer;
4. start the replacement service and timers, then switch the single preserved
   `/classroom-screen` route;
5. run the complete C509/B407 compatibility smoke suite; and
6. release the replacement writer before restoring the route, timers, service,
   backup, and legacy writer in that order.

The smoke suite preserves the legacy bookmark and finite read API family while
using canonical replacement screen identities internally. It covers all eight
display states, target and preview data, day plan and display inventory,
manifest/icon/assets/media, QR, health, and readiness. Unprefixed routes remain
closed when the legacy mount is enabled.

The repository rehearsal may operate only on disposable loopback servers and
temporary SQLite state. It must report zero external mutations and zero live
operational changes, reject configuration drift, fail closed on a second
writer, and execute the complete rollback after a forward failure.

The inert [M-16 target proposal](../migration/m16-target-proposal.json) binds
the currently supported candidate choices without activating them: C509 and
the `b407` compatibility alias, the exact `/classroom-screen` route, loopback
port 4317, `classroom-hub-production.service`, Chrome 150 coverage at both
legacy-required viewports, Asia/Ho_Chi_Minh, the known 06:20/06:30/06:45
weekday observations and 30-minute health cadence, and the legacy jobs that
remain disabled. The 06:20 weekday PowerSchool observation is historical only:
the promoted M-07B/M-11/M-12 decision already replaces it with 07:20
Asia/Ho_Chi_Minh Sunday through Friday and excludes Saturday. Any accepted
decision must preserve that replacement while separately resolving the brief,
health, missed-run, and exact job/timer targets.

The user accepted this decision, the inert target proposal, and its scheduler
policy on 2026-08-11. Acceptance fixes the rehearsal/runbook direction and
does not authorize service activation, protected-reference access, provider
traffic, routing, deployment, or M-17. The standalone TV's exact
browser/viewport, exact replacement artifacts, private route/backend, and clean
replacement readiness remain mandatory live-preflight stop gates. The
production display service candidate, 18:00–20:00 Asia/Ho_Chi_Minh maintenance
window, and operator/stop roles are frozen in M-16. Alert semantics are
governed by accepted ADR-0012, while protected delivery provisioning remains
separate and cannot be invented here.

A later authorized read-only M-16 preflight resolved only the route
observation: the private listener and current loopback backend are SHA-bound in
the target proposal. The on-device candidate smoke, protected provisioning,
replacement readiness, future port-4317 handoff, and M-17 activation remain
separately gated.

## Alternatives considered

- Change the bookmarked TV URL during cutover.
- Stop the legacy service before proving the replacement route contract.
- Permit both writers briefly to reduce the handoff interval.
- Treat the M-11 shadow service or a synthetic rehearsal as production
  readiness by itself.

These alternatives either create unnecessary client changes, remove the safe
fallback too early, violate the single-writer invariant, or overstate the
available evidence.

## Consequences

The generic HTTP server now supports only the exact legacy mount and a finite
allowlisted compatibility family. Both the full eight-state fixture and the
persistent SQLite-backed reader exercise that path offline. The cutover helper
is deterministic, self-cleaning, and incapable of invoking systemd, Tailscale,
OpenClaw, provider identities, or provider writes.

M-16 can prepare a reviewable runbook and measured rehearsal without granting
M-17 authority. Production units, timers, routes, and kiosk settings remain
unchanged until a separately approved M-17 execution.

## Reversibility

The proposed manifest and compatibility aliases are local code and
documentation changes. They can be revised before acceptance without changing
production. Once accepted, a materially different route, service, scheduler,
writer scope, or kiosk target requires a new fingerprint and review.

## Verification implications

Require exact-shape manifest tests, ordered forward/rollback receipts,
double-writer and rollback-failure tests, a real SQLite backup/integrity/restore
round trip, all compatibility routes and display states through the switched
loopback proxy, persistent-reader integration, exact checked-in target-proposal
byte binding across all five reference classes, repository safety checks, the
full offline gate, and an explicit human approval of the measured runbook and
exact production targets.

## Later amendment

Accepted [ADR-0022](0022-parallel-production-canary.md) preserves this
rehearsal as the final-handoff and rollback evidence but changes M-17's first
step. An isolated candidate URL, secondary Calendar, and separate state now run
in parallel before any legacy route, scheduler, writer, or alert is displaced.
