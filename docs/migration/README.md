# Migration evidence index

Migration evidence is versioned with the code or contract it reviews. A review
package records what exists; it does not authorize promotion or the next plan
step.

- [M-01 review package](m01-review-package.md) — approved initial versioned
  contracts, synthetic fixture cases, parity accounting, visual manifest,
  safety checks, and later gates.
- [M-02 review package](m02-review-package.md) — approved pure domain types,
  capability-specific ports, read-only orchestration contracts, architecture
  enforcement, and focused parity evidence.
- [M-03 review package](m03-review-package.md) — approved pure/offline baseline
  covering normalization, plans, display state,
  enrichment, content, vocabulary, attendance, overrides, preview, and inert
  Calendar decisions, with portable sanitized legacy goldens, explicit parity
  classifications/corrections, and remaining blockers.
- [M-04 review package](m04-review-package.md) — approved local baseline for
  versioned SQLite state, forward migrations, transactional repositories,
  allowlisted continuity import, and synthetic backup/restore and retention
  evidence after three adversarial review rounds and an independent final
  review.
- [M-05 review package](m05-review-package.md) — approved offline B407 HTTP,
  presentation, local-control, QR, and media baseline with repository-local
  Chrome fallback evidence; human production approval remains a later gate.
- [M-06 review package](m06-review-package.md) — independently reviewed offline
  operations, diagnostics, persistence, rehearsal, and deliberately inert
  deployment baseline, approved as commit `61e2d69`; activation and unresolved
  policy remain later gates.
- [M-07A review package](m07a-review-package.md) — completed and independently
  reviewed synthetic qualification of the accepted read-only PowerSchool
  adapter, approved as commit `8190805`; it is not M-07B live
  characterization.
- [M-07B review package](m07b-review-package.md) — independently reviewed
  bounded production blocker characterization, strict authorization/evidence
  contract, supervised managed-profile lifecycle, and recorded future cadence
  requirement, approved as commit `7582a82`.
- [M-07C review package](m07c-review-package.md) — clean-room offline
  integration of operator-present filtered-session bootstrap and a
  credential-free passive collector. The separately authorized bootstrap and
  credential-free exact-read gate completed, including a three-period Tuesday
  observation; a durable production marker remains deferred.
- [M-08 review package](m08-review-package.md) — promoted narrow
  Google Classroom coursework reads, normalized cache/backoff, protected
  external grant, typed async wrapper, bounded live evidence, and a completed
  mutation-free stable-TV-latency observation. Operational registration remains
  separately gated.
- [M-09 review package](m09-review-package.md) — offline synthetic attendance
  matrix, validated links/routes, aggregate-only continuity quarantine, and
  count-only reconciliation under accepted ADR-0015. Any safe export read
  remains separately gated.
- [M-10 review package](m10-review-package.md) — mutation-free offline
  integration harness, bounded manifest, existing adapter/domain composition,
  redacted result and permission inventory. A protected live retry joined three
  C509 PowerSchool codes to their unique embedded Classroom section codes,
  planned all three Tuesday meetings, refreshed three temporary cache entries,
  and reported zero differences or mutations. M-10 is promoted and gates the
  authorized M-11 observation.
- [M-11 review package](m11-review-package.md) — isolated C509 shadow service,
  protected configuration and SQLite state, mutation-disabled read jobs,
  fixed seven-day 07:20 Asia/Ho_Chi_Minh timer, backup/restart evidence, and a
  passed user-approved accelerated zero-mutation qualification. M-11 is
  promoted; M-12 subsequently passed its separate gates and was promoted.
- [M-12 review package](m12-review-package.md) — strict value-free behavior
  comparator, exact seven-scenario manifest, behavior-ID triage, redacted
  SQLite evidence and an approved legacy source/test alternative reference.
  The identified Coming Up, day-complete schedule, and pre-checkin detail gaps
  are corrected through real local shadow projections and exact-build-bound,
  loopback-only Chrome 150 evidence, including 200% reflow, focus, and reduced
  motion. Live empty-day readiness and filtered-session longevity are deferred
  without another login. The user
  accepted the corrected exact-horse-media visual and explicitly approved the
  comparison result and promotion. M-12 is promoted.
- [M-13 review package](m13-review-package.md) — promoted separate intended-
  scope Calendar read adapter, fixed projection policy, ownership classifier,
  approved hash-bound Tuesday dispositions, dry-run intent evidence, and pure
  lease simulation. Its production/read-grant deferrals remain; the later M-14
  non-production qualification is recorded separately below.
- [M-14 review package](m14-review-package.md) — complete offline writer and
  rollback implementation plus a successful bounded Auto Lesson 2 provider
  qualification ending empty; independent review and the explicit ADR,
  evidence-disposition, and promotion gates are complete. M-15 was authorized
  only afterward.
- [M-15 review package](m15-review-package.md) — authorized bounded production
  Calendar trial; offline/read-only gates and the exact approved
  three-replacement execution succeeded; its evidence was explicitly accepted
  and M-15 promoted on 2026-08-10.
- [M-16 review package](m16-review-package.md) — promoted isolated
  cutover/rollback rehearsal with exact legacy route compatibility, real SQLite
  restore, one-writer enforcement, sanitized target inventory, approved
  current-to-port-4317 handoff, physical Fully candidate evidence, and accepted
  four-hour recovery/runbook targets. Its final host-native alert qualification
  provisioned separate protected values and delivered one confirmed fixed test
  without wiring any service, route, state, or OpenClaw runtime dependency.
  Accepted ADR-0021 now adds an offline-qualified, unwired persistent-profile
  schedule-read/authentication compatibility option. Its exact profile
  lifecycle and any current-date read were separate live gates at the offline
  checkpoint; it did not authorize another manual sign-in or M-17.
  A later authorized temporary legacy compatibility gate preserved the running
  profile under OpenClaw ownership, completed one non-forced repair without a
  manual sign-in, and returned four periods for 2026-08-12 via session HTTP.
  The current-date read gate is closed; the final target/runbook gates were
  subsequently accepted and M-16 promoted. Replacement profile/service wiring
  remains an M-17 concern.
  ADR-0019 and its [accepted inert target proposal](m16-target-proposal.json) separate
  known route/cadence/viewport facts from the remaining user decisions.
- [M-17 review package](m17-review-package.md) — accepted ADR-0022 amendment
  replacing immediate cutover with an isolated parallel production canary on a
  separate Tailnet URL, manually created secondary owned Calendar, distinct
  state/services/timers, staggered reads, and report-only alerts. It retains a
  separately approved final-handoff gate and grants no live authority.
- [Retirement decision log](retirement-decisions.md) — explicit approvals only;
  currently no behavior is retired.

The executable parity coverage map is
[`src/contracts/v1/parity-coverage.ts`](../../src/contracts/v1/parity-coverage.ts).
The build compares it with every behavior and unknown in the
[legacy parity inventory](../legacy-parity-inventory.md).
