# ADR-0021: Persistent PowerSchool compatibility lane

- **Status:** Accepted
- **Date:** 2026-08-12
- **Qualifies:** [ADR-0014](0014-filtered-powerschool-session-state.md) and
  [ADR-0020](0020-just-in-time-powerschool-repair.md)
- **Decision scope:** separate read-only compatibility capability; no live use,
  service activation, deployment, or provider access authorization

## Context

ADR-0014 deliberately replaced a durable Google-bearing browser profile with
filtered PowerSchool-only state. That remains the preferred passive design, but
live evidence now shows that the tenant redirects a current filtered session to
its OIDC login path while the proven legacy OpenClaw lane remains authenticated
through a dedicated persistent Chrome profile. Repeated attempts to reproduce
Google authentication in a new disposable browser have also imposed an
unreasonable operator burden without improving readiness.

The user therefore accepted importing the legacy lane's complete schedule-read
and authentication lifecycle as a bounded compatibility option. This is a
conscious security trade-off: the compatibility profile retains Google identity
state as well as PowerSchool session state. It does not authorize importing the
legacy lane's student, grade, scoresheet, raw-capture, gateway-management, or
generic browser-control capabilities.

## Decision

Add a fourth, separately invoked PowerSchool capability:

1. It uses one dedicated owner-only Chrome user-data directory outside the
   repository and separate from ADR-0014 filtered state. The application rejects
   unsafe paths, symlinks, wrong ownership/modes, and concurrent launches.
2. Its routine reader may perform browser-native silent OIDC through the exact
   configured PowerSchool and Google identity origins, then read only the exact
   approved status and dated bell pages. It receives no credential values,
   1Password references, repair callback, or form-filling API. If visible
   identity, TOTP, phone, passkey, CAPTCHA, recovery, or other interaction is
   required, it returns a sanitized repair-required result.
3. The explicit ADR-0020 operator-present JIT entrypoint may target the same
   dedicated profile. Only that repair supervisor can resolve the three fixed
   1Password references; it scrubs the profile setting and all secret authority
   before launching the browser worker. The profile is retained after repair,
   while the original ADR-0020 disposable mode remains available unchanged.
4. Both paths share the pre-navigation HTTP/WebSocket, popup, download, origin,
   method, and top-level-navigation guard. They retain the fixed process-group
   deadline, cleanup reserve, signal propagation, and descendant-quiescence
   boundary. The compatibility collector still normalizes through the existing
   M-07A/M-07B observation adapter and domain contract.
5. No raw page, response, screenshot, HAR, video, header, credential, student,
   grade, or scoresheet data is persisted. The persistent profile itself is
   sensitive runtime state: it is excluded from Git, SQLite, evidence, logs,
   fixtures, and ordinary backups and must never be inspected or copied by
   Classroom Hub.
6. The lane remains opt-in and absent from every service, timer, production job,
   Calendar path, and route. Selecting an existing legacy profile or activating
   this lane requires a later exact-path, single-owner lifecycle decision and
   separately authorized read-only verification.

M-17's accepted ADR-0024 amendment now selects this lane for Chalkwright's two
plan services after native repair plus complete filtered-state transfer could
not reproduce the browser-bound session in a disposable profile. That later
selection does not adopt a legacy profile: it uses only the dedicated
Chalkwright-owned profile created by native repair. The plan entrypoint remains
credential-, repair-, and form-free, and every unrelated unit is denied access
to the retained profile.

The profile must not be launched concurrently by OpenClaw and Classroom Hub.
No profile copy or migration is implied. A later operator may either designate
the existing legacy managed profile under an exclusive handoff or create a new
dedicated compatibility profile; that choice is deliberately outside this
offline decision.

## Alternatives considered

- **Require another manual sign-in:** rejected as the default because the user
  has already repeated that interaction many times and the proven persistent
  lane exists.
- **Keep retrying disposable automated Google authentication:** rejected after
  bounded attempts failed closed at Google's browser policy boundary.
- **Broaden the passive filtered collector:** rejected because it would give the
  least-authority routine path identity-origin and active-browser capability.
- **Import the whole legacy plugin:** rejected because its student/grade reads,
  raw captures, shell environment sourcing, gateway coupling, and historical
  `--no-sandbox` launcher exceed the schedule-reader requirement.

## Consequences

The compatibility lane is more operationally reliable but has greater retained
authority than ADR-0014. Profile theft could expose a Google session; backups,
permissions, process ownership, lock discipline, and host compromise therefore
matter more. The separate entrypoint and unwired status make that authority
visible and reversible. Disabling it requires no schema or domain change, and
the filtered passive collector remains available.

Installed Playwright Core 1.62.0 types support `launchPersistentContext` with a
dedicated `userDataDir`; current official Playwright documentation confirms
that the directory stores cookies/local storage, that closing the context closes
the browser, that concurrent instances cannot share it, and that the ordinary
Chrome default profile must not be automated. Exact 1.62 online documentation
was not located, so locked local types plus synthetic Chrome 150 evidence are
the exact-version authority; the current reference is
<https://playwright.dev/docs/api/class-browsertype#browser-type-launch-persistent-context>.

Browser-native SSO also cannot impose a true pre-transfer cap on an undeclared
or encoded response body. Declared oversized responses fail closed, request and
navigation counts remain finite, and the overall process deadline is enforced,
but this limitation must not be described as a hard aggregate byte cap.

## Verification implications

Offline qualification requires real installed-Chrome synthetic tests for fixed
credential repair into the persistent profile, silent identity-session reuse
after the PowerSchool cookie is cleared, exact status/bell reads, normalization,
interactive-state refusal, credential/environment scrubbing, filesystem and
lock rejection, request/popup/WebSocket/download boundaries, timeouts, and
architecture isolation from services and later provider writers.

The next live gate is not another manual sign-in. It requires a separately
authorized exact persistent-profile target/lifecycle decision, confirmation
that no other process owns the profile, then one read-only compatibility run for
the current Asia/Ho_Chi_Minh date. Any interactive identity state stops for an
operator decision; it does not trigger automatic credential use.

## Live compatibility disposition

The authorized preflight found the proven profile already owned by a healthy
OpenClaw 2026.6.11 browser. Classroom Hub correctly did not launch the same
user-data directory. The user-approved temporary alternative used the legacy
lane's fixed interfaces: the initial current-date read stopped at
repair-required, one non-forced repair authenticated without manual sign-in,
and the conditional 2026-08-12 read returned four periods via session HTTP.
Only status, date, count, and source were retained, with zero PowerSchool
business-data mutation.

This proves the user's requested proven compatibility method and closes the
M-16 current-date schedule-read gate. It does not select a repository-owned
profile lifecycle or authorize concurrent launch. Because installed OpenClaw
exposes no documented direct fixed-tool gateway RPC, the one-time gate used a
non-delivering agent turn; that LLM/transcript path is evidence only and must
not become the production bridge.
