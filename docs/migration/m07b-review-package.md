# M-07B review package: bounded PowerSchool characterization

- **Status:** implementation complete and independently reviewed; bounded live
  blocker characterization recorded as the checkpoint evidence
- **Date:** 2026-08-09
- **Baseline:** `8190805f4ecaebefa5fa40686fb7a9947ccd620e`
- **Approval:** user-approved on 2026-08-09 as commit
  `7582a820ebd3ae31df9a19131dabc5b35f93a665`
- **External effects:** one authorized managed-profile launch and one exact
  same-origin `GET`; no provider mutation, repair, or retained raw data

## Checkpoint boundary

M-07B may characterize only the accepted M-07A passive adapter against one
production TASV PowerSchool status surface and one bell-schedule surface. It
does not authorize authentication repair, student search, Scoresheet,
PowerSchool mutation, Calendar, services, routing, deployment, pushes, M-08, or
any recurring live read. The user approved M-07A commit
`8190805f4ecaebefa5fa40686fb7a9947ccd620e` on 2026-08-09 before authorizing
this checkpoint.

## Frozen authorization

The one-shot characterization contract is:

- exact production origin `https://tasv.powerschool.com`;
- existing TASV teacher/PowerTeacher session, without claiming provider-side
  least privilege;
- opaque managed profile name `powerschool` and the exact locked M-07A
  Playwright/Chrome integration; the filesystem path remains outside Git and
  retained evidence;
- authentication status path `/teachers/home.html`;
- bell path `/teachers/aet_schedulebell.html` with only
  `target_date=08/10/2026` for the authorized 2026-08-10 date;
- final replacement live window 2026-08-09 04:24–05:24 UTC, explicitly
  superseding the earlier windows; maximum eight top-level reads, concurrency
  one, ten
  seconds per read/navigation, and 120 seconds total;
- `GET`/`HEAD` only at the passive transport boundary, with the fixed live
  characterization source further restricted to `GET`; no body, form, generic
  navigation, retry after an
  authentication failure, off-origin redirect, SSO/manual flow, or repair;
- a 30-minute cooloff after the first authentication failure;
- no PS-010 student search or PS-011 Scoresheet access; and
- sanitized evidence only, outside Git and application SQLite, retained for at
  most seven days.

The actual run must stop on any policy, request, profile-lock, authentication,
origin, path/query, mutation, private-data, raw-retention, byte, timeout,
concurrency, or redaction uncertainty. A bounded failure with zero further
provider access is a valid safe outcome.

## Protected-profile preflight

M-07A deliberately accepts disposable temporary profiles only. Before adding a
managed-profile launch path, a synthetic no-navigation experiment used the
same `playwright-core` persistent-context API and the authorized Chrome
executable against a new disposable directory. Merely launching and closing
Chrome created 12 top-level profile artifacts. This confirms that ordinary
persistent-context use cannot prove filesystem immutability even when the
application exposes no login or page-action capability.

The initial M-07B authorization did not explicitly permit those incidental
writes. The implementation therefore kept the production profile unopened and
recorded a sanitized zero-request preflight instead of inferring permission,
copying or exporting the profile, or inventing an overlay workaround.

The production entrypoint consequently exposes only that source-less
preflight. The nonzero coordinator and its status/bell result projection are
synthetic qualification code, not a live executable composition: its ordinary
promise timeout cannot prove that an arbitrary non-cooperative source has
quiesced. A future authorization that permits managed-profile use must also add
and verify a process-level quiescence boundary before any nonzero provider run.
These are independent gates: permission for Chrome's incidental profile writes
alone is insufficient, and both must close before live source capability can be
constructed.

During an earlier, subsequently superseded 2026-08-09 window, the source-less
preflight ran at
2026-08-09T04:16:21.721Z and returned
`profile-write-not-authorized`. Its strict evidence records zero requests, no
selected transport, no surfaces, no normalized fields, no fingerprint, and a
deletion deadline of 2026-08-16T04:16:21.721Z. The record is retained only in
the executing task's assigned external `m07b` evidence directory. This is a
bounded stop result, not a live characterization and not sufficient to approve
or commit M-07B.

The next live attempt requires both:

1. explicit permission for Playwright/Chrome to acquire locks and make its
   unavoidable browser-managed incidental writes inside the named managed
   profile during one bounded launch/read/close session, without authorizing
   profile inspection, copying, backup, authentication repair, form actions,
   or any broader profile mutation; and
2. a verified process-level quiescence boundary that runs the live adapter in
   an isolated child process, clamps its lifetime to both the request budget and
   authorization window, terminates the complete browser process tree after a
   bounded grace interval, waits for confirmed exit before returning, and
   treats uncertain termination as a failed stop with no retry.

The user explicitly closed the first gate for one bounded run by authorizing
Chrome's unavoidable incidental writes inside the designated managed profile,
without authorizing inspection, copying, export, repair, form interaction, or
generic browsing. The implementation closed the second gate before profile or
provider access: the fixed live child runs in its own process group, receives
only the one profile reference and frozen policy, is bounded by the lesser of
120 seconds and the remaining authorization window, receives a graceful
termination signal followed by forced teardown, and is accepted only after the
complete process group is confirmed absent. Executable regressions cover
normal exit, a non-cooperative worker, and a non-cooperative descendant.

## Live characterization result

The authoritative host UTC clock read 2026-08-09T04:34:04.117Z immediately
before the supervised capability was constructed, inside the final authorized
window. The qualified runtime tuple was Node.js 24.15.0, npm 11.12.1,
`playwright-core` 1.62.0, and Google Chrome 150.0.7871.114, matching the locked
M-07A integration and project tooling record.

The supervised live attempt began at 2026-08-09T04:34:15.043Z and completed at
2026-08-09T04:34:16.178Z, entirely inside the final replacement window. It
made exactly one top-level request:

- method `GET`;
- approved authentication surface `/teachers/home.html` at the exact approved
  origin;
- `session-http` transport;
- authentication redirect classification; and
- 1132.460561 milliseconds, with zero response-body bytes retained.

The result was `authentication-required`. The runner entered cooloff through
2026-08-09T05:04:16.178Z and stopped immediately. It did not request the bell
surface, retry, navigate a browser page, invoke repair, follow an off-origin
redirect, submit a form, construct a request body, or access PS-010/PS-011.
The browser process group was confirmed quiescent before the supervisor
returned, and its temporary runtime home was removed. The outcome is the
authorized bounded blocker classification, not evidence of an authenticated
bell-schedule read or live schedule normalization.

## Future morning cadence requirement

The approved future schedule is Sunday through Friday at 07:20
Asia/Ho_Chi_Minh, with Saturday excluded. This is a requirement for Classroom
Hub's future standalone Linux application/service scheduling and must not be
delegated to ChatGPT, Codex, or OpenClaw. M-07B records the requirement only;
it adds no timer or scheduling implementation, leaves the manifest's cadence
pending, performs no recurring read, and does not change the active legacy
reader. Exact systemd syntax, missed-run behavior, executable ownership, and
activation remain later authorized design and deployment work.

## Retained evidence

Only sanitized JSON characterization records may be written beneath the
executing Codex task's assigned `m07b` visualization directory. It may contain
the outcome/category, UTC timestamps, safe surface IDs and methods, transport,
HTTP status, redirect class, response-byte and duration counts, normalized
field/count summaries, deterministic fingerprint, changed/no-op classification,
and redacted codes. Raw responses, DOM, screenshots, headers, cookies,
credentials, profile data/path, private identifiers, and unapproved URL/query
values are forbidden. The final record must state a deletion deadline no later
than seven days after the live attempt.

The zero-request preflight record expires at
2026-08-16T04:16:21.721Z. The live authentication-blocker record expires at
2026-08-16T04:34:16.178Z. Both are outside Git and application SQLite in the
executing task's assigned `m07b` evidence directory. Both pass the strict
runtime evidence validator; the live record reports one `GET`, one auth
surface, no normalized fields, no fingerprint, and no raw body.
The repository does not install a cleanup timer for task-owned evidence; the
task owner must remove these two external records by their stated deadlines.
That lifecycle requirement does not authorize any service or scheduler change.

## Verification and review record

Offline preparation and its earlier independent review were clean. The final
replacement window produced the genuine bounded live blocker result described
above after both profile and quiescence gates closed.

Final verification passed:

- focused characterization, child, supervisor, process-quiescence, source, and
  architecture suites;
- the complete `npm run check` gate with 364/364 tests, 70 documentation links,
  fixture and repository-safety checks, formatting, strict application and
  browser-client type-checking, production build, smoke test, and the 6/6
  offline operations rehearsal;
- strict validation of both external evidence records;
- `git diff --check`, empty staging, and secret/artifact scans; and
- independent review of the complete frozen diff after corrections, with no
  remaining P0/P1 or material P2 finding.

The review corrections cancel delayed process-group escalation before return,
bind the exact account-relative managed-profile identity independently of the
child's disposable `HOME`, resolve the repository root from the compiled
layout, reject `HEAD` at the fixed live source, and accurately distinguish the
superseded zero-request preflight window. No additional provider or profile
access was used to make these corrections.
