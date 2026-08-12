# M-13 review package: Calendar ownership audit without writes

- **Status:** promoted on 2026-08-10 after explicit user approval of the scope,
  three candidate dispositions, three future description-only replacements,
  dry-run evidence, and direct-grant deferral
- **Authorization:** the user established the remaining roadmap as an active
  goal and authorized autonomous safe offline and read-only progress on
  2026-08-10
- **Production boundary:** no Calendar writer credential or method, provider
  mutation, operational registration, deployment, route change, kiosk change,
  or M-14 execution

## Roadmap fit

M-13 follows promoted M-12 and begins the final Calendar preparation before
controlled writes. It gates M-14. M-13 can prepare and, when authorized, run a
read-only ownership audit; it cannot qualify a writer, alter Calendar, or begin
the non-production write trial.

M-14 through M-18 still cover a separately approved writer identity and
non-production scope, writer convergence/rollback, a bounded production trial,
cutover readiness, route and kiosk cutover, stabilization, and retirement. The
Calendar writer credential, non-production and production calendar scopes,
legacy-writer exclusion, production route, production kiosk runtime, cutover
owner, and retirement decision are deferred rather than completed.

## Governing decision

[ADR-0016](../decisions/0016-calendar-read-identity-and-ownership.md) accepts a
separate intended read-only Calendar grant and a strong three-property
application ownership marker for M-13. The protected reference's declared scope
is not treated as proof of actual OAuth authority; exact token authority remains
a direct live-verification gate. The ADR explicitly leaves M-14's writer
identity, scope, credential, and test calendar undecided. ADR-0011 continues to
prohibit reuse of the Classroom grant.

The implementation uses exact `@googleapis/calendar` 16.0.0. Google's official
authorization guide documents
`calendar.events.owned.readonly`; the official `events.list` reference documents
the bounded GET and private extended-property fields used by the audit. The
installed generated declarations were also inspected for the exact client
surface. Version 16.0.0 is recorded in the lockfile and official signed release
metadata.

## Offline implementation

- `src/config/google-calendar.ts` loads only an external protected-reference
  path, exact calendar and application scope IDs, and finite timeout,
  page/event, and window budgets.
- `src/infrastructure/google-calendar/official-client.ts` validates an
  owner-only, regular, single-link, exact-shape reference containing the sole
  read scope, then exposes only `events.list` with a fixed field mask, no
  request body, no automatic retries, and caller abort propagation.
- `src/infrastructure/google-calendar/adapter.ts` performs a finite paginated
  read and immediately reduces provider entries to timed semantic fields plus
  the three private ownership properties. Invalid and unsupported entries are
  counted so the audit fails closed.
- `src/infrastructure/google-calendar/audit-capability.ts` is the sole supported
  M-13 composition boundary. It binds the configured calendar, scope, fixed
  marker, budgets, named projection policy, read transport, and the verified
  plan's exact local-day window before any provider request. Callers cannot
  supply summaries, descriptions, or an alternate timezone.
- `src/application/calendar/projection-policy.ts` fixes block labels as event
  summaries and one normalized PowerSchool schedule description. It rejects
  empty, padded, multiline, noncanonical, or oversized labels plus wrong-day,
  partial-day, unverified, malformed, or uncovered plan input before source
  authority is constructed.
- `src/application/calendar/ownership-audit.ts` classifies verified ownership,
  explicit adoption, legacy candidates, ambiguity, and unrelated events. A
  partial marker, recurring instance, stale approval, unsafe provider entry, or
  unapproved legacy match suppresses all eligible intents. An approval is valid
  only for an exact desired match or the narrow historical description variant
  with exact summary, interval, and timezone; an approved historical variant is
  a proposed normalized-description replacement. The approval fingerprint
  binds the hashed calendar, scope, window, plan, desired set, every complete
  classified observation including ownership and recurrence, and every exact
  inert intent. Evidence is count/fingerprint-only and always reports zero
  external mutations.
- `src/application/calendar/lease-simulator.ts` rehearses acquisition, expiry,
  and conflict as a pure value operation with no durable or provider effect.

No application, shadow, display, job-registry, systemd, or command entrypoint
imports the M-13 capability. The existing Calendar intent planner remains inert;
M-13 makes no intent executable.

## Offline acceptance evidence

Focused tests cover:

- exact intended declared read scope and exact `events.list` parameters;
- protected-reference ownership, permissions, single-link, symlink, shape, and
  writer-scope rejection;
- bounded pagination, item/window limits, timeout/error classification, and
  authentication repair;
- minimal provider reduction, invalid-entry accounting, and all-day quarantine;
- verified ownership, exact no-op, explicit adoption binding, unrelated-event
  isolation, partial/recurring/stale/ambiguous blocking, and redacted evidence;
- fixed projection text, exact plan-local-day coverage, narrow legacy
  description adoption, and impossible offset-date rejection;
- pure lease acquisition, expiry, conflict, and malformed-input refusal; and
- architecture-level absence of writer, request body, command, operational,
  display, shadow, or deployment reachability.

The unified offline gate passes documentation, fixture and repository safety,
systemd verification, formatting, strict types, 502 tests, production build,
startup smoke, and the 6/6 offline operations rehearsal. Independent review
found no remaining material blocker after the projection, Unicode, timestamp,
fingerprint, and historical-description regressions were added.

## Open live gate

A bounded legacy-capability observation was completed without inspecting or
copying credential material. The exact Calendar reference embedded in the
authoritative legacy synchronization source was resolved in memory and queried
for 2026-08-10 through 2026-08-24 Asia/Ho_Chi_Minh. The reducer retained only a
Calendar-reference hash, counts, event evidence hashes, and an audit hash. It
observed 13 timed default events: zero new strong markers, 13 legacy-marker
candidates, zero ambiguous, zero unrelated, zero recurring, zero all-day, zero
cancelled, and zero malformed entries. It reported zero attempted and completed
mutations. The legacy wrapper has a broader read-command allowlist, so this is
ownership-inventory evidence only; it does not qualify the direct adapter's
grant or exact scope.

A second value-free read-only comparison used the isolated shadow's 2026-08-11
plan and the exact legacy target Calendar. All three plan meetings had one
unique exact start/end match among three Calendar events; all three summaries
matched their block labels and all three descriptions matched the legacy
description prefix. There were zero unmatched or ambiguous intervals and zero
mutations. The retained comparison fingerprint is
`sha256:465cae23fd9770926b23d41630de1b32440437c522e377aba405eabc2dbfc602`.
This supports the three Tuesday entries as adoption candidates but is not an
adoption approval and does not qualify the direct adapter's OAuth grant.

A final typed dry run used the proposed scope
`classroom-hub-c509-2026-27`, the exact 2026-08-11 local-day window, one bounded
legacy Calendar read, and the fixed composition boundary. It normalized three
events for three plan meetings with zero invalid or unsupported items. Without
approval it classified all three as legacy candidates, zero as ambiguous or
unrelated, emitted no eligible intents, and retained audit fingerprint
`sha256:2a5eb7e86b4fdc86e0aaac99d30546fcc23da8fdf0959828e6dd3ed6bdd822e7`.
The three candidate evidence references are:

- `sha256:1cc0428e43fee068393299224a75f7e41befc1555bb5f941d468bedbb839d44e`;
- `sha256:5bcedf493c20736cf55a6ffddcdb346b16659a6eac9af14db9be8b6f6fa07d48`;
- `sha256:fcc7cb5deb007c521cdf8d60e10513e63e3ec9f12239fdc983cc939596063898`.

A hypothetical, explicitly non-approved hash-bound adoption classified all
three as adopted and proposed exactly three normalized-description replacement
intents: zero creates, deletes, or no-ops; zero blockers; and fingerprint
`sha256:fa6e2dc6a00422b500ab4a56dcb004e535c109083d892145a93b1fb7423c3206`.
Both passes reported zero attempted and completed external mutations. This is
the approval evidence, not approval itself.

The direct grant's actual provider scope remains unverified and the direct
adapter was not called live. That adapter must not be operationally used until
its authority is independently verified. Because M-13 has no operational or
writer reachability, this qualification can remain deferred without another
sign-in if the user accepts that disposition during promotion.

On 2026-08-10 the user explicitly approved the M-13 proposal. At that time, the approval
accepts scope `classroom-hub-c509-2026-27`, the three hash-bound Tuesday legacy
candidate dispositions, their three future description-only replacements, the
dry-run evidence, M-13 promotion, and deferral of direct-grant verification
until before operational use. It does not authorize any Calendar write,
credential provisioning, deployment, or live M-14 execution.

## Deferred at M-13

- direct-adapter provider authority, live behavior, revocation, and renewal;
- M-14 writer identity, actual grant, credential, exact non-production
  Calendar, protected reference, and live provider qualification; these were
  subsequently qualified under the separate M-14 authorization and evidence;
- non-production mutation, rollback, notification suppression, and convergence,
  subsequently qualified by M-14;
- production trial, legacy-writer exclusion, routing, kiosk, cutover, and
  retirement.
