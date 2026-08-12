# ADR-0010: Direct PowerSchool browser/auth adapter

- **Status:** Superseded by [ADR-0014](0014-filtered-powerschool-session-state.md)
- **Date:** 2026-08-09
- **Decision scope:** offline adapter architecture; no live access authorization

## Context

Steady state must not depend on the OpenClaw browser runtime. Legacy behavior
uses a persistent isolated browser profile, same-origin HTTP where possible,
browser fallback, explicit SSO repair consent, bounded timeouts, and auth
cooloff. The direct technology and lifecycle therefore needed an offline
decision before any read-only characterization could be considered.

The bounded M-07A spike used only a local synthetic PowerSchool-like origin and
a temporary test profile. It exercised the exact locked/runtime combination of
`playwright-core` 1.62.0, installed Google Chrome 150.0.7871.114, and the Node.js
24.15.0 `fetch` implementation. This establishes repository-local synthetic
compatibility for that combination. It is not evidence about a PowerSchool
deployment, its SSO configuration, or future browser/library compatibility.

## Decision

Use a repository-owned read-only adapter with these boundaries:

- Lock `playwright-core` exactly and use the separately installed Chrome
  executable. `playwright-core` supplies persistent-context and dynamic-page
  browser control without downloading a second browser or adding a test runner.
- Keep the dedicated protected persistent-profile directory outside Git,
  SQLite, configuration payloads, domain contracts, logs, fixtures, and
  backups. Only an opaque profile reference may cross the infrastructure
  configuration boundary.
- Prefer bounded same-origin `GET`/`HEAD` HTTP reads using Node.js `fetch` when
  a valid authenticated context can safely supply the required session
  material. Use browser rendering only for explicitly allowlisted dynamic
  surfaces.
- Make the passive acquisition capability mechanically read-only: no generic
  navigation command, page-action callback, form operation, request-body
  option, or mutation method is exposed. Browser fallback aborts non-read
  requests. The synthetic origin fails any unexpected mutation method.
- Keep authentication status observation separate from repair. Cached status
  is the default; an explicit live probe remains bounded and non-login. Passive
  acquisition never attempts login, SSO, challenge response, or profile repair.
- Keep interactive repair behind a separate consent-bearing capability. M-07A
  qualifies that capability with a fake transport only; a callable operator
  entry point and Playwright repair implementation remain blocked until their
  profile-write boundary is separately authorized. Consent, manual approval,
  SSO/challenge blockers, timeout, and repair-required outcomes remain visible
  and redacted.
- Normalize only the minimum schedule observation fields required by the
  existing source port and canonical-plan pipeline. Profile layout, cookies,
  response bodies, DOM/browser details, and raw captures are infrastructure
  concerns and never enter domain or SQLite contracts.

M-07A qualifies this decision against synthetic evidence only. M-07B is a
separate, explicitly authorized, read-only characterization gate.

## Dependency value

The material addition is exact `playwright-core` 1.62.0. Its concrete value is
control of the installed Chrome persistent context for dynamic passive pages
while preserving a future separately authorized repair implementation boundary;
ordinary reads can continue using Node's built-in HTTP client. Using
`playwright-core`, rather than `playwright`
or `@playwright/test`, avoids a bundled browser download and an unnecessary
second test framework. The application still pays a browser/library
compatibility and protected-profile lifecycle cost, so upgrades require the
synthetic suite and a separately authorized read-only characterization before
promotion.

## Alternatives considered

- **Browser automation for every read:** rejected because it increases latency,
  resource use, dynamic behavior, and mutation exposure for surfaces that can
  be fetched safely with same-origin `GET`.
- **Session HTTP only with manually provisioned cookies:** rejected because it
  cannot reliably represent dynamic pages or the explicit repair lifecycle and
  encourages cookie handling outside the protected profile boundary.
- **Full `playwright` or `@playwright/test`:** rejected because M-07A needs the
  library API against installed Chrome, not downloaded browser binaries or a
  second test runner.
- **Official PowerSchool API:** remains preferable if a later authorized,
  least-privilege read-only contract exposes the required bell surface, but no
  such contract was available to the offline spike.
- **Transitional legacy/OpenClaw reads:** may assist later comparison but cannot
  remain a steady-state dependency.

## Consequences

Browser/library/Chrome compatibility becomes a reviewed version tuple.
Protected profile creation, permissions, locking, upgrade, backup exclusion,
and destruction need an operator-owned lifecycle outside application state.
Same-origin checks, allowlisted paths, timeouts, response bounds, redaction,
cooloff, and repair separation are security contracts rather than conventions.

M-07B preflight added one concrete lifecycle constraint: Chrome's persistent
context writes browser-managed lock/session/cache metadata even when the
adapter performs no navigation or DOM action. A protected-profile read
authorization must therefore either permit those incidental browser writes or
provide a separately approved profile mechanism that preserves the original;
the adapter must not infer that permission, copy the profile, or weaken the
boundary. This observation does not change the selected technology or authorize
repair.

The bounded M-07B characterization subsequently authorized those incidental
writes for one managed-profile session only. A fixed child process and
process-group supervisor enforced the 120-second/window deadline, forced
teardown, and confirmed quiescence before returning. The one live status GET
ended at an authentication-required redirect, so no bell read or browser
fallback occurred. This validates the safe blocker path, not authenticated
tenant layout or bell normalization.

The normalized source port preserves reversibility: another browser library or
an authorized official API may replace the adapter without changing domain or
SQLite schemas.

## Verification implications

M-07A must prove with a local synthetic origin and temporary profile:

- authenticated, expired, cached, live-probe, timeout, cooloff, recovery,
  SSO/manual-blocker, and explicit-repair classifications;
- same-origin HTTP selection and dynamic browser fallback;
- request-method enforcement and synthetic-server detection of any mutation;
- bounded/redacted provenance and minimum normalized observations;
- integration with the existing canonical-plan pipeline;
- absence of profile, cookie, browser, raw response, and secret fields from
  domain and SQLite contracts.

M-07B must repeat only the minimum read-only characterization that is
separately authorized. This ADR does not authorize or claim live PowerSchool,
credential, protected-profile, private-data, source-write, Calendar, service,
routing, or deployment access.
