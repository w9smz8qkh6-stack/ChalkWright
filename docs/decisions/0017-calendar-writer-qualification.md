# ADR-0017: Isolated Calendar writer qualification

- **Status:** Accepted
- **Date:** 2026-08-10
- **Decision scope:** M-14 non-production writer qualification

## Context

Promoted M-13 proves read-only ownership classification and inert intent
planning. M-14 must test actual create, no-op, replace, delete, retry, lease,
receipt, and rollback behavior in a non-production Calendar before any
production writer trial. Completing M-13 did not authorize a writer.

On 2026-08-10 the user separately authorized offline M-14 writer code,
ownership guards, durable leases and journals, idempotency, receipts, rollback,
and synthetic tests. That authorization explicitly excludes credentials,
sign-in, Calendar API calls, live mutations, service activation, deployment,
and production access.

The user later named the isolated secondary Calendar **Auto Lesson 2**, approved
reuse of the protected Classroom OAuth client only to provision a separate
writer credential, and authorized the bounded non-production qualification.
The provider grant was verified as exactly `calendar.events.owned`; the
credential, target identifiers, and production deny reference remain outside
the repository.

Google documents `calendar.events.owned` as authority to view and mutate events
on calendars the user owns. The `events.insert`, `events.update`, and
`events.delete` references support `sendUpdates=none`; Google also warns that
using `none` can affect external-calendar synchronization. A no-notification
parameter is therefore not a sufficient safety boundary for events with guests
or external copies.

## Proposal

Use a second, separately provisioned installed-application OAuth grant for
M-14. Its intended sole scope is:

`https://www.googleapis.com/auth/calendar.events.owned`

The grant must not be the Classroom grant or M-13 read-only grant. Its actual
provider authority must be independently verified before use. The target must
be one exact, user-approved, non-primary, non-production Calendar owned by the
same account. Configuration must also reject the known production Calendar
reference by hash. The qualification used an owner-only, exact-shape external
credential reference and protected configuration for Auto Lesson 2. Reusing
the OAuth client did not reuse or widen the Classroom refresh grant.

The writer accepts only the existing typed Calendar intents plus an exact,
short-lived execution manifest. The top-level operator approval is itself
time-limited and binds the complete material protected configuration, hashed
credential/database references, action mode, exact sequence, and source/build/
dependency fingerprint. A run may start only when its complete overall deadline
fits inside the remaining approval lifetime; internal manifest expiry is also
capped to that top-level expiry. The internal manifest binds the non-production
environment, hashed Calendar reference, application scope, M-13 audit
fingerprint, complete intent-set fingerprint, exact intent IDs, issuance,
expiry, and approval ID. Dry-run is the command default. Execute mode requires
an explicit flag and approval fingerprint. `primary`, expired, augmented,
partial, duplicate, or drifted approvals fail before lease or provider access.

One SQLite lease exists per application scope. It has a finite expiry and exact
lease/owner identity. A sanitized journal records only SHA-256 references,
finite intent states, outcomes, and error codes; it stores no credential,
Calendar ID, event text, attendee data, or provider response. A completed
execution replays without provider access. An interrupted create uses a
deterministic Google-compatible event ID so the next run can observe and accept
the already-converged owned event rather than duplicate it.

Every replace or delete begins with a fresh read and requires all three private
ownership markers plus an etag. Replace uses full `events.update` with
`If-Match`; delete also uses `If-Match`. Create uses a deterministic event ID.
Automatic SDK retries are disabled; retry and convergence decisions belong to
the application journal. All mutations fix `sendUpdates` to `none`.

The admitted event body contains only ID where applicable, normalized summary,
fixed description, start/end with timezone, three private ownership markers,
and disabled reminders. The adapter rejects attendees, recurrence, conference
data, attachments, location, active/default reminders, recurring instances,
partial ownership, malformed responses, and arbitrary provider fields. This
keeps the `sendUpdates=none` warning outside the approved M-14 test surface.

Rollback preparation binds completed mutation steps to exact before snapshots.
Creates invert to deletion of the deterministic test event; replacements
restore the same strongly owned event. Google retains deleted custom event IDs
as cancelled tombstones, so a deleted event is restored under a fresh,
deterministic rollback ID and that restored copy is explicitly deleted during
final test cleanup. A
separate short-lived rollback approval binds the fully reconciled successful
source execution fingerprint,
recomputed rollback-evidence fingerprint, exact inverse-action fingerprint and
IDs, scope, hashed Calendar reference, and expiry. The executor obtains the
same scope lease, reads before every effect, rechecks all three ownership
markers, uses etags for delete/update, and uses a client-supplied compatible ID
only to restore an exact deleted-event snapshot. Missing replacement targets,
foreign/partial ownership, changed evidence, and augmented snapshots fail
closed. Failed or partial forward journals must first converge through the
forward executor; they cannot be presented as rollback evidence. Rollback has
its own restart-safe journal and sanitized receipt; an
interrupted effect converges by fresh read rather than duplicating the inverse.
No rollback action is eligible for a no-op or already-converged forward step.
The bounded live qualification proved this sequence in Auto Lesson 2 and ended
with zero owned test events. Independent review is clean. On 2026-08-10 the
user accepted this ADR, accepted the documented no-additional-live-noop
evidence disposition, and explicitly approved M-14 promotion.

Any failed qualification enters a fixed recovery path. It preflights all four
deterministic references, refuses any event whose complete ownership or admitted
test fields differ, and only then uses the same leased/journaled writer to
delete the exact owned test artifacts and verify an empty readback. A separate
recovery mode has its own approval fingerprint and cannot reuse execute
approval. This replaces the preliminary attempts' temporary cleanup scripts.

The exact generated client subset is implemented around an injected client for
synthetic verification. A separate qualification-only factory and entrypoint
load one owner-only exact-scope reference. Neither is reachable from a job,
systemd unit, service, route, deployment, or production writer path.

## Alternatives considered

- Reuse the M-13 read grant and request incremental write authority: rejected
  because it would collapse audit and mutation authority.
- Reuse the Classroom grant: rejected by ADR-0011 and least privilege.
- Accept `primary` as the test target: rejected because a configuration mistake
  could make the qualification a production write.
- Use provider automatic retries: rejected because ambiguous mutation outcomes
  require journal-aware read-before-retry convergence.
- Delete and recreate every changed event: rejected because it widens effects
  and weakens etag conflict detection.
- Treat `sendUpdates=none` as sufficient for events with guests: rejected by
  Google's documented warning and the broader event side effects involved.
- Persist full provider responses as receipts: rejected because M-14 needs only
  bounded outcome evidence and rollback inputs, not private Calendar content.

## Consequences

The offline implementation proves finite authority, exact body shape,
single-writer coordination, notification policy, replay, ownership refusal,
and injected-failure convergence. The separately authorized live qualification
also proved the exact grant, real non-production target, provider convergence,
cancelled-tombstone handling, rollback, and empty cleanup. It does not authorize
an operational writer or any production Calendar access.

The successful live run's no-op intent was inert but referenced no existing
provider event. The corrected flow now reads a seeded strongly owned exact match
and journals that same reference in its isolated no-op phase. This correction
is offline-qualified. The accepted evidence disposition requires no additional
M-14 provider proof and requires M-15 to perform an exact read-only semantic
no-op preflight before any production mutation.

Full-resource update intentionally canonicalizes approved, simple,
application-owned test events. Production adoption remains gated: M-15 must
repeat a bounded audit and must not apply this writer to an event with guests or
unsupported provider features.

## Reversibility

Before live qualification, removing the M-14 modules and schema migration has
no provider effect. During a later approved test, rollback may touch only exact
strongly marked test events in the named non-production Calendar. Removing the
writer reference disables all future provider access; the finite lease then
expires.

## Verification implications

- Verify exact `@googleapis/calendar` 16.0.0 generated types and official
  Calendar method/scope documentation before relying on the adapter.
- Prove dry-run default, exact execute-manifest validation, primary-target
  refusal, one durable lease, owner-safe release, restart persistence, and
  redacted corruption failure.
- Prove create/no-op/replace/delete, etags, deterministic IDs, fixed ownership,
  `sendUpdates=none`, no automatic retry, hostile ownership refusal, malformed
  response accounting, and convergence after an injected journal failure.
- Prove rollback plans only inverse completed owned mutations, requires a
  separate exact approval, shares the one-scope lease, journals/replays across
  restart, suppresses updates, and converges after an injected journal failure.
- Prove architecture-level absence from operational entrypoints, credentials,
  official client construction, systemd, deployment, and production routing.
- Before promotion, independently review the completed sanitized live evidence
  and every mutation/rollback/cleanup mapping, then obtain explicit acceptance
  of the no-additional-live-noop disposition, this ADR, and M-14 promotion. All
  four gates closed on 2026-08-10.
