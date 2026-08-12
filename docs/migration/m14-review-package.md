# M-14 review package: non-production Calendar writer qualification

- **Status:** promoted on 2026-08-10 after bounded Auto Lesson 2 live
  qualification, clean independent review, accepted no-additional-live-noop
  evidence disposition, and accepted ADR-0017
- **Authorization:** on 2026-08-10 the user authorized isolated offline writer
  construction, then separately authorized creation and use of Auto Lesson 2,
  a distinct exact-scope writer grant, and the bounded live lifecycle; the user
  subsequently accepted ADR-0017, the evidence disposition, and M-14 promotion
- **Excluded:** operational registration, service activation, deployment,
  production Calendar access, and M-15

## Roadmap fit

M-14 follows promoted M-13 and gates M-15. It proves the writer first in an
exact non-production scope. The approved test Calendar and separate
least-privilege writer grant have now completed bounded mutation, readback,
rollback, and cleanup. Independent review is clean, and the user closed the
evidence-disposition, ADR, and promotion gates on 2026-08-10.

The live gate was a separately authorized one-off evidence action before the
ADR was accepted. The user later accepted the ADR and evidence disposition and
explicitly promoted M-14. That sequencing exception does not authorize any
later writer use.

M-15 remains the bounded production trial. M-16 through M-18 remain cutover
rehearsal, production switch, stabilization, and retirement. None has begun.

## Governing proposal and exact-version evidence

[ADR-0017](../decisions/0017-calendar-writer-qualification.md) is accepted. It
defines the separate writer grant, exact owned-event write scope, non-primary
test Calendar, finite approval, three-marker ownership, etags, deterministic
IDs, simple event shape, suppressed updates, durable coordination, and rollback
boundary. The live gate used Auto Lesson 2, an owner-only external writer
reference, a protected exact-shape configuration, and a production-target deny
hash. Protected values are not retained here.

The installed dependency is exact `@googleapis/calendar` 16.0.0. Its generated
types were inspected for `events.get`, `insert`, `update`, and `delete`, request
bodies, and `sendUpdates`. Google's current official
[authorization guide](https://developers.google.com/workspace/calendar/api/auth),
[insert reference](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert),
[update reference](https://developers.google.com/workspace/calendar/api/v3/reference/events/update),
[delete reference](https://developers.google.com/workspace/calendar/api/v3/reference/events/delete),
and [extended-properties guide](https://developers.google.com/workspace/calendar/api/guides/extended-properties)
were checked before live use. The actual token authority was verified as the
single exact `calendar.events.owned` scope.

## Implementation

- `src/application/calendar/writer-qualification.ts` validates an exact
  short-lived approval, refuses `primary`, acquires one lease, performs
  read-before-mutate convergence, journals each step, and emits sanitized
  counts/hashes. Completed approvals replay without provider access.
- `src/ports/calendar-mutation-transport.ts` exposes only exact event get,
  insert, update, and delete. Request types cannot express attendees,
  recurrence, conferences, attachments, location, reminders, arbitrary bodies,
  or notification modes other than `none`.
- `src/infrastructure/google-calendar/offline-writer-adapter.ts` maps that port
  to exact generated-client method shapes around an injected client. It
  independently validates the non-primary target, request shape, IDs, etags,
  ownership, normalized event body, timeout, signal, and fixed notification
  mode before client access.
- `src/infrastructure/google-calendar/official-writer-client.ts` is a
  qualification-only factory for one exact owner-only external authorized-user
  reference. It accepts exactly the owned-events writer scope and is imported
  only by the separately invoked M-14 qualification entrypoint.
- `src/ports/calendar-execution-state.ts`,
  `src/infrastructure/sqlite/calendar-execution-state.ts`, and schema migration
  5 provide one expiring lease per scope plus restart-safe hash-only journals.
- `src/application/calendar/reconciliation-command.ts` makes dry-run the
  default and accepts execute only with an exact approval fingerprint.
- `src/application/calendar/rollback-planner.ts` derives inverse actions only
  for completed, strongly owned mutations with exact before snapshots. Deleted
  custom IDs restore under a fresh deterministic ID because Google retains
  cancelled tombstones for deleted IDs.
- `src/application/calendar/rollback-qualification.ts` recomputes that plan,
  requires a successful reconciled forward journal and separate short-lived
  rollback approval, obtains the same scope lease, rechecks ownership before
  every effect, journals sanitized outcomes, and converges on retry.
- `src/application/calendar/live-qualification.ts` and its entrypoint bind one
  fresh run ID, exact target/deny hashes, complete budgets, a 15-minute approval
  window, hashed credential/database references, action mode, and exact source,
  executed build, and dependency identity. The full overall deadline must fit
  before approval expiry, and no internal manifest can outlive it. They include injected journal
  failure, a seeded exact-owned no-op phase, readback, rollback, restored-copy
  cleanup, automatic partial-failure recovery, and final empty readback.
- `src/application/planning/calendar-intents.ts` strips the planner-only
  `desiredId` before placing desired fields in the frozen mutation contract.

No job registry, shadow process, systemd artifact, service, production route,
or M-15 path imports these M-14 capabilities.

## Offline evidence

Focused synthetic tests prove:

- exact create/no-op/replace/delete with fixed `sendUpdates=none`;
- deterministic create and restore IDs, conditional etags, complete ownership
  markers, fixed minimal event bodies, and cancelled-tombstone handling;
- rejection of primary, expired, augmented, partial, duplicated, and drifted
  approvals before capability access;
- distinct execute/recovery approvals bound to every material configuration
  field and source/build/dependency identity;
- foreign ownership refusal before mutation;
- one durable scope lease, competitor refusal, expiry recovery, and owner-safe
  release;
- restart-safe sanitized journal round-trip and corrupt-row failure;
- no provider access on completed replay;
- convergence without a duplicate after the provider changed but the success
  journal write failed;
- exact rollback delete/update/restore-insert, restored-copy cleanup,
  ownership/etag refusal, journal-failure convergence, and restart replay;
- automatic cleanup after an ordinary partial failure, plus a separately
  approved exact-reference recovery mode that refuses foreign artifacts before
  any mutation;
- dry-run command parsing and rejection of generic/force/primary arguments; and
- architecture-level absence from operational services and production routing.

The complete repository `npm run check` gate passes 545 tests plus documentation
links/changelog, fixture safety, operations and repository-safety verifiers,
formatting, strict server/client types, production builds, startup smoke, and
the six-job offline rehearsal. `git diff --check` is clean.

## Sanitized live qualification evidence

The user approved reuse of the already protected Classroom OAuth client solely
to provision a separate writer refresh credential. Provider introspection
verified one exact `calendar.events.owned` grant. The target was the named
secondary Calendar Auto Lesson 2; configuration rejected `primary` and the
known production target by hash.

Two bounded preliminary attempts failed closed and improved the implementation.
The first exposed that Google returns a cancelled tombstone for an exact read of
a deleted custom event ID. The second proved that the same custom ID cannot be
reinserted after deletion. Each attempt was followed by an ownership-checked
cleanup that left zero owned test events. The implementation now treats an
exact cancelled tombstone as absent, restores a deleted snapshot under a fresh
deterministic rollback ID, and explicitly deletes that restored copy during
final cleanup.

The fresh final run completed the approved lifecycle:

- five forward provider mutations across setup and
  create/no-op/replace/delete execution;
- one deliberately injected post-mutation journal failure, followed by a
  successful read-before-retry convergence with no duplicate;
- exact event readback before rollback;
- four rollback provider mutations, including the fresh-ID deleted-event
  restoration;
- one final ownership-checked cleanup mutation for that restored copy; and
- zero remaining owned test events across all four deterministic references.

The run's no-op intent proved zero mutation but used a synthetic absent
reference, so it did not prove an exact semantic no-op against an existing
provider event. The corrected flow now performs a post-seed exact ownership and
field read, then journals that same reference in a separate no-op phase before
the later replacement. Synthetic tests prove this binding and preserve the five
forward/four rollback/one cleanup mutation counts. This correction has not been
re-run against Google and is not presented as historical live evidence.

Every mutation fixed `sendUpdates=none`; the admitted body had no attendee,
recurrence, conference, attachment, location, or active reminder capability.
The evidence retains only finite statuses, counts, target/reference hashes, and
execution fingerprints. No Calendar ID, credential, token, account identifier,
event response, or private provider content is checked in. Production Calendar,
PowerSchool, Classroom, services, routing, and deployment were untouched.

## Promotion disposition

On 2026-08-10 the user accepted ADR-0017, accepted the
no-additional-live-noop disposition, and explicitly approved M-14 promotion.
The historical live limitation remains disclosed, the corrected exact
owned-event read and non-action are proved offline, and M-15 must perform the
exact read-only semantic no-op preflight before any production mutation.

M-14 promotion does not authorize M-15. Its production trial remains a
separate user-authorized gate.
