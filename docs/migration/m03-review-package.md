# M-03 pure plan, state, and enrichment review package

- **Plan step:** M-03 — Implement pure plan, state, and enrichment behavior
- **Status:** Approved and promoted as the M-03 baseline
- **Prerequisite:** Approved M-01 and committed M-02 (`037af6f`)
- **Evidence boundary:** Repository-only pure functions and sanitized synthetic tests

## Scope delivered

The candidate adds no dependency and performs no filesystem, database, HTTP,
browser, subprocess, provider, Calendar, or other external I/O. Persistence,
vocabulary-history updates, and Calendar changes are inert values only.

- `src/application/normalization/bell-schedule.ts` extracts weekly hydrated and
  embedded AET, table, card, text, missing-metadata, and noisy layouts and
  strictly normalizes dates, periods, freshness, provenance, and diagnostics.
- `src/domain/plan-derivation.ts`, `fallback-plans.ts`, and `pure-values.ts`
  derive isolated canonical/effective plans, enforce fresh verified authority,
  retain transitional unverified fallback decisions, and provide stable IDs,
  serialization, and fingerprints.
- `src/application/read-only/state-machine.ts` implements all eight frozen
  states, exact boundary precedence, hidden check-in, and next-class-day labels.
- `src/domain/coursework.ts` ports the meeting-date-relative seven-day lookback
  and 21-day lookahead, dated/undated classification, legacy ordering and
  three-item caps, provider/title/non-deleted filtering, material and count fields,
  per-class isolation, and refresh/provenance metadata that cannot change
  buckets. Only fresh matching-date/class overlays are accepted.
- `src/domain/content.ts` preserves ordered default and date-override arrays in
  both nesting forms; groups fresh assignments by unit with legacy selection
  limits; retains eligible static cards; hides only documented card types;
  preserves featured, detail, accent, duration, due, and follow-up fields; and
  appends vocabulary last.
- `src/domain/vocabulary.ts` ports source-priority de-duplication, class/subject/
  CodeHS eligibility, exact context scoring, focused and best-available pools,
  previous-meeting avoidance, deterministic class/date/block rotation,
  same-meeting reuse, repeat-after-exhaustion, display metadata, and inert
  persistence context.
- `src/domain/attendance.ts` resolves direct/wrapper link precedence and returns
  the nested five-field attendance summary, class/link fields, and QR target
  data without QR rendering; each count is independently validated and missing
  counts remain distinct from zero.
- `src/domain/overrides.ts` models one exact screen/date scope containing a
  global announcement, simulator controls, and multiple class/meeting entries;
  meeting lookup precedes class lookup and the base model remains immutable.
- `src/application/read-only/composition.ts` composes loaded-date original and
  effective plans, timeline, diagnostics, overrides, state, and forced target
  without receiving mutation capabilities.
- `src/application/planning/calendar-intents.ts` builds deterministic desired
  events and inert no-op/create/replace/delete decisions for verified owned
  events, suppresses notifications, ignores ambiguous ownership, validates
  intervals, and supports stable forced/non-forced planning.

## Legacy evidence used

Only source, documentation, and tests were inspected read-only:

- `<legacy-plugin-root>/powerschool-browser-lane/lib/adapters/bell-schedule.js`
- `<legacy-plugin-root>/powerschool-browser-lane/tests/bell-schedule.test.js`
- `<legacy-plugin-root>/classroom-screen/src/timing.js`
- `<legacy-plugin-root>/classroom-screen/src/domain.js`
- `<legacy-plugin-root>/classroom-screen/src/overrides.js`
- `<legacy-plugin-root>/classroom-screen/src/preview.js`
- `<legacy-plugin-root>/classroom-screen/src/classroom-refresh.js`
- `<legacy-plugin-root>/classroom-screen/src/vocabulary-history.js`
- `<legacy-plugin-root>/classroom-screen/shared/assignment-normalization.cjs`
- corresponding legacy pure-domain tests; and
- `/srv/openclaw/scripts/powerschool_bell_calendar_sync.js` source only.

No live database, runtime state, credentials, browser profile, student record,
provider data, service, network endpoint, or external Calendar was accessed.

Sanitized portable evidence now lives in
`test/fixtures/m03-legacy-golden.ts`. Tests do not import legacy code or depend
on legacy absolute paths at runtime. The fixture covers the five real bell
shapes plus coursework ordering/fields and vocabulary source/pool inputs; the
same focused suite contains pinned content, attendance, and multi-class
override goldens. Synthetic links use only the reserved, non-routable
`fixture.example.invalid` host, which the fixture scanner permits narrowly
while continuing to reject other absolute URLs.

## Legacy pure-test port disposition

Applicable assertions were ported by behavior into the focused M-03 suites,
rather than preserving legacy object names or runtime wiring:

- all `timing.test.js` state choices, including morning cutoff, hidden check-in,
  between-class reset, dismissal, completion, and empty plans;
- pure `domain.test.js` identity/class-key normalization, unit extraction,
  coursework filtering/overlay, direct attendance-link precedence, objectives,
  static hiding, concise directions, vocabulary scoring/rotation/reuse/
  exhaustion/CodeHS preference, display/date isolation, and next-day selection;
- pure override append/replace/hide/dismissal and base immutability behavior;
- preview timeline, diagnostics, original/effective plan, and hidden-check-in
  behavior;
- coursework refresh classification; and
- vocabulary-history selection/reuse/no-preview-write behavior as inert decisions.

The following legacy tests cannot be exactly ported inside M-03 without
violating the milestone boundary, so their named gates remain explicit:

- missing/invalid override-file fallback and atomic file writes require M-04
  persistence and M-05 control behavior;
- inline-script escaping, preview HTML, route/query handling, and default live
  clock selection require M-05 rendering/HTTP work (`PRE-002` remains blocked);
- actual vocabulary-history persistence requires M-04; M-03 returns an intent;
- provider cache refresh/batching requires M-08; M-03 normalizes supplied
  synthetic values only; and
- QR rendering and live attendance route/matrix behavior require M-05/M-09.

## Parity classification

“Exact” below means exact for the pure M-03 data/decision boundary; later HTTP,
rendering, persistence, provider, and Calendar execution gates remain in force.

| Parity ID     | Classification                | M-03 result and remaining gate                                                                                                                                               |
| ------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PS-007`      | exact legacy match            | All documented extractor layouts and strict missing/mismatch/stale/malformed outcomes are covered.                                                                           |
| `CAL-003`     | exact legacy match            | Desired fields and ownership-scoped notification-suppressed intents are preserved.                                                                                           |
| `CAL-004`     | normalization-only difference | Pure `replace` is one inert decision instead of exposing the legacy delete/create sequencing; execution remains M-14.                                                        |
| `CAL-006`     | normalization-only difference | Skip/force behavior is preserved; canonical stable serialization uses a documented FNV-1a 64 digest instead of legacy SHA-256.                                               |
| `GC-002`      | exact legacy match            | Meeting-date windows, due/undated buckets, ordering, caps, filters, fields, and independent refresh metadata are preserved.                                                  |
| `GC-004`      | exact legacy match            | Only fresh matching-date/class enrichment overlays.                                                                                                                          |
| `GC-005`      | exact legacy match            | Mapping failure is diagnosed per class without contaminating valid classes.                                                                                                  |
| `PLAN-001`    | exact legacy match            | Ordered identity/mapping semantics are preserved; stale or unverified observations fail authoritative derivation and cannot yield Calendar intents.                          |
| `PLAN-002`    | exact legacy match            | Date, room, and screen scopes cannot cross-project.                                                                                                                          |
| `PLAN-003`    | exact legacy match            | Check-in, content, dismissal, and end boundaries derive from injected policy and absolute times.                                                                             |
| `PLAN-004`    | exact legacy match            | All eight states and exact equality precedence are implemented.                                                                                                              |
| `PLAN-005`    | exact legacy match            | Hidden check-in selects content for the first class and prior post-end between classes.                                                                                      |
| `PLAN-006`    | exact legacy match            | Tomorrow, Friday Next Week, gap, no-next, and screen-filter behavior are preserved without fabricated days.                                                                  |
| `PLAN-007`    | unresolved blocker            | Transitional fallback is disabled by default and always unverified when enabled; `U-011` still blocks a long-term policy decision.                                           |
| `CONTENT-001` | exact legacy match            | Defaults and both date/class override nestings resolve deterministically.                                                                                                    |
| `CONTENT-002` | exact legacy match            | Card kind, accent, lines, and optional duration survive pure normalization.                                                                                                  |
| `CONTENT-003` | exact legacy match            | Unit-grouped objectives precede eligible static/date cards; stale data generates none and removes only documented cards.                                                     |
| `CONTENT-004` | exact legacy match            | Featured text, first two compacted sentences, exact special rewrite, Classroom follow-up, and due information are preserved.                                                 |
| `VOC-001`     | exact legacy match            | Source-priority de-duplication, context/CodeHS scoring, focused pools, and deterministic rotation are preserved.                                                             |
| `VOC-002`     | exact legacy match            | Same-meeting reconstruction, previous-word avoidance, exhaustion, display metadata, and inert history context are preserved.                                                 |
| `ATT-001`     | exact legacy match            | Check-in, teacher-display, QR target, and Classroom link data are modeled.                                                                                                   |
| `ATT-002`     | exact legacy match            | Direct prefilled/responder links precede wrapper/quick links; invalid URLs are not emitted.                                                                                  |
| `ATT-003`     | approved correction           | The nested five-count summary is modeled; unlike legacy coercion, missing stays missing and invalid values diagnose instead of becoming zero/NaN. QR rendering remains M-05. |
| `PRE-001`     | exact legacy match            | Pure loaded-date preview returns original/effective plan, timeline, diagnostics, overrides, and forced target.                                                               |
| `PRE-002`     | unresolved blocker            | Query/route enforcement that permits frozen clocks only in explicit preview mode belongs to M-05 and was not fabricated in M-03.                                             |
| `PRE-003`     | exact legacy match            | Preview has no writer capabilities; mutation spies remain at zero.                                                                                                           |
| `OVR-001`     | exact legacy match            | One exact screen/date scope supports global fields and multiple entries; meeting ID lookup precedes class ID.                                                                |
| `OVR-002`     | approved correction           | Legacy fields are preserved, but the user-required global announcement remains across a class-card replace instead of being removed.                                         |

The two approved corrections above come directly from this correction request:
attendance must preserve missing versus zero and validate invalid counts, and a
global announcement must apply across the whole display/date even when one
class replaces its own cards. No ADR or unrelated product policy was accepted.

## Verification matrix

| Area                            | Synthetic evidence                                                                                                                                                                                                                                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Bell extraction                 | table, card, text/noise, missing metadata, hydrated weekly AET, embedded AET, matching/mismatch, stale, malformed, byte stability                                                                                                                                                                            |
| Plans                           | normal, special, empty, stale, malformed interval, missing/partial mapping, fallback, multi-room/screen isolation                                                                                                                                                                                            |
| State                           | minus/exact/plus for check-in open, content start/equal official start and check-in close, dismissal, end, later-class transitions; all eight states; hidden check-in                                                                                                                                        |
| Next day                        | immediate tomorrow, Friday next week, gap, no next, wrong screen                                                                                                                                                                                                                                             |
| Enrichment/content              | meeting-vs-refresh regression, inclusive boundaries, dated/undated order, three-item caps, provider/title/non-deleted filtering, nested materials/links, counts, mapping isolation, fresh/stale/wrong scope, unit grouping, both override nestings, static preservation/hiding, exact objective fields/order |
| Vocabulary/attendance/overrides | source de-duplication, CodeHS/focused pools, rotation, same-meeting reconstruction, previous-word avoidance, exhaustion metadata; missing/zero/invalid five-count summary; global plus two classes, meeting precedence, replace, unrelated scopes, immutability                                              |
| Preview/Calendar                | zero mutation calls, source immutability, cross-screen negative, authoritative-plan rejection, no-op/create/replace/duplicate/obsolete/force/convergence/invalid interval, unrelated ownership, fingerprint stability                                                                                        |

The approval review included `npm run check`, the focused compiled M-03 tests,
and `git diff --check`; all passed before promotion.

## Remaining decisions and boundaries

- `U-011`: approve removal or a steady-state replacement for the transitional
  unverified Calendar/latest-local fallback. M-03 does not settle it.
- `PRE-002`: explicit preview-mode query/clock enforcement requires the M-05
  route layer. Pure preview composition does not imply route authorization.
- Calendar persistence/execution, QR rendering, HTTP/routes/control UI,
  providers/authentication, SQLite/migrations, and live integration remain later
  milestones. No M-04 component is part of the M-03 baseline.

## Approval record

M-03 was approved by the user on 2026-08-08 after independent parity review of
the corrected pure behavior and portable evidence plus a complete quality-gate
run. The approved snapshot is the prerequisite pure-behavior baseline for
M-04; M-03 approval does not itself authorize later milestones or live-system
work.
