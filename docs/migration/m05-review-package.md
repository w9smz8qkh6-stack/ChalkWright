# M-05 review package: B407 display and local controls

- **Status:** offline M-05 checkpoint complete; automated, independent review,
  and agent-inspected browser gates passed
- **Date:** 2026-08-09
- **Human visual approval:** not claimed; evidence prepared for user review
- **Baseline:** `a627eb82b2313f578b447840f59be1b986d73bb1`

## Scope delivered

This candidate implements only the offline, fixture-backed B407 product slice:

- an injected Node.js loopback HTTP transport and stable route/error contracts;
- server-rendered display and operator HTML, repository-owned CSS, SVG, WebM,
  manifest, and a bounded browser controller;
- all eight frozen display states, exact timing boundaries, deterministic
  coursework/objective/vocabulary/attendance fixtures, and scoped QR PNGs;
- SQLite-backed plan last-known-good state, date/screen overrides, and
  plan/meeting/screen carousel holds using temporary state only; and
- health/readiness, timeout/backoff/recovery, media ranges and fallback,
  startup, and graceful shutdown.

It does not contain provider adapters, live or legacy migration behavior,
Calendar execution, operational scheduling, service installation, routing,
deployment, or M-06 work.

## Architecture and authority

The domain and M-02 ports remain independent of HTTP, HTML, SQLite, providers,
and external writers. HTTP receives an injected controller and closed resource
maps. Presentation receives values and emits markup without persistence or
operator authority. The synthetic composition root alone joins fixture plans,
temporary SQLite, HTTP, and presentation.

Only `127.0.0.1` and `::1` may be bound. Reads start without a token; mutations
then fail closed with `operator_auth_unconfigured`. When locally configured,
the bounded bearer is accepted only in the Authorization header and compared
in constant time. It is never accepted in URLs/forms, persisted in browser
storage, or included in errors. Paths, segments, queries, bodies, deadlines,
resources, redirects, and media ranges are bounded.

## Determinism and mutation boundaries

Normal target reads acquire and semantically persist fixture plans so failure
can serve exact-scope last-known-good state. Readiness fails while any display
is degraded even when that state remains renderable. Preview uses a separate
read-only plan path, passes values into the M-03 preview composition, and never
calls plan, override, hold, or other writers. Pinned display previews disable
polling and use the selected fixture instant for clocks and countdowns.
Ordinary display time comes from an injected fixture clock anchored with
monotonic elapsed time; the client carries the server offset forward and
refreshes it after each successful poll. Only `/preview` accepts caller-pinned
time, so unauthenticated display reads cannot time-travel durable state.

Simulator meeting selection is validated against the effective plan before
class, content, attendance, QR, hold, and presentation data are selected.
Invalid meeting identities fail closed. Day-complete labels use the M-03
next-class-day selector over synthetic candidate plans.

Holds require complete plan/meeting/class/room/screen scope and revision-checked
transitions. Normal target evaluation audits timed expiry. Operator views keep
the terminal revision so a new hold can begin after expiry without resurrecting
history. Overrides and holds reload from SQLite and remain screen/date isolated.

## Assets, QR, and media

The QR encoder is dependency-free Version 4-L for bounded fixture URLs. Tests
verify deterministic PNG bytes, finder and timing structure, mandated `EC 11`
padding, payload bounds, and route scope. Independent matrix extraction
recovered the exact synthetic URL after the finder/timing correction.

The checked-in dismissal asset is a 63,887-byte VP8 WebM. Local Chrome verified
that it reaches `canplay`, advances playback, reports 960×540, and has a
2.966252-second duration. HTTP tests cover full, HEAD, `206`, open/suffix ranges,
and `416`. Readiness accepts only a bounded regular non-symlink WebM with the
EBML signature plus the reviewed exact byte length and SHA-256; missing,
malformed, same-size forged, directory, and symlink targets degrade safely
without preventing health inspection. Regeneration is fixed to the repository
asset and refuses to replace it with bytes outside the reviewed contract.

## Independent review corrections

The independent review found and the candidate corrected:

1. preview plan writes;
2. QR finder/timing corruption and reversed initial pad order;
3. host-clock timestamps on fixture-dated operator holds;
4. forced-meeting content/scope drift and unknown meeting acceptance;
5. polling and live clocks overriding pinned previews;
6. object/string disagreement in the target-state client contract;
7. incomplete original/effective preview evidence;
8. hard-coded next-class-day labels;
9. readiness remaining successful while last-known-good was serving;
10. contradictory/dead manifest sources;
11. unaudited timed-hold expiry that prevented a repeat lifecycle;
12. insufficient media readiness and an unconfined regeneration target; and
13. omission of the M-05 fixture source from the fixture-safety gate;
14. unauthenticated time-travel queries mutating hold expiry;
15. a non-advancing server clock that prevented ordinary timed expiry;
16. host-clock display/countdown drift from the synthetic server state;
17. page-render rather than click-time operator timestamps; and
18. non-monotonic elapsed-time calculation for the fixture clock;
19. stale-payload clock rewind during polling failure;
20. a hand-maintained browser JavaScript controller outside strict TypeScript;
21. successful last-known-good polling hiding the degraded-state warning; and
22. cross-day polling leaving the header date and document title stale;
23. a safe queried QR route being rejected by an over-narrow local-URL guard;
24. a 19-pixel large-TV vertical overflow caused by a fixed header estimate;
    and
25. undersized carousel-dot hit targets.

Each correction has an executable regression in the corresponding application,
HTTP, presentation, media, or fixture-safety suite. The browser controller's
authoritative source is strict TypeScript compiled by a dedicated DOM
configuration with no new dependency; its emitted ignored asset is the exact
file served and exercised by the VM harness. The harness covers pinned
clock/no-poll, state application, and monotonic failure-time behavior. Full DOM,
accessibility, network, console, and visual behavior is recorded in the browser
evidence below.

## Parity accounting

Offline contract evidence now directly addresses `ATT-003` through `ATT-005`,
`PRE-001` through `PRE-003`, `OVR-001` through `OVR-003`, `DISP-001` through
`DISP-009`, `HTTP-001` through `HTTP-003`, `MEDIA-001`, `MEDIA-002`,
`HEALTH-001`, `SEC-001`, and `SEC-002`.

This does not claim real attendance-source qualification, production operator
identity, proxy/header validation, production routes, live recovery, or visual
acceptance. Those later gates remain explicit in the executable parity map.

## Verification

The closing full `npm run check` passed 210/210 tests plus documentation,
fixture safety, formatting, strict application and DOM-client types, production
build, and smoke verification. The earlier focused M-05, architecture, parity,
QR, media, and client-runtime run passed 60/60. `git diff --check`, secret,
fixture, generated-artifact, and staging audits passed. A post-evidence
independent closure review is recorded below.

## Browser evidence gate

The in-app browser bridge reported no attachable browsers. With explicit user
approval, the fallback used repository-local headless Chrome 150.0.7871.114
against the disposable loopback fixture server. This is Chrome evidence, not
in-app-browser evidence. The final recapture used a fresh disposable profile
and a host-resolver rule that mapped every non-loopback hostname to `0.0.0.0`,
so external hosts were unreachable from the evidence browser.

The captured set contains all eight representative states at 1920×1080; the
preview, override, and hold views at 1366×768; a 683×384 effective 200% reflow
case; and reduced-motion evidence. The CDP record reports:

- exact 1920×1080 kiosk documents with no horizontal or vertical overflow;
- no console/runtime errors, external or unexpected requests, unnamed
  interactive controls, or broken images;
- a 320×320 rendered check-in QR from the expected 328-pixel local PNG;
- both local dismissal-media layers at `readyState` 4 with the reviewed
  2.966252-second duration;
- a visible solid focus outline, reduced-motion matching, and no horizontal
  overflow under effective 200% reflow; and
- successful authorized override save plus hold create, reload, and release.

Agent inspection found the corrected visual hierarchy readable in every state
and the operator views usable at both laptop and reflow viewports. The carousel
hit targets, QR rendering, and kiosk overflow defects found in the first pass
were corrected and recaptured. The only automated small-target report is the
native checkbox's internal 13-pixel box; its full-width labeled row is the
interactive target.

Evidence is retained outside Git in the private M-05 evidence directory.
`browser-evidence.json` is the machine-readable index and the adjacent PNGs are
the user-review set. Its host-specific location is intentionally not published.
Agent inspection is not human visual approval.

## Review record

- 2026-08-08: implementation assembled against accepted ADR-0009 using only
  synthetic fixture state and local loopback execution.
- 2026-08-08: targeted QR/media and complete independent code reviews found the
  material defects listed above; all were corrected with regressions.
- 2026-08-08: automated verification and final independent re-review passed
  after all corrections; browser evidence remains the sole closure gate.
- 2026-08-09: the user approved repository-local headless Chrome after the
  in-app bridge could not attach. The first visual pass found three material
  presentation defects; all were corrected with regressions and the complete
  evidence set was recaptured for user review.
- 2026-08-09: a fresh independent closure review inspected every PNG at original
  resolution, reran the 210-test gate, and found no remaining P0/P1 or material
  visual P2, no unsafe artifact or credential, and no M-06 or live scope.
