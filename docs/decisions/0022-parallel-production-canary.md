# ADR-0022: Isolated parallel production canary before final handoff

- **Status:** Accepted
- **Date:** 2026-08-12
- **Accepted:** 2026-08-12
- **Amends:** ADR-0005, ADR-0006, and ADR-0019 for the M-17 execution sequence

## Context

M-16 proved the replacement candidate, rollback ordering, physical Fully Kiosk
rendering, and protected operational targets. The roadmap originally made M-17
an immediate transfer of the existing TV route, scheduler ownership, and
Calendar writer. The user instead chose a safer evaluation period in which the
legacy application and Classroom Hub run concurrently without sharing a route,
Calendar target, mutable state, writer lease, or operational alert channel.

Parallel execution is safe only if it does not recreate the double-writer risk
that ADR-0006 rejected. Google Calendar OAuth authority is not calendar-
specific, so a distinct calendar alone is insufficient: Classroom Hub must
also bind its configured target, reject `primary` and the legacy calendar, and
retain its existing ownership and lease guards. A separate Tailnet URL must
not replace or mutate the legacy `/classroom-screen` mapping during evaluation.

## Decision

M-17 keeps its milestone number but has two separately approved internal gates.

### Parallel-canary activation gate

The first gate may activate Classroom Hub only as an isolated production
canary:

- the legacy application, URL, Calendar, schedules, alerts, and state remain
  unchanged and authoritative;
- Classroom Hub binds its existing loopback candidate port behind a distinct
  Tailnet-only URL, implemented as an exact approved path, HTTPS port, or
  service identity without changing the legacy mapping;
- Classroom Hub writes only to one manually created secondary Calendar owned
  by the same Google account. The protected configuration binds the exact
  calendar reference and its digest, rejects `primary`, and rejects the exact
  legacy-calendar reference/digest;
- the application receives no authority to create, delete, share, subscribe
  to, or change properties of calendars. Calendar creation remains a manual
  operator action outside the application;
- candidate services, timers, SQLite state, backups, leases, journals,
  ownership markers, and configuration references are distinct from both the
  legacy runtime and any final production target;
- provider reads remain bounded and read-only. Candidate refreshes are
  staggered from known legacy refreshes to avoid synchronized load;
- operational alerts remain report-only. The qualified direct Telegram
  adapter stays unwired during the canary unless a later explicit decision
  names a separate non-production destination and execution gate;
- the physical TV keeps the legacy URL as its normal page. Candidate checks on
  Fully Kiosk are bounded, reversible evaluation windows; another Tailnet
  browser may observe the candidate continuously; and
- stopping the canary removes only candidate units/timers and its separate
  Tailnet mapping. It never restores, rewrites, or deletes legacy state because
  the legacy path was never displaced.

Activation requires a new immutable manifest covering the distinct URL,
secondary Calendar, deny references, state/configuration roots, service/timer
names, cadence offsets, build, backup, stop command, and observation policy.
It also requires a read-only Calendar preflight proving the exact candidate
target and the absence of access to the legacy target through the execution
plan. Neither this ADR nor its acceptance authorizes that preflight or any live
activation.

### Final-handoff gate

Parallel evidence does not silently become cutover authority. After the
user-approved observation interval and coverage criteria pass, a second
authorization must choose:

1. promote the secondary candidate Calendar as the permanent application
   Calendar; or
2. stop the legacy writer and perform a separately fingerprinted migration to
   another exact Calendar target.

Only that final gate may disable legacy schedules, change the existing TV URL
or route, enable routine alerts, transfer Calendar ownership, or make Classroom
Hub authoritative. The M-16 single-writer handoff and rollback evidence remains
the governing order for that later transfer.

## Acceptance evidence

Canary evaluation is coverage-based, not elapsed-time-only. Before final
handoff, retained value-free evidence must show:

- the agreed active-school-day observation interval completed;
- representative beginning-of-day, pre-check-in, in-class, ending, gap,
  post-class, and end-of-day behavior was observed or explicitly dispositioned;
- candidate and legacy plans, display states, and Calendar semantics have no
  unexplained material difference after normalizing provider-generated IDs;
- no candidate request or journal references the legacy or primary Calendar;
- no duplicate candidate events, overlapping candidate writers, foreign
  ownership, unexpected provider mutations, public listener, or route collision
  occurred;
- refresh freshness, resource use, backups, restart recovery, and readiness
  remained within the approved bounds; and
- the physical Fully Kiosk checks remain materially consistent with the
  accepted visual baseline.

The exact observation duration and the final candidate-Calendar disposition
remain explicit pre-activation/final-handoff decisions. They are not inferred
by this ADR.

## Alternatives considered

- Immediate replacement of the existing TV route and Calendar writer.
- Two writers targeting the same Calendar with different ownership markers.
- A candidate route with no Calendar writes.
- A broader OAuth grant allowing Classroom Hub to create the secondary
  Calendar.
- Enabling routine Telegram delivery during the canary.

Immediate replacement gives less evaluation time. Sharing a Calendar preserves
double-write and ownership risk. A mutation-free shadow does not prove the
writer lifecycle already qualified by M-14/M-15. Broader calendar-management
authority is unnecessary. Routine alert delivery would create duplicate or
ambiguous operator notifications during evaluation.

## Consequences

M-17 no longer begins by displacing the legacy runtime. It first creates a
fully isolated candidate lane, increasing configuration and comparison work
but making rollback equivalent to stopping the candidate. The legacy
application remains an OpenClaw dependency during the canary; this is
intentional and does not satisfy M-18.

The eventual handoff still requires one writer for each Calendar scope. During
the canary there may be two active writers only because they target disjoint,
explicitly bound calendars and state roots. No code may generalize this into
permission for two writers on one Calendar.

## Reversibility

The documentation amendment is fully reversible before activation. A live
canary is reversible by stopping only its exact units/timers and removing only
its exact candidate mapping. Secondary Calendar events are retained for audit
unless a separately approved cleanup plan removes application-owned candidate
events. Final handoff retains the M-16 four-hour rollback objective.

## Verification implications

Before canary activation, add exact-shape configuration and architecture tests
for route, calendar-deny, state-root, unit/timer, cadence, alert-report-only,
and rollback isolation. Add semantic comparison that ignores provider IDs but
does not ignore dates, times, summaries, ownership, readiness, or state. The
full offline gate and an independent review must pass. Provider reads,
secondary-calendar writes, systemd activation, Tailnet changes, Fully Kiosk
changes, and final handoff each remain separately authorized live actions.

## Authoritative references

- [Google Calendar API scopes](https://developers.google.com/workspace/calendar/api/auth)
  documents that `calendar.events.owned` manages events on owned calendars but
  does not grant calendar-creation authority.
- [Google Calendar `calendars.insert`](https://developers.google.com/workspace/calendar/api/v3/reference/calendars/insert)
  lists the broader scopes required to create a secondary calendar; Classroom
  Hub will not request them for this canary.
- [Tailscale Serve CLI](https://tailscale.com/docs/reference/tailscale-cli/serve)
  documents separate path, HTTPS-port, and service targets. The exact installed
  target and configuration still require a value-free live inventory and
  separate approval before use.
