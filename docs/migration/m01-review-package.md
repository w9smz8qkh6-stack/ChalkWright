# M-01 contract and sanitized-evidence review package

- **Plan step:** M-01 — Freeze contracts and sanitized evidence
- **Status:** Approved and committed
- **Contract version:** `1.0.0`
- **Evidence boundary:** Repository-only, deterministic, and synthetic

## Scope delivered

M-01 freezes data shapes and evidence assignments. It does not parse schedules,
select display states, calculate plans, persist data, serve HTTP, render UI,
operate a browser, call Google, reconcile Calendar, install services, or deploy.

The versioned TypeScript contracts cover:

- provenance, verification, freshness, and diagnostics;
- safe normalized schedule observations;
- canonical day plans with a required effective IANA timezone, meetings with
  complete boundary fields, room scope, and screen assignments;
- the exact eight display-state identifiers and state-case shape;
- the initial route-family names, meeting-timeline order, and TV polling timing
  table;
- inert Calendar no-op/create/replace/delete intent shapes with verified
  ownership and notification suppression; and
- categorized succeeded, degraded, skipped, repair-required, and failed job
  outcomes.

Breaking contract changes require a new contract-version directory. Additive
changes to v1 must remain compatible and update fixtures, coverage, tests,
documentation, and the changelog together.

The meeting contract retains separate `officialStartsAt`, `checkInClosesAt`,
and `contentStartsAt` fields because each boundary has a distinct behavioral
meaning and legacy API name. Current parity requires all three timestamps to be
equal. The synthetic multi-screen plans also assert that check-in opens before
that shared boundary and dismissal starts before the official end.

Each canonical plan owns its effective `timeZone` independently of Calendar
intent data and screen presentation assignments. Later domain and presentation
work will use it for local-day selection, the morning cutoff, and localized
labels; M-01 only freezes the required data contract.

## Static parity audit

The correction audit used the authorized repository-adjacent legacy design
documentation, implementation, and tests as static evidence only:

- the legacy state-machine documentation and domain implementation define
  check-in close as official start and content start as check-in close;
- legacy domain and timing tests assert those boundary values and their equality;
- the legacy day-plan builder carries the configured timezone, and timing and
  rendering code use it for local dates, morning cutoff behavior, and labels;
  and
- the remaining frozen display states, route families, polling values, Calendar
  ownership rules, and notification-suppression assumptions were compared with
  their cited legacy sources and showed no additional direct contradiction.

No legacy service, provider, credential, browser profile, job, or external data
was accessed during this static audit.

## Synthetic fixture catalog

| Fixture                 | Scenario         | What it freezes                                       | Later behavioral proof                 |
| ----------------------- | ---------------- | ----------------------------------------------------- | -------------------------------------- |
| `schedule-normal`       | Normal           | Two ordered normalized periods                        | M-03 normalization/timing              |
| `schedule-special`      | Special schedule | Shortened/advisory period shapes                      | M-03 special-schedule behavior         |
| `schedule-empty`        | Empty/no classes | Valid zero-period observation                         | M-03 no-classes/day-complete behavior  |
| `schedule-stale`        | Stale            | Explicit stale freshness and diagnostic               | M-03/M-10 stale-input behavior         |
| `schedule-malformed`    | Malformed        | Rejected unknown payload shape                        | M-03 validation/failure classification |
| `schedule-gap-day`      | Gap day          | Requested date between loaded dates                   | M-03 next-class-day behavior           |
| `schedule-multi-screen` | Multi-screen     | Two rooms, plans, screens, and isolation expectations | M-03/M-05 isolation                    |

All values are intentionally synthetic. Builders use fixed inputs and contain
no clocks, randomness, network access, external paths, provider identifiers,
or copied legacy values.

## Parity coverage map

The executable
[`parity-coverage.ts`](../../src/contracts/v1/parity-coverage.ts) contains one
primary entry for every inventory behavior ID and `U-001` through `U-015`.
Each entry is classified as exactly one of:

- synthetic fixture;
- contract test;
- static invariant;
- visual case; or
- explicitly named later verification.

Every entry also names a later behavioral gate. M-01 evidence freezes a shape or
obligation; it does not claim the behavior has been implemented. A focused test
extracts IDs directly from the parity inventory and rejects missing, extra, or
duplicate coverage entries.

## Visual-baseline manifest

The TypeScript visual manifest defines these required states:

| State               | Required variants                               |
| ------------------- | ----------------------------------------------- |
| `no_classes`        | Default                                         |
| `morning_overview`  | Default                                         |
| `idle`              | Default                                         |
| `pre_checkin`       | Default                                         |
| `in_class_content`  | Objective, bellringer, vocabulary, generic card |
| `dismissal_warning` | Local media ready, local media delayed          |
| `post_end`          | Default                                         |
| `day_complete`      | Default                                         |

The provisional viewports are `large-tv` at 1920×1080 and `laptop` at
1366×768, matching the inventory's large-display and laptop requirement. U-010
still requires sanitized discovery of the exact kiosk/browser/viewport contract.
Every manifest entry is `not-captured`; no screenshot or visual approval is
fabricated.

## Fixture safety and redaction

`npm run fixtures:check` recursively scans fixture source files and rejects
likely:

- private keys, common credential assignments, provider tokens, and OAuth client
  identifiers;
- email/Calendar addresses, absolute URLs, private hostnames, and private IPs;
- UUIDs and long numeric live identifiers;
- student-record, credential, browser-profile, and raw-capture fields; and
- absolute host paths outside the repository.

Tests exercise both safe synthetic values and representative rejected patterns,
and they scan the serialized fixture catalog. These heuristics supplement review;
they are not proof that arbitrary data has been anonymized. Fixtures must be
synthetic by construction, not copied and then lightly edited.

## Unknowns and later gates

Every `U-001` through `U-015` coverage entry is classified as later
verification, has no fabricated M-01 evidence reference, and names its smallest
safe decision or verification gate. In summary:

- product scope remains open for broader PowerSchool and Google read lanes;
- attendance implementation evidence remains incomplete;
- scheduler, routing, Calendar ownership, and active-room facts require later
  redacted read-only audits;
- PowerSchool, Google, and alert technology ADRs remain Proposed;
- shadow/stabilization/RTO, retention, operator identity, and fallback policy
  require user decisions; and
- visual/browser details and operator-brief contracts require later safe evidence.

## Approval record

M-01 was approved by the user on 2026-08-08 after independent review of the
corrected contracts and fixtures and an independent full quality-gate run. The
approved snapshot is the prerequisite baseline for M-02; approval does not
authorize later migration stages or live-system work.
