# Documentation index

## Product and migration planning

- [Product vision](product-vision.md) — users, workflows, target capabilities,
  MVP boundary, safety, non-goals, and measurable success.
- [B407 Classroom Display MVP](b407-display-mvp.md) — immediate offline M-05
  product slice, evidence, and explicit non-production boundary.
- [Legacy parity inventory](legacy-parity-inventory.md) — evidence register,
  behavior ledger, acceptance criteria, dispositions, and open unknowns.
- [Architecture principles](architecture-principles.md) — enduring boundaries,
  canonical flow, state ownership, isolation, and accepted/proposed choices.
- [Migration strategy](migration-strategy.md) — phased risk-reduction strategy,
  promotion/stop gates, continuity, and rollback posture.
- [Migration execution plan](migration-plan.md) — dependency-ordered work,
  per-step verification and side-effect boundaries, and requirements
  traceability.
- [Future parity roadmap](future-parity-roadmap.md) — paused post-M17 parity
  plan prioritizing vocabulary, lesson-reference slide enhancement, and later
  attendance-admin work.
- [Offline glossary catalog](glossary-catalog.md) — normalized local vocabulary,
  translations, BLOB media, import limits, and review/provenance rules.
- [Architecture decision records](decisions/README.md) — accepted direction and
  unresolved implementation choices.
- [Migration evidence](migration/README.md) — review packages, executable parity
  accounting, visual evidence requirements, and retirement decisions.
- [Public-preview publication gate](publication-readiness.md) — legal, privacy,
  history, presentation, CI, and release requirements before repository
  visibility changes.
- [Public history plan](publication-history-plan.md) — value-free audit result,
  recommended clean-root strategy, rejected alternatives, and final evidence.
- [Release and version policy](release-policy.md) — pre-release SemVer,
  publication contents, npm-publish prevention, and support boundaries.
- [Third-party notices](../THIRD_PARTY_NOTICES.md) — locked direct dependency
  licenses, aggregate lockfile inventory, and gated media provenance.
- [Configuration guide](configuration.md) — safe local defaults, protected
  references, current schema boundaries, and the planned guided setup layer.
- [Offline operations](operations.md) — bounded M-06 jobs, temporary rehearsal,
  inert deployment artifacts, and future activation gates.
- [Permanent production deployment](permanent-production-deployment.md) — the
  protected-main polling controller, immutable releases, local readiness,
  automatic rollback, and the separately controlled first-release gate.
- [M-07A synthetic PowerSchool qualification](migration/m07a-review-package.md)
  — completed offline evidence for a repository-owned read-only adapter; live
  characterization remains a separately authorized M-07B gate.
- [M-07B bounded PowerSchool characterization](migration/m07b-review-package.md)
  — exact one-shot authorization, sanitized evidence boundary, managed-profile
  lifecycle, and the recorded future Sunday-through-Friday morning requirement.
- [M-07C filtered-session integration](migration/m07c-review-package.md) —
  offline manual-bootstrap/passive-read separation, disposable profiles,
  containment evidence, roadmap reconciliation, and completed credential-free
  exact-read gate.
- [M-08 Google Classroom reads](migration/m08-review-package.md) — accepted
  least-privilege model, adapter/cache/refresh evidence, protected external
  grant, roadmap fit, completed bounded OAuth/live-read gate, and stable-TV-
  latency evidence. M-08 is promoted; operational registration remains gated.
- [M-09 attendance and continuity](migration/m09-review-package.md) — accepted
  transient P/T/A matrix, validated compatibility links, aggregate-only safe
  export quarantine, and reconciliation evidence.
- [M-10 read-only integration](migration/m10-review-package.md) — bounded
  mutation-free orchestration, redacted evidence, permission inventory, offline
  cases, prerequisite reconciliation, and a passed protected C509 live gate.
  M-10 is promoted; its M-11 successor has passed the accelerated gate.
- [M-11 isolated shadow](migration/m11-review-package.md) — separate loopback
  service/state/configuration, fixed seven-day timer, read-only provider jobs,
  backup/restart evidence, and a passed accelerated zero-mutation
  qualification. M-11 is promoted; M-12 subsequently passed its separate gates
  and was promoted.
- [M-12 behavior comparison](migration/m12-review-package.md) — value-free
  plan/display/operations comparison, exact scenario and accepted-difference
  policy, redacted SQLite evidence, and an accepted corrected visual baseline.
  The user approved the comparison result and promotion; M-12 is promoted.
- [M-13 Calendar ownership audit](migration/m13-review-package.md) — promoted
  intended-scope read-only adapter, fixed projection policy, strong
  ownership/adoption classifier, approved Tuesday dispositions, dry-run
  evidence, and pure lease simulation. Its adapter remains list-only; the
  later separately authorized M-14 qualification remains isolated from
  operations and production.
- [M-14 Calendar writer qualification](migration/m14-review-package.md) —
  complete offline writer/rollback implementation and bounded Auto Lesson 2
  lifecycle ending empty; independently reviewed and explicitly promoted, with
  M-15 authorized only afterward.
- [M-15 bounded production Calendar trial](migration/m15-review-package.md) —
  fixed Tuesday prepare/approval/execute boundary, legacy-writer exclusion,
  fresh backup, successful three-replacement execution, and rollback-ready
  evidence; explicitly accepted and promoted on 2026-08-10.
- [M-16 cutover rehearsal](migration/m16-review-package.md) — promoted bounded
  target, recovery, candidate, and alert-qualification evidence without a live
  route or scheduler handoff.
- [M-17 parallel-canary and handoff record](migration/m17-review-package.md) —
  historical isolated-candidate evidence plus the current permanent-production
  handoff status. The standalone lane now serves the existing classroom path;
  its timers and owned-Calendar follower are active, while the shadow remains
  available only as a rollback reference pending stabilization and M-18.
- [Offline PowerSchool collector](powerschool-bell-collector.md) — safe
  configuration, filtered and persistent protected-state handling, four-way
  passive/manual/JIT/compatibility capability split, containment limits, and
  the separately authorized live stop gate.

The planning documents are intentionally non-exhaustive summaries of a parity-
first process. The parity inventory governs behavior preservation: absence from
a summary does not authorize retirement.

## Environment and tooling

- [Engineering standards](engineering-standards.md) — documentation and comment
  policy, dependency/build practices, testing, migrations, and definition of
  done.
- [Changelog](../CHANGELOG.md) — consequential unreleased product, contract,
  operational, security, and runtime changes.
- [Working environment](../.codex/environment.md) — repository-scoped Codex
  bootstrap assumptions, boundaries, and safe commands.
- [Tooling and canonical documentation](tooling.md) — generated detected/locked
  software versions with canonical, version-appropriate documentation links.

Contributors can run `npm run docs:check:portable` to verify the changelog and
local documentation links. Maintainers can run `npm run docs:check` to also
confirm that the generated tooling index matches the canonical deployment
host. Run
`npm run docs:check-links` when network access is authorized to validate
canonical external links.
