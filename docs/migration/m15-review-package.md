# M-15 review package: bounded production Calendar trial

- **Status:** promoted on 2026-08-10 after explicit evidence acceptance
- **Authorization:** on 2026-08-10 the user explicitly authorized M-15 and
  asked work to continue non-interactively until genuine input is required
- **Exact mutation gate:** ADR-0018 and execution fingerprint
  `sha256:986269fe1a505d055b456d4ee0e5eda6b5ff159873bb28adbc5326e333e3345c`
  accepted on 2026-08-10
- **Excluded:** recurring operation, service/timer activation, PowerSchool or
  Classroom writes, TV routing, deployment, M-16, commit, push, and PR

## Roadmap fit

M-15 follows promoted M-14 and gates Stage E. It is one bounded production
writer trial, not cutover. M-16 through M-18 remain separately authorized
rehearsal, cutover, stabilization, and retirement work.

## Fixed scope

- date: 2026-08-11;
- timezone: Asia/Ho_Chi_Minh;
- scope: `classroom-hub-c509-2026-27`;
- one hash-bound non-primary production Calendar;
- the three exact candidate evidence references promoted in M-13;
- three description-only replacements, zero creates and zero deletes; and
- fixed `sendUpdates=none` with no attendee, recurrence, conference,
  attachment, or location capability. One exact `provider-default` literal
  verifies the events' existing reminder policy; the fixed patch omits
  reminders and unrelated private properties so Google preserves them. Methods,
  offsets, and arbitrary reminder changes remain unrepresentable.

The checked-in package intentionally omits Calendar IDs, event references,
event text/times, etags, OAuth material, protected paths, and raw provider
responses.

## Implementation boundary

`src/application/calendar/production-trial.ts` reproduces the exact three M-13
candidate evidence references and clean legacy-candidate classification,
retains the promoted audit fingerprint as lineage, binds the fresh
plan-specific audit, derives only the approved adoption set, performs per-event
GET-only semantic no-op checks, binds a protected prepared proposal, executes
three one-intent durable writer transactions, performs exact readback, and
compensates partial failure.

The M-15 transport adds only an etag-conditional fixed patch for the normalized
description/three ownership keys and exact restoration of the approved legacy
description. Google's documented patch semantics preserve omitted event fields
and unrelated private keys. The official transport pair is imported only by
the separate M-15 entrypoint. Routine services/jobs have no path to it.

The entrypoint is split into `--prepare`, `--stage-approval`, and an exact
fingerprint `--execute`. Preparation requires a fresh verified SQLite backup
and a disabled, quiescent fixed OpenClaw legacy writer. Prepared snapshots and
approval are owner-only, single-link, atomic external JSON; execution state is
a separate owner-only SQLite database.

## Evidence classes

### Promoted evidence reused

- M-13's exact audit fingerprint and three candidate evidence references;
- M-13's user-approved adoption and future description normalization;
- M-14's exact `calendar.events.owned` grant and writer/rollback qualification;
- the accepted M-14 disposition requiring an exact existing-event GET/no-op
  preflight before any M-15 mutation.

### Offline M-15 evidence

Focused tests prove exact preparation, three bounded adoptions,
zero-mutation drift refusal, automatic compensation after an injected later
failure, strict protected JSON/config boundaries, exact legacy exclusion, and
the M-15-only transport/architecture boundary. The full repository gate is
clean.

### Authorized read-only production evidence

The fixed OpenClaw legacy writer is disabled and quiescent. Authorized Calendar
list and exact-event GET reads reproduced the three promoted M-13 candidate
evidence references with three legacy candidates and no creates, deletes,
ambiguities, or unrelated events. The reads also established that the events
use provider-default reminders and contain unrelated private metadata. The
M-15-only fixed patch therefore omits those fields and preserves them according
to the provider's documented patch semantics.

The final GET-only semantic no-op preflight completed with zero attempted and
zero completed provider mutations. At `2026-08-10T15:40:42.022Z` it wrote an
owner-only prepared proposal for three replacements with fingerprint
`sha256:4550d0c1620025aa558fc7b50fab7d43344e6e53d01ba045a3a3f8b24a86e2fb`.
The user accepted ADR-0018 and the exact short-lived execution fingerprint.

### Bounded production execution evidence

Execution completed all three approved replacements and exact readback:

- attempted external mutations: 3;
- completed external mutations: 3;
- creates/deletes: 0;
- rollback attempted/completed: 0/0;
- replacement receipts: 3 distinct sanitized execution fingerprints;
- rollback-ready snapshots: 3; and
- final code: `m15-production-trial-succeeded`.

The protected backup, proposal, approval, journal, and rollback snapshots are
retained outside the repository. The legacy writer remains disabled and
quiescent. No recurring operation, service/timer activation, deployment, TV
routing, PowerSchool/Classroom write, or M-16 action occurred.

## Rollback

Before mutation: discard the protected proposal and re-enable the unchanged
legacy writer after confirming no M-15 process or lease exists.

After a failed mutation: keep the legacy writer disabled, allow exact automatic
compensation/readback to finish, inspect only sanitized evidence, and do not
re-enable legacy operation until all three references are back at an accepted
legacy-field state and no M-15 lease/process remains. A retained approved
ownership marker is intentional.

After success: retain the backup and protected manifest through the next
separately authorized rehearsal/cutover decision. The user accepted the trial
evidence and rollback readiness and explicitly promoted M-15 on 2026-08-10.
Any M-16 action remains a separate decision.
