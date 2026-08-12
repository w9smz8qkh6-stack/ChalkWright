# ADR-0020: Just-in-time PowerSchool session repair

- **Status:** Accepted
- **Date:** 2026-08-10
- **Would amend:** [ADR-0014](0014-filtered-powerschool-session-state.md)
- **Decision scope:** repair capability only; routine collection remains unchanged
- **Later qualification:** [ADR-0021](0021-persistent-powerschool-compatibility-lane.md)
  permits this explicit repair worker to target a separate retained
  compatibility profile; disposable repair remains the default.

## Context

ADR-0014 correctly removed credentials, Google identity, form actions, and a
durable browser profile from routine PowerSchool collection. Its manual-only
repair entrypoint also caused the operator to repeat the same interactive sign-
in many times during migration. The proven legacy plugin has a narrower useful
property: after explicit operator consent it can retrieve fixed 1Password
references just in time, fill the ordinary Google sign-in and TOTP steps, wait
passively when Google requires phone approval, verify the PowerSchool session,
and then return to unattended session reuse.

The legacy implementation also carries properties that do not belong in the
replacement: a persistent Google-bearing Chrome profile, gateway/browser
restart coupling, environment-file sourcing, and broad cookie handling. This
decision adapts the method, not those implementation details.

## Decision

Keep routine collection exactly as ADR-0014 defines it. It must remain unable
to import, receive, or invoke 1Password, credentials, Google repair, identity
forms, or generic navigation. A routine authentication failure still returns
`repair-required` and stops every later Calendar action.

Add a separate repair capability. The user accepted this decision and
authorized its offline implementation on 2026-08-10:

1. A human explicitly starts one bounded repair and confirms operator presence.
   No service, timer, health check, or routine collector may invoke it.
2. A fixed supervisor loads only owner-only references to the pre-approved
   1Password item fields. Vault/item/field selection is not caller-controlled.
3. Exact username, password, and TOTP values are retrieved just in time through
   the installed, version-verified 1Password CLI. They are never placed in Git,
   SQLite, command arguments, durable environment files, logs, screenshots,
   evidence, or retained browser state.
4. The supervisor sends the minimum values to one disposable visible-browser
   child through a bounded ephemeral channel, closes that channel immediately,
   scrubs its own copies, and never exposes them to routine code.
5. The child may navigate only the approved Google identity flow and exact
   PowerSchool origin, fill only the expected identity/TOTP controls, and wait
   without clicking when phone approval or another interactive challenge is
   required. Unknown pages, fields, origins, popups, or challenges stop safely.
6. Success still requires the exact PowerSchool bell-page marker. The child
   exports only PowerSchool-domain cookies and exact-origin storage under
   ADR-0014's protected-state rules, then deletes the entire temporary profile
   on every success, failure, abort, and timeout path.
7. The supervisor enforces one repair at a time, a finite overall deadline,
   request and response budgets where browser-native SSO permits them, process-
   group teardown, descendant quiescence, and sanitized terminal evidence.

This decision is not credential authority. The current authorization covers
only offline implementation and synthetic verification. 1Password reference
provisioning, any secret lookup, and one live repair remain separately
authorized actions.

## Alternatives considered

- **Keep manual-only repair:** lowest implementation authority, but repeats a
  burdensome flow despite the existing fixed-reference method.
- **Reuse the legacy persistent profile:** rejected because it retains Google
  state and reintroduces profile lifecycle, backup, lock, and gateway coupling.
- **Run routine collection under `op run`:** rejected because it gives routine
  reads ambient credential authority and fails the independence boundary.
- **Store Google credentials or TOTP seeds in application configuration:**
  rejected because references, not secret values, are the maximum durable
  authority the application may hold.

## Consequences

If accepted and later implemented, ordinary expiry repair can be much less
interactive while routine collection remains 1Password-independent. Google may
still require phone approval or introduce a new challenge; those cases remain
operator-present and fail closed rather than being bypassed.

The repair module becomes a high-authority component requiring stricter review
than the passive collector. It must remain absent from production server,
scheduler, provider-refresh, and Calendar-writer import graphs.

## Offline implementation disposition

The authorized offline implementation is complete in the clean integration
lane. The supervisor requires a literal operator-presence flag, loads one
owner-only external exact-shape reference payload, calls fixed `/usr/bin/op`
`read` arguments, overwrites parent buffers after encoding, and supplies one
bounded stdin packet to a fixed process-group worker. The worker uses a new
mode-`0700` disposable profile, recognizes the bounded identity/TOTP states,
waits passively on phone approval, verifies the exact bell marker, writes only
ADR-0014-filtered PowerSchool state, and removes the profile on every exit.

The locked browser tuple is Playwright Core 1.62.0 with Chrome
150.0.7871.114. The installed 1Password CLI is 2.34.1; official 2.x release
notes and secret-reference documentation support the fixed `op read` and
`attribute=otp` contracts. Synthetic tests exercise success, credential-free
routine reuse, phone approval, rejected credentials, unknown challenge,
foreign popup, fixed references, ephemeral transfer/overwrite, abort, timeout,
concurrency, and cleanup. Browser-native SSO does not provide a hard cap for an
undeclared response body, so the implementation rejects declared oversized
responses but retains that limitation as a live stop condition rather than
claiming a complete transfer cap.

No protected reference was created or read, no 1Password authentication was
attempted, and no provider request occurred under this offline authorization.

## Later authorized headless refinement

During M-16, repeated desktop-app approval and a crashed graphical session made
the initial JIT mechanism operationally equivalent to the manual burden this
decision was intended to remove. The user explicitly authorized one bounded
headless repair using the existing protected legacy 1Password service account.
This refines only the repair supervisor:

- one optional absolute owner-only file outside the repository is parsed as
  inert environment data; it is never sourced or evaluated as shell;
- only `OP_SERVICE_ACCOUNT_TOKEN` is admitted, with bounded token syntax,
  single-link/ownership/mode/path checks, and post-use buffer overwrite;
- the token reaches only the three fixed `op read` subprocesses and is deleted
  before the browser worker is created;
- the supervisor selects headless Chrome only after that protected authority is
  successfully loaded; the literal operator-presence acknowledgement, exact
  references/origins, deadline, disposable profile, marker verification, and
  PowerSchool-only state filtering remain unchanged; and
- routine collection, services, schedulers, Calendar paths, and the browser
  worker never receive the service-account token or its file path.

The legacy service account's complete vault grant is not inferred or claimed
from application behavior. Classroom Hub's exercised authority remains bounded
at its own layer by the three fixed references; a 1Password-side permission
audit is a separate provider action if ever required.

## Reversibility

The isolated implementation is removable without changing filtered state
format or routine collection. Falling back to ADR-0014's manual bootstrap
remains possible at all times.

## Verification implications

Before any live use, require exact-version 1Password CLI and browser contracts;
synthetic tests for fixed-reference selection, ephemeral secret transfer and
scrubbing, expected field/TOTP handling, passive phone-challenge waiting,
unknown-page refusal, filtered output, profile cleanup on every outcome,
timeouts, aborts, concurrency, process-tree quiescence, and architecture tests
proving routine/service/scheduler/Calendar paths cannot reach repair or secret
authority. Live verification must be one separately approved operator-present
repair followed by credential-free routine status and bell reads.

The first post-grace retry did not write replacement state, and the immediate
credential-free read still reported expired state. Because the exact final
sanitized worker classification was lost during a cross-task handoff, this
decision records only the observable non-success and does not infer a narrower
Google state. A subsequent source-only comparison with the proven legacy lane
added two more finite recognized actions on the identity origin's exact
challenge-selection path: `Enter your password` and the explicit authenticator
code option. Synthetic Chrome covers that complete sequence; unknown markup
continues to fail closed. No further live attempt is implied or authorized by
this offline refinement.

The user later separately authorized one attempt with those challenge-selection
choices. It again completed the fixed service-account-backed reads without a
desktop prompt, but failed closed at `unexpected-challenge` and wrote no state.
One more source-only comparison found that the replacement still did not press
the legacy lane's explicit `Try another way` control before looking for the
authenticator option. The replacement now permits that named transition once,
then returns to the exact challenge-selection policy. Synthetic Chrome covers
the security-key-to-alternatives-to-TOTP path. A later separately authorized
bounded attempt exercised it but
again returned `unexpected-challenge`, wrote no state, and was not repeated.
The legacy source also contains a separate headed/noVNC launcher, but its
repair-completion path explicitly configures headless CDP. The headed launcher's
durable profile and `--no-sandbox` contract remain outside this decision and do
not justify weakening the replacement boundary.

A separately authorized diagnostic refinement makes every
`unexpected-challenge` result carry one closed value-free category while
retaining no page text, URL, title, screenshot, selector inventory, or provider
value. Missing, augmented, or unknown categories are rejected at the worker
IPC boundary. This changes only sanitized diagnosis; it grants no additional
browser action or automatic retry.

The one separately authorized categorized attempt returned `browser-rejected`
after the fixed 1Password reads completed without a desktop prompt. It wrote no
state and caused no provider mutation. Further selector or challenge-state
retries are therefore unjustified. Any direct-CDP fresh-profile alternative
must be designed, version-verified, and reviewed separately without importing
the legacy durable profile or `--no-sandbox`; otherwise ADR-0014's manual
bootstrap remains the fallback.

## Offline direct-CDP refinement

The user subsequently authorized that alternative for offline implementation
only. Installed Chrome 150 now starts directly on `about:blank` with its sandbox
enabled, a new mode-`0700` user-data directory, and an ephemeral loopback CDP
port. Locked Playwright Core 1.62 attaches to the existing process and creates a
download-disabled, service-worker-blocked ephemeral context. The existing
context-wide HTTP/WebSocket, popup, method, origin, navigation-count, declared
byte, exact-marker, filtering, deadline, and process-group boundaries remain in
force before the first application navigation. The endpoint file is read with
no-follow, owner, single-link, regular-file, size, port, and browser-target
validation. Cleanup closes the context and CDP browser, terminates a surviving
Chrome parent, relies on the enclosing process-group supervisor for descendant
quiescence, and deletes the complete fresh profile.

Chrome startup precedes application routing and therefore is not claimed to be
fully network-confined. The design reduces background startup activity and
navigates initially only to `about:blank`. Synthetic localhost tests against
the exact installed Chrome verify the selected attach and cleanup behavior.
This is not live provider evidence and grants no retry; a provider attempt and
subsequent credential-free routine read remain separately authorized gates.

That live gate was subsequently authorized once for 2026-08-11. The direct-CDP
candidate still received Google's sanitized `browser-rejected` classification
before the exact PowerSchool marker. It wrote no replacement state, and the
conditional credential-free routine read was not invoked. Cleanup left no
disposable profile or Chrome process. The direct-launch hypothesis is therefore
not promoted, and this decision grants no further retry.

A separately authorized one-time legacy bridge then used OpenClaw 2026.6.11's
named browser-profile cookie interface without inspecting or copying the
profile. Classroom Hub retained only 11 PowerSchool-host cookies, wrote them
through the ADR-0014 filter, and discarded the captured envelope. A conditional
credential-free routine read was allowed and returned
`repair-required/session-state-rejected`. The bridge therefore does not satisfy
the live-readiness gate and is not adopted as routine or repair architecture.
No legacy repair or Google authentication was attempted.

The user later authorized one invocation of the legacy lane's established
`repair_auth` capability followed by the same filtered bridge and a
credential-free read. Its preflight found the managed profile already
authenticated, so no credential retrieval, Google authentication, or new login
occurred. The repeated filtered export retained 11 PowerSchool-host cookies and
no origin storage. The replacement routine collector then completed its exact
status and 2026-08-11 bell reads without any credential, 1Password, Google,
repair, or operator capability and returned a fresh verified three-period C509
observation. This is valid live evidence for filtered-state reuse and M-16
read capability. Asia/Ho_Chi_Minh local time was already 2026-08-12, so the
requested 2026-08-11 schedule is prior-day evidence and does not establish a
fresh current-day plan. It is not evidence that Classroom Hub's replacement
JIT browser repaired a rejected session, and the legacy profile/bridge remains
a transitional recovery aid rather than adopted steady-state architecture.

One separately authorized current-local-date routine read then requested
2026-08-12 from the saved filtered state. It failed closed with
`repair-required/session-state-rejected` and did not invoke repair, Google,
1Password, credentials, or a retry. The prior-day success therefore does not
establish filtered-session longevity or fresh current-day readiness. No manual
sign-in was requested.
