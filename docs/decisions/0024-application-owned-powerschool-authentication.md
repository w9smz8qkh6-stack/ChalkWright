# ADR-0024: Application-owned PowerSchool authentication lifecycle

- **Status:** Accepted
- **Date:** 2026-08-14

## Context

Chalkwright already performs routine PowerSchool reads through its own
read-only collector and stores only filtered, owner-only PowerSchool session
state. During M-17 recovery, however, the canary still imported that state from
the legacy OpenClaw-managed browser. That bridge proved migration continuity,
but it left authentication repair dependent on the application being replaced.

The repository already contains the accepted ADR-0020 JIT repair worker and
ADR-0021 persistent compatibility profile. They are isolated from routine
collection, resolve only fixed 1Password references, bind browser navigation to
PowerSchool and the configured identity origin, and save only filtered
PowerSchool state. The missing element is Chalkwright-owned production wiring.

## Decision

Chalkwright owns its PowerSchool authentication lifecycle:

1. Routine plan refresh remains credential-free and receives no repair,
   form-fill, 1Password, or operator-controlled navigation capability. After
   repeated live evidence showed that complete filtered cookie and site-state
   transfer could not reproduce the authenticated session, the M-17 plan
   reader uses Chalkwright's dedicated retained profile through the accepted
   ADR-0021 collector. That collector may perform browser-native silent OIDC
   only between the exact configured PowerSchool and identity origins; it
   cannot retrieve credentials or interact with identity forms.
2. A separate, operator-invoked service runs the existing JIT repair worker for
   the current `Asia/Ho_Chi_Minh` date. It has no timer and is never started by
   the routine plan unit.
3. Repair uses Chalkwright-scoped protected 1Password references, a dedicated
   service-account token, a dedicated retained compatibility profile, and the
   existing filtered canary session directory. These paths are outside the
   repository and inaccessible to unrelated provider and maintenance units.
4. A successful repair must be followed by a credential-free exact plan
   preflight. Authentication alone never qualifies provider data or activates
   the candidate.
5. The OpenClaw bridge is removed. Neither repair nor routine collection reads
   an OpenClaw file, process, profile, command, API, MCP tool, or output. The
   independently running legacy display remains only a rollback comparator.
6. CAPTCHA, passkey/security-key prompts, ambiguous account selection, recovery
   challenges, browser rejection, unknown origins, policy violations, and
   timeouts fail closed with sanitized result codes. No attempt bypasses a
   provider challenge.

## Consequences

- Chalkwright can renew and reuse its own PowerSchool browser-bound session
  without reading the legacy application's browser state.
- High-authority repair remains visibly separate from normal operation and can
  be audited or disabled independently.
- The retained profile contains sensitive Google-bearing browser state and is
  protected separately from both application SQLite and filtered PowerSchool
  state.
- A dedicated 1Password service account is an external credential dependency,
  but not a legacy-application dependency.
- Initial protected provisioning, one native live repair, and one subsequent
  credential-free plan read remain separately controlled live gates.

## Rejected alternatives

- **Import OpenClaw state indefinitely:** rejected because it prevents runtime
  independence.
- **Give routine collection repair credentials:** rejected because a passive
  read failure must not silently gain identity or secret authority.
- **Schedule unconditional daily repair:** rejected because valid sessions
  should not trigger unnecessary credential or identity-provider activity.
- **Copy a whole legacy browser profile:** rejected because it retains
  unrelated cookies, browser state, ownership ambiguity, and migration coupling.

## Verification

- Static architecture checks prove the retained-session plan entrypoint imports
  neither the repair entrypoint nor the 1Password resolver, rejects ambient
  repair authority, and is the only production job wired to the retained
  profile.
- Synthetic browser tests retain the exact-origin, method, challenge,
  temporary-state, cleanup, and secret-scrubbing boundaries from ADR-0020 and
  ADR-0021.
- The M-17 unit verifier requires an inert, no-timer repair service and exact
  plan services. Only repair and plan services can write the dedicated profile;
  plan services cannot access the protected repair provider directory.
- The additive provisioner creates only fixed owner-only Chalkwright paths and
  accepts only three distinct exact `op://` references plus one bounded service
  account token file.
- Live completion requires `authenticated` from native repair followed by a
  successful credential-free retained-session exact plan preflight, with no
  OpenClaw process or state access in either step.

## 2026-08-15 retained-session amendment

Native repair repeatedly completed successfully, but a fresh disposable context
still received an exact bell-page authentication redirect after full public and
locked-version cookie-partition state preservation. This does not by itself
prove a particular provider mechanism. Chrome's current official DBSC material
does establish that modern sessions can depend on browser-held key material and
that exported cookies alone need not reproduce them. Playwright's current
official persistent-context documentation establishes that the dedicated user
data directory retains browser session data and cannot be concurrently shared.
Exact Playwright 1.62 online documentation was not located, so locked local
types and the existing installed-Chrome synthetic test remain the
version-matched executable evidence.

The amendment therefore composes the already accepted ADR-0021 retained-profile
reader into M-17 rather than adding another authentication mechanism. The
historical module name contains “compatibility,” but the runtime profile,
entrypoint, systemd units, and data roots are all Chalkwright-owned. No legacy
runtime component is called or copied.

## 2026-08-20 permanent-production amendment

The permanent headed repair now runs in the desktop owner's real graphical
session with a fresh, disposable Chrome profile and retains only validated
PowerSchool state. A live repair authenticated without human approval, and the
following credential-free `production-plan-refresh` invocation consumed that
filtered state and stored the canonical local plan successfully. Permanent
production therefore uses the filtered-state reader and does not grant its
routine plan unit access to the Google-bearing retained-profile directory.

This supersedes the retained-profile choice only for permanent production,
based on the newer end-to-end production evidence. The historical M-17 canary
units and evidence remain unchanged. Repair still has no timer, routine reads
still have no credential or 1Password authority, and neither path depends on
OpenClaw.
