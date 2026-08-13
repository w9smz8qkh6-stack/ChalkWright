# Changelog

This file records consequential changes to Chalkwright (formerly Classroom
Hub). It follows the
principles of Keep a Changelog without treating Git history as a second commit
log. Trivial formatting and behavior-neutral refactors are intentionally
omitted.

## [Unreleased]

### Changed

- Prepared the M-17 candidate snapshot for public portfolio review: host-specific
  migration inputs now come from protected references, private Tailnet hostnames
  are excluded from source while their operational boundary remains hash-bound,
  the README reflects the live-qualified but unpromoted canary honestly, and
  publication checks reject personal home roots and private Tailnet URLs.

- Replaced the host-specific M-17 Calendar provisioning source with the generic
  protected migration handoff
  `/etc/chalkwright/migration/google-calendar-writer-config.json`, keeping
  operator-specific home paths out of the publishable repository.

- Restored the accepted legacy during-class header bell: while class content is
  active, the upper-right status group now shows the original bell silhouette
  beside a ceiling-rounded count of minutes until the official class end. The
  value advances from the client clock without rebuilding the scene, briefly
  shimmers only when the minute changes, exposes an exact accessible label,
  respects reduced-motion preferences, and clears outside class-content state.
  The adjacent current-time clock now also matches the legacy display by
  showing hour and minute only while retaining second-level evaluation
  internally. Its date precedes the clock on the same row, and the bell badge
  is vertically centered against the clock instead of appearing as a
  subscript. The redundant lower-left “Dismissal begins” countdown is no longer
  rendered during class content.

- Activated the isolated M-17 parallel canary on corrected release
  `sha256:9986bbad0d320eea5dfe0b5fe705441a1927815f185767a6d24c9781789a8362`
  for the exact 2026-08-13 12:20 through 2026-08-20 12:20
  Asia/Ho_Chi_Minh window. The activation passed plan, Classroom, integrity,
  verified-backup, server health/readiness, and manifest gates; created exactly
  three owned events in `Auto Lesson 2`; and started five isolated timers. A
  second reconciliation observed all three events and completed zero mutations.
  The separate Tailnet HTTPS route on port 14443 is healthy and ready, while the
  legacy 9443 route, Calendar, units, state, alerts, and Fully Kiosk URL remain
  unchanged. M-17 remains in observation and is not promoted.

- Corrected the live presentation label projection discovered during the first
  canary display check. A verified meeting such as `Robotics (IC008.1)` now
  renders the human title `Robotics` only when its parenthesized section code
  normalizes to the meeting's exact course key; mismatched suffixes remain
  intact and code-only inputs retain their normalized fallback.

- Prevented unchanged 30-second display polls from replacing the complete scene
  DOM and replaying its media fade. Healthy polls now update clock and status
  metadata in place unless the rendered presentation fragment actually changes.

- Closed the deferred end-of-day preview gap exposed by the physical canary.
  The existing read-only PowerSchool refresh now scans at most seven subsequent
  dates, stores verified no-class days without presenting them as class days,
  and stops at the first verified non-empty future plan. The `day_complete`
  scene can therefore show the next loaded class day across weekends and short
  holidays without fabricating a schedule.

- Added an inactive-only, exact-predecessor M-17 release upgrade path and a
  recoverable fixed disposition for the failed zero-mutation activation
  manifest, so the bounded Calendar intent-identity correction can be installed
  without reusing or overwriting approved evidence.

- Corrected the M-17 Calendar writer's bounded deterministic intent identity
  contract after the first activation attempt failed closed with
  `calendar-write-input-invalid`. Real intent IDs compose plan, scope, and
  meeting identities and may exceed the generic 128-character identifier
  limit; writer approvals and durable journal steps now consistently allow at
  most 512 safe characters, while provider event IDs remain fixed SHA-256-based
  values. Forward-only migration 6 rebuilds only the journal-step table with
  that bound and preserves existing rows. The failed attempt completed zero
  mutations, stopped the candidate server, and left every candidate timer and
  route inactive.

- Completed the authorized M-17 read-only live-preflight sequence without a new
  PowerSchool sign-in. The existing legacy persistent browser passively renewed
  its session; the strict bridge retained eleven PowerSchool cookies plus one
  exact-origin local-storage record; and the canary plan and active-Classroom
  preflights succeeded. The secondary `Auto Lesson 2` audit observed zero
  events, proposed three intents, and attempted no mutations. A bounded
  provider-inaccessible loopback comparison then matched three legacy and
  candidate meetings using the established course-name-plus-section-code UI
  label, with zero semantic differences and retained evidence fingerprint
  `sha256:77071f2349eaf2a95ba25bdf1ee7236caa1251210cfdb666de01a49a70ba69af`.
  Candidate Calendar semantics in that comparison are the three planned
  reconciliation intents, while the separate provider preflight observed zero
  existing events. A first protected activation manifest was bound but rejected
  before use because its seven-day window began before activation; it must be
  recoverably superseded immediately before any separately authorized
  activation, and none of its inactive elapsed time counts as canary coverage.
  No activation, routing, timer, Calendar mutation, or Fully Kiosk change
  followed.

- Added a fixed, operator-only M-17 recovery bridge for the explicitly
  authorized legacy PowerSchool compatibility path. It binds the installed
  OpenClaw 2026.6.11 read-only cookie interface and its generic evaluation
  interface with one scanner-bound read-only expression containing no mutation
  or network operation. It keeps the envelopes in memory, atomically binds local
  storage to the returned document origin, requires both that origin and the
  response URL to match the configured PowerSchool origin, drops root before
  application imports, and filters cookies plus bounded exact-origin local
  storage through the strict
  PowerSchool-only validator, and atomically refreshes only the isolated canary
  session state without profile copying or password, 1Password, or Google
  credential access.

- Added a create-once, release-bound M-17 SQLite initializer after the first
  live preflight exposed that inert provisioning created the isolated
  directories but left the required canary database absent. The initializer
  drops root authority before importing application code and has no provider,
  service, route, or legacy-state capability.

- Completed the first M-17 live-preflight stage with isolated protected
  provisioning, exact digest-bound inert installation, and a validated
  privilege-dropped filtered PowerSchool state copy. The copy retained eleven
  PowerSchool cookies and no origin storage, browser profile, Google state, or
  provider request; all units remain stopped and routing remains unchanged.

- Adopted Chalkwright as the public product, package, UI, documentation, and
  future repository name while retaining existing `CLASSROOM_HUB_*`,
  `classroom-hub` runtime paths, compatibility URLs, and ownership markers for
  a later tested deprecation migration. Historical evidence keeps its original
  name. Removed both uncleared videos from the distributable tree and replaced
  the bundled-media requirement with an optional external, exact-size,
  SHA-256-bound site-media reference and healthy poster fallback.

- Recorded the post-stabilization open-source distribution goal: one versioned
  human-facing non-secret configuration and guided setup/validation workflow
  should generate the strict protected runtime contracts without requiring
  implementers to edit source, systemd units, or internal JSON. Secrets, OAuth
  grants, browser profiles, provider tokens, and live-target defaults remain
  excluded. This does not expand or renumber M-17/M-18.

- Accepted ADR-0022 and amended M-17 from an immediate production handoff to a
  two-gate parallel canary followed by a separately approved final handoff. The
  canary design keeps the legacy URL, Calendar, schedules, alerts, and state
  authoritative while Classroom Hub uses a separate Tailnet URL, manually
  created secondary owned Calendar with primary/legacy deny binding, distinct
  state/services/timers, staggered read-only acquisition, and report-only
  alerts. The exact observation duration and final Calendar disposition remain
  later decisions. No deployment, protected-reference access, provider action,
  route, service, scheduler, alert, or Fully Kiosk change was authorized or
  performed.

### Added

- Added the offline M-17 parallel-canary package: distinct Chalkwright
  configuration/state/release roots, inert hardened services and staggered
  timers, an exact `Auto Lesson 2` writer with primary/legacy deny binding,
  durable lease/journal/idempotency reuse, a filtered-state-only PowerSchool
  copier, protected provisioning, digest-bound release/install tooling, and a
  candidate-only stop path that quiesces every timer and in-flight oneshot.
  Activation now requires provider-inaccessible SQLite integrity and verified
  backup jobs before readiness/Calendar reconciliation, with separate nightly
  maintenance timers. Synthetic tests cover cross-target drift,
  malformed Calendar evidence, convergence, unsafe config/state, and unit
  activation drift. No protected reference, provider, service, route, or kiosk
  action is part of this offline change.

- Adopted the OSI-approved Apache License 2.0 for the future Chalkwright public
  source release, including the canonical license text and package SPDX
  metadata. This license decision does not grant redistribution rights to the
  separately gated private deployment videos.

- Added a public-preview publication gate, least-privilege GitHub CI workflow,
  portable CI gate, security and conduct policies, structured issue and pull
  request templates, release/version policy, executable value-free publication
  and reachable-history audits with adversarial tests, public configuration
  guide, generalized deployment paths, reproducible synthetic display
  screenshot evidence, weekly npm/GitHub Actions Dependabot coverage, a clean
  current dependency audit, a value-free reachable-history scanner and
  clean-root publication plan, direct/transitive dependency notices, portable
  Git/editor attributes, and explicit repository metadata.
  The curated public root excludes private migration history and private media;
  visibility remains conditional on the exact remote CI gate.

- Added an offline-only M-16 alert-authority provisioner. It SHA-binds the
  fixed legacy operations source, extracts one destination without evaluating
  source code, validates the separate owner-only bot-token file, atomically
  writes only three fixed service-owned files, overwrites value buffers, and
  has no network, Telegram, service, timer, subprocess, or routing capability.
  Synthetic tests cover source drift, duplicate/malformed destinations,
  malformed tokens, fixed separate paths, and inertness. It has not been
  applied; no protected value was read, migrated, printed, or delivered.
  Added a separate one-shot qualification entrypoint that accepts only a fixed
  reference and literal non-operational test text, rejects ambient provider
  authority, reports finite counters/codes, and remains unreachable from all
  jobs and services. After the user approved its exact fingerprint, the inert
  release installed from its bound predecessor, three protected files were
  created without printing values or making a provider request, and the single
  fixed message was delivered with zero service, route, or application-state
  changes. It was not retried and remains unwired from routine operation.

- Completed the separately authorized M-16 transient candidate and physical
  Fully Kiosk smoke without replacing the legacy route. A strict in-memory
  bridge retained 11 PowerSchool-only cookies from the already-authenticated
  legacy browser interface; the current-date production plan job succeeded,
  the inactive Classroom job skipped before source construction, and display,
  health, and readiness returned 200 from the pinned release. A separate
  non-Funnel Tailnet listener exposed the candidate temporarily. The first
  pinned preview mapping intercepted CSS/image subpaths and rendered unstyled;
  corrected local asset routes returned 200 and the user's physical-device
  photo confirmed the styled in-class composition without visible clipping.
  The preview handlers and candidate listener were removed, the legacy display
  remained healthy, and zero Calendar requests or provider writes occurred.
  The live-time `day_complete` waiting copy records the already-deferred evening
  next-class-day source rather than a missing current-day plan. The later exact
  host-native alert qualification, recipient confirmation, and explicit final
  runbook/target/recovery/candidate approval closed the remaining gates, and
  the user promoted M-16. M-17 remains unauthorized.

- Added and executed the separately authorized inert M-16 production
  provisioner. It created a non-login service identity, owner-only core
  directories, five protected configuration/reference files, and an
  unextracted SHA-bound runtime archive while printing no protected values,
  making zero provider requests, and installing or starting no production
  unit. Alert delivery, executable deployment, routing, and TV changes remain
  deferred.

- Accepted ADR-0021 and implemented its offline-only persistent PowerSchool
  compatibility lane after the filtered session repeatedly reached the tenant's
  documented OIDC login path. A separate unwired supervisor/worker now uses one
  protected external Chrome profile for browser-native silent OIDC and exact
  status/bell reads, with no credential, 1Password, form-fill, student, grade,
  service, timer, Calendar, or production-job capability. The explicit JIT
  repair command may target that profile while scrubbing its setting and all
  secret authority from the browser environment. Real installed Chrome 150
  synthetic tests prove fixed credential repair, retained identity state,
  cleared-PowerSchool-cookie renewal, two independent exact reads, existing
  schedule normalization, and interactive-state refusal. That offline
  qualification accessed no live profile, credential, provider, service,
  deployment, or M-17 capability; exact profile ownership and a current-date
  read were still M-16 gates at that checkpoint.
  A later authorized gate preserved the running legacy profile under OpenClaw
  ownership, stopped after an initial repair-required result, then used one
  explicitly authorized non-forced legacy repair. It authenticated without a
  manual sign-in, and the conditional read returned four periods for
  2026-08-12 through session HTTP. Repository evidence retains only
  status/date/count/source. No raw schedule, student/grade surface, profile
  content, credential, or PowerSchool business-data mutation was retained or
  performed. This closes the temporary current-date compatibility read gate;
  repository-owned profile handoff and service wiring remain deferred.

- Began the authorized offline/read-only M-16 cutover rehearsal. Added an exact
  16-step configuration/backup/writer/service/timer/route/smoke/rollback
  manifest, SHA-bound sanitized target references, one-writer enforcement,
  exact target-proposal byte binding across all five reference classes and the
  complete implementation fingerprint,
  automatic rollback after forward failure, a disposable real SQLite
  backup/integrity/restore exercise, and a full eight-state loopback smoke
  suite. The HTTP boundary now preserves only the exact legacy
  `/classroom-screen` mount and finite legacy read API/media/manifest aliases,
  maps the B407 bookmark to the canonical current screen, prefixes every local
  browser URL, and refuses unprefixed or hostile paths. Both the full fixture
  and persistent SQLite reader exercise the compatibility path. The exact-tree
  rehearsal passed in 241 ms with a 9 ms rollback, at most one writer, and zero
  live changes or external mutations. Added an inert non-fixture production
  reader composition behind an owner-only exact-shape reference and separate
  protected operator token. It is loopback-only, preserves the exact legacy
  mount, reads only confined SQLite/display state, has no provider, scheduler,
  route-management, subprocess, or Calendar capability. An exact inert
  `.service.in` candidate now references it with provider paths denied,
  loopback-only network policy, and no installation target. Repository-contained references,
  linked or missing managed state, coupled config/token paths, and nested
  database/backup paths fail before startup. Added a real Chrome 150 regression
  for every accepted state at 3840×2160 plus the legacy-required 1920×1080 and 1366×768
  viewports, covering bounded geometry, reduced motion, visible keyboard focus,
  local-only network, and browser errors. It found and fixed an unprefixed CSS
  poster URL that bypassed the legacy mount. Added an inert target proposal that
  freezes the known C509/legacy-alias/route/viewport/cadence facts. It records
  the observed legacy 06:20 weekday refresh only as superseded evidence and
  preserves the promoted 07:20 Asia/Ho_Chi_Minh Sunday-through-Friday
  replacement requirement with Saturday excluded. The user
  identified the display as a standalone Hikvision display with a built-in
  minimal computer, accepted an 18:00–20:00 Asia/Ho_Chi_Minh maintenance
  window, and confirmed bounded operator/stop roles. Safe legacy source review
  fixed the Classroom enrichment requirement as an asynchronous trigger during
  `pre_checkin` and `in_class_content`, with a 30-second success throttle,
  60/120/240/480/900-second failure backoff, last-known-good retention, and no
  display-request wait. Added an offline-only active-class job boundary that
  selects exactly one locally mapped current class before constructing source
  authority. The user accepted ADR-0019, the inert target proposal, and the
  non-catch-up scheduler policy on 2026-08-11. Separate inert service/timer
  candidates and an exact manifest now implement the 07:20
  Sunday-through-Friday plan refresh and 30-second active-class evaluation with
  `Persistent=false`, separate provider environments, cross-provider ambient
  authority rejection, bounded oneshot services, and no activation surface.
  Later user-supplied photos identify the exact panel as a Hikvision
  `DS-D5C75RB/A` with a built-in Android computer and confirm Fully Kiosk
  Browser `1.60.1-play`. Official documentation establishes Android WebView
  rendering and the 3840×2160 native panel, while runtime CSS scaling remains
  device-dependent. The bounded offline envelope now covers 3840×2160,
  1920×1080, and 1366×768; the later separately authorized physical candidate
  smoke completed that render/readiness gate. Protected core/alert configuration
  and the fixed alert test are complete, while routine live wiring remains
  absent. The private route is SHA-bound and its future port-4317 handoff is
  approved but unchanged. The user approved the final evidence and promoted
  M-16. At that checkpoint M-17 had not begun; its later offline canary
  implementation is recorded separately above and still grants no live
  authority.
  A separately authorized read-only production-reference/route preflight then
  found every exact future production path and service identity absent and no
  production units installed. It bound one private, non-Funnel
  `/classroom-screen` handler to active `classroom-screen.service` and HTTP
  loopback port 20790 through SHA-256 references, with 200 status-only probes
  and no retained response bodies. No protected file was opened and no service,
  scheduler, route, kiosk, provider, identity, or filesystem state changed.
  Accepted ADR-0020 and implemented its authorized offline-only just-in-time
  1Password repair architecture while preserving a completely credential-free
  routine collector. The isolated entrypoint requires explicit operator
  presence, exact owner-only fixed references, installed CLI 2.34.1, a bounded
  overwritten stdin transfer, a disposable visible profile, recognized
  username/password/TOTP and passive phone-approval states, exact marker
  verification, and PowerSchool-only state export. Synthetic Chrome proves
  routine reuse, fail-closed unknown challenge/foreign popup handling,
  concurrency, abort/timeout, and profile cleanup. A later authorized M-16
  preflight provisioned and read the fixed protected references once; its
  browser failed closed at a policy violation without writing state. After an
  offline iframe-classification fix, an exact-origin retry stopped before
  browser launch because desktop 1Password authority was unavailable. The user
  then authorized a bounded headless repair using the existing protected
  legacy 1Password service account. The supervisor parses only its token as
  data, never sources the file, confines it to the three fixed reads, and scrubs
  it before browser launch; routine/service/scheduler paths remain unable to
  reach it. The first headless attempt stopped at `unexpected-challenge` and
  wrote no state. A synthetic delayed-TOTP regression now preserves a
  ten-second actionless transition grace while unknown challenges still fail
  closed. The separately authorized post-grace retry produced no replacement
  state, and the immediate credential-free routine read still reported expiry;
  its exact final sanitized worker classification was lost during the
  cross-task handoff, so no narrower cause is claimed. A later source-only
  legacy comparison added recognition for only the explicit password and
  authenticator choices on the identity challenge-selection path. Synthetic
  Chrome proves that finite sequence while unknown challenges remain
  fail-closed. One separately authorized attempt with those choices still
  returned `unexpected-challenge` and wrote no state. The final source-only
  legacy comparison added the missing one-time explicit `Try another way`
  transition before the already-recognized authenticator selection; synthetic
  Chrome proves that path. A separately authorized bounded attempt exercised it
  but again returned `unexpected-challenge` and wrote no state. The old filtered
  state is expired. A final source-only check confirmed that the legacy repair
  completion path was itself headless; its distinct headed/noVNC launcher uses
  a durable profile and `--no-sandbox` and was not transplanted. No PowerSchool
  mutation or replacement state write occurred. Added a separately authorized
  value-free diagnostic contract that maps an unexpected Google screen to one
  closed category while retaining no page text, URL, screenshot, selector
  inventory, or provider value; malformed categories fail at the worker IPC
  boundary and the classifier adds no browser action or retry. The one
  authorized categorized attempt returned `browser-rejected` after prompt-free
  fixed 1Password reads, wrote no state, and performed no provider mutation.
  Further selector retries are stopped. A subsequently authorized offline-only
  direct-CDP alternative now starts exact installed Chrome 150 itself on
  `about:blank` in a fresh profile with its sandbox retained, exposes only an
  ephemeral loopback endpoint, and lets locked Playwright 1.62 attach and create
  a service-worker-blocked context before application navigation. Synthetic
  localhost coverage proves guarded authentication, filtered routine reuse,
  direct launch failure, process shutdown, and profile deletion. It imports no
  legacy durable profile or `--no-sandbox` behavior, performed no provider or
  protected-reference action, and still requires separate live authorization.
  One subsequently authorized bounded live attempt for 2026-08-11 again
  returned the sanitized Google `browser-rejected` category before the
  PowerSchool marker. It wrote no replacement state, the conditional routine
  read was not run, and local cleanup left no disposable profile or Chrome
  process. No retry is implied.
  A separately authorized one-time bridge then read the named legacy
  PowerSchool profile only through installed OpenClaw 2026.6.11's cookie
  interface, retained and atomically wrote 11 PowerSchool-host cookies through
  the strict ADR-0014 filter, and scrubbed the captured envelope. The immediate
  credential-free 2026-08-11 status/bell run returned
  `repair-required/session-state-rejected`; no Google state, legacy repair,
  provider mutation, retained temporary profile, or Chrome process resulted.
  A later authorized invocation of the legacy lane's bounded `repair_auth`
  capability found its profile already authenticated and therefore performed no
  credential retrieval, Google authentication, or new sign-in. Repeating the
  strict bridge retained 11 PowerSchool-host cookies and no origin storage; the
  clean routine collector then completed exact status/bell reads without
  credential, 1Password, Google, repair, or operator capability and returned a
  fresh verified three-period C509 observation for 2026-08-11. This closes the
  filtered-state reuse question without qualifying the replacement JIT browser
  or adopting the legacy profile/bridge as steady-state architecture. Local
  Asia/Ho_Chi_Minh time was already 2026-08-12, so this is prior-day evidence;
  the separately authorized current-local-date read then failed closed with
  `repair-required/session-state-rejected`, invoked no repair, Google,
  1Password, credentials, or retry, and left session longevity and fresh-plan
  readiness open without requesting another manual sign-in.
  Offline comparison with the proven legacy session-HTTP method then identified
  a bounded request-identity mismatch. Routine reads now derive the installed
  Chrome user-agent from the blank disposable page, normalize only its exact
  headless product token, send the exact PowerSchool-root referrer, persist
  response-cookie rotation across independent runs, and distinguish sanitized
  status-stage from bell-stage session rejection. Twenty-four synthetic Chrome
  tests cover the change without provider, protected-state, repair, Google, or
  1Password access.
  A separately authorized non-repairing gate then confirmed the legacy managed
  profile was already authenticated and retained 11 filtered PowerSchool
  cookies without sign-in or credential access. The first conditional
  2026-08-12 routine read failed closed at the status-page boundary with
  `status-session-state-rejected`, so the second read was not attempted. No
  repair, retry, provider mutation, or retained browser process resulted.
  Added finite value-free `redirected`, `unauthorized`, and `forbidden`
  classifications for both status and bell session reads. A separately
  authorized diagnostic classified the exact 2026-08-12 status response as a
  redirect; it was not followed, and no destination, header, body, cookie
  value, or page content was retained.
  Exact Node 24.15/Undici 7.24 and Fetch-standard verification plus a final
  authorized non-following diagnostic narrowed the response to HTTP 302 at
  `/oidc/openid_connect_login`, with 11 applicable cookies for each approved
  provider path. PowerSchool's public SIS 25.1 documentation identifies that
  exact path as its external-identity-provider authentication endpoint. The
  tenant's exact SIS version is unavailable, so the collector classifies only
  the documented authentication role and keeps it blocked without a bell
  request or identity traffic.
  The passive browser boundary now preserves its stricter body-budget failure
  when a loaded host lets the enclosing deadline race Playwright navigation
  settlement.
  Accepted ADR-0012 from safe legacy source evidence to preserve the
  established Telegram, 30-minute evaluation, six-hour repeat, new/recovery,
  and script-owned delivery semantics without retaining any destination or
  credential value. Added an offline-only fixed `sendMessage` adapter with two
  separate external owner-only value references, redacted count-only messages,
  abort/deadline propagation, bounded responses, no automatic retry, finite
  provider outcomes, buffer overwrite, and architecture tests proving it is
  absent from jobs, services, and units. No production value or network was
  used; protected provisioning, wiring, and live delivery remain open.
  A source-only review also characterized the proven legacy PowerSchool repair
  lane for a later low-friction repair design: explicit consent, fixed
  just-in-time 1Password references, bounded visible Google sign-in, passive
  phone approval, and session verification. Its persistent profile, gateway
  coupling, and broad cookie handling are explicitly not transplanted, and no
  repair or provider access was performed.

- Began the explicitly authorized M-15 bounded production Calendar trial.
  Added an exact Tuesday/C509 replacement-only engine that retains the promoted
  M-13 audit as lineage, reproduces its exact candidate hashes and clean
  classification, binds the fresh plan-specific audit, performs an
  existing-event GET-only semantic no-op preflight, binds fresh-backup and
  disabled/quiescent legacy writer evidence, journals three one-intent
  replacements under durable leases, uses an etag-conditional fixed patch that
  omits and therefore preserves the legacy events' provider-default reminders
  and unrelated private properties, verifies exact readback, and compensates partial failure to
  protected legacy snapshots. Owner-only atomic prepared/approval files, strict fixed-scope
  configuration, an M-15-only restoration transport, and a separate
  prepare/stage-approval/execute entrypoint keep production authority absent
  from services and routine jobs. The full offline gate passed. Authorized
  list/exact-event reads reproduced the exact three-candidate set and completed
  the GET-only semantic no-op preflight with zero mutations; the protected
  proposal was prepared. The user accepted ADR-0018 and its exact short-lived
  execution fingerprint; all three approved replacements completed with exact
  readback, zero creates/deletes, no rollback, and three rollback-ready
  snapshots. The user accepted that evidence and explicitly promoted M-15;
  the continuing roadmap goal separately authorized only safe offline/read-only
  M-16 preparation afterward.

- Completed the separately authorized M-14 offline Calendar writer implementation:
  added exact short-lived execution approvals, strong ownership/read-before-
  mutate and etag guards, deterministic create IDs, fixed notification
  suppression, durable SQLite single-writer leases and sanitized journals,
  crash-safe replay/convergence, dry-run-default command parsing, exact
  separately approved rollback planning/execution with source-evidence binding
  and durable replay, a credential-free injected-client adapter, and synthetic boundary
  tests. No Calendar API call, credential, live mutation, service activation,
  deployment or production access was authorized at that checkpoint. The complete
  offline gate passes 545 tests. A later separately authorized Auto Lesson 2
  qualification verified an exact `calendar.events.owned` grant, exercised five
  forward mutations with injected journal-failure convergence, completed four
  rollback and one final cleanup mutation, and ended with zero owned test
  events. Cancelled Google event tombstones now map to logical absence, and
  deleted snapshots restore under fresh deterministic rollback IDs before
  explicit cleanup. The first independent review then tightened the top-level
  approval to a 15-minute complete-config/source/build/dependency binding whose
  remaining lifetime must cover the full overall deadline, added
  a distinct approved exact-reference recovery mode plus automatic
  partial-failure cleanup, and tied no-op qualification to a seeded exact owned
  event. The historical live no-op used an absent synthetic reference, so that
  correction is not represented as live evidence. Production Calendar and
  operational services were untouched. Independent review is clean; the user
  accepted the no-additional-live-noop evidence disposition and ADR-0017 and
  explicitly promoted M-14. M-15 was authorized only afterward.

- Promoted M-13's mutation-free Calendar ownership checkpoint after explicit
  user approval of scope `classroom-hub-c509-2026-27`, three hash-bound legacy
  candidate dispositions, three future description-only replacements, the
  dry-run evidence, and direct-grant deferral. The checkpoint includes an exact
  `@googleapis/calendar` 16.0.0 `events.list` wrapper, a separate protected
  reference declaring only the intended owned-event read scope, bounded
  provider reduction, one fixed block-label/normalized-description projection
  policy, exact plan-local-day reads, strong three-property
  application ownership, hash-bound explicit legacy adoption,
  count/fingerprint-only dry-run evidence, and pure lease simulation. Unmarked
  matches, partial markers, recurrence, stale approvals, malformed entries, and
  ambiguity fail closed and suppress every eligible intent. The capability is
  absent from shadow, display, operations, service, routing, and writer paths.
  A bounded legacy ownership inventory found 13 candidates, and a value-free
  comparison matched all three Tuesday plan meetings to three candidates by
  interval, summary, and legacy description marker, with zero mutations.
  Direct-grant authority verification before operational use, all Calendar
  writes, and live M-14 execution were still gated at M-13 promotion. The final typed
  Tuesday dry run found three exact legacy candidates and zero ambiguity; a
  hypothetical adoption proposed three description-normalization replacements
  and no creates/deletes, while performing zero mutations.
  Audit fingerprints bind complete normalized ownership and recurrence state;
  impossible offset dates, caller-selected projection text, and partial or
  wrong-day windows fail closed.

- M-12's strict value-free plan, display, route, and operations comparator:
  exact normal/changed/gap/no-class/future-day/stale-cache/auth-failure
  scenarios; frozen behavior-ID triage; three directional accepted
  replacements; unconditional zero-provider-mutation enforcement; hostile
  input and forged-result rejection; and atomic redacted SQLite comparison
  evidence. Focused offline tests pass. The first
  value-free loopback probe found no current-room/Tuesday legacy reference and
  exposed a zero-period normalization gap on a confirmed no-class day. The
  current integration now maps only an authenticated, exact-date, verified
  empty bell page to a fresh `no-classes` observation and stores an empty
  canonical/effective plan; browser-level synthetic coverage proves zero
  identity-origin traffic. The user approved the unchanged legacy source/docs
  and passing 93-test suite as the alternative reference where live legacy data
  is absent. A later sanitized filtered-session rejection is retained as
  deferred longevity/repair evidence rather than triggering another operator
  login; the prior successful Tuesday read remains the live acquisition proof.
  Live empty-day readiness has not been re-probed and no incomplete evidence
  row was persisted. Future repair-auth work is separately gated and will begin
  from the proven legacy implementation. A safe legacy source/test audit
  confirmed eight named states, including attendance as `pre_checkin`. The
  replacement now ports the exact horse-backed Coming Up composition for
  `idle`/`post_end`, the complete next-class-day schedule in `day_complete`,
  and class code/link/QR plus all five aggregate attendance counts in
  `pre_checkin` through its typed presentation model. The real shadow now
  projects validated aggregate attendance and future effective plans from its
  local SQLite state; missing links preserve independent class-code and count
  fields. Fresh loopback-only Chrome 150 evidence covers 1920×1080, effective
  200% reflow, keyboard focus, and reduced motion, with exact source/build/PNG
  digests and no horizontal overflow, unexpected requests, or console errors.
  Human review identified the initial tiny horse WebM as an outdated stand-in;
  the candidate now uses the exact high-quality 4,591,479-byte MP4 named by the
  latest legacy source, with path, length, signature, and SHA-256 pinned by
  readiness. The user explicitly accepted the corrected exact-horse-media
  visual and approved the comparison result and M-12 promotion. M-12 is
  promoted. No Calendar, provider-write, production-route, kiosk, or M-13
  capability was added.

- Preserved the finite PowerSchool repair reason through the isolated shadow
  job boundary so operators can distinguish missing or rejected filtered state
  from status/bell marker drift without inspecting protected state or provider
  content.

- M-11's isolated mutation-disabled C509 shadow runtime: separate loopback
  service, least-authority server/provider-refresh environments, and protected
  SQLite/backup paths; persistent canonical plans and normalized Classroom
  cache; a run ledger; strict writer-disabled configuration; hardened system
  units with provider paths inaccessible to persistent readers and non-loopback
  server IP traffic denied; restart/backup lifecycle tests;
  and six exact 07:20 Asia/Ho_Chi_Minh executions across the authorized
  2026-08-11 through 2026-08-17 Sunday-through-Friday observation window.
  Saturday and post-window catch-up are disabled; Calendar, provider writes,
  production TV routing, kiosk changes, and M-12 remain absent. The
  pre-observation gate passed with a fully hardened system service running as
  the unprivileged application account, exact installed-unit hashes, health 200,
  expected pre-plan readiness
  503, a successful restart and two verified backup/catalog pairs, distinct
  4318/20790 listeners, and the timer waiting for its first Tuesday event. The
  superseded combined environment was removed after exact comparison with the
  retained refresh copy, and independent re-review found no remaining blocker.
  Under the user-approved accelerated gate, a fresh filtered PowerSchool state
  then supported an exact credential-free Tuesday plan, followed by a
  successful Classroom refresh, zero attempted/completed external mutations in
  both ledger rows, a 200 local day plan and preview, and continued `/tv` 404.
  M-11 is promoted; its fixed scheduled window remains active as supplemental
  evidence. M-12 was subsequently promoted after its separate gates passed.

- Corrected M-11 refresh containment after an authorized immediate attempt
  failed safely before provider acquisition: the Chrome-bearing refresh unit
  now allowlists only the user, PID, and network namespaces required by its
  enabled Linux sandbox, while server/backup units still prohibit all namespace
  creation. The verifier and adversarial tests reject disabled or broader
  refresh namespace policy. The failed attempt recorded zero attempted and zero
  completed external mutations and did not start Classroom.

- Promoted M-08 after qualifying its scope/read and stable-TV-latency gates with
  a dedicated Desktop OAuth client, an owner-only external
  exact-shape grant using Google's canonical teacher read-only scope, and one
  bounded live `courses.courseWork.list` audit over eight legacy-derived
  mappings. Seven observations succeeded and one unavailable mapping remained
  isolated; zero provider mutations, Calendar capabilities, or provider-data
  persistence occurred, and temporary client/provisioning artifacts were
  permanently removed. A later mutation-free observation completed 40/40
  baseline and 160/160 under-load kiosk requests; p95 latency was 2.72 ms at
  baseline and 1.75 ms during the bounded Classroom batch.

- M-10's mutation-free offline integration harness: bounded representative
  schedule/Classroom manifests, existing canonical-plan and normalized-cache
  composition, fixed read-only permission inventory, multi-room and
  authentication/freshness/mapping/partial-failure evidence, value-free result
  summaries, and a structural absence of Calendar capability. The protected
  M-08 is now promoted. A configured M-10 retry completed operator-present
  bootstrap and observed three live Tuesday periods, but the first retry used
  an unsuitable historical-date mapping and Classroom did not run. Follow-up
  read-only metadata established that the 2026–27 target moved from B407 to
  C509 and has 12 current Classroom mappings with no overlap with last year's
  eight. The integration now joins a delimiter-bounded PowerSchool code token
  embedded in the Classroom section field, canonicalizes provider room labels
  and UTC instants, rejects missing or ambiguous joins, and reports only a
  named redacted mapping difference. A protected C509 retry planned three
  Tuesday meetings, refreshed all three matching Classroom courses into a
  temporary in-memory cache, and reported zero differences, source mutations,
  or Calendar capability. M-10 is promoted; no operational activation occurred.

- Narrowed the M-08 installed-app authorized-user reference to a dedicated
  client ID and secret, refresh token, and the exact sole Classroom read scope,
  retained only in an owner-only external file. Live exchange evidence showed
  that this generated Desktop client secret is required.

- M-09's offline attendance/continuity safety contract: a bounded transient
  roster-first P/T/A matrix, validated display/QR link precedence, a known-alias
  compatibility redirect boundary, aggregate-only safe-export planning with
  whole-record quarantine and explicit provenance, count-only reconciliation,
  and repeatable disposable-SQLite evidence. The user accepted ADR-0015 and
  promoted M-09 on 2026-08-09. No legacy attendance state or student rows were
  read or persisted; safe-export reads remain separately gated.

- M-08's offline Google Classroom read boundary using exact
  `@googleapis/classroom` 14.0.0 and Google's sole canonical teacher-read
  `classroom.student-submissions.students.readonly` scope: fixed published-coursework listing,
  existing-domain normalization, one-to-one numeric mappings, bounded ordered
  partial-failure refresh/backoff, strict normalized SQLite cache, and a typed
  but operationally unregistered job wrapper. Its separately authorized live
  scope/read gate is now recorded under accepted ADR-0011.

- Verified the simplified M-07C bootstrap live with operator authentication and
  owner-only filtered PowerSchool state, then reused that state for exact
  credential/1Password/Google-free status and bell reads. The live routine
  reached normalization and returned `not-found` for a Monday the user
  confirmed had no classes, exposing the then-missing empty-day normalization.
  The current offline integration corrects that result only after the
  authenticated exact-date bell marker is verified. A later authorized retry
  refreshed filtered state without another sign-in prompt and produced a
  three-period Tuesday observation. A durable production marker remains
  deferred without retaining private response evidence.

- Simplified the operator-present PowerSchool bootstrap after the first live
  policy failure: normal browser SSO navigation is allowed until an exact
  PowerSchool bell marker appears, while temporary-profile cleanup and
  PowerSchool-only saved-state filtering remain mandatory. Routine collection
  keeps its strict credential-free request and byte boundaries.

- Kept real PowerSchool scripts and resource references inert during routine
  static rendering by disabling JavaScript and aborting all browser-side
  network requests, instead of rejecting otherwise parseable pages solely for
  containing normal active markup.

- Recorded the separately authorized M-07C live bootstrap attempt: it stopped
  fail-closed at `bootstrap-policy-violation` before authentication, produced no
  filtered state, and did not proceed to routine provider reads. Temporary
  profile, process, lock, and empty session-directory cleanup were verified
  without inspecting private page or state contents.

- M-07C's clean-room offline PowerSchool session integration: a separate
  operator-present visible bootstrap that retains only filtered PowerSchool
  state, a credential/1Password/Google-independent passive status/bell
  collector using disposable profiles, strict state/lock/filesystem and
  request/byte/deadline/process-tree containment, synthetic adversarial tests,
  accepted ADR-0014, and an explicitly unexecuted live verification gate.

- M-07B's bounded production-characterization contract: exact read-only
  PowerSchool status/bell surfaces, one-shot request/window budgets, sanitized
  evidence and last-known-good rules, plus the recorded future standalone
  Sunday-through-Friday 07:20 Asia/Ho_Chi_Minh refresh requirement. A hard
  process-group supervisor and forced teardown gate the authorized
  managed-profile session. The bounded live run made one status `GET`, returned
  `authentication-required`, entered cooloff, and stopped without a bell read,
  repair, provider mutation, or raw evidence retention.

- M-07A's completed entirely synthetic direct PowerSchool adapter qualification:
  an HTTP-first read-only boundary, installed-Chrome fallback through exact
  `playwright-core` 1.62.0, separate explicit authentication repair, bounded
  timeout/cooloff/provenance contracts, and a mutation-detecting local fixture
  origin. Live characterization remains a separately authorized M-07B gate.

- M-06 offline operations contracts: a finite typed job registry and CLI,
  redacted health reports and stable issue fingerprints, restart-safe alert
  decisions with report-only/fake delivery, distinct morning/evening brief
  contracts, and bounded run-ledger queries.
- Local SQLite integrity, verified backup/catalog pruning, and retention-policy
  hooks plus a self-cleaning six-job temporary-state rehearsal. This is
  repository evidence only and does not prove production scheduling or RTO/RPO.
- Deliberately inert service/timer templates, a pending cadence manifest, and
  offline verification for process/job separation, loopback intent, hardening,
  bounded runtime, unresolved schedules, forbidden artifacts, and dependency
  boundaries.

- The offline fixture-backed M-05 B407 display: loopback HTTP contracts,
  server-rendered display/operator views, all eight states, scoped QR and
  attendance presentation, versioned offline assets, playable local dismissal
  media, preview, overrides, persisted carousel holds, health/readiness, and
  graceful disposable-state startup/shutdown.
- Dependency-free browser controllers for one-second clocks/countdowns,
  reveal-aware carousel timing, dots, swipe, pause/resume, server holds,
  10-second polling timeout, 30-second healthy cadence, bounded exponential
  retry, last-good retention, and dual-layer media fallback.
- A local-Chrome media regeneration command. It has concrete value only for
  reproducing the required offline WebM and adds no npm or application runtime
  dependency.
- A bounded B407 Classroom Display MVP brief and contributor guide that
  distinguish the offline M-05 product slice from the later production
  replacement.
- Sanitized Chrome 150 evidence for all eight 1920x1080 display states,
  laptop operator views, effective 200% reflow, reduced motion, local media,
  QR rendering, keyboard focus, authorized controls, and offline network
  behavior. Evidence remains outside Git for user review.

- M-04 infrastructure-only SQLite persistence with numbered checksummed
  migrations, scoped canonical/effective plan history, finite safe-state
  repositories, semantic no-ops, last-known-good reads, integrity checks, and
  transactional job/fingerprint rules.
- A schema-driven continuity importer for normalized schedule observations and
  explicitly allowlisted configuration, mapping, plan, content, vocabulary,
  attendance, override, hold, Calendar-candidate, job, comparison, and temporary
  operational state, with atomic idempotent application and redacted rejection
  evidence.
- Integrity-checked backup/restore, confined path policy, checksum catalogs,
  14-daily/8-weekly selection and pruning, category-specific retention hooks,
  and an accepted recovery/retention policy in ADR-0013.
- M-03 pure, deterministic bell-schedule extraction and normalization; canonical
  plan derivation; eight-state selection; hidden-check-in and next-class-day
  behavior; explicitly unverified fallback selection; coursework enrichment;
  content/objective resolution; vocabulary decisions; attendance display data;
  scoped overrides; mutation-free preview composition; and inert Calendar
  reconciliation intents with stable fingerprints.
- Synthetic M-03 golden and boundary coverage for schedule layouts, normal,
  special, empty, stale, malformed, gap-day, fallback, multi-room/multi-screen,
  enrichment rejection, content precedence, vocabulary rotation, attendance
  links, overrides, preview mutation spies, and Calendar convergence.
- M-02 pure domain types, provider-neutral read ports, implementation-neutral
  persistence boundaries, isolated Calendar/local-command capabilities,
  mutation-free preview/comparison contracts, and executable architecture
  enforcement.
- Versioned M-01 contracts for safe schedule observations, canonical day plans
  with an effective IANA timezone and complete meeting boundaries, display
  states, inert owned Calendar intents, provenance/freshness, and categorized
  job outcomes.
- Deterministic synthetic normal, special-schedule, empty, stale, malformed,
  gap-day, and multi-screen fixtures with repository fixture-safety checks.
- Executable coverage for every legacy parity ID and `U-001` through `U-015`, an
  empty preserve-by-default retirement log, and a pending visual-baseline
  manifest with provisional large-TV and laptop viewports.
- Host-native Node.js/TypeScript scaffold with strict configuration validation,
  modular source/test layout, deterministic formatting, tests, production build,
  and inert systemd templates.
- Repository environment contract and generated tooling index that records
  detected or locked versions with canonical documentation links.
- Product vision, evidence-backed legacy parity inventory, architecture
  principles, migration strategy, dependency-ordered migration plan, and ADRs.
- Local documentation-link validation and changelog-structure validation as
  offline build requirements.
- Production-entry-point smoke check using safe, isolated environment values.
- Engineering standards covering documentation, comments, dependencies,
  migrations, tests, service behavior, and the repository definition of done.

### Changed

- Corrected the bounded JIT PowerSchool browser guard to count only main-frame
  navigations as top-level. Exact allowlisted GET/HEAD resource iframes no
  longer fail as identity redirects, while pre-frame and foreign popup requests
  remain blocked before egress; synthetic Chrome covers both boundaries.

- Extended each bounded JIT PowerSchool 1Password reference-read deadline from
  15 to 60 seconds so verified desktop authorization can complete without
  weakening the five-minute overall deadline, fixed references, byte cap, or
  post-read buffer destruction.

- Superseded ADR-0010's durable PowerSchool profile lifecycle with ADR-0014's
  filtered session state and separate manual repair capability. M-07C is an
  additive pre-M-10 checkpoint; M-08 onward retain their approved numbering and
  scope.

- Accepted ADR-0010 after the bounded offline spike. Dedicated PowerSchool
  profiles remain protected state outside Git, SQLite, domain contracts, logs,
  and backups; passive reads cannot submit forms or invoke source mutations.
- Recorded user approval of M-06 commit `61e2d69` on 2026-08-09 and split the
  former M-07 into synthetic M-07A qualification and explicitly authorized
  M-07B read-only characterization.

- SQLite migration 3 adds a strictly validated singleton alert checkpoint with
  separate active and last-successfully-delivered fingerprint sets. Failed
  fake delivery remains retryable and cannot erase prior delivery evidence.
- Replaced the misleading oneshot fixture-server timer with an invalid managed-
  server template, a bounded named-job service, and non-activatable timer
  templates. No units were installed, enabled, or started.
- The unified quality gate now validates M-06 operations/systemd safety and
  runs the temporary SQLite operations rehearsal.

- Startup now validates explicit loopback host/port settings and serves the
  fixture-backed MVP with temporary SQLite state. Operator mutations remain
  disabled unless a bounded local bearer value is configured.
- Accepted ADR-0009's small server-rendered HTML/CSS/TypeScript strategy for
  M-05 without adding a UI framework or package dependency. A dedicated strict
  DOM TypeScript build emits the browser controller under ignored build output;
  README runtime and repository-state guidance were corrected.
- Bound ordinary display and operator timing to an injected monotonic fixture
  clock while keeping caller-selected instants preview-only. Media readiness now
  requires the reviewed WebM byte length and SHA-256 before serving it.
- Tightened local presentation URLs so bounded QR query parameters remain
  renderable while traversal and external targets still fail closed; corrected
  kiosk viewport sizing and enlarged carousel-dot hit targets after browser
  inspection.

- Strengthened M-04 persistence validation to require complete exact runtime
  contracts, real dates and normalized instants, valid IANA timezones, finite
  numbers, enums, dense data-only arrays/objects, scope relationships, and
  nested types before storing or recovering plans and safe state. Cycles,
  accessors, hostile proxies, and other non-serializable inputs now fail closed.
- Bound recovered safe-state payload identity and complete scope to the SQLite
  row and query metadata; semantic no-ops now validate stored payloads before
  trusting their hashes and repair corrupt current rows with a valid revision.
- Carousel holds now include plan identity, preserve audited release/expiry/
  invalidation revisions, reject stale concurrent transitions, and cannot be
  resurrected from superseded history. Calendar fingerprints now advance only
  when scope, output fingerprint, state reference, completion time, and
  requested date all match the successful job result.
- Hold invalidation now rejects instants before the held instant and revalidates
  every internally constructed record inside the transaction. Instant ordering
  uses epoch values so optional millisecond spelling cannot invert chronology.
  Released or expired holds can begin a new lifecycle through the current
  revision without allowing generic writes or resurrecting superseded history.
- Persistence now validates generated clock instants, revision identifiers,
  academic-year dates, and migration application instants before writing.
  Promise-like transaction and migration callbacks roll back rather than
  committing asynchronous work. Calendar clean state additionally requires a
  date-bearing requested scope, complete mutation counts, and no error or
  incident codes.
- Corrected effective-plan persistence to allow one current row per date/screen,
  supersede a screen's prior room assignment, and require the expected room on
  reads so last-known-good recovery cannot cross room assignments.
- Continuity validation now enforces frozen enum, nested-domain, temporal,
  ordering, and meeting-boundary contracts. No-ops recursively revalidate the
  stored collection record as well as its identity and checksum; corrupt
  existing records fail with redacted evidence and remain unchanged.
- Continuity configuration snapshots now require every frozen nested value.
  Planning first takes one descriptor-only data snapshot, rejecting accessors,
  sparse/augmented arrays, symbols, non-enumerable fields, and exotic objects
  before identity extraction so record identity and content cannot diverge.
- Backup pruning now derives retention from fully parsed catalogs and validates
  every candidate, caller/catalog identity, actual byte length, and recomputed
  checksum before deleting anything; schema migration opens now fail if the
  checksummed ledger and `user_version` differ. Expiry pruning rejects invalid
  cutoff instants before opening a deletion transaction, and configuration
  retention accepts only real canonical UTC supersession instants.
- Raised the supported Node.js runtime to 24.15.0 so M-04 can use the built-in
  `node:sqlite` release-candidate transaction, integrity, and backup APIs without
  adding a dependency.
- M-04 now records the complete read-safe schedule observation with explicit
  provenance, freshness, verification, and diagnostics while excluding raw
  provider captures.
- Corrected M-03 coursework to use meeting-date-relative legacy windows,
  ordering, caps, non-deleted filtering, undated update-time behavior,
  complete objective/vocabulary fields, and refresh metadata that cannot move
  assignments between buckets.
- Corrected M-03 content and vocabulary to preserve ordered static/date cards,
  legacy objective grouping and selection limits, exact context scoring and
  focused pools, deterministic class/date/block rotation, same-meeting reuse,
  repeat avoidance, and display-complete inert history decisions.
- Replaced the single-selector override shape with a full screen/date scope
  containing global announcement/simulator fields and multiple meeting/class
  overrides; meeting IDs take precedence and global fields do not require a
  class selector.
- Strengthened attendance summaries to keep five independent counts, preserve
  missing values separately from zero, and diagnose invalid values. Global
  announcements also remain visible across per-class card replacement as an
  explicitly requested correction to legacy behavior.
- Fresh, verified PowerSchool observations are now the only authoritative
  canonical-plan input; stale or unverified material cannot produce primary
  plans or Calendar intents and remains eligible only for explicit transitional
  fallback handling.
- The unified `npm run check` gate now verifies documentation, formatting,
  strict types, tests, the production build, and a startup smoke check.
- Test discovery now uses the Node.js test runner's recursive glob handling so
  root-level and nested compiled tests cannot be silently skipped by shell glob
  behavior.
- Repository guidance now requires documentation and changelog updates alongside
  consequential code or contract changes.

### Security

- PowerSchool session state is owner-only protected runtime material outside
  the repository and application SQLite. Routine collection cannot receive
  credential, identity-repair, form, generic-navigation, Google, or 1Password
  capability and removes a fresh temporary Chrome profile after every run.

- Operational database, backup, and catalog files must be regular single-link
  files, preventing a managed-path hard link from aliasing an external inode.
- Continuity schemas reject unknown and forbidden sensitive/path fields;
  rejection evidence omits values, backup/restore paths are confined, and
  tests use only synthetic state in temporary directories.
- Established read-only boundaries for PowerSchool and Google Classroom,
  application-owned-only Calendar reconciliation, separate protected handling
  for secrets/browser profiles/runtime state, and Tailnet-only deployment intent.

### Operations

- Kept the future Sunday-through-Friday 07:20 Asia/Ho_Chi_Minh PowerSchool
  cadence documented but inert. No service, timer, scheduler, routing, or
  deployment artifact is installed or activated by M-07C.

- Preserved source-auth, Classroom refresh, and Calendar-reconcile names as
  explicitly deferred dependency nodes without provider or writer capability.
  Exact scheduler ownership/cadences, live alert delivery, complete brief
  semantics, routing, activation, and timed restore proof remain later gates.

- Accepted four-hour RTO and 24-hour RPO objectives, nightly-backup intent,
  14-daily/8-weekly backup retention, and data-category retention periods;
  operational scheduling and recovery proof remain later milestones.
- Recorded parity-first shadow, single-writer, outside-hours cutover, rollback,
  stabilization, health, alert, scheduled-brief, backup, and recovery requirements.

### Deprecated

- None.

### Breaking changes

- None.
