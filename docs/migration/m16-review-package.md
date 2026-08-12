# M-16 review package: cutover and rollback rehearsal

## Status

M-16 is **promoted**. The isolated implementation and rehearsal pass. A later
separately authorized candidate gate provisioned the inert production identity,
protected core configuration, SQLite state, and a SHA-bound runtime release;
ran read-only plan and Classroom jobs; started a two-hour transient loopback
candidate; and briefly added a separate non-Funnel Tailnet candidate listener.
The legacy service and its existing `/classroom-screen` route were never
replaced. The candidate listener was removed after the on-device smoke, while
the provider-free transient loopback process retained its fixed automatic
two-hour stop because an immediate stop required interactive sudo. No
production service or timer was installed or enabled, no Calendar capability
was invoked, no provider write occurred during that candidate gate, and no
credential value entered repository evidence.

The user subsequently approved the exact alert execution proposal fingerprint.
The inert release install, protected value migration, and single fixed
qualification message all succeeded as recorded below. They made no service or
route change and did not wire the alert adapter into routine operation.
The user confirmed the message appeared in the intended destination and then
approved the final runbook, exact targets, recovery evidence, candidate
disposition, and M-16 promotion on 2026-08-12. The Telegram check qualified a
direct host-native Node adapter and service-owned protected references; it does
not introduce an OpenClaw runtime dependency. M-17 remains unauthorized.

After M-16 promotion, the user accepted
[ADR-0022](../decisions/0022-parallel-production-canary.md). It preserves all
M-16 rehearsal and rollback evidence but amends M-17's execution sequence: the
replacement must first run on a separate Tailnet URL, secondary Calendar, and
isolated state while legacy ownership remains unchanged. Final route/writer
handoff is a later separately approved gate.

The user accepted ADR-0012 and ADR-0020 and authorized only ADR-0020's offline
implementation. User-supplied device photos identify the physical display as a
Hikvision `DS-D5C75RB/A` interactive flat panel with its own built-in Android
computer, not this Ubuntu host, and confirm Fully Kiosk Browser `1.60.1-play`.
Fully's official documentation states that its browser uses Android WebView;
the exact installed WebView provider/version and effective CSS viewport are
runtime-dependent and cannot be derived from product literature. Hikvision's
official datasheet establishes a 3840×2160 at 60 Hz native panel. M-16 therefore
uses a conservative three-viewport browser envelope—3840×2160, 1920×1080, and
1366×768—and required a brief on-device candidate smoke before route cutover;
the later candidate evidence below completes that render/readiness gate. The
device serial number visible in the first photo is deliberately not retained.
The user accepted a reasonable
outside-class-hours window; the proposal fixes 18:00–20:00
Asia/Ho_Chi_Minh with readiness, class-state, backup/rollback, and operator
stop conditions.

Fully's current official documentation describes version 1.60 and its Android
WebView architecture, while the installed-device photo is the exact authority
for the `1.60.1-play` patch/build suffix because version-matched online release
documentation was not available: [Fully Kiosk Browser documentation](https://www.fully-kiosk.com/en/).
The native output comes from Hikvision's official
[DS-D5C75RB/A datasheet](https://assets.hikvision.com/prd/normal/all/doc/m000071068/DS-D5C75RB_A_Datasheet_20251208.pdf).

[ADR-0019](../decisions/0019-bounded-cutover-rehearsal.md), the inert target
proposal, and its non-catch-up scheduler policy were accepted on 2026-08-11.
That acceptance authorizes no live action. M-17 has not begun.

On 2026-08-12 the user additionally accepted
[ADR-0021](../decisions/0021-persistent-powerschool-compatibility-lane.md) and
authorized its offline implementation. That decision imports only the proven
legacy lane's dedicated persistent-profile schedule-read/authentication
lifecycle. It does not import student/grade/scoresheet reads, raw captures,
generic browser control, gateway management, shell-sourced configuration, or
the historical `--no-sandbox` launcher. It grants no live provider or profile
access and does not promote M-16.

## Governing scope

This checkpoint follows promoted M-15 and gates M-17. It is limited to:

- exact configuration and target reference binding;
- a verified SQLite backup/restore and four-hour RTO measurement;
- single-writer handoff ordering;
- replacement service/timer and preserved-route simulation;
- the complete C509/B407 compatibility smoke suite; and
- automatic rollback to the verified baseline.

It excludes live service management, Tailscale changes, OpenClaw job changes,
Calendar calls, provider reads/writes, kiosk changes, deployment, and legacy
removal.

## Read-only production inventory

The 2026-08-10 reduced inventory recorded only sanitized facts and digests:

- one Tailnet handler owns the exact `/classroom-screen` mount; route-reference
  fingerprint
  `sha256:51ddffe4ecc6852d910ccabd27feb0a3fabb4873f7f0ebbfcfef1d42b5dcc265`;
- the relevant replacement system-unit inventory contained four units, with
  two active and one failed; service-reference fingerprint
  `sha256:bf22ca4b7d5fee032e0538cb8cfa8b9f7e3cb3b0806cf76ffb71c4f81b5820c6`;
- the relevant OpenClaw inventory contained seven schedules, four enabled and
  none running; scheduler-reference fingerprint
  `sha256:8c82637c268743e7d74059eaca4ebdd425077dad086bbddbd65e22ef605f908d`;
- the disabled/quiescent M-15 writer-scope reference fingerprint is
  `sha256:8fe2743a835c15b078657ce3992216670513325f28193ebf05b061e4a8ad6839`;
  and
- no running Chrome process established the production kiosk contract; the
  negative observation fingerprint is
  `sha256:37fed25dd160970de461ab26994a78e11208de504ff57ade19c0e8943136d6b6`.

No private hostname, job identifier, provider value, runtime payload, or secret
is retained here. The failed refresh and required on-device candidate smoke are
explicit stop conditions.

## Authorized protected-reference and route preflight

On 2026-08-12 the user authorized one read-only inspection of the future
protected production references and the existing private route/backend. It made
no file, identity, service, scheduler, route, kiosk, or provider change and did
not open any protected file. Metadata checks established that the future
`classroom-hub` service account and every exact production root/reference named
by the inert templates are absent: `/opt/classroom-hub`,
`/etc/classroom-hub/server/production-server.json`, both production job
environment files beneath `/etc/classroom-hub/jobs`, the alert-delivery
provider directory, `/var/lib/classroom-hub/production`, and
`/var/lib/classroom-hub/powerschool-session`. None of the five exact production
service/timer names is installed. This is the expected non-provisioned baseline,
not readiness evidence and not permission to create those targets.

Installed Tailscale 1.102.2's documented read-only `serve status --json`
interface found exactly one `/classroom-screen` handler. The private listener
and raw backend are retained only as SHA-256 bindings in the inert target
proposal. The route uses a non-Funnel HTTP loopback proxy to port 20790 at `/`,
owned by the enabled and active user unit `classroom-screen.service`. Status-
only loopback probes returned 200 for `/`, `/classroom-screen`, `/health`, and
`/ready`; no body was retained. The route was not public through Funnel. This
closes the identity of the route to preserve while leaving its future switch
strictly M-17-gated. Tailscale's current official Serve reference documents the
status JSON interface and loopback reverse-proxy contract:
[Tailscale Serve CLI reference](https://tailscale.com/docs/reference/tailscale-cli/serve).

Installed systemd 259's `show` interface established that only the earlier
shadow units are present; exact version-matched online systemd 259 documentation
was unavailable, so the installed manager is the authority for this metadata
observation. The shadow server and timer remain active, and the prior shadow
refresh unit remains failed. No journal or protected environment was read.

## Authorized inert production provisioning

On 2026-08-12 the user separately authorized creation of the inert production
identity, directories, protected core configuration, a copied exact-scope
Classroom read grant, a generated operator token, and a hash-bound application
archive. The checked-in sysusers/tmpfiles contracts created the non-login
`classroom-hub` identity and owner-only state/reference directories. The
provisioner then atomically created five protected files, printed no protected
values, made zero provider requests, and installed or started no service. Its
sanitized evidence digest is
`sha256:f44cc79292695d89fd52b214f3fee629d5792ed51996cc132008952a68018494`.

The fully checked runtime was retained only as an unextracted root-owned `0600`
archive under `/opt/classroom-hub/releases`, bound by
`sha256:cc73d49e1a3aebfa6bda62375c1955167096cee34b8d82c082773ec02f0aef53`.
The executable `/opt/classroom-hub/dist` path remains absent, every production
unit remains uninstalled, the existing route was unchanged, and no TV action
occurred. Alert-delivery references remained deliberately unprovisioned at this
checkpoint; the later exact alert gate is recorded below. This is inert
readiness evidence only; it is not M-16 promotion or M-17 authority.

## Offline implementation

`src/application/cutover/rehearsal.ts` defines an exact 16-step manifest and
receipt sequence. It binds complete runtime/configuration and five target
reference classes, permits at most one writer, executes rollback after any
forward failure, and refuses incomplete rollback or RTO breach.

The entrypoint now validates and hashes the exact checked-in target-proposal
bytes independently into route, service-inventory, scheduler-inventory,
writer-scope, and kiosk-runtime reference classes. The same proposal file is
part of the complete source/build/additional-file implementation fingerprint.
Any proposal byte change therefore changes every target-reference hash and the
configuration fingerprint; an extra top-level field, unsafe value-shaped text,
wrong schema/status/timezone, or missing required section prevents rehearsal.

`src/entrypoints/m16-rehearsal.ts` implements that port only with disposable
loopback servers and temporary SQLite state. It creates and verifies a real
SQLite backup, deliberately changes the source after backup, restores into a
separate database, verifies the original marker and `PRAGMA integrity_check`,
and removes all temporary state.

The HTTP boundary now supports only the exact optional
`/classroom-screen` mount, the finite legacy read API aliases, and an explicit
`b407`-to-canonical-screen mapping. Generated manifest, asset, client, media,
QR, polling, preview, and operator URLs retain the mount. When enabled,
unprefixed paths return 404. Unsafe aliases, traversal, unexpected methods, and
legacy mode without the exact mount fail closed.

The compatibility contract is exercised both by the complete eight-state
fixture and by the actual persistent SQLite-backed display reader. The latter
proves the route layer is reusable by the non-fixture application rather than
being screenshot-only evidence.

`src/app/production-server.ts` and
`src/entrypoints/production-server.ts` now compose that persistent reader as
an inert, non-fixture production candidate. It accepts only one owner-only,
exact-shape configuration reference and one separate owner-only local operator
token, binds only to loopback, uses the exact `/classroom-screen` mount, and
loads no PowerSchool, Classroom, Calendar, scheduler, route-management, or
subprocess capability. No activation-ready unit, deployment artifact,
protected configuration, provider reference, or route points to this
entrypoint. The exact inert `systemd/classroom-hub.service.in` candidate does,
but
the `.in` suffix, pending marker, and absent `[Install]` section keep that
template non-installable.
Repository-contained paths, linked or missing managed state, nested database
and backup paths, and coupled configuration/token references fail before the
HTTP listener starts.

A Chrome 150 browser regression now renders every accepted state at the
documented native 3840×2160 output and both legacy-required viewport families,
1920×1080 and 1366×768. It proves bounded
document geometry, reduced-motion emulation, an on-screen keyboard-focused skip
link, local-only requests, no HTTP/console/page errors, and nonempty screenshots.
The first run exposed an unprefixed CSS poster URL; the stylesheet now resolves
that asset relative to itself, so mounted and unmounted routes both work. This
offline evidence does not establish the device's runtime WebView/CSS scaling;
the bounded on-device pre-cutover smoke remains authoritative for that fact.

## Smoke coverage

The switched replacement route verifies, in fixed order:

- the existing `/classroom-screen/b407` bookmark;
- legacy displays, day-plan, target, preview, QR, and media APIs;
- `no_classes`, `morning_overview`, `idle`, `pre_checkin`,
  `in_class_content`, `dismissal_warning`, `post_end`, and `day_complete`;
- manifest, icon, stylesheet, browser client, health, and readiness; and
- exact replacement route ownership on every observation.

The rehearsal never has two writers and always returns to the original route,
service/timer, writer, and backed-up state model.

## Measured evidence

The current exact-tree rehearsal completed with:

- status `passed`;
- evidence fingerprint
  `sha256:fa2b94ee8fb8e8c7e1f32c813ab83efceaa243e64a944753b8847aef79cb97cc`;
- total elapsed time 242 ms;
- rollback elapsed time 8 ms against the accepted four-hour RTO;
- maximum concurrent writers 1; and
- zero attempted/completed external mutations and zero live operational
  changes.

The closing full `npm run check` passes 668 tests plus documentation, fixture,
repository/systemd safety, formatting, strict types, client checks, production
build, startup smoke, the six-job operations rehearsal, and the M-16 rehearsal.
`git diff --check` is clean.

## Version-sensitive facts

The host inventory records Node 24.15.0, systemd 259, Tailscale 1.102.2,
OpenClaw 2026.6.11, Chrome 150.0.7871.114, and locked Playwright Core 1.62.0.
The responsive regression uses only APIs declared by the exact generated types
shipped in that official package; exact-version web documentation was not
available, so no undocumented behavior is assumed. Tailscale's official CLI
documentation was used for the read-only `serve status --json` contract, and
OpenClaw's official CLI documentation was used for `cron list --all --json`.
No command or configuration that changes those systems was invoked.

- [Tailscale Serve CLI reference](https://tailscale.com/docs/reference/tailscale-cli/serve)
- [OpenClaw cron CLI reference](https://docs.openclaw.ai/cli/cron)

## Inert target proposal

The accepted inert [M-16 target proposal](m16-target-proposal.json) freezes only
facts already
supported by approved repository evidence or the sanitized read-only inventory:
C509 as the canonical room, the preserved `b407` alias and
`/classroom-screen` route, candidate loopback port 4317, candidate service
name, all three verified viewport sizes, Asia/Ho_Chi_Minh, the accepted 07:20
Sunday-through-Friday PowerSchool replacement cadence, the superseded legacy
06:20 weekday observation, the legacy 06:30/06:45 weekday briefs, the
30-minute health cadence, and three legacy jobs that remain disabled. It does
not mistake the old 06:20 job for the accepted replacement target. It also records the
exact Hikvision model, installed Fully Kiosk version, accepted maintenance
window, and operator roles without inventing its WebView or viewport details.

It deliberately does not manufacture the TV's exact WebView version or CSS
viewport, protected alert destination, live repair evidence, private hostname,
or unobserved route value. The later authorized preflight adds only SHA-bound
route evidence and sanitized loopback facts.
Safe legacy source inspection characterized Classroom enrichment as an
asynchronous trigger only during `pre_checkin` and `in_class_content`, with a
30-second success throttle, post-failure retry at 60, 120, 240, 480, then at
most 900 seconds, last-known-good retention, and no display-request wait. The
user had authorized using that legacy configuration as the reference, so
proposal version 2 records those exact semantics. The offline-only
`active-job-handler.ts` validates a local target, admits exactly those two
states, selects only the matching current class mapping, and constructs source
authority only afterward. Inactive, malformed, wrong-date, unmapped, aborted,
and invalid-policy cases never construct it. At proposal acceptance the handler
was unwired; the later exact inert candidate described below implements the
accepted policy without activating it. The proposal remains an immutable target
record, contains no private target or identifier, and is not itself a service,
timer, command sheet, or live authorization.

## Accepted inert production jobs

Two separate non-installable service/timer candidates now implement the
accepted scheduler policy offline:

- `production-plan-refresh` invokes only the credential-free PowerSchool
  routine collector at 07:20 Asia/Ho_Chi_Minh on Sunday through Friday, with
  `Persistent=false` and no catch-up;
- `production-classroom-refresh` evaluates local SQLite/display target state
  30 seconds after activation or the preceding run completes, constructs
  Classroom authority only for `pre_checkin` or `in_class_content`, and then
  refreshes exactly one mapped current class.

The two entrypoints share only a provider-neutral bounded job runtime and local
SQLite ledger. They use distinct future environment files, reject nonempty
ambient variables from other provider families, and have no Calendar, alert,
JIT repair, route, service-management, or shell capability. The PowerSchool
candidate cannot import Classroom; the Classroom candidate cannot import
PowerSchool. Both service and timer files retain `.in`, have no `[Install]`
section, and are therefore not activation-ready. The exact manifest also keeps
brief delivery, alert provisioning, maintenance timer finalization, Calendar
handoff, and protected live references deferred.

Installed systemd 259 (`259.5-0ubuntu3`) documents `OnUnitInactiveSec` as
relative to the activated unit's last deactivation and `Persistent` catch-up as
applying only to `OnCalendar`. The candidate uses those exact semantics, and
`systemd-analyze verify` accepted temporary `.service`/`.timer` copies. The
official online exact-259 manual was unavailable, so this evidence relies on
the installed version-matched primary manual and does not extrapolate from a
different release.

Accepted ADR-0012 selects the existing Telegram-compatible
channel, 30-minute checks, six-hour repeats, new/recovery semantics, and
script-owned delivery policy. A fixed direct `sendMessage` adapter is now
offline-qualified against synthetic owner-only references and an injected
executor. It sends only redacted counts/timing, has a ten-second deadline, a
16-KiB response cap, no automatic retry, bounded provider classifications, and
post-attempt byte overwrite. It remains unreachable from jobs, services,
production reader, and systemd artifacts. The protected destination remains
deliberately absent from evidence. At this offline checkpoint it still required
value-free provisioning/verification; the later exact gate below completed
that setup and one fixed test without wiring routine authority.

Accepted [ADR-0020](../decisions/0020-just-in-time-powerschool-repair.md)
turns the operator's low-friction repair request and proven legacy method into
a bounded isolated capability. The offline implementation uses fixed
owner-only references, installed 1Password CLI 2.34.1, a bounded overwritten
stdin packet, one fixed child process group, a disposable visible profile,
recognized username/password/TOTP states, passive phone approval, exact marker
verification, and PowerSchool-only state filtering. Synthetic Chrome proves
success, credential-free routine reuse, failure/abort/timeout/concurrency
cleanup, and foreign popup/unknown challenge refusal. It preserves ADR-0014's
credential-free routine path and rejects the legacy persistent profile.

The later separately authorized live preflight provisioned the protected fixed
references and completed one bounded three-reference read. Its browser phase
failed closed at `repair-policy-violation` and wrote no session state. Offline
diagnosis corrected a guard defect that counted exact-allowlisted resource
iframes as top-level identity navigations; synthetic Chrome now proves those
GET/HEAD child frames are allowed while pre-frame and foreign popups remain
blocked before egress. A retry with the exact approved Google resource origins
then stopped before browser launch at `repair-secret-unavailable` because the
1Password desktop process had crashed and no Bren graphical session remained.
The user then explicitly authorized a bounded headless repair using the proven
legacy protected 1Password service account. The replacement now parses only
the service-account token from that owner-only file without shell evaluation,
passes it only to the three fixed reads, scrubs it before browser launch, and
keeps it unreachable from every routine/service/scheduler path. The protected
file passed value-free validation and the secret reads completed without a
desktop prompt. The first headless browser attempt stopped at
`unexpected-challenge` and wrote no state. Legacy comparison showed that the
replacement's 1.5-second unknown-transition refusal was substantially shorter
than the proven bounded wait; it now observes without action for at most ten
seconds, with synthetic delayed-TOTP and unknown-challenge regressions.
The pre-existing filtered state was owner-only and structurally safe but an
exact credential-free routine read returned `session-state-rejected`,
confirming expiry. No PowerSchool mutation occurred and no replacement state
was written. The separately authorized post-grace retry completed without
writing replacement state. Its exact final sanitized worker classification was
lost during the cross-task handoff, so the record makes no stronger claim; an
immediate credential-free routine read again returned
`session-state-rejected`. The attempt is therefore treated as a non-success and
was not repeated.

A second source-only comparison with the proven legacy implementation found two
additional finite Google challenge-selection states: an explicit `Enter your
password` choice and an explicit authenticator-code choice. The replacement now
recognizes only those named choices on the identity origin's
`/challenge/selection` path. Synthetic Chrome proves the complete
username-selection-password-selection-TOTP sequence, while unknown challenge
markup still fails closed and deletes the disposable profile. This refinement
was then used in one separately authorized bounded headless attempt. Fixed
1Password reads again completed without a desktop prompt, but Google returned
another `unexpected-challenge`; no replacement state or provider mutation was
produced. The attempt was not repeated.

A third source-only legacy comparison found the remaining finite transition:
the explicit `Try another way` control that reveals the already-recognized
authenticator choice. The replacement now permits that named action once per
repair before returning to the exact challenge-selection policy. Synthetic
Chrome proves the security-key-to-alternatives-to-TOTP sequence, and the
unknown-challenge regression remains fail-closed. This latest refinement is
offline-qualified and the full offline gate passes 628 tests. A separately
authorized bounded attempt then exercised it: fixed 1Password reads again
completed without a desktop prompt, but Google still returned
`unexpected-challenge`. No state or provider mutation was produced, and the
attempt was not repeated.

The final source-only launch comparison found no evidence that merely adding a
virtual display would resolve this blocker. The legacy repair-completion script
explicitly configured its CDP browser as headless. Its separate headed/noVNC
launcher uses a durable profile and `--no-sandbox`, so it is not transplanted
into the fresh-profile replacement boundary.

The user then separately authorized one value-free diagnostic attempt. Before
that provider action, the repair result contract was narrowed so
`unexpected-challenge` must carry exactly one finite category: ambiguous
account choice, account verification, browser rejection, CAPTCHA,
passkey/security key, recovery, unrecognized selection, or unclassified. The
classifier retains no page text, URL, title, screenshot, selector inventory, or
provider value. Synthetic Chrome proves security-key classification, and the
supervisor rejects missing or unknown categories before emitting IPC output.
The one authorized categorized attempt completed its fixed 1Password reads
without a desktop prompt and returned `browser-rejected`. It wrote no state and
performed no provider mutation. This establishes that the remaining blocker is
Google's rejection of the automated browser, not another unidentified
password/TOTP transition; no retry was made.

A later authorization covered offline implementation only of the proven
legacy launch distinction. The candidate now starts exact installed Chrome 150
directly in a new disposable profile with the sandbox retained, exposes only an
ephemeral loopback CDP endpoint, attaches Playwright Core 1.62, and creates a
service-worker-blocked/download-disabled context before installing the existing
repair guards and performing any application navigation. Synthetic localhost
success proves filtered-state export and credential-free routine reuse; the
real direct-launch failure path proves profile deletion. The implementation
does not copy the legacy durable profile, `--no-sandbox`, noVNC/Xvfb,
environment sourcing, or broad cookie extraction. No provider, 1Password,
protected-reference, service, deployment, or TV action occurred. Whether
Google accepts this direct launch remains unverified and requires a new,
explicit live authorization.

The user then supplied that authorization for one bounded 2026-08-11 attempt,
with a credential-free status/bell read allowed only after successful repair.
The direct-CDP browser again returned
`unexpected-challenge/browser-rejected`; it did not reach the PowerSchool
marker or write replacement state. Because the prerequisite failed, the
routine read was not run. Local post-run checks found neither a disposable
repair profile nor a Chrome process. The live-readiness gate remains open and
no retry is authorized.

The user then authorized one bounded bridge through the existing legacy
PowerSchool browser lane, without profile-file access. Exact installed OpenClaw
2026.6.11 produced its JSON cookie envelope for the named PowerSchool profile;
the bridge filtered it to 11 PowerSchool-host cookies, atomically wrote only the
ADR-0014 state shape, and scrubbed the captured buffers. The conditional
credential-free status/bell read for 2026-08-11 returned
`repair-required/session-state-rejected`. Thus the legacy profile's current
PowerSchool cookies are not a reusable authenticated replacement session. No
Google state was retained, no legacy repair or login was invoked, no provider
mutation occurred, and no temporary profile or Chrome process remained.

The user subsequently authorized one invocation of the legacy lane's existing
bounded `repair_auth` capability followed by the same filtered bridge and one
credential-free read. The legacy preflight found its managed profile already
authenticated, so it did not retrieve credentials, contact Google, or perform a
new sign-in. OpenClaw again exported 11 cookies through its application-owned
interface; Classroom Hub retained only the PowerSchool-host subset and no
origin storage. The clean routine collector then completed the exact status and
bell reads for 2026-08-11 with no credential, 1Password, Google, repair, or
operator capability and returned one fresh verified three-period C509
observation. No PowerSchool business-data mutation occurred, and post-run checks
found no Classroom Hub temporary profile or Chrome process. Because the host's
operational timezone is Asia/Ho_Chi_Minh and local time was already 2026-08-12,
this is prior-day acquisition evidence rather than a current-day readiness
observation. It proves credential-free filtered-state reuse, but it does not
close the fresh-plan gate, qualify the replacement JIT browser as a successful
live repair, or authorize the legacy profile/bridge as steady-state
architecture.

The user then separately authorized one exact read for the current
Asia/Ho_Chi_Minh date, 2026-08-12, using only that filtered state. The routine
collector failed closed with
`repair-required/session-state-rejected`. It did not invoke repair, Google,
1Password, credentials, or another provider attempt. The successful prior-day
read is therefore transient reuse evidence, not current-day or longevity
readiness. Per the stated stop condition, no automatic retry or manual sign-in
was requested.

The subsequent offline-only comparison found one concrete request-contract
difference: the proven legacy session-HTTP reader sends a browser user-agent
and same-origin referrer, while the replacement used Node's default request
identity. The routine collector now derives the installed Chrome user-agent
from its blank disposable page, normalizes only the exact headless product
token, and sends the exact PowerSchool-origin root as referrer. Its method,
origin, path, redirect, response-type, byte, deadline, and filtering boundaries
are unchanged. Synthetic Chrome now proves response-cookie rotation survives
two independent collector runs and distinguishes sanitized status-stage from
bell-stage session rejection. No provider, protected-state, repair, Google, or
1Password action occurred during this offline correction.

The user then authorized one consolidated, non-repairing live gate: confirm the
legacy managed profile was already authenticated, export only its filtered
PowerSchool cookies, and attempt two exact routine reads for the current
Asia/Ho_Chi_Minh date. The application-owned legacy probe returned
`already_authenticated` without repair, sign-in, Google, credentials, or
1Password. The strict bridge retained 11 PowerSchool-host cookies. The first
corrected routine read failed closed at the status-page boundary with
`repair-required/status-session-state-rejected`; therefore the second read was
not attempted. No repair, retry, provider mutation, retained temporary profile,
or Classroom Hub Chrome process resulted. This narrows the live failure to the
status-stage session contract and leaves both current-day readiness and
filtered-session longevity open.

The user separately authorized one value-free provider diagnostic after the
collector gained finite redirect/unauthorized/forbidden classifications. The
same exact 2026-08-12 status request returned
`repair-required/status-session-redirected`. The collector did not follow the
redirect and retained no destination, header, body, cookie value, or page
content. It made no bell request and invoked no repair, Google, 1Password, or
credential path. This proves the status-stage rejection is an HTTP redirect,
not a 401, 403, marker mismatch, browser failure, or response-policy failure.

Exact-version verification identified installed Node 24.15.0 and bundled
Undici 7.24.4. The matching Node reference documents stable Undici-backed
`fetch`, while the Fetch Standard defines relative `Location` parsing. A final
authorized non-following diagnostic retained only HTTP status, normalized
pathname, and applicable-cookie counts. The exact status request carried 11
applicable cookies and returned HTTP 302 to `/oidc/openid_connect_login`; the
bell path also had 11 applicable cookies but was not requested. PowerSchool's
public SIS 25.1 OIDC service-provider documentation identifies that exact path
as its external-identity-provider authentication endpoint. The tenant's exact
SIS version is unavailable, so no broader version-specific behavior is
inferred. The collector now classifies the exact OIDC path as
authentication-required and continues to block it. No query, origin, header,
body, cookie name/value, or page content was retained, and no bell request,
repair, Google, 1Password, or credential path ran.

## Open gates

### Accepted persistent compatibility option

The offline candidate now has a separate compatibility supervisor, worker,
collector, and existing-adapter source. It uses an external owner-only
Google-bearing Chrome profile, permits browser-native silent OIDC only across
the exact configured PowerSchool/identity/resource origins, and then reads only
the approved status and dated bell pages. It receives no credential or
1Password authority and refuses visible identity interaction. The explicit JIT
repair command alone may target the same retained profile while keeping its
fixed-reference and secret-scrubbing boundary.

Real installed Chrome 150 synthetic evidence proves fixed
username/password/TOTP repair into a persistent profile, deletion of the
PowerSchool cookie, silent reauthentication through retained identity state,
exact status/bell acquisition, normalization through the approved schedule
contract, and a second independent collector run. It also proves an empty
profile returns repair-required without submitting a form. Architecture tests
keep this capability out of every service, timer, job, Calendar path, and
production reader. The focused compatibility/config/worker/JIT suite passes 42
tests. No protected profile, credential, 1Password item, or provider was
accessed for this evidence.

Playwright Core is locked at 1.62.0 and the installed browser is Chrome
150.0.7871.114. Current official Playwright documentation corroborates the
dedicated persistent-directory and one-concurrent-launch contracts, but an
exact version-pinned 1.62 online page was not available; locked local types and
the synthetic suite are the exact-version evidence. Browser-native SSO cannot
provide a hard pre-transfer cap for an undeclared or encoded response body, so
the lane retains request-count/deadline and declared-size refusal without
claiming a complete byte cap.

### Separately authorized current-date compatibility gate

Read-only host preflight found the proven `powerschool` Chrome profile already
running under OpenClaw 2026.6.11 with a healthy loopback CDP endpoint. Classroom
Hub did not inspect or copy its profile and did not launch a competing browser.
Because Playwright and Chrome permit only one owner of a user-data directory,
the profile remained under its existing owner and the live gate used the
legacy lane's fixed `get_bell_schedule` and `repair_auth` interfaces instead of
the repository's new-profile launcher.

The first exact 2026-08-12 refresh returned sanitized `repair-required` and
stopped without repair. Under the user's explicit authorization to use the
proven legacy authentication method, one non-forced `repair_auth` call returned
`authenticated`; no manual sign-in was requested. The conditional second
read-only refresh returned:

- effective date `2026-08-12`;
- period count `4`; and
- source `session-http`.

Only those bounded facts were retained. No class name, period detail, URL,
identifier, cookie, raw page, credential, prompt code, student/grade surface,
or provider-write result entered repository evidence. The calls made no
PowerSchool business-data mutation. This closes the current-date schedule-read
gate through the user-approved temporary legacy compatibility source. It does
not prove the repository-owned persistent-profile launcher against the tenant,
authorize concurrent profile ownership, or wire the source into a service.

An earlier bounded gate used an isolated non-delivering OpenClaw agent turn and
created a transcript because official documentation search did not identify a
direct fixed-tool gateway RPC in installed 2026.6.11. The later candidate gate
did not repeat that dependency: it invoked the legacy plugin's deterministic
service implementation directly and retained only sanitized status/date/count/
source evidence. A production bridge still must not depend on an LLM or
transcript. The safe long-term choices remain exclusive profile handoff to the
repository-owned collector or a separately reviewed fixed local tool bridge.

### Authorized production candidate and on-device evidence

On 2026-08-12 the exact deployed release
`sha256:002264cb6de9d04f18a0da4737b71510981b3027d1cb9f18429a8bfab4d0c823`
completed the real candidate smoke after one strict filtered-state bridge from
the already-authenticated legacy managed profile. The bridge used OpenClaw's
installed application interface rather than profile-file access, retained 11
PowerSchool-host cookies and no origin storage, printed no values, and wrote
the service-owned state through Classroom Hub's strict shape and permission
boundary. A direct legacy browser read had first returned four periods for
2026-08-12 without sign-in, credential retrieval, Google traffic, or provider
mutation.

The production plan job then returned `succeeded`. The Classroom job returned
its defined inactive `skipped` result with exit code 2, so no Classroom source
authority was constructed. The transient production reader started on
loopback port 4317; the display, health, and readiness routes each returned 200. A separate Tailnet-only HTTPS listener on port 16443 exposed only this
candidate while the existing private 9443 listener and legacy 20790 backend
remained byte-for-byte unchanged in the observed routing map.

At 15:54 Asia/Ho_Chi_Minh the live controller correctly selected
`day_complete` for the imported four-period plan. Its visible fallback said
that it was waiting for the next imported schedule because the separately
deferred evening next-class-day source had not imported a future plan. This is
not evidence that the current-day plan was absent. A read-only pinned
`in_class_content` preview was briefly mapped to the same candidate URL for the
physical smoke. The first mapping intercepted asset subpaths and visibly
rendered unstyled; the mapping was corrected, every CSS, JavaScript, SVG, and
manifest request returned 200, and disposable Chrome 150 confirmed one loaded
stylesheet, a decoded image, no horizontal overflow, and the accepted styled
composition. The user then supplied a physical Fully Kiosk/Wondershare photo
showing the styled header, course identity, clock/date, content frame, and
countdown without visible clipping. The pinned handlers and the entire 16443
candidate listener were subsequently removed. The preserved legacy loopback
display still returned 200.

This closes the on-device candidate rendering/readiness portion of M-16. It
does not promote M-16, authorize M-17, make the temporary legacy bridge steady
state architecture, or silently complete the deferred evening next-class-day
source.

The remaining alert-authority setup now also has an offline-only inert
provisioner. It binds the fixed legacy operations source to its reviewed
SHA-256 before extracting exactly one destination without evaluating the
source, validates the separate owner-only bot-token file, and can create only
three service-owned `0600` files beneath the fixed
`/etc/classroom-hub/providers/alert-delivery` directory. It overwrites all
in-memory source/value buffers and reports only a policy digest and zero-value,
zero-request counters. Focused synthetic tests reject source drift, duplicate
or malformed destinations, malformed tokens, coupled paths, and any service,
routing, subprocess, HTTPS, or Telegram capability in the provisioner. The
provisioner was later applied once under the exact approved proposal. It
created three protected files, printed zero values, made zero provider requests,
and installed or started no unit. Its sanitized policy digest was
`sha256:3a628c2ca10d64684f16955c4c4819c1217bf22784145ccda642f523b8582a1f`.
The service-owned target directory was subsequently observed as mode `0700`;
its contents remained unreadable to the unprivileged operator account, as
intended. The existing direct adapter remains unwired; its eventual exact
production job belongs to separately authorized M-17.

A separate one-shot qualification entrypoint is also offline-qualified. It
accepts only `--execute`, the fixed protected reference path, and an environment
without any other Classroom Hub/provider authority. It sends exactly the fixed
text “Classroom Hub alert delivery test / No operational issue is being
reported.” through the already bounded adapter and emits only delivered/failed
counters and a finite code. It has no state, service, timer, routing, Calendar,
PowerSchool, or Classroom capability and remains unreachable from every routine
entrypoint and systemd artifact. The secret-free inert runtime archive is
`/tmp/classroom-hub-m16-alert-qualification-runtime.tar.gz`, SHA-256
`a45b90c3414088871262a2f2954d2a89344d8b8c663e2fa7482448dccc763396`;
its fixed installer can advance only from the physically qualified candidate
release and reports zero messages/provider requests. Neither archive nor
entrypoint had been installed or executed at proposal time. After exact
approval, the fixed installer advanced only from the expected predecessor to
release
`sha256:a45b90c3414088871262a2f2954d2a89344d8b8c663e2fa7482448dccc763396`
and reported zero services, routes, provider requests, and messages. One
service-user execution then reported exactly one attempted and delivered
message, zero service/route changes, and zero application-state writes. It was
not retried. The transient candidate is inactive and no production Classroom
Hub service is installed or active.

The complete value-free execution proposal binds the archive, prior release,
installer, provisioner, compiled entrypoint, compiled adapter, literal-message
digest, fixed reference, service identity, one-message maximum, zero
service/route changes, and deferred M-17 wiring. Its canonical proposal
fingerprint is
`sha256:73870c7ca90294e4dd6e71fc8f7e26fcc8ac65e596e3902e0a0c901332f7ee3b`.
Approval of any different byte, path, user, message, count, or effect is not
implied.

All M-16 completion gates are closed: the intended recipient was confirmed;
the SHA-bound preserved private listener, current loopback backend, future
port-4317 handoff, maintenance window, roles, and stop conditions were
approved; and the measured runbook, four-hour recovery objective, exact target
references, and on-device candidate disposition were explicitly accepted.
Promotion is evidence approval only. It installs/enables no production service
or timer, changes no route or TV, and grants no M-17 authority. M-17 remains a
separate live authorization; M-18 stabilization and removal remain later,
independently gated work.
