# M-07A review package: synthetic direct PowerSchool adapter qualification

- **Status:** complete and independently reviewed; live characterization remains blocked
- **Date:** 2026-08-09
- **Baseline:** `61e2d699e8efa745ba1590e2465af5a3406f94a4`
- **External effects:** none authorized or claimed
- **Approval:** user-approved on 2026-08-09 as commit
  `8190805f4ecaebefa5fa40686fb7a9947ccd620e`

## Checkpoint boundary

M-07A is an entirely synthetic qualification of the direct PowerSchool adapter.
It may use only repository fixtures, disposable loopback servers, temporary
SQLite, and a temporary browser profile. It must stop after one clean local
commit. M-07B live characterization and M-08 Google Classroom work are outside
this checkpoint.

The user approved the M-06 commit
`61e2d699e8efa745ba1590e2465af5a3406f94a4` on 2026-08-09 before authorizing
M-07A.

## Selected technology

ADR-0010 accepts a repository-owned HTTP-first adapter with browser fallback:

- exact `playwright-core` 1.62.0;
- installed Google Chrome 150.0.7871.114;
- Node.js 24.15.0 built-in `fetch` for bounded same-origin reads;
- a dedicated protected persistent profile outside Git, SQLite, domain
  contracts, logs, fixtures, and application backups;
- cached authentication status by default, explicit non-login live probe, and
  a separate consent-bearing repair capability;
- passive same-origin `GET`/`HEAD` first, with browser fallback only for
  allowlisted dynamic surfaces.

The version tuple is supported here only by the synthetic evidence below. It
is not a statement that a real PowerSchool/SSO deployment has been tested.

### Why the dependency is material and justified

`playwright-core` provides installed-Chrome persistent-context control and
dynamic-page rendering without downloading browser binaries or introducing
the Playwright test runner. Node's built-in HTTP client remains sufficient for
ordinary same-origin reads. The alternatives were less suitable:

- browser-for-every-read increases resource use and mutation surface;
- HTTP-only/manual-cookie handling cannot cover dynamic pages or a controlled
  repair lifecycle safely;
- full `playwright`/`@playwright/test` adds browser-download or test-runner
  scope that the application does not need;
- an official read-only API remains a future replacement option if an
  authorized contract exposes the necessary bell surface.

Canonical references are recorded in [the generated tooling index](../tooling.md),
including the Playwright 1.62 release notes and persistent-context API and the
Node.js 24.15.0 `fetch` documentation.

## Required synthetic evidence

The completed candidate cites executable tests for all of the following:

1. Authenticated and expired sessions, cached versus explicit live status, a
   failed probe that preserves the prior success, and safe status provenance.
2. Passive acquisition that never initiates login, SSO, challenge response,
   form submission, or repair.
3. A separate repair capability contract with consent/no-consent, SSO/manual
   blocker, timeout, resumption, and redacted repair-required outcomes. M-07A
   uses a fake transport and does not expose an operator entry point or mutate a
   browser profile.
4. Same-origin HTTP success, auth redirect/401, cross-origin rejection,
   allowlisted dynamic-page browser fallback, bounded response/timeouts, and
   deterministic transport provenance.
5. Repeated authentication failures entering injected-clock cooloff, bounded
   cooloff responses without login churn, expiry/recovery, and success reset.
6. A synthetic server that records all requests and fails unexpected mutation
   methods; structural tests showing passive ports expose no form/action/body/
   arbitrary-method capability and browser fallback aborts non-read requests.
7. Minimum normalized schedule observations with freshness, verification,
   diagnostics, and redaction, followed through the existing canonical-plan
   pipeline.
8. Architecture/schema evidence that cookies, profile formats/paths, DOM,
   browser details, raw response bodies, and private student data cannot enter
   domain or SQLite contracts.
9. Resource cleanup, input immutability, deterministic retry/cooloff behavior,
   and no retained temporary profile or server artifact.

## Parity accounting

- **Synthetic qualification complete:** `PS-001` through `PS-009`, with every
  live/tenant-specific claim still assigned to M-07B.
- **Resolved by the offline decision:** `U-006`, through accepted ADR-0010 and
  the required synthetic spike evidence.
- **Preserved without product exposure:** `PS-010`, `PS-011`, and `U-001`.
  Student search and Scoresheet behavior are neither retired nor exposed by
  M-07A; a later product-scope decision remains necessary.
- **Later live evidence:** production origin/session/profile compatibility,
  real SSO and manual-blocker behavior, observed bell paths/layouts, and actual
  transport selection remain M-07B.

No line in this package may be interpreted as live-provider, credential,
protected-profile, private-school-data, source-write, Calendar, service,
routing, deployment, or human acceptance evidence.

## Limitations carried to M-07B

Synthetic markup and auth behavior can prove adapter policy and failure
handling but cannot establish the current routes, headers, cookies, SSO prompts,
dynamic rendering, response sizes, timing, rate expectations, or normalized
field sufficiency of a particular PowerSchool environment. Installed Chrome
compatibility also needs requalification after a browser or Playwright upgrade.

## Exact authorization required for M-07B

M-07B must not start from general credential or profile availability. A new
authorization must explicitly provide or approve all of these fields:

1. the exact PowerSchool environment/origin and whether it is production;
2. the read-only account identity/role and an opaque protected-profile
   reference, without placing credentials or cookies in the repository;
3. the exact allowlisted authentication-status and bell-schedule paths and the
   minimum fields that may be read;
4. the allowed date/time window, maximum requests, concurrency, timeout, and
   cooloff budget;
5. whether a single explicit interactive repair attempt is authorized, and
   which operator handles SSO, phone, challenge, or manual approval;
6. what sanitized evidence may be retained, for how long, and where outside
   Git/application SQLite it may be stored;
7. confirmation that form submission, source mutation, student search,
   Scoresheet access, raw capture retention, Calendar calls, services, routing,
   deployment, pushes, PRs, and M-08 remain excluded unless separately named.

If any field is absent, characterization remains blocked rather than inferred.

## Verification record

The final focused command compiled the test tree and ran the PowerSchool
adapter/authentication/repair/HTTP/browser, canonical acquisition,
architecture, and port suites: 50/50 tests passed. The suite used only local
loopback origins and temporary dedicated Chrome profiles, and cleanup completed.

The complete `npm run check` gate passed after the final corrections, including
documentation/tooling/link validation, fixture safety, repository operational
safety, formatting, strict application/client type checks, 327 tests,
production build, smoke, and the 6/6 offline operations rehearsal.
`git diff --check` passed. The tracked/untracked artifact audit found no database,
backup, log, key, certificate, cookie, browser-profile, credential, or generated
runtime file; the staging area was empty before the local commit.

Independent review found and drove corrections for overall timeout enforcement,
finite path and resource allowlists, GET-based mutation traps, browser response
budgets, cookie applicability, canonical date/verification authority, and
browser-operation quiescence. The final review found no remaining P0, P1, or
material P2 issue and no live/M-07B/M-08 scope breach.

No live provider, protected profile, credential, private school data, source
write, Calendar call, service, routing, or deployment state was accessed or
changed. M-08 did not begin.
