# M-08 review package: Google Classroom read qualification

- **Status:** promoted after bounded live scope/read and stable-TV-latency gates
- **Date:** 2026-08-09
- **Integration branch:** `codex/m07c-clean-integration`
- **Approved repository baseline:**
  `efeb37edc5b8be6fa35746b38db37aa4dfa85b4f`
- **External effects:** one dedicated Desktop OAuth client and one owner-only
  external authorized-user reference were created; two bounded eight-mapping
  read-only Classroom batches and 200 loopback kiosk GETs were observed; no
  provider mutation or application-state write occurred

## Roadmap fit

M-08 is the existing roadmap milestone immediately after M-07B. Supplemental
M-07C remains between them as PowerSchool evidence for M-10, but the roadmap
explicitly says M-07C does not gate implementation of M-08 or M-09. The
separately authorized M-07C bootstrap/session-reuse read gate has now completed;
its no-class Monday result does not change M-08 scope.

This checkpoint implements and scope/read-qualifies M-08's adapter,
normalization, bounded batch, cache/freshness, backoff, and typed asynchronous
job wrapper. M-08 and M-09 are promoted. A later protected comparison also
promoted M-10, which now gates isolated shadow deployment at M-11. The
fixture-backed usable-display checkpoint was already reached at M-05; a minimum
viable production replacement still requires M-11 through M-18 shadow,
comparison, Calendar ownership/writer, rollback, cutover, and stabilization
gates.

There is no milestone-number conflict. M-08's authorized live read/scopes audit
completed after the offline checkpoint. One of eight legacy mappings returned
the expected isolated `classroom-course-not-found` classification; that
operational mapping follow-up does not defeat the milestone's explicit partial-
failure requirement or the successful scope/method qualification.

## Accepted credential and capability model

ADR-0011 records the user-approved model:

- operator-provisioned installed-application user OAuth outside Classroom Hub;
- exact sole scope
  `https://www.googleapis.com/auth/classroom.student-submissions.students.readonly`;
- exact official `@googleapis/classroom` 14.0.0 dependency;
- configured numeric course IDs, so no `courses.list` or
  `classroom.courses.readonly` scope;
- only the generated `courses.courseWork.list` read method, fixed to
  `PUBLISHED` coursework and a bounded field mask; and
- protected owner-only, single-link, exact-shape credential reference outside
  the repository and SQLite; and
- dedicated installed-app client ID, client secret, refresh token, and exact
  sole scope in the owner-only external reference. Live exchange evidence
  showed that this client requires its generated secret; it is never retained
  in the repository, SQLite, logs, or review evidence.

Classroom Hub still implements no consent UI, credential retrieval, 1Password,
service-account, domain-delegation, Calendar, or general Google command
surface. The separately authorized operator workflow created the dedicated
client and protected external grant; only its path crosses the application
configuration boundary.

## Offline implementation evidence

The provider boundary consists of one transport method. The official-client
wrapper fixes course state, order, page size, response fields, timeout, abort
signal, and disabled automatic retry. Provider failures become a finite set of
sanitized codes. The adapter paginates within configured page/item limits,
drops malformed or non-published records, and feeds the existing
`normalizeCoursework` domain contract rather than creating a parallel model.

The refresh orchestration accepts one through twelve one-to-one mappings,
retains input order, caps parallel reads at four, isolates per-course failure,
applies bounded exponential backoff, and always reports zero attempted and
completed external mutations. Its typed job wrapper emits only aggregate,
sanitized outcomes. The wrapper remains intentionally absent from the
operational registry and entrypoint until a later operational milestone;
therefore no current command or timer can reach Google.

SQLite migration 4 adds a dedicated normalized-enrichment cache. It stores no
OAuth material, raw provider response, roster, student, submission, or grade
data. Strict runtime validation, bounded payloads, semantic hashes, and
provider-neutral fields protect the cache. Reads compute fresh/stale state at
the caller's observation time. Failed refreshes preserve last-known-good data,
advance bounded failure/backoff state, and successful refreshes clear that
state.

The display server, controller, browser client, and main entrypoint do not
import the Classroom adapter or refresh job. Live latency cannot enter a TV
request path by construction, and the separately authorized observation below
also measures host contention.

## Dependency and version evidence

The exact package is `@googleapis/classroom` 14.0.0 (Apache-2.0, Node.js
`>=12`) with its lockfile graph. Its shipped generated TypeScript source was
checked for the exact `courses.courseWork.list` parameters and method options.
The official REST reference identifies this operation as `GET`, accepts an
empty request body, and lists the equivalent
`classroom.coursework.students.readonly` spelling. The separate Classroom scope
guide and observed OAuth mapping establish the exact canonical returned scope.
The official installed-app OAuth guidance governed external provisioning.
`npm audit`
reported zero known vulnerabilities at integration time. A deprecated
transitive `glob` warning is recorded as dependency-graph debt; it does not add
a runtime command surface.

## Offline verification

Synthetic tests cover:

- exact scope and dependency pinning, and absence of broader Google products;
- fixed published-coursework parameters/fields with no request body or write
  method;
- credential-reference permissions, ownership, exact shape/scope, symlink,
  hard-link, and repository-path rejection;
- pagination, ordering, published filtering, existing domain normalization,
  mapping misses, page/item limits, timeouts, and sanitized provider errors;
- ordered bounded concurrency, partial failure, abort, retry backoff, and zero
  external mutation counts;
- normalized cache fresh/stale behavior, last-known-good retention, recovery,
  unsafe URL rejection, and semantic corruption detection;
- typed job success/degraded/repair-required outcomes without course IDs or
  private error details; and
- architecture separation from display request paths and operational runtime
  registration.

The complete `npm run check` passed: generated documentation was current, 93
local links resolved, fixture safety passed, all 447 tests passed, production
build and startup smoke passed, and the offline operations rehearsal completed
6/6 jobs. Operations/repository safety verified two inert services, seven
pending timer templates, ten bounded job names, and 289 candidate paths for
forbidden artifacts or operational dependencies. `git diff --check` passed.
The dependency audit reported zero known vulnerabilities. Focused review found
and corrected cache freshness-at-read semantics, migration expectations,
operational-unreachability coverage, exact credential-shape coverage, raw-item
budget accounting, cache-exception isolation and source-code sanitization, and
explicit repeated-token/timeout cases before this package was finalized.

## Live qualification evidence

The user separately authorized client creation, the canonical teacher-read
scope, consent, and bounded live reads. One dedicated Desktop client was
created in the existing project. The owner-only external reference passed
regular-file, canonical-path, owner, mode-`0600`, single-link, size, exact-key,
and exact-one-scope checks. Its one-time downloaded client intermediate and all
temporary provisioning/live-run scripts were then permanently removed.

Google's authorization server mapped the method-reference spelling
`classroom.coursework.students.readonly` to the canonical
`classroom.student-submissions.students.readonly` scope listed in Google's
Classroom scope guide. The helper rejected the first non-exact response; after
the user explicitly approved the canonical teacher read-only scope, the final
exchange returned exactly that sole scope. No broader scope was accepted.

The legacy plugin's local catalog yielded eight numeric, one-to-one mappings
without exposing identifiers. A one-shot run invoked only
`courses.courseWork.list`, with the reviewed field/page/item/time/concurrency
bounds. Seven mappings returned verified observations; one returned sanitized
`classroom-course-not-found`, demonstrating the intended partial-failure
isolation. No coursework happened to fall in the selected recent/upcoming
window. The run reported zero attempted/completed mutations, constructed no
Calendar capability, persisted no provider data, and did not touch the live TV
service. Display request paths remain structurally cache-only.

A later separately authorized host-contention observation issued 40 baseline
kiosk GETs and 160 kiosk GETs while another bounded eight-mapping Classroom
batch ran with concurrency three. Every kiosk request succeeded. Baseline
median/p95/max latency was 1.62/2.72/50.31 ms; under Classroom load it was
1.22/1.75/28.56 ms. The read batch again isolated seven observations and one
sanitized failure. It wrote no cache, invoked no Calendar capability, and
reported zero TV and provider mutations. This satisfies the roadmap's stable
TV-latency verification without operationally registering refresh.

## Deferred rather than completed

- repair or retirement of the one legacy mapping that is unavailable to the
  authorized account;
- quota/rate behavior, refresh-token revocation, the external-testing seven-day
  token lifetime, consent expiry, and operator repair behavior;
- long-duration TV latency after a future operational asynchronous refresh is
  registered;
- operational registry/CLI wiring, scheduler/service/timer work, deployment,
  routing, or background refresh;
- M-10 configured multi-source integration;
- Calendar credentials, reads, ownership, or writes; and
- `GC-007` unrelated Gmail/Drive/Docs/Sheets/Slides/Forms reads, which remain an
  explicit `U-001` product-scope decision and are not silently retired.

## Promotion and next gate

The read-only method/scope, failure-isolation, and stable-TV-latency portions of
M-08's completion gate are satisfied. M-08 is promoted. This does not register
the refresh wrapper or authorize a service, timer, deployment, or background
job.

The protected grant and reviewed mappings supported a later controlled M-10
comparison that retained only redacted/disposable evidence, produced no
differences, and kept Calendar capability absent. M-10 is promoted. Operational
registration remains deferred: no current CLI, timer, service, display request,
or background process can invoke Classroom refresh. M-11 requires separate
authorization.
