# M-07C review package: filtered PowerSchool session integration

- **Status:** offline implementation, operator bootstrap, credential-free exact
  reads, and nonempty-day normalization verified live; a durable production
  marker remains deferred
- **Date:** 2026-08-09
- **Baseline:** `efeb37edc5b8be6fa35746b38db37aa4dfa85b4f`
- **Prior approved PowerSchool checkpoint:**
  `7582a820ebd3ae31df9a19131dabc5b35f93a665`
- **External effects:** separately authorized read-only bootstrap attempts and
  exact routine status/bell reads; filtered external session state was retained
  with owner-only permissions, and no PowerSchool business-data mutation
  occurred

## Checkpoint boundary and roadmap fit

The approved roadmap names M-07A, M-07B, and then M-08. It does not name M-07C.
This package records an additive supplemental checkpoint after M-07B without
renumbering, collapsing, or beginning M-08 through M-18. M-07C closes an
implementation/evidence gap exposed by M-07B's safe
`authentication-required` result: it provides a filtered-session bootstrap and
credential-free routine collector, whose separately authorized authenticated
read gate subsequently completed.

M-07C gates the PowerSchool evidence required by M-10's read-only integration
gate. It is not a prerequisite for implementing M-08 or M-09, and it does not
itself complete M-10. The immediate fixture-backed usable-display checkpoint
was already completed at M-05; this work neither changes nor promotes that
display. The minimum viable replacement still requires applicable M-08 through
M-18 Google-read, import, integration, shadow, comparison, Calendar-ownership,
writer, rollback, cutover, and stabilization gates.

This is the only roadmap conflict: the requested M-07C label is absent from the
approved milestone list. Treating it as a supplemental pre-M-10 gate preserves
the existing milestone numbers and dependencies while making the newly proven
session method reviewable. No approved milestone is silently reopened or
declared complete.

## Verified prototype evidence

The technical handoff reports a one-time operator-present visible Chrome
bootstrap on the Linux RDP desktop that completed Google SSO. It filtered saved
state to PowerSchool cookies and exact PowerSchool-origin storage, deleted the
temporary Google-bearing profile, and reused the filtered state for
authenticated headless bell reads that produced one normalized three-period
observation. It reports no PowerSchool business-data mutation. An attempted
automatic Google login failed closed at an interactive challenge.

Those facts are prototype evidence, not repository acceptance evidence. The
prototype's live reads were still launched beneath `op run`, so it did not
prove 1Password-independent routine operation. The mixed source checkout also
contains failed and unrelated work and was not copied wholesale.

## Offline integration evidence

The clean implementation has two fixed capabilities:

- The manual bootstrap launches visible Chrome with a fresh profile, accepts no
  credential values or form automation, waits for any browser tab to reach the
  exact PowerSchool bell URL and success marker, filters exported state, writes
  it atomically at owner-only permissions, and deletes the complete profile on
  success, failure, abort, or timeout. Operator-driven identity navigation is
  browser-native so normal SSO redirects, posts, resource origins, and auxiliary
  tabs are not mistaken for policy violations.
- The passive collector receives no identity origin, credential, 1Password, or
  repair capability. It loads only validated filtered state, creates and
  removes a fresh profile for each run, performs exact manually non-following
  status and bell `GET` reads, renders bounded HTML behind an all-network-abort
  browser route, refreshes state only after both markers pass, and normalizes
  through the approved bell adapter/domain contract.

Both entry points use an exclusive owner-only lock and fixed process-group
supervision with finite navigation/overall deadlines, abort propagation, an
internal five-second cleanup reserve, graceful termination, forced teardown,
and descendant-quiescence verification. Hostile paths, symlinks, hard links,
ownership/mode mismatches, unknown state fields, and malformed state fail
closed. The routine collector additionally rejects redirects and non-HTML or
oversized responses. Routine rendering has JavaScript disabled, service workers
and downloads disabled, and every browser-side request aborted, so provider
scripts, forms, popups, downloads, and service-worker markup remain inert rather
than blocking static parsing. Errors and CLI output contain only sanitized
outcome codes or existing normalized contracts.

The qualified local tuple is Node.js 24.15.0, npm 11.12.1,
`playwright-core` 1.62.0, and installed Chrome 150.0.7871.114. Exact installed
Playwright type declarations confirm persistent contexts, state injection,
download blocking, and service-worker blocking. The manual operator phase does
not claim application-level origin, method, request-count, or response-byte
confinement; its boundaries are operator presence, a disposable profile, an
overall deadline, an exact PowerSchool success marker, and filtered durable
output. Routine Node.js reads retain their hard preflight/streamed byte cap and
strict route contract.

Offline synthetic tests cover:

- successful bootstrap cookie/origin-storage filtering and temporary-profile
  deletion, including an encoded identity response;
- cleanup after bootstrap failure, abort, and timeout;
- credential-free valid-state status/bell reads and approved normalization;
- missing, expired, and rejected state without Google or credential access;
- a fresh removed profile for every routine run;
- routine foreign origins/paths and redirects; inert post, popup, download,
  service-worker, and excess-request markup with zero extra provider actions;
  excess bytes, timeout, supervisor interruption,
  concurrency, hard links, unknown state fields, and hostile state/path targets;
- exact date/status/bell parsing, verification, authority, and provenance; and
- shared approved M-07A/M-07B normalization, plus static dependency boundaries
  excluding credential and repair modules from routine collection.

The complete pre-live `npm run check` gate passed with 402 tests, 78 local documentation
links, 261 forbidden-artifact/operational-dependency candidates, the production
build, startup smoke check, and 6/6 offline operations rehearsal. `git diff
--check` also passed. Independent review findings were corrected before final
handoff. No file is staged or committed by this checkpoint.

## Deferred requirements and live unknowns

M-07C deliberately does not prove or complete:

- a durable production bell marker beyond the interim visible-body check;
- state expiry, provider revocation, repair frequency, or long-term unattended
  operation;
- behavior across restart, Chrome/Playwright/Node upgrade, or provider SSO/page
  changes;
- live concurrency/resource behavior or scheduler/service operation;
- Google Classroom, attendance/continuity imports, M-10 multi-source
  integration, shadow operation, Calendar ownership/writes, cutover, or
  stabilization;
- installation or activation of the future Sunday-through-Friday 07:20
  Asia/Ho_Chi_Minh cadence, including exact systemd calendar syntax,
  missed-run behavior, or operator ownership; or
- any 1Password, credential, profile-retention, evidence-retention, routing,
  deployment, push, or pull-request action.

The original clean-room handoff requested hard request/byte/origin confinement
for the manual operator phase. After the first live attempt showed that boundary
closing the authentication window before the operator could sign in, the user
explicitly chose a simpler browser-native manual flow. Hard acquisition limits
remain complete for routine reads but are deferred for manual SSO; this is a
documented scope exception rather than a completed requirement.

## Live stop gate

On 2026-08-09, a separately authorized operator-present bootstrap for
2026-08-10 returned the sanitized `bootstrap-policy-violation` outcome before
authentication completed. Per the gate contract, no retry or policy relaxation
was attempted and the routine collector was not run. Metadata-only cleanup
verification found no filtered state, temporary profile, lock, or matching
browser process; the empty newly created session directory was removed.

After the user explicitly selected the simpler browser-native flow, one attempt
timed out cleanly and a later attempt completed manual Google/PowerSchool sign-in.
The real bell page did not contain the synthetic `#bell-schedule` selector, so
the final bootstrap used the exact bell URL plus a visible `body` as its interim
success check. It saved a 0600 filtered state file beneath a 0700 external state
directory and removed the complete temporary profile.

A credential-free routine run then reused that saved state with no Google,
1Password, credential, repair, or operator capability. Its first pass exposed
that real PowerSchool markup contains normal active elements; after keeping
those elements inert with JavaScript disabled and all browser-side requests
aborted, the repeat completed both exact bounded reads and returned the
sanitized `not-found` normalization result for 2026-08-10. No raw page, private
schedule, screenshot, header, or response evidence was retained.

The user then confirmed that the requested Monday had no classes and that
classes started Tuesday. The sanitized `not-found` result was consistent with
an empty source day, but it also exposed that this collector version had not
yet mapped a verified zero-period response to the existing `no-classes` domain
state. The authentication/session-reuse and exact-read gate was proven. M-12
later corrected that normalization gap offline under an exact-date empty-AET
contract; it does not relabel the historical result as a live success. A
nonempty-day normalized observation and durable production bell marker remained
deferred at this checkpoint.

A later authorized M-10 attempt used policy recovered from checked-in legacy
configuration and located the retained state by filename/metadata without
opening it. The passive status read returned `session-state-rejected`; a second
sanitized classification check confirmed the same outcome. No SSO, Google,
credential, or repair capability ran in those checks.

The user then authorized a new operator-present bootstrap. The visible browser
reached the exact Tuesday bell page without presenting another sign-in prompt,
saved fresh filtered state, closed, and removed its temporary profile. A
credential-free routine read reused that state and produced one verified
three-period observation for 2026-08-11. This completes the deferred nonempty-
day normalization evidence; a durable production marker stronger than visible
`body` remains deferred. The subsequent M-10 `not-found` is a canonical mapping
difference, not a PowerSchool authentication or parser failure.

After the simplification, the complete `npm run check` and `git diff --check`
gates passed with 401 tests, 78 documentation links, 261 repository-safety
candidates, production build, smoke check, and 6/6 offline rehearsal jobs.
