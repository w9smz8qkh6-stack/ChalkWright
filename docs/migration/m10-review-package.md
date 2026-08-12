# M-10 review package: read-only integration gate

- **Status:** protected C509 integration gate passed with three planned Tuesday
  meetings, three fresh Classroom cache entries, zero differences, zero source
  mutations, and no Calendar capability; M-10 is promoted
- **Date:** 2026-08-10
- **Integration branch:** `codex/m07c-clean-integration`
- **Approved repository baseline:**
  `efeb37edc5b8be6fa35746b38db37aa4dfa85b4f`
- **External effects:** bounded read-only Classroom metadata/coursework requests,
  bounded passive PowerSchool status/bell reads, and temporary in-memory cache
  writes; no provider mutation, Calendar capability, persistent cache write,
  service, or timer change

## Roadmap fit and prerequisite reconciliation

M-10 is the existing final checkpoint in Stage B. It consumes the direct
PowerSchool and Google Classroom read paths and gates M-11's isolated,
mutation-disabled shadow instance. It does not renumber, collapse, or begin
M-11 or any later milestone.

The user authorized M-10 on 2026-08-09. M-07B is approved, M-07C completed its
separately authorized filtered-state bootstrap and credential-free exact status
and bell reads, M-09 is promoted, and M-08 has completed its protected grant,
mapping, bounded live read/scope gate, and stable-TV-latency verification. M-08
is promoted. The first configured M-10 retry observed three live Tuesday periods
but did not produce a canonical plan because its temporary manifest used an
unsuitable historical-date mapping. The user clarified that the current room is
C509 and that each Classroom course carries the matching PowerSchool code in its
section field. Current-term metadata confirmed 12 new C509 mappings and zero
overlap with the prior eight. A bounded comparison proved that each of Tuesday's
three PowerSchool codes occurs as one delimiter-bounded token in exactly one
current Classroom section. The protected combined retry then passed with no
differences. M-10 is promoted; M-11 remains separately gated.

The fixture-backed usable-display checkpoint remains M-05. A minimum viable
replacement still requires M-11 through M-18:
isolated shadow operation, behavioral comparison, Calendar intent/ownership
audit, writer qualification, rollback rehearsal, cutover, stabilization, and
legacy retirement. This checkpoint does not expose a live display, activate a
job, or approach the writer/cutover gates.

## Implemented integration contract

`runM10ReadOnlyIntegrationGate` accepts a bounded repository-owned manifest and
only three capabilities: a schedule-source factory, a Classroom enrichment-
source factory, and the existing normalized Classroom cache port. It cannot
receive a Calendar writer or intent planner, a provider-write client, a
credential loader, a repair browser, a command runner, or a generic network
client.

The manifest permits one through 12 named cases. Each case fixes one date, one
canonical room, at most 64 room-matching schedule mappings, canonical-plan
timing, and an expected schedule classification. Each schedule mapping carries
the reviewed Classroom section field. Plan derivation requires the normalized
PowerSchool code as one exact delimiter-bounded token inside that field; a
date-specific period ID may narrow but cannot override the section match.
Provider room labels such as
`C509` are separately normalized to canonical room identity, timestamps are
converted to canonical UTC instants, and both still fail closed on mismatch.
An optional Classroom section permits one
through 12 unique numeric provider mappings already represented by the
schedule mapping, with bounded cache, backoff, and parallelism policy. The
existing PowerSchool-to-canonical-plan and Classroom-refresh/cache contracts do
the actual work; M-10 introduces no parallel provider or plan model.

The result exposes only case aliases, finite classifications, counts, named
difference codes, and scope-isolation status. It never returns room, class,
course, provider, observation, plan, error-message, or raw-response identities.
Every case and aggregate result fixes attempted and completed source mutations
and eligible Calendar intents at zero. `calendarCapabilityConstructed` is
always false. Omitting Calendar capability entirely is stronger than injecting
a null writer and makes the no-execution boundary structural.

The permission inventory is fixed to:

- PowerSchool schedule reads through `GET`/`HEAD`, with repair in the separate
  operator-present M-07C capability;
- Google Classroom published-coursework reads through
  `courses.courseWork.list` and only
  `classroom.student-submissions.students.readonly`; and
- no Calendar capability.

Resource containment combines the manifest's fixed case/mapping/parallelism
bounds and a required caller-owned abort signal with the already-qualified per-adapter request,
item, byte, page, timeout, and process limits. No live entry point or scheduler
is added at this checkpoint.

## Offline evidence

Synthetic integration tests cover:

- representative multi-room canonical plans and an explicit no-class day;
- delimiter-bounded PowerSchool-code tokens embedded in Classroom sections,
  idempotent room identity, canonical UTC instants, and rejection of substring,
  wrong-section, ambiguous, and cross-room mappings;
- PowerSchool repair-required, stale observation, mapping gap, and thrown-source
  classification without constructing Classroom or Calendar capability;
- Google Classroom success, authentication repair-required, rate-limit failure,
  partial success/degradation, stale-cache retention, and normalized cache
  counts;
- ordered bounded cases, room-scoped mappings, numeric one-to-one Classroom
  mappings, policy limits, and pre-source rejection of extra-field, sparse, or
  accessor-backed manifests without invoking accessors;
- caller abort before source construction;
- a dedicated redacted `schedule-mapping-difference` classification without
  room, class, section, period, or provider values; and
- architecture and serialized-result scans proving the absence of Calendar,
  credential/repair, provider-write, identity, and raw-output surfaces.

The M-08 adapter, refresh, official-client, and SQLite cache suites continue to
prove exact provider normalization, fixed OAuth method/scope, bounded paging,
partial failure, backoff, corruption detection, and last-known-good retention.
M-07A through M-07C continue to own exact PowerSchool transport/session/parser
evidence. M-10 composes those approved contracts rather than duplicating them.

The full offline `npm run check` gate passed all 449 tests, production build,
startup smoke, and the 6/6 temporary-state operations rehearsal. Documentation
resolved 93 local links, repository safety checked 289 candidate paths, fixture
safety and formatting passed, and `git diff --check` reported no error.

## Live prerequisite audit and stop condition

A metadata-only environment check inspected presence only and printed no
values. At that checkpoint the execution environment did not provide the
required PowerSchool room, exact origin, external filtered-session directory,
protected Classroom credential reference, or reviewed numeric course mappings.
No protected file, browser state, credential, provider page, or private
evidence was opened during that audit.

The M-08 authorized-user reference and eight reviewed mappings are present, and
the stable-TV-latency observation completed with 200/200 successful kiosk GETs
and no p95 regression during the Classroom batch. M-08 is promoted.

The user authorized resolving the missing non-secret PowerSchool policy from
the legacy app. Checked-in legacy configuration supplied the exact PowerSchool
origin, teacher status route, dated bell route, B407 room, timezone, Chrome
path, and mapping rules. A filename-and-metadata-only scan located the retained
owner-only M-07C session directory without opening its state file. The bounded
configured M-10 case targeted Tuesday 2026-08-11 with an in-memory Classroom
cache and no Calendar capability. Its first attempt returned `repair-required`,
and a sanitized passive follow-up classified the cause as
`session-state-rejected`.

The user then authorized one operator-present bootstrap. After one invisible
display attempt and one rejected alternate-display launch, the temporary browser
was raised on the active GNOME display, reached the exact bell page without
requiring another sign-in, saved fresh filtered state, and deleted its complete
profile. Credential-free routine reads then produced a verified three-period
Tuesday observation.

The legacy catalog contains zero B407 records for 2026-08-11. The temporary
retry tried exact live-label and historical-date joins rather than the intended
Classroom section-code join, so canonical acquisition remained `not-found` and
Classroom did not run inside M-10. The user then identified C509 as the current
classroom. A bounded read-only current-course inventory found 12 active C509
courses, 12 unique section fields and numeric IDs, and zero section overlap with
the prior eight legacy mappings. A corrected PowerSchool read produced three
C509 periods and a runtime-valid observation after local timestamps were
canonicalized to UTC.

The selected Chrome work profile could not be launched from the execution
session's desktop boundary. The existing legacy PowerSchool lane was therefore
queried passively as the user-authorized reference, but its teacher-home session
had expired and it returned `repair-required` without attempting sign-in. The
newer M-07C filtered state remained valid: an exact status/bell read returned
three C509 periods with PowerSchool codes. A count-only comparison then found
each code as one delimiter-bounded token in exactly one current Classroom
section, with one unique numeric Classroom course ID. This made a Schedule-tab
navigation unnecessary and avoided another authentication flow.

The protected combined M-10 invocation used only those three current mappings,
the retained filtered PowerSchool session, the existing narrow Classroom grant,
and a temporary in-memory cache. It returned `passed`: three meetings planned,
three Classroom reads attempted, three cache writes, three fresh entries, zero
stale or missing entries, zero differences, zero source mutations, zero eligible
Calendar intents, and no Calendar capability. No raw provider content was
retained, and all temporary probe scripts were removed.

## Deferred rather than completed

- live schedule coverage for the other nine current C509 mappings and additional
  production dates, which belongs to M-11 shadow operation rather than this
  representative M-10 gate;
- durable protected configuration and persistent integration cache state;
- operational job registration, persistent integration state, services,
  timers, routing, deployment, or background execution;
- every Calendar read, intent audit, credential, writer, or mutation; and
- M-11 and all later roadmap work, pending separate authorization.

## Completion and next authorization gate

M-10's completion gate is satisfied: the separately controlled protected
invocation proved representative direct reads and canonical outcomes, emitted
only the redacted result contract, recorded zero source writes and zero eligible
Calendar intents, and produced no differences requiring approval. M-10 is
promoted.

The next roadmap step is M-11's isolated mutation-disabled shadow instance. It
requires separate authorization before any service template, protected runtime
configuration, port, timer, routing, deployment, or background operation is
prepared or activated. No M-11 work occurred here.
