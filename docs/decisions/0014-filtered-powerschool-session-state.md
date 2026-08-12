# ADR-0014: Filtered PowerSchool session state and separate manual repair

- **Status:** Accepted
- **Date:** 2026-08-09
- **Supersedes:** [ADR-0010](0010-direct-powerschool-auth-adapter.md)
- **Decision scope:** offline session architecture; no live access authorization
- **Later qualification:** [ADR-0021](0021-persistent-powerschool-compatibility-lane.md)
  adds a separate higher-authority compatibility lane; this filtered passive
  lane remains unchanged.

## Context

ADR-0010 selected a repository-owned, read-only, HTTP-first PowerSchool adapter
with browser fallback and separate repair, but assumed a durable protected
Chrome profile. M-07B proved that merely launching Chrome mutates such a
profile and ended safely when the existing session required authentication.

A later operator-present prototype demonstrated a narrower method: complete
Google SSO once in a fresh visible Chrome profile, export only cookies belonging
to the PowerSchool host and storage for the exact PowerSchool origin, delete the
whole temporary profile, and reuse the filtered state for authenticated
headless status/bell reads. That prototype did not prove routine independence
from `op run`, long-term session behavior, scheduling, or deployment. Its mixed
checkout is evidence only and is not an integration source of record.

## Decision

Retain ADR-0010's read-only adapter, minimum normalization, and explicit repair
separation, but replace the durable Chrome-profile lifecycle with two distinct
capabilities:

- Manual bootstrap is an explicit operator-present entry point. It launches
  visible Chrome with a fresh temporary profile and exposes no credential
  retrieval or form-filling API. After the exact PowerSchool bell marker is
  visible, it atomically writes only filtered PowerSchool state into an
  owner-only directory outside the repository and deletes the profile on every
  outcome.
- Routine collection cannot import or receive credentials, 1Password, Google
  identity origins, repair callbacks, form actions, or generic navigation. It
  loads filtered state into a new temporary Chrome profile for every run,
  performs exactly the allowlisted status and bell `GET` reads with manual
  redirect rejection and finite response bounds, renders only the bounded HTML
  behind an all-network-abort route, and deletes the profile.
- State refresh is allowed only after both authenticated markers pass. The same
  origin/domain filtering, owner/mode validation, symlink rejection, size cap,
  atomic replacement, and single-process lock apply to initial and refreshed
  state.
- Both fixed workers run beneath a process-group supervisor with an overall
  deadline. The worker operation deadline ends five seconds earlier to reserve
  cleanup time. External aborts are propagated to the detached process group;
  graceful termination, forced teardown, and descendant-quiescence verification
  remain the outer boundary. Routine rendering runs with JavaScript disabled,
  downloads and service workers disabled, and all browser-side network requests
  aborted. Active provider markup is therefore inert while the exact bounded
  Node.js responses remain available for static parsing.
- Browser routing begins only after Chrome has started. The implementation must
  document this unavoidable startup-traffic limitation rather than claiming
  complete browser-process egress confinement.

The future Sunday-through-Friday 07:20 Asia/Ho_Chi_Minh cadence remains a
documented, inert requirement. This decision does not authorize a timer,
service, provider access, credential access, or live verification.

## Alternatives considered

- **Keep one durable Chrome profile for routine reads:** rejected because every
  launch mutates a large Google-bearing profile and expands backup, upgrade,
  lock, and credential-containment risk.
- **Automate Google credentials or invoke 1Password:** rejected because routine
  collection must remain useful without identity-repair authority, and an
  interactive provider challenge must fail closed to an operator.
- **Store cookies in application SQLite or configuration:** rejected because
  session material is protected runtime state, not domain/configuration data.
- **Use the durable state directory as Chrome profile storage:** rejected
  because incidental browser state would reintroduce the profile lifecycle this
  decision removes.

## Consequences

Routine collection has a much smaller authority boundary and can classify
missing, expired, revoked, or malformed state as repair-required without
attempting SSO. Operators use a separate visible repair: the original manual
bootstrap or the accepted ADR-0020 fixed-reference JIT capability. Neither is
reachable from routine collection.
Filtered state remains sensitive, external runtime material that is excluded
from Git, SQLite, fixtures, logs, screenshots, and backups unless a later
retention decision explicitly says otherwise.

The method still depends on provider cookie/session compatibility and the exact
Node.js, Playwright, and installed-Chrome tuple. The operator-present bootstrap
uses browser-native identity navigation because real SSO may require redirects,
posts, auxiliary origins, and additional tabs. It therefore does not claim
application-level request-origin, method, count, or response-byte confinement.
Its durable boundary is narrower: an overall deadline, a disposable profile,
an exact PowerSchool success marker, and PowerSchool-only filtered output.
Routine acquisition retains exact routes and hard request, byte, navigation,
and overall bounds.

## Verification implications

Offline qualification must prove filtering, cleanup on every outcome, exact
routine requests, marker/date parsing, state refresh, routine request/byte/deadline
bounds, routine redirect rejection, inert active-markup containment, hostile
filesystem rejection, deterministic concurrency refusal, architectural absence of
credential/repair dependencies, and process-tree quiescence. A later live gate
must separately authorize one operator-present bootstrap and then exact status
and bell reads from the saved state without 1Password, Google, or operator
involvement in the routine phase.
