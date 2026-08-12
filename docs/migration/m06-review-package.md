# M-06 review package: offline operations and deployment artifacts

- **Status:** offline baseline complete; independent review clean
- **Date:** 2026-08-09
- **Baseline:** `eb71574f114e41f5405fdfb11f0d55fa5b31463d`
- **External effects:** none
- **Approval:** user-approved on 2026-08-09 as commit
  `61e2d699e8efa745ba1590e2465af5a3406f94a4`

## Scope delivered

M-06 adds a finite typed job registry and bounded CLI, typed run-ledger query
and persistence, strict HEALTH-003 observations/reports, stable redacted issue
fingerprints, restart-safe ALERT-001 decisions, separate morning/evening brief
contracts, report-only/fake alert delivery, and local SQLite integrity,
verified-backup, and retention hooks. A self-cleaning rehearsal exercises six
jobs using only synthetic temporary SQLite and backup files.

SQLite migration 3 adds one finite `alert-state` record kind while preserving
the migration ledger/user-version agreement and forward-only transaction
rules. Checkpoints keep active and last-successfully-delivered fingerprint sets
separate so a failed fake send cannot suppress a retry or erase recovery state.
Run listing is bounded, filtered, redacted, and last-known-good safe.

## Capability and safety boundaries

The registry names source authentication, Classroom refresh, and Calendar
reconciliation only to preserve dependency ordering. They are `deferred` and
can only return `prerequisite-unavailable`; no source adapter, credential,
Calendar writer, local-command port, network transport, or arbitrary executable
is reachable. Unknown/extra/case-changed CLI inputs fail before configuration
or filesystem access. Paths are normalized, confined children of one managed
root and are never accepted as CLI arguments.

Health/report/brief builders are pure domain code. Issue fingerprints derive
only from code and safe scope, remain stable across ordering/time/message
changes, and contain no raw observations. Alert decisions are transport-neutral;
the only implementation is an in-memory fake. No recipients, endpoints, or
credentials are represented. ADR-0012 was still proposed at M-06 and was
subsequently accepted during M-16 without provisioning any live transport.

## Deployment artifacts

The prior misleading oneshot fixture-server timer was removed. At M-06, the managed web
service became `classroom-hub.service.in` with an intentionally invalid command
placeholder. All seven timers are `.timer.in` files with unresolved schedule
and timezone placeholders. `cadence-manifest.json` records all ten registry
names, identifies provider/writer jobs as deferred, and marks every clock
pending confirmation. The bounded job service is also a `.service.in` file
with an invalid command placeholder; it records intended hardening while
leaving the maximum runtime unresolved, without being activation-ready. Timer
`Persistent` behavior remains a placeholder alongside clock and timezone.

M-16 subsequently replaced only the display template's invalid command with an
exact still-non-installable production-reader candidate; this does not alter
the historical M-06 qualification.

The offline verifier checks exact names, manifest/template agreement, loopback
configuration, process/job type separation, graceful stop/restart/runtime
bounds, missed-run intent, hardening, and the absence of shell, public bind,
installation, OpenClaw, Tailscale mutation, or deferred timer drift. It does
not claim live systemd, route, ownership, or lifecycle evidence.

## Persistence and recovery evidence

Integrity inspection is read-only. Backup delegates to the M-04 integrity,
catalog, byte-length, checksum, confined-path, and 14-daily/8-weekly primitives;
every candidate catalog is parsed before pruning. Retention enforces aged
job/comparison/superseded-alert, attendance/temporary, academic
plan/content/vocabulary, and inactive configuration/mapping/Calendar state
boundaries while preserving the current alert checkpoint. Schedule
observations, overrides, and terminal hold audit have no assigned ADR-0013
category and remain preserved pending a reviewed policy. Neither the
offline rehearsal nor synthetic M-04 restore proves production scheduling,
permissions, monitoring, four-hour RTO, or 24-hour RPO.

## Parity accounting

- **Executable M-06 evidence:** `HEALTH-003`, `ALERT-001`, `OPS-003`, and the
  bounded/redacted portions of `OPS-005`.
- **Static/offline preservation evidence:** `OPS-001`, `OPS-002`, `PERSIST-001`,
  `PERSIST-003`, `NET-001`, and `DEP-001`.
- **Preserved earlier evidence:** `HEALTH-001`, `HEALTH-002`, `PERSIST-002`.
- **Later operational evidence:** `OPS-004`, production backup/RTO/RPO proof,
  Tailnet routing, actual service lifecycle, provider job execution, and final
  standalone/OpenClaw retirement.

This package does not claim exact legacy parity where U-003 or U-015 remains
open. It does not promote proposed ADR-0012.

## Explicit unresolved decisions

- **U-003:** active scheduler ownership and exact clocks/timezone.
- **U-008 / ADR-0012:** recipients, delivery transport, quiet/repeat/escalation
  policy, and credential ownership.
- **U-015:** complete morning/evening content, destination, and delivery-failure
  semantics. Evening execution remains skipped until schedule policy supplies
  the next configured class day.
- **U-014:** named operator identity.
- Production state ownership, server command, protected environment path,
  activation, routing, backup monitoring, and timed restore evidence.
- A cross-process alert lease/CAS before any real delivery transport is
  authorized. M-06 serializes only its in-process fake evaluation.

## Independent review corrections

The first independent review identified and the candidate corrected unsafe
database creation/symlink following before dispatch; false success after alert
delivery/checkpoint failure; post-timeout effects and unbounded hard-stop ledger
attempts;
non-finite job-run identities; unused retention cutoffs and omitted alert
history; pre-only integrity inspection; mismatched scope-ID contracts;
activation-ready job/missed-run guesses; and destructive orphan-backup cleanup.
Regressions now require existing physically confined state, pre/post integrity,
derived clock-bound retention, exact finite run identity, concurrent local
alert dedupe, all-inert unit placeholders, and missing-catalog zero deletion.
Hard-stop ledger persistence is explicitly bounded and best-effort; exit 124
and future process-supervisor evidence remain the fallback when persistence is
unavailable.

The final confinement review also demonstrated that a hard-linked managed
database could alias an external inode. Database, backup, and catalog trust now
requires a regular single-link file, with CLI and catalog regressions proving
hard-link aliases fail before database mutation or artifact reads.

## Verification record

The frozen candidate passed the complete `npm run check` gate: documentation
generation/link/changelog checks, fixture safety, operations/systemd/repository
safety, formatting, strict application and browser-client types, 277 tests,
production build, startup smoke, and the six-job temporary-state rehearsal.
`git diff --check` passed; staging was empty; the artifact scan found no
database, backup, log, key, certificate, credential, or private-data files.

An independent final review of the complete diff from the M-05 baseline found
no remaining P0, P1, or material P2 defect, documentation overclaim, scope
breach, or forbidden artifact. No host unit, scheduler, route, provider,
credential, Calendar, or external state was accessed or changed. This review
closes the offline M-06 repository checkpoint; it does not approve any later
activation, live transport, routing, or production recovery claim.
