# ADR-0018: Bounded production Calendar trial

- **Status:** Accepted
- **Date:** 2026-08-10
- **Milestone:** M-15

## Context

M-13 promoted the exact C509 Tuesday ownership audit and three hash-bound
legacy-event adoption dispositions. M-14 promoted an isolated writer after an
exact-scope non-production qualification. The user has now authorized M-15,
but production effects still require a narrower, reviewable execution approval.

The three production candidates are unmarked legacy events. Adoption therefore
cannot be inferred from title or description. The legacy OpenClaw writer must
also be inactive before the replacement obtains any mutation capability.

## Proposal

Use the already verified, owner-only `calendar.events.owned` writer grant as the
M-15 production-trial identity. It remains outside every service and routine
job. The trial is fixed to 2026-08-11, scope
`classroom-hub-c509-2026-27`, one non-primary Calendar, and the three exact M-13
candidate evidence hashes.

The trial has three separate commands:

1. **Prepare:** require the legacy writer to be disabled and quiescent, create
   and verify a fresh SQLite backup, read the exact plan and Calendar window,
   reproduce the approved M-13 candidate evidence set and classification, retain
   the promoted audit fingerprint as lineage, bind the fresh plan-specific
   audit, and perform an exact GET-only semantic no-op preflight. Persist the
   private snapshots outside the repository.
2. **Stage approval:** bind the prepared proposal, backup, exclusion evidence,
   code/build/dependency fingerprint, intent/adoption/no-op fingerprints, scope,
   target hash, and a maximum 15-minute lifetime. This performs no provider
   access.
3. **Execute:** require the operator-approved fingerprint, re-check legacy
   exclusion and every exact event with etags, then perform only the three
   approved description-normalizing replacements with `sendUpdates=none`.

Every event remains simple: no attendees, recurrence, conferences, attachments,
or location. The exact preflight/readback requires the three legacy events'
provider-default reminder policy, while the M-15-only patch omits reminders so
Google preserves them. No arbitrary reminder method, offset, or change is
admitted. The patch contains only the normalized description and three approved
private ownership keys; Google's documented patch semantics preserve omitted
fields and merge the new private keys without deleting unrelated keys. Durable
SQLite leases and journals make retry convergent. A failure immediately
restores each changed event's exact preflight fields while retaining the
explicitly approved Classroom Hub ownership marker; the retained marker
prevents future heuristic re-adoption.

## Alternatives

- Provision another production credential: rejected for this bounded trial;
  it adds sign-in and grant-management risk without reducing the already exact
  scope.
- Let M-15 infer adoption again: rejected; only the exact M-13 evidence set is
  eligible.
- Disable the legacy writer after mutation: rejected; exclusion is a
  prerequisite, not cleanup.
- Make M-15 an operational job: rejected; recurring operation belongs to later
  cutover milestones.

## Consequences and reversibility

The protected prepared state contains private event references and legacy
fields and must never enter logs, evidence, Git, or documentation. Checked-in
evidence contains only hashes, counts, finite codes, and timestamps.

Before execution, removing the prepared files and re-enabling the unchanged
legacy job is a complete rollback. After partial execution, automatic
compensation and exact readback must complete before legacy re-enable. After a
successful trial, user acceptance of evidence and rollback readiness remains
the M-15 promotion gate. This proposal does not authorize M-16 or recurring
production operation.

## Verification

- hostile config/state/filesystem targets fail closed;
- enabled, running, renamed, duplicated, or rescheduled legacy jobs fail closed;
- the exact three M-13 candidate references and clean classification must
  reproduce; the promoted audit hash remains lineage while the fresh
  plan-specific audit hash is separately approval-bound;
- preparation and staging prove zero provider mutations;
- event drift between preparation and execution refuses before mutation;
- injected partial failure restores earlier mutations exactly;
- the execute approval binds the complete source and compiled trees plus fixed
  dependency/config files; and
- no service, routine job, PowerSchool, Classroom, routing, or deployment path
  can import the M-15 capability.

## Acceptance

On 2026-08-10 the user accepted this decision and approved the exact
short-lived execution fingerprint. The bounded trial then completed three
approved replacements with exact readback, zero creates/deletes, no rollback,
and three retained rollback-ready snapshots. In a separate subsequent action,
the user accepted that evidence and explicitly promoted M-15. Neither action
authorizes M-16.
