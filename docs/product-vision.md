# Product vision

## Purpose

Chalkwright will be the self-contained classroom operations application for
turning trusted school schedule data into a dependable classroom day plan,
enriching that plan with read-only learning and attendance context, presenting
it on classroom screens, and reconciling only application-owned Calendar
events. It replaces the legacy runtime without requiring OpenClaw, while
preserving legacy behavior unless retirement is explicitly approved.

The feature lists in this document and the other planning documents are
non-exhaustive. The governing rule is behavioral parity: silence about a
legacy behavior never authorizes its removal. The
[legacy parity inventory](legacy-parity-inventory.md) is the living control
surface for discovery, disposition, evidence, and acceptance.

## Users and stakeholders

- **Teacher/operator:** sees the current class, timing, objectives,
  assignments, vocabulary, attendance links, schedule previews, and health;
  uses scoped overrides and carousel controls.
- **Students:** consume the classroom display and follow the current check-in
  link or QR code. They do not administer the application.
- **Classroom display:** is a first-class client associated with a room and an
  isolated effective day plan.
- **Maintainer:** configures mappings, imports continuity state, observes jobs,
  compares legacy and replacement output, performs cutover, and rolls back.
- **School systems and Google services:** are bounded integrations, not users.
  PowerSchool and Google Classroom remain read-only; Calendar writes are
  restricted to application-owned events.

## Core workflows

1. Acquire and authenticate to PowerSchool without mutating it.
2. Normalize schedule/bell data and mappings into a canonical day plan.
3. Enrich that plan from local content, vocabulary history, attendance links,
   and read-only Google Classroom data without blocking display responses.
4. Derive display state from the canonical plan and the room's configured
   clock/timing policy.
5. Serve the existing TV route with matching state, layout, media, polling,
   countdown, carousel, and failure behavior through initial cutover.
6. Preview future or frozen points in a real day plan without production side
   effects.
7. Apply display/date/class-scoped local overrides and server-controlled
   carousel holds.
8. Reconcile the canonical day plan to explicitly owned Calendar events with
   one active writer, idempotent comparison, and auditable outcomes.
9. Report health, readiness, freshness, job outcomes, alerts, and recovery
   without exposing student or credential data.

## Goal-state capabilities

- A host-native Node.js/TypeScript service with repository-owned code,
  configuration schemas, migrations, tests, systemd units, timers, and
  operating documentation.
- SQLite as the application state store for configuration snapshots, canonical
  plans, mappings, ownership state, content, overrides, vocabulary history,
  carousel holds, job runs, and comparison evidence.
- Separate, least-privilege handling for credentials, OAuth material, and
  browser profiles; none are stored in SQLite or Git.
- First-class screens and rooms with isolated configuration, plans, holds,
  overrides, readiness, and routes. The offline fixture baseline remains B407;
  the user identified C509 as the current 2026–27 classroom and production-
  validation target on 2026-08-09.
- A canonical day-plan pipeline that is independent of Calendar and OpenClaw.
- Direct, bounded adapters for PowerSchool, Google Classroom, Calendar, and
  continuity imports. Transitional adapters are permitted during migration.
- A responsive, last-known-good display that remains useful during upstream or
  refresh failures.
- Versioned internal contracts, golden fixtures, parity comparisons, and
  evidence-driven promotion gates.
- Tailnet-only access through Tailscale Serve. The production canary uses a
  separate URL; the existing TV URL and route remain authoritative until a
  separately approved final handoff.
- OpenClaw may consume Chalkwright later as a client, but Chalkwright has
  no steady-state dependency on OpenClaw runtime, scheduling, plugins, browser
  services, databases, or directories.

## Immediate checkpoint: B407 Classroom Display MVP

The immediate MVP is a repository-local, offline proof of the B407 display and
operator experience. It uses synthetic fixtures, temporary SQLite databases,
loopback HTTP, and local assets to complete M-05 without activating a provider,
legacy runtime, route binding, service, scheduled job, or Calendar writer. Its
bounded deliverable is defined in the
[B407 Classroom Display MVP brief](b407-display-mvp.md).

This checkpoint proves the route contracts, all eight display states, timing,
content, QR/attendance presentation, carousel and persisted scoped holds,
preview/overrides, media ranges, authorization, polling/recovery, responsive
layout, accessibility, and graceful lifecycle. It is useful as a complete
fixture-backed product slice, but it is not production readiness or permission
to cut over B407.

## Later MVP: minimum viable replacement

The later production MVP means minimum viable **replacement**, not a reduced
feature prototype.
Cutover requires every discovered legacy behavior to be preserved, replaced
equivalently, or explicitly approved for retirement. Required MVP scope
includes:

- all accepted safety and ownership boundaries;
- PowerSchool schedule acquisition and safe authentication failure behavior;
- canonical day-plan generation and continuity state import;
- Google Classroom enrichment from local cache with non-blocking refresh;
- Calendar ownership, comparison, reconciliation, and writer exclusivity;
- existing display routes, states, timing, content, objectives, vocabulary,
  attendance links, media, responsive layout, polling, and last-known-good
  behavior;
- preview/simulation, scoped overrides, and current carousel interactions;
- server-controlled carousel holds that survive TV reloads, allow indefinite
  hold or a configured safety timeout, and remain isolated by screen;
- health/readiness, freshness checks, job records, alert/recovery semantics,
  scheduled operator briefs, backups, deployment, Tailnet routing, and rollback;
- C509 production validation while retaining the approved B407 fixture and a
  multi-screen/multi-room domain model. The legacy TV URL/alias disposition is
  still verified at the cutover-routing gate rather than inferred from the room
  change.

MVP may expose status/health, future-day preview, existing overrides, and basic
carousel controls as an operator surface. These are not substitutes for parity
in the TV surface and integrations.

## Post-MVP direction

- Package Chalkwright as an approachable open-source, self-hosted
  application after the initial deployment is stable. A teacher or school
  implementer should be able to install it, select providers, name rooms and
  screens, map courses, choose calendars and schedules, and validate the result
  without editing TypeScript, systemd units, or internal JSON contracts.
- Provide one documented, versioned, human-facing non-secret configuration
  surface plus a guided setup/upgrade/diagnostic workflow. The setup layer may
  generate the strict protected runtime files, but those machine-facing files
  remain exact-shape, least-privilege, and fail-closed.
- Keep credentials, OAuth grants, browser profiles, provider tokens, and other
  sensitive values outside the portable configuration. Configuration stores
  only opaque references and guides explicit authorization/repair workflows.
- Supply safe examples, schema-driven validation, actionable value-free error
  messages, configuration backup/export, preflight checks, and reversible
  install/uninstall instructions. Defaults must never silently select a real
  provider, Calendar, route, room, or mutation target.
- Validate and activate additional rooms/screens after isolation tests and
  explicit rollout approval.
- Add richer operator diagnostics, comparison drill-down, mapping management,
  and controlled replay from sanitized fixtures.
- Improve named operator identity and auditability if shared bearer-token
  operation no longer meets the risk profile.
- Add richer historical reporting only when privacy, retention, and query value
  justify it.
- Offer a stable client API for OpenClaw or other consumers after the
  application is independent and its contracts are versioned.

Post-MVP direction does not authorize postponing discovered legacy parity that
is needed at cutover.

## Safety boundaries

- PowerSchool and Google Classroom are read-only. No attendance, grades,
  comments, coursework, rosters, or other source records may be created,
  updated, submitted, acknowledged, or deleted.
- Authentication repair is an explicit operator workflow. An authentication
  failure stops Calendar preparation before any Calendar mutation begins.
- Calendar is an output. Only events with verified application ownership may
  be created, replaced, or deleted; unrelated events are immutable.
- Only one Calendar writer may be active for a given ownership scope.
- Secrets, OAuth data, browser profiles, raw student records, sensitive
  captures, runtime databases, logs, and generated artifacts remain outside
  Git.
- Student data is minimized in storage, logs, metrics, fixtures, alerts, and
  comparison reports. Golden fixtures are synthetic or irreversibly redacted.
- Tailnet reachability is not operator authorization. Mutating local controls
  require a distinct authorization boundary.
- Cutover occurs outside teaching hours with a validated backup, rollback
  procedure, ownership check, and health gate.

## Non-goals

- Writing to PowerSchool or Google Classroom.
- Treating Calendar as the internal schedule database or course authority.
- Public internet exposure.
- Requiring OpenClaw to run, schedule, authenticate, browse, persist, or route
  the steady-state application.
- Reading or copying unnecessary student records, browser cookies, OAuth
  material, or sensitive response bodies during migration.
- Replacing working behavior merely to adopt a fashionable framework.
- Expanding beyond explicitly owned Calendar events.
- Declaring legacy features retired because they were absent from an initial
  conversation or fixture.

## Measurable success criteria

1. Every inventory behavior has evidence, disposition, acceptance criteria,
   migration phase, and an accountable verification result; no item remains
   implicitly dropped.
2. All offline golden-fixture and contract tests pass deterministically without
   credentials, network access, live services, or student data.
3. Read-only integration tests produce no source-system mutations and record
   explicit authentication/freshness outcomes.
4. Shadow runs produce zero unexplained day-plan, display-state, route, timing,
   content, or Calendar-intent differences across a user-approved observation
   window and representative special-day scenarios.
5. Calendar dry-run comparison proves that every proposed mutation is within
   the application-owned set; an authentication failure produces zero proposed
   or actual mutations.
6. The initial B407 TV URL, visual states, countdown boundaries, carousel
   behavior, media, refresh cadence, and failure retention pass automated and
   recorded visual acceptance.
7. The replacement is ready and healthy for an agreed parallel-canary interval
   on a separate Tailnet URL, secondary Calendar, and isolated runtime state;
   scheduled jobs are observable and candidate alerts remain report-only.
8. The canary and final-handoff rehearsals complete within their approved
   operational windows without two writers targeting the same Calendar or any
   candidate mutation of legacy state.
9. After stabilization, no steady-state process, timer, import, state path,
   browser runtime, or route depends on OpenClaw.
10. Before a general open-source release, a fresh supported host can reach a
    fixture-backed healthy display through the documented guided setup, and a
    representative implementer can customize non-secret settings without
    editing source code or generated service/runtime files.
