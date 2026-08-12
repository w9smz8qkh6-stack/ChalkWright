# Working environment

This file is the repository's durable environment contract for Codex and human
contributors. It describes the expected working context; it is not a dotenv
file and must never contain credentials or other sensitive values.

## Execution topology

- Run the application natively on the Linux host. Do not introduce a container
  runtime or a hosted deployment assumption without an explicit requirement.
- Use the repository root as the working directory.
- Use Bash-compatible commands for repository automation.
- Use Node.js 24.15.0 or newer and npm versions satisfying `package.json`.
  M-04 relies on the built-in `node:sqlite` release-candidate API as documented
  for the observed Node.js 24.15.0 runtime; no native add-on dependency is
  installed. `package-lock.json` is
  authoritative for JavaScript dependency versions, and `npm ci` is the
  reproducible installation command.
- Treat `systemd/` as inert templates. Do not install, enable, start, stop, or
  restart units without explicit authorization.
- A separately authorized 2026-08-12 M-16 inert provisioning step created the
  non-login `classroom-hub` identity, owner-only production core directories,
  five protected configuration/reference files, and one unextracted root-owned
  runtime archive. Its sanitized provisioner digest is
  `sha256:f44cc79292695d89fd52b214f3fee629d5792ed51996cc132008952a68018494`;
  the archive digest is
  `sha256:cc73d49e1a3aebfa6bda62375c1955167096cee34b8d82c082773ec02f0aef53`.
  No provider call, executable deployment, unit installation/start, route
  change, or TV action occurred. Alert provisioning remains absent.
- M-07A uses exact `playwright-core` 1.62.0 with the separately installed Google
  Chrome 150.0.7871.114 only for synthetic browser fallback and temporary-profile
  tests. It does not download a repository browser. Any protected PowerSchool
  profile belongs outside this repository and application state and must not be
  inspected without separate M-07B authorization.
- M-07B's one-shot authorization is represented by a frozen repository policy
  and sanitized evidence contract. It does not make protected profiles or live
  PowerSchool routine development inputs. Chrome persistent contexts write
  browser-managed profile metadata even without page actions, so managed
  profile launch must fail closed unless that incidental-write boundary is
  explicitly authorized. The one M-07B launch was separately authorized and
  ran only inside a fixed process-group supervisor with bounded forced teardown;
  that evidence does not grant routine profile or provider access.
- M-07C replaces durable routine browser-profile use with filtered PowerSchool
  session state in an owner-only directory outside the repository. Manual
  visible bootstrap and passive collection are separate entry points. Routine
  collection receives no identity, credential, 1Password, or repair authority
  and uses a fresh deleted Chrome profile for every run. This is offline
  integration evidence. Separately authorized 2026-08-09 retries completed
  operator authentication and retained only a filtered owner-only PowerSchool
  state file. A credential-free routine reuse completed the exact status and
  bell reads without Google or 1Password, then returned `not-found` for a
  Monday the user confirmed had no classes. That historical result exposed a
  zero-period normalization gap. The current offline integration now maps only
  an authenticated exact-date empty bell page with the verified marker to a
  fresh `no-classes` observation; missing markers, wrong dates, and auth
  failures remain distinct. A later authorized bootstrap refreshed the
  filtered state without another sign-in prompt, and routine reuse observed
  three Tuesday periods. A durable production bell marker remains unverified.
  Accepted ADR-0020 adds an offline-qualified, separately invoked JIT repair
  worker. It is absent from routine/service/scheduler import graphs, uses
  installed 1Password CLI 2.34.1 through fixed `op read` arguments and an
  owner-only reference file, transfers values only through a bounded stdin
  packet, and uses a disposable Chrome profile. The current offline candidate
  starts exact installed Chrome 150 directly with its sandbox retained, then
  attaches locked Playwright 1.62 over loopback CDP before application
  navigation; this has synthetic localhost evidence only. A separately authorized
  M-16 preflight provisioned the fixed external references and completed one
  bounded read; the browser then failed closed at a policy violation without
  writing state. After an offline iframe-classification fix, the exact-origin
  retry stopped before browser launch because desktop 1Password authority was
  unavailable. Existing filtered state is expired; no provider mutation or
  replacement state write occurred. The user then explicitly authorized a
  headless repair using the existing protected legacy service account. Its file
  passed value-free validation, fixed secret reads completed without a desktop
  prompt, and only the service-account token was parsed as data and scrubbed
  before browser launch. The first headless browser stopped at
  `unexpected-challenge`; no state was written. The replacement now retains a
  ten-second no-action grace for delayed standard identity transitions, with a
  synthetic Chrome regression, while unknown challenges still fail closed.
  Later bounded replacement and direct-CDP attempts still returned a sanitized
  browser rejection. An initial strict bridge through the legacy managed
  profile produced 11 PowerSchool-only cookies that routine validation
  rejected. After a separately authorized legacy `repair_auth` invocation found
  that profile already authenticated, the same application-owned bridge
  produced 11 PowerSchool-only cookies and no origin storage; the clean routine
  collector then completed exact status and 2026-08-11 bell reads and returned
  a fresh verified three-period C509 observation. The routine phase received no
  credential, 1Password, Google, repair, or operator capability. This closes
  the filtered-state reuse question without qualifying the replacement JIT
  repair or adopting the legacy profile/bridge as steady-state architecture.
  Local Asia/Ho_Chi_Minh time was already 2026-08-12, so the requested
  2026-08-11 schedule is prior-day evidence. A separately authorized 2026-08-12
  routine read then failed closed with `session-state-rejected` and invoked no
  repair, Google, 1Password, credentials, or retry. Current-day readiness and
  filtered-session longevity remain gated without another manual sign-in.
  A later offline source comparison found that the legacy session-HTTP reader
  sends a browser user-agent and exact-origin referrer while the replacement
  used Node defaults. The replacement now derives the installed Chrome identity
  from its blank disposable page, normalizes only the headless product token,
  sends the exact PowerSchool root referrer, persists rotated cookies, and emits
  separate value-free status/bell rejection codes. Two independent synthetic
  Chrome runs pass; no provider retry or protected-state access accompanied the
  correction. A later authorized non-repairing gate confirmed the legacy
  managed profile was already authenticated and retained 11 filtered
  PowerSchool cookies without sign-in or credential access. The first
  conditional 2026-08-12 routine read failed closed at the status page with
  `status-session-state-rejected`, so the second was not attempted. No repair,
  retry, provider mutation, retained temporary profile, or Classroom Hub Chrome
  process resulted. Current-day readiness and session longevity remain open.
  A separately authorized value-free diagnostic then classified the exact
  status response as a redirect rather than a 401, 403, marker mismatch,
  browser failure, or response-policy failure. The redirect was not followed
  and its destination and content were not retained.
  Exact Node 24.15/Undici 7.24 and Fetch-standard verification plus a final
  authorized non-following diagnostic narrowed it to HTTP 302 at
  `/oidc/openid_connect_login`, with 11 applicable cookies for each approved
  provider path. PowerSchool's public SIS 25.1 documentation identifies that
  exact path as its external-identity-provider authentication endpoint. The
  tenant's exact SIS version is unavailable, so the collector classifies only
  the documented authentication role, keeps it blocked, and made no bell
  request.
  Accepted ADR-0021 now adds a separate, offline-qualified compatibility lane
  that retains one dedicated external owner-only Google-bearing Chrome profile.
  It may complete silent browser-native OIDC and read only the exact status/bell
  pages, but receives no credentials, 1Password references, form-fill, student,
  or grade capability. The explicit JIT worker alone may target that retained
  profile. Installed Chrome 150 synthetic repair, silent renewal, exact-read,
  normalization, interactive-state refusal, scrubbing, and inert-wiring tests
  pass. No protected profile or provider was accessed, no service/job imports
  the lane, and an exact exclusive profile-lifecycle decision plus separate
  current-date read authorization were M-16 gates at the offline checkpoint.
  A subsequent authorized live gate found the legacy profile already active and
  did not compete for or inspect it. Its fixed bell call first returned
  repair-required; one authorized non-forced legacy repair authenticated without
  a manual sign-in, and the conditional 2026-08-12 read returned four periods
  via session HTTP. Only status/date/count/source were retained. This closes the
  temporary legacy current-date read gate while repository-owned handoff and
  service wiring remain deferred.
- M-08 uses exact `@googleapis/classroom` 14.0.0 behind one
  `courses.courseWork.list` transport. The sole accepted OAuth scope is
  `classroom.student-submissions.students.readonly`. A dedicated installed-app
  grant now exists in an owner-only external reference, and eight legacy-
  derived one-to-one mappings completed a bounded live audit with seven
  observations and one isolated unavailable mapping. A later mutation-free
  observation completed 200/200 kiosk GETs with no p95 latency regression under
  another bounded Classroom batch, promoting M-08. The job wrapper is not
  registered.
- M-10's offline integration runner accepts only read-source factories and the
  normalized Classroom cache port. It has no Calendar, provider-write,
  credential, repair, command, or generic network capability. A protected
  2026-08-10 C509 gate matched three delimiter-bounded PowerSchool codes inside
  unique current Classroom section fields, planned all three Tuesday meetings,
  refreshed three entries in temporary in-memory cache, and reported zero
  differences, source mutations, or Calendar capability. M-10 is promoted.
- A separately authorized 2026-08-12 M-16 transient candidate used the pinned
  release `002264cb6de9d04f18a0da4737b71510981b3027d1cb9f18429a8bfab4d0c823`.
  After the already-authenticated legacy browser returned a four-period current-
  date schedule without sign-in, an application-interface bridge retained 11
  PowerSchool-only cookies and no origin storage for the service-owned strict
  filtered state. The production plan job succeeded, the inactive Classroom
  job skipped before source construction, and display/health/readiness returned
  200. A separate non-Funnel port-16443 listener exposed the candidate without
  changing the legacy listener/backend. A temporary pinned preview initially
  intercepted asset paths and rendered unstyled; corrected asset mappings and
  a physical Fully Kiosk photo verified the styled in-class composition. The
  pinned mappings and candidate listener were removed, and the legacy display
  still returned 200. The provider-free transient reader retained its fixed
  two-hour automatic stop because an immediate stop required interactive sudo.
  The live-time `day_complete` fallback lacks the explicitly deferred evening
  next-class-day plan. No Calendar request or provider write occurred. M-16
  was not yet promoted at that checkpoint; alert disposition and final
  runbook/target approval remained. A
  SHA-bound offline-only provisioner migrated the fixed legacy alert
  destination and bot authority into three separate service-owned files; the
  adapter remains unwired. The user approved the exact proposal, the inert
  release installed, and the service-user one-shot qualification reported
  exactly one delivered fixed message with zero service, route, or
  application-state changes. No retry occurred. Recipient acknowledgement and
  final M-16 runbook/target approval were subsequently accepted and M-16 was
  promoted. The direct Telegram adapter is host-native and does not depend on
  OpenClaw runtime authority. M-17 remains unauthorized. The user subsequently
  accepted ADR-0022: M-17 must begin as an isolated parallel canary using a
  separate Tailnet URL, secondary owned Calendar, distinct state and process
  names, staggered reads, and report-only alerts. No implementation or live
  action accompanied that amendment.
- M-11 is promoted under the user-approved accelerated qualification gate, and
  its isolated 2026-08-11 through 2026-08-17 C509 shadow observation remains
  active as supplemental evidence. A credential-free exact Tuesday
  PowerSchool plan and Classroom refresh succeeded with zero external
  mutations, and the local day plan and preview returned 200 while `/tv`
  remained 404. Its system service runs as
  `bren`, binds only `127.0.0.1:4318`, uses the
  separate owner-only server and provider-refresh environments and
  the deployment-specific shadow state directory. The persistent server is
  denied the provider environment/state paths and all non-loopback IP traffic;
  it has no Calendar, production-route, TV, kiosk, or operator-mutation
  capability. The superseded combined environment was removed after an exact
  comparison with the retained refresh copy. The six fixed
  07:20 Asia/Ho_Chi_Minh timer events exclude Saturday and use
  `Persistent=false`, so they cannot catch up beyond the approved window.
  Do not inspect protected state directly.
- M-12 was promoted on 2026-08-10 after explicit user approval of its corrected
  visual and comparison result. Its comparator accepts only finite
  normalized plan/display/route/operations facts and returns value-free codes,
  counts, behavior IDs, and dispositions. Redacted records use the existing
  strict `comparison-evidence` SQLite kind. No provider, credential, browser,
  command, Calendar, or generic network capability is constructed. A value-
  free loopback probe found no
  current-room/Tuesday legacy reference and exposed an empty-day normalization
  gap. The gap is resolved offline through the authenticated exact-date
  `no-classes` contract and an empty persisted plan. The user approved the
  unchanged legacy source/docs and passing 93-test suite as the alternative
  reference where current live legacy data is absent, and declined another
  PowerSchool sign-in after a later refresh returned the sanitized
  `session-state-rejected` result. The prior successful credential-free Tuesday
  read remains the live acquisition evidence; live empty-day readiness and
  filtered-session longevity are deferred. No incomplete evidence row was
  stored. A safe source/test audit of the legacy app confirmed eight named
  states, including attendance as `pre_checkin`. The replacement now ports the
  exact legacy horse-backed Coming Up composition for `idle`/`post_end`, the
  next-class-day schedule rendered by `day_complete`, and the complete
  code/link/aggregate summary rendered by `pre_checkin`. The shadow projects
  future plans and validated aggregate attendance from local SQLite only, with
  independent missing-link degradation. Fresh disposable Chrome 150 evidence
  covers 1920×1080, effective 200% reflow, keyboard focus, and reduced motion;
  its manifest records exact source/build and PNG SHA-256 digests. It is stored
  outside Git under the current M-12 visualization directory.
  The exact production kiosk viewport/browser and filtered-session longevity
  remain deferred. M-13 is promoted under the remaining-roadmap goal. It uses
  exact `@googleapis/calendar` 16.0.0
  behind one bounded `events.list` transport and the sole
  `calendar.events.owned.readonly` scope. The protected grant is separate from
  Classroom, and no Calendar writer, operational registration, or provider
  mutation exists. The user approved its scope, three Tuesday dispositions,
  future description-only replacements, dry-run evidence, promotion, and
  direct-grant deferral. Do not inspect protected state or expose private
  legacy/shadow response values. M-14 writer construction is complete and
  remains unreachable from operations. A separately authorized Auto Lesson 2
  qualification used one owner-only external credential whose actual grant was
  verified as exactly `calendar.events.owned`. The final bounded run proved
  injected journal-failure convergence, five forward, four rollback, and one
  final cleanup mutation, ending with zero owned test events. The qualification
  factory is not reachable from services or jobs. Independent review then
  required a time-limited complete-config/source/build approval, a durable
  exact-reference recovery path, and a provider-tied seeded no-op. Those are
  corrected offline; the historical live no-op used an absent synthetic
  reference and has not been re-run. The user accepted the no-additional-live-
  noop disposition and ADR-0017 and explicitly promoted M-14. The user later
  authorized the bounded M-15 Tuesday production trial. Its offline
  implementation and the authorized exact read-only preparation are complete;
  the fixed legacy writer is disabled/quiescent and the protected
  three-replacement proposal was prepared. The user accepted ADR-0018 and the
  exact short-lived execution fingerprint; all three approved replacements
  completed with exact readback and no rollback. The legacy writer remains
  disabled/quiescent, and three rollback-ready snapshots are retained. The
  user accepted that evidence and explicitly promoted M-15. The continuing
  roadmap goal authorizes safe offline/read-only M-16 preparation. Its isolated
  switch/rollback and legacy-route rehearsal pass, and an inert provider-free
  non-fixture production reader now composes the persistent SQLite display path
  behind a protected exact-shape reference. No service or deployment invokes
  it. M-16 was later promoted after its bounded live gates and explicit final
  approval; service activation, route/kiosk changes, and M-17 remain
  unauthorized.
- See `docs/tooling.md` for versions observed on the canonical working host and
  links to the corresponding upstream documentation.

## Project environment variables

- `NODE_ENV`: `development`, `test`, or `production`; defaults to
  `development`.
- `LOG_LEVEL`: `debug`, `info`, `warn`, or `error`; defaults to `info`.
- `CLASSROOM_HUB_HOST`: loopback only (`127.0.0.1` or `::1`); defaults to
  `127.0.0.1`.
- `CLASSROOM_HUB_PORT`: local HTTP port; defaults to `4317` and accepts `0` for
  ephemeral test servers.
- `CLASSROOM_HUB_OPERATOR_TOKEN`: optional local bearer secret. When absent,
  operator mutations remain disabled. Never place a real value in Git, URLs,
  logs, screenshots, or command history.
- Operational jobs separately require bounded instance/scope IDs, an IANA
  timezone, a confined managed root/database/backup path set, an explicit real
  academic-year-end date, and a 1–3600 second deadline. These use the
  `CLASSROOM_HUB_INSTANCE_ID`, `CLASSROOM_HUB_OPERATIONS_SCOPE_ID`,
  `CLASSROOM_HUB_TIME_ZONE`, `CLASSROOM_HUB_MANAGED_ROOT`,
  `CLASSROOM_HUB_DATABASE_PATH`, `CLASSROOM_HUB_BACKUP_DIRECTORY`,
  `CLASSROOM_HUB_ACADEMIC_YEAR_END`, and
  `CLASSROOM_HUB_JOB_DEADLINE_SECONDS` variables.
- `CLASSROOM_HUB_ALERT_DELIVERY_MODE` is `report-only` by default. `fake` is
  accepted only for synthetic rehearsal and then requires a bounded
  `CLASSROOM_HUB_ALERT_REPEAT_SECONDS`. The offline-qualified direct adapter
  accepts only `CLASSROOM_HUB_ALERT_DELIVERY_REFERENCE`, an external protected
  path to two further protected value paths; it has no inline recipient,
  endpoint, or credential variable and is unreachable from every job/service.
  ADR-0012 is accepted. The Telegram destination/credential were later
  provisioned without disclosure and one fixed qualification message was
  delivered. The user confirmed the intended recipient; routine job
  wiring/delivery remain separately gated for M-17.
- PowerSchool session variables are listed as empty safe placeholders in
  `.env.example`. They describe exact origins, status/bell paths and markers,
  bounded time/request/byte policy, Chrome executable, room/date offset, and an
  external session directory. They never contain Google or PowerSchool
  credentials. Bootstrap-only identity/resource origins are not forwarded to
  the routine child.
- `CLASSROOM_HUB_POWERSCHOOL_REPAIR_REFERENCE` is JIT-repair-only and may point
  only to an owner-only external exact-shape JSON file containing three fixed
  1Password references. It is never forwarded to routine collection or the
  repair browser child. The checked-in example is empty.
- `CLASSROOM_HUB_POWERSCHOOL_ONEPASSWORD_SERVICE_ACCOUNT_ENV` is optional and
  JIT-repair-only. When explicitly authorized, it may name one protected legacy
  environment file outside the repository. The supervisor parses only
  `OP_SERVICE_ACCOUNT_TOKEN` as data, never evaluates the file as shell, and
  removes the token before launching the browser child. It is absent from every
  routine/service/scheduler environment allowlist.
- Google Classroom placeholders describe only a protected credential-reference
  path, numeric course mappings, and bounded timeout/page/item/concurrency/cache/
  backoff policy. Credential material, OAuth client creation, consent, and live
  reads remain outside the repository and require separate authorization. The
  offline active-class handler selects only `pre_checkin` or
  `in_class_content` from local target state before source construction; no
  entrypoint, service, or timer imports it.
- Google Calendar audit placeholders describe a distinct external read-only
  reference, one exact calendar and application scope ID, and finite timeout,
  page/event, and window budgets. The only intended declared scope is
  `calendar.events.owned.readonly`; the declaration is not proof of the actual
  provider grant, which remains a direct live-verification gate. No writer
  setting or credential exists.
- `.env.example` contains safe examples only. Local `.env*` files other than
  `.env.example` are ignored and must not be inspected or committed.

## Bootstrap and verification

```sh
npm ci
npm run check
```

`npm run check` is the CI-compatible offline gate for generated documentation,
local links, changelog structure, fixture safety, formatting, strict types,
tests, inert operations artifacts, the production build, compiled startup
smoke check, and temporary-state operations rehearsal.

Use `npm run docs:sync` after an intentional package, runtime, host-tool, Codex,
MCP, or documentation-reference change. Review the generated diff rather than
accepting it blindly. Use `npm run docs:check-links` to validate canonical URLs
when network access is authorized; the normal quality gate remains offline.

## External boundaries

- M-07A introduces a repository-owned PowerSchool-shaped read adapter qualified
  only against a local synthetic origin and temporary profile. It makes no live
  provider claim. M-05 exposes only an explicit loopback Node.js HTTP server
  backed by synthetic fixtures and temporary SQLite state.
- M-07C's manual bootstrap uses operator-present browser-native identity
  navigation and therefore does not claim per-request origin/method/byte
  confinement. Its durable output is filtered to PowerSchool and its temporary
  browser profile is removed. Routine Node.js reads retain exact route and hard
  streamed-byte bounds; static browser rendering disables JavaScript and aborts
  every browser-side network request.
- The configured OpenAI documentation MCP server is public and read-only; it
  retrieves documentation and does not call application APIs.
- Any future PowerSchool or Google Classroom integration must remain read-only.
- M-08's Classroom grant, bounded live reads, and stable-TV-latency check are
  qualified, so the milestone is promoted. Do
  not inspect credential values, widen scopes, repeat live reads, or
  operationally register refresh without the applicable later gate.
- Never inspect or modify live services, scheduled jobs, external data, OAuth
  material, browser profiles, student data, runtime state, or logs as part of
  routine repository work.
