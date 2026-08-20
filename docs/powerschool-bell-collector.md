# Offline PowerSchool session collector

## Boundary

M-07C provides an offline-qualified, read-only PowerSchool bell collector with
separate routine, manual-repair, accepted ADR-0020 just-in-time-repair, and
accepted ADR-0021 persistent-compatibility commands. The repair and
compatibility paths are qualified only against synthetic origins; this does not
itself authorize live provider or 1Password use. Separately authorized live
attempts and their sanitized outcomes are recorded in the M-16 review package.

```sh
npm run build
npm run ops:powerschool-session-bootstrap -- YYYY-MM-DD
npm run ops:powerschool-jit-repair -- --operator-present YYYY-MM-DD
npm run ops:powerschool-bells -- YYYY-MM-DD
npm run ops:powerschool-bells:compatibility -- YYYY-MM-DD
```

The bootstrap is an explicit operator-present repair action. It opens visible
Chrome and waits for the operator to complete PowerSchool/Google SSO. It does
not retrieve credentials, invoke 1Password, fill fields, click controls, or
respond to identity challenges. The routine command cannot navigate to the
identity origin or invoke the bootstrap.

The JIT command is a separate high-authority entrypoint that refuses to start
without the literal `--operator-present` acknowledgement. It loads one
owner-only external exact-shape JSON file containing only three fixed `op://`
references, resolves them with fixed `/usr/bin/op read ... --no-newline`
arguments, and sends the bounded values to one fixed worker through stdin. An
explicitly authorized headless repair may additionally name one protected
legacy environment file; the supervisor securely parses only
`OP_SERVICE_ACCOUNT_TOKEN` as data and never evaluates that file as shell.
That service-account token reaches only the three fixed `op read` processes,
is scrubbed before browser launch, and is never forwarded to the worker.
Service-account mode gives those reads one fresh private, cache-disabled
1Password CLI configuration directory and removes it before returning; it
does not depend on or write the service account's home directory. A cleanup
failure scrubs any acquired value and fails the repair closed. Desktop-backed
mode retains the operator's existing CLI configuration path.
Each fixed reference read has a 60-second deadline inside the five-minute
top-level repair deadline. Desktop-backed mode permits a visible 1Password
approval; service-account mode requires no desktop app.
They never enter argv, the child environment, Git, SQLite, or a durable file.
The worker recognizes only expected username, password, TOTP, account
selection, and passive phone-approval states. A standard identity transition
may remain actionless for at most ten seconds before it fails closed; unknown
challenges receive no click or value.
The current offline candidate starts installed Chrome directly against the
fresh profile with its sandbox enabled and a loopback-only ephemeral CDP port,
then attaches locked Playwright Core 1.62.0 before creating a
download-disabled, service-worker-blocked browser context. It does not reuse
the legacy durable profile, `--no-sandbox`, or the Playwright browser-launch
path that Google classified as `browser-rejected`.
Parent buffers and the transfer packet are overwritten after delivery; the
short-lived child owns the unavoidable browser-library strings and exits after
profile cleanup.

## Persistent compatibility lane

Accepted [ADR-0021](decisions/0021-persistent-powerschool-compatibility-lane.md)
adds a fourth opt-in capability modeled on the proven legacy schedule-reader
lifecycle. It is a deliberate exception to ADR-0014, not a change to the
passive collector. It uses one dedicated owner-only persistent Chrome profile
and may follow browser-native silent OIDC between the configured PowerSchool
and Google identity origins. The routine compatibility worker receives no
credential, 1Password, repair-reference, form-fill, or generic navigation
capability. A visible email, password, TOTP, phone, passkey, CAPTCHA, recovery,
or other interactive identity state returns a sanitized repair-required result.

The exact additional setting is
`CLASSROOM_HUB_POWERSCHOOL_COMPATIBILITY_PROFILE_DIRECTORY`. It must be a
normalized external path, must not overlap the filtered session directory, and
is created/validated as owner-only mode `0700` protected runtime state. The
profile may retain Google identity and PowerSchool state. It must not be
inspected, copied, committed, placed in SQLite, captured as evidence, or
included in ordinary backups. OpenClaw and Classroom Hub must never launch it
concurrently.

An explicit repair may target that same profile only with:

```sh
npm run ops:powerschool-jit-repair -- \
  --operator-present --persistent-compatibility YYYY-MM-DD
```

Only the repair supervisor can resolve the fixed 1Password references. The
profile path is validated before secret access and scrubbed from the child
browser environment along with all secret authority. On success the profile is
retained; the filtered PowerSchool state is still refreshed for compatibility
with the passive lane. The original disposable JIT syntax and behavior remain
unchanged.

The compatibility collector installs its context-wide HTTP/WebSocket, popup,
download, origin, method, and main-frame request-count guards before navigating
to the exact status and dated bell URLs. It requires both configured markers,
retains only bounded bell markup in memory, and normalizes through the existing
M-07A/M-07B observation contract. It stores no page capture. Browser-native SSO
cannot enforce a true pre-transfer cap on an undeclared or encoded body; a
declared oversize fails closed and the overall deadline remains finite, but the
shared byte setting is not a hard aggregate compatibility-lane transfer cap.

Installed Playwright Core 1.62.0 is the locked implementation version and
Chrome 150.0.7871.114 is the synthetic runtime. Current official Playwright
documentation confirms the dedicated `userDataDir`, stored cookie/local-storage,
single-launch, close-context, and no-default-profile contracts at
<https://playwright.dev/docs/api/class-browsertype#browser-type-launch-persistent-context>.
An exact version-pinned 1.62 online page was not available; locked local 1.62
types and the synthetic Chrome suite are the exact-version evidence.

M-17's two plan units now select this lane through the fixed supervised
retained-session entrypoint. No other job, service, timer, or route may access
the profile. Live use still requires the exact Chalkwright-owned profile,
credential-free process boundary, and separately authorized provider read; it
does not justify another manual sign-in.

## Protected state

`CLASSROOM_HUB_POWERSCHOOL_SESSION_DIRECTORY` must be a normalized absolute
path outside the repository. The implementation creates or requires the
directory at mode `0700`, rejects symlink components, hard links, unknown state
fields, and wrong ownership, and stores `.classroom-hub-auth-state.json` as an
atomic single-link mode-`0600` regular file.
The saved payload contains only cookies applicable to the configured
PowerSchool host and storage for the exact PowerSchool origin. It must be
handled as sensitive runtime state and excluded from Git, SQLite, logs,
screenshots, fixtures, evidence, and ordinary backups.

The passive, manual, JIT, and compatibility commands acquire one exclusive
lock. A concurrent invocation returns a sanitized refusal. Disposable manual,
JIT, and passive operations create a new mode-`0700` temporary Chrome profile
under the host temporary directory and remove the whole profile after success,
rejection, failure, abort, or timeout. The protected filtered-state directory
is never used as browser profile storage.

ADR-0021 is the one explicit exception to the temporary-profile rule: its
dedicated external profile is retained across runs and is never the filtered
state directory.

## Configuration

Safe placeholder names are listed in `.env.example`. Shared settings define the
exact HTTPS PowerSchool origin, exact bell path template, verified marker,
optional expected school text, external state directory, Chrome executable,
navigation timeout, and byte budget. Routine-only settings define room, exact
status path/marker, overall timeout, finite request budget, and display date
offset. The manual deadline is active. Identity origin, bootstrap resource
origins, bootstrap request count, and the shared byte value remain validated
configuration-schema compatibility inputs but do not confine the browser-native
operator phase and must not be treated as security controls.

No configuration field accepts a username, password, one-time code, form
selector/value, arbitrary command, generic URL, or request body. The JIT-only
reference variable names one owner-only file outside the repository; that file
may contain only three exact, distinct 1Password references, with the TOTP
reference requiring `attribute=otp`. It is not forwarded to the browser child.
Non-loopback origins must use HTTPS.

## Passive read behavior

The routine supervisor forwards only a fixed allowlist of passive settings to a
fixed child process. The child loads validated filtered state, launches
headless Chrome with downloads disabled and service workers blocked, installs
an all-network-abort route, disables JavaScript, and injects the saved state.
Node.js then performs one exact status `GET` followed, when policy permits, by
one exact dated bell `GET`. Redirects are not followed, response types are
restricted to HTML, and the combined body is streamed beneath a hard byte cap.
The bounded HTML is rendered only in the network-blocked page so scripts cannot
expand provider access. The tenant's authenticated bell session may redirect
the auxiliary teacher-home status path to a recognized same-origin
authentication endpoint. In that one case the collector continues to the bell
request and accepts the session only when the exact private bell page passes
its marker and expected-school-text checks. Unauthorized, forbidden,
cross-origin, invalid, unrelated same-origin, and teacher-page status outcomes
still stop before the bell read.

Each HTTP read uses a bounded user-agent derived from the installed Chrome
context, with only the exact `HeadlessChrome/` product token normalized to
`Chrome/`, plus the exact PowerSchool-origin root as referrer. This preserves
the proven legacy session-HTTP request identity without hard-coding a stale
browser version or widening any origin, method, path, redirect, or body rule.
Successful response cookies are applied to the disposable context and the
filtered state is atomically refreshed. Synthetic Chrome proves a rotated
cookie survives two independent collector runs. A rejected response is
classified without retaining URL, header, or page content: status and bell
codes distinguish `unauthorized`, `forbidden`, invalid redirect, cross-origin
redirect, legacy-recognized authentication redirect, legacy-recognized teacher
redirect, and other same-origin redirect outcomes. Redirects remain blocked in
every category.

The live tenant additionally accepts the browser-authenticated bell page while
redirecting a replay of the same filtered cookies through Node's HTTP stack.
Only after the exact Node bell request returns the recognized authentication
redirect, the same disposable credential-free Chrome context may retry that
one exact bell URL as a browser-native main-document `GET`. Chrome protocol
request interception allows only that first exact request and fails every
redirect, identity request, and subresource before the wire. JavaScript,
downloads, service workers, popups, credentials, forms, and identity-origin
authority remain absent. The successful body must still be HTML, remain within
the configured streamed byte limit, and pass the exact URL, marker, and
school-text checks before its filtered PowerSchool state is refreshed. The
capture is labelled `browser-read`; an unsuccessful retry preserves the
sanitized authentication-repair result.

The live tenant's first installed browser-native retry still received that
authentication redirect after a successful native repair. The retained-state
filter had been using `storageState()` cookies, whose locked Playwright 1.62
return type omits the optional CHIPS partition key even though
`context.cookies()` and `context.addCookies()` support it. Repair and routine
refresh now capture cookies through `context.cookies()`. They retain a
partitioned cookie only when its partition key is the exact configured
PowerSchool origin or Chrome's immediate schemeful parent site, and preserve
Chromium's exact `hasCrossSiteAncestor` component exposed by locked Playwright
1.62. They reject every foreign, broader, or incomplete partition and restore
filtered cookies separately after local state. The bounded Node lane never
flattens a retained partitioned cookie into a raw `Cookie` header and rejects
`Partitioned` response cookies because a Set-Cookie header alone does not carry
the complete browser partition key.
This prevents both loss of an applicable PowerSchool partition and accidental
conversion to a broader unpartitioned cookie. A disposable installed-Chrome
regression round-trips both ancestor values. The current Playwright
authentication guide confirms that browser
state is sensitive impersonation material; exact 1.62 behavior is additionally
bound by the installed runtime source and Chrome regression because the public
guide tracks the current release rather than an archived 1.62 page:
<https://playwright.dev/docs/auth>.

The schemeful site is the URL scheme plus registrable domain, not a fixed
number of DNS labels. Chalkwright therefore uses exact-pinned `tldts` 7.4.9
with ICANN and private Public Suffix List rules enabled. Its official package
documentation defines `getDomain` as the registrable-domain operation and
documents the private-suffix option: <https://www.npmjs.com/package/tldts>.

The runtime contract was checked against exact installed Node 24.15.0 with
bundled Undici 7.24.4. Node documents `fetch` as a stable Undici-backed Web API,
and the Fetch Standard defines parsing `Location` relative to the response URL.
The exact-version Node reference is
<https://nodejs.org/download/release/v24.15.0/docs/api/globals.html#fetch>; the
redirect algorithm is <https://fetch.spec.whatwg.org/#http-redirect-fetch>.
PowerSchool's public SIS 25.1 OIDC service-provider documentation identifies
`/oidc/openid_connect_login` as its external-identity-provider authentication
endpoint. The exact tenant SIS version is unavailable, so no broader
version-specific behavior is inferred. The collector recognizes that one exact
path as authentication-required and still does not follow it. The reference is
<https://ps.powerschool-docs.com/pssis-admin/25.1/powerschool-sis-as-oidc-service-provider-for-sso>.

Missing/rejected state, a rejected bell request, or a missing required marker
returns `repair-required` without Google, credentials, or SSO. Filtered state is
refreshed atomically only after the status marker passes or its narrowly
recognized authentication redirect is superseded by the exact authenticated
bell marker. Bell content continues through the approved M-07A/M-07B parser and
schedule-observation port; M-07C adds no parallel bell model.

## Containment limitations

Both the ordinary Node path and the narrowly triggered browser-native retry
retain a hard streamed byte cap. The latter pauses the exact response at
Chrome's protocol boundary, rejects an oversized declared length, reads the
body through a bounded sequential stream, and only then fulfills the local
page. Its request surface remains one exact PowerSchool document GET with no
followed redirect.

The fixed process-group supervisor enforces the overall deadline while the
worker stops five seconds earlier to reserve profile/lock cleanup time. It
propagates external aborts, sends graceful termination, escalates to forced
process-group teardown, and verifies descendant quiescence before returning.
The retained-plan production parent remains alive for a bounded 3.5-second
post-cancellation interval, which exceeds the supervisor's two-second graceful
termination plus one-second forced-quiescence proof. Other production jobs
retain the ordinary one-second hard-stop grace.
The manual operator-present bootstrap uses normal browser identity navigation
and does not claim application-level origin, method, request-count, or
response-byte confinement. The managed persistent-context JIT browser starts
Chrome before application routing exists, but starts only at its empty initial
page; no application navigation occurs until the managed context has its
guards. The JIT browser installs context-wide HTTP and WebSocket guards before
navigation, permits PowerSchool GET/HEAD plus expected identity GET/HEAD/POST
flows, enforces a main-frame navigation count, permits GET/HEAD child-frame
loads only from the same exact resource-origin allowlist, and treats
non-top-level HTTPS PowerSchool same-site `OPTIONS`/`POST` requests as
browser-internal resource traffic rather than top-level application writes,
rejects pre-frame/foreign popups and downloads, and rejects declared oversized
responses. Browser-
native SSO still prevents a hard cap on an undeclared response body, so the
shared byte value is not represented as a complete JIT transfer cap. Both
repair paths always remove their temporary profile, and only state filtered to
the exact PowerSchool origin may be written after the exact bell marker is
visible. Routine Node.js reads use the separate strict route contract and hard
streamed cap.

## Deferred operation

The future Sunday-through-Friday 07:20 Asia/Ho_Chi_Minh cadence, with Saturday
excluded, remains a requirement only. M-07C contains no service/timer template
for this collector and does not install, enable, or activate any scheduler.
Restart/upgrade behavior, live expiry/revocation, unattended longevity, and the
exact systemd calendar/missed-run policy remain later gates.

## Characterized legacy repair reference

The user identified the prior OpenClaw PowerSchool browser lane as the proven
repair reference. A source-only review found a distinct, explicitly consented
repair command that first probes the existing session, resolves fixed
1Password references only for repair, drives a bounded Google sign-in in a
managed visible Chrome target, passively waits when Google requires phone
approval, verifies usable PowerSchool cookies, and leaves ordinary reads on a
separate session-HTTP path. No credential or protected profile content was
opened during this characterization.

That implementation began as evidence rather than transplanted code. Its direct
environment-file sourcing, gateway restart, broad cookie extraction, student
and grade surfaces, raw captures, and generic routine coupling still conflict
with the accepted boundary. ADR-0021 later accepts only its dedicated
persistent-profile schedule-read/authentication lifecycle as a separate,
higher-authority compatibility lane. Accepted ADR-0020 and its authorized offline
implementation adapt only the useful method: explicit repair authority, fixed just-in-time
1Password references, a disposable visible profile, bounded automatic
username/password/TOTP steps, passive human approval when Google demands it,
exact PowerSchool marker verification, PowerSchool-only state export, complete
temporary-profile deletion, and immediate credential/environment scrubbing.
The routine collector must remain unable to import or invoke any of those
capabilities. Synthetic tests cover fixed-reference selection, ephemeral
transfer and overwrite, username/password/TOTP, passive phone approval,
unknown challenge and popup refusal, filtered output, credential-free routine
reuse, concurrency, abort, timeout, and profile deletion. Reference
provisioning and one bounded three-reference read were later separately
authorized. That browser attempt failed closed at a policy violation without
writing state. After an offline iframe-classification fix, an exact-origin
retry stopped before browser launch when desktop 1Password authority was
unavailable. Successful repair and credential-free routine reuse remain the
gate for the replacement JIT design; the design itself does not require a
manual PowerSchool sign-in.

The earlier direct-CDP alternative was retained only as offline evidence. The
standalone repair now uses a managed Playwright persistent Chrome context,
matching the proven legacy repair's launch model while retaining the
Chalkwright-owned profile, enabled Chrome sandbox, fixed request boundary, and
bounded cleanup. Synthetic localhost tests exercise the managed launch,
identity/PowerSchool guard, filtered-state reuse, launch failure, and complete
profile cleanup. A live repair and credential-free routine read remain required;
offline launch qualification is not evidence that Google will accept the new
browser identity.

### Headed repair on the existing desktop session

The production repair unit runs in Bren's existing graphical systemd user
manager. That manager already owns the desktop's `DISPLAY`, Wayland, D-Bus,
runtime, and Xauthority values, so the repair does not reconstruct a desktop
session inside the system manager, grant another account display access, or
hard-code a display target. Chrome still uses the separate Chalkwright-owned
profile. The root controller stages only fixed repair configuration and
1Password authority in a mode-`0700` directory under Bren's runtime directory,
waits for the user one-shot, validates its bounded output, transfers only the
filtered PowerSchool state to the routine account, and removes the staging
directory. Routine retained-profile collection neither depends on nor can
obtain the user repair unit or its temporary 1Password authority.

The authentication request boundary keeps ordinary top-level PowerSchool
navigations GET/HEAD-only. After it observes a top-level request to the fixed
Google identity origin, it may consume exactly one top-level PowerSchool POST
as the SSO authentication return; no other PowerSchool POST is allowed. A
blocked request crosses the supervisor boundary only as a fixed violation
category, never as a URL, body, response, or provider value.

The user then authorized exactly one such live gate for 2026-08-11. The fixed
service-account-backed 1Password handoff completed far enough to launch the
direct-CDP browser, but Google again returned the sanitized
`unexpected-challenge/browser-rejected` result. The exact PowerSchool marker
was not reached, no filtered state was written, and the conditionally authorized
credential-free status/bell read was therefore not run. Local verification
found no retained disposable profile or Chrome process. No retry is authorized
or implied.

The user next authorized one bounded bridge through the proven legacy lane's
installed application interface, explicitly without opening or copying its
browser profile. Installed OpenClaw 2026.6.11 returned an exact JSON cookie
envelope from the named PowerSchool profile. A short-lived process retained
only 11 cookies applicable to the configured PowerSchool host, passed them
through Classroom Hub's strict filtered-state validator and atomic writer, and
overwrote its captured buffers without printing names or values. No Google
cookie or origin storage was retained. The immediately following
credential-free routine status/bell run for 2026-08-11 returned
`repair-required/session-state-rejected`, so those legacy cookies were not a
reusable authenticated session. No legacy repair, Google flow, or retry was
invoked, and local cleanup left no temporary profile or Chrome process.

The user then authorized one invocation of the legacy lane's existing bounded
`repair_auth` capability, followed by the same strict bridge and one routine
read. Its preflight found the managed profile already authenticated, so it did
not retrieve credentials, contact Google, or perform another sign-in. The
repeated application-owned export again retained 11 PowerSchool-host cookies
and no origin storage. The clean routine collector then completed its exact
status and bell reads for 2026-08-11 without credential, 1Password, Google,
repair, or operator capability and returned a fresh verified three-period C509
observation. This proves live filtered-state reuse and closes M-16 source
reuse. Local Asia/Ho_Chi_Minh time was already 2026-08-12, so the requested
2026-08-11 schedule is prior-day evidence rather than a fresh current-day plan.
It does not prove that the replacement JIT browser can repair a rejected
session, and neither the legacy profile nor this bridge is adopted as
steady-state architecture.

The user next authorized one exact 2026-08-12 routine read from that saved
state. It failed closed with `repair-required/session-state-rejected` and did
not invoke repair, Google, 1Password, credentials, or a retry. This leaves
current-day readiness and filtered-session longevity open. Per the user's stop
condition, no repeated manual sign-in was requested.

A source-only comparison after that refusal found that the proven legacy
session-HTTP reader sent a browser user-agent and same-origin referrer while the
replacement used Node's default request identity. The offline correction above
adapts only those two bounded headers and adds the two-run rotation regression.
No provider retry, protected-state read, repair, or sign-in was performed while
qualifying this change.

The installed 1Password CLI is 2.34.1. Its official release record and installed
help confirm the `op read` contract, while 1Password's secret-reference
documentation supplies the `attribute=otp` form used by the fixed TOTP
reference:

- [1Password CLI 2 release notes](https://app-updates.agilebits.com/product_history/CLI2)
- [1Password secret references](https://www.1password.dev/cli/secret-references)
- [1Password secrets in scripts](https://www.1password.dev/cli/secrets-scripts)

The authorized bootstrap and credential-free exact reads occurred. The user
confirmed the selected Monday had no classes. The collector version used for
that probe returned sanitized `not-found` because zero-period normalization had
not yet implemented the no-class domain state. The current integration corrects
that mismatch: only an authenticated bell page with the exact requested date
and verified bell marker, plus an empty AET day container with no period
element, embedded payload, or time range, may normalize to a fresh, verified
`no-classes` observation. Missing markers, wrong dates, malformed entries, and
authentication failures still fail closed. A later authorized operator-present retry reached
the Tuesday bell page without another sign-in prompt, refreshed the filtered
state, and enabled a credential-free routine observation containing three
periods. A durable live marker stronger than visible `body`, session longevity,
and the separate canonical room/period mapping difference remain later work.
The routine phase must still avoid Google, 1Password, credential automation,
and private page evidence.

Accepted ADR-0024 composes the existing JIT worker into Chalkwright's own M-17
operator-invoked repair service. The service has no timer, uses a dedicated
Chalkwright-owned retained profile and fixed protected 1Password
references, and writes only filtered canary session state. This removes the
legacy OpenClaw browser from the intended steady-state authentication path
without granting repair authority to routine collection. The legacy bridge
has been removed from the executable repository; the independently running
legacy application remains available only as the rollback display while the
native repair followed by a credential-free exact plan read is qualified.

Complete locked-version cookie-partition preservation still did not reproduce
the repaired session inside a disposable profile. That evidence does not prove
which provider feature binds the session to the profile. Chrome's current DBSC
documentation does confirm that browser-held key material can make cookie-only
transfer insufficient, and Playwright documents the session-data role and
single-owner constraint of a persistent user-data directory. M-17 therefore
uses the already accepted ADR-0021 collector for the credential-free plan job.
It reopens only Chalkwright's dedicated retained profile, may perform bounded
silent OIDC between the exact configured origins, and has no credential,
1Password, form-fill, repair, OpenClaw, or legacy-profile capability.

The retained reader reports request-policy failures using a fixed, value-free
reason class. Those classes distinguish blocked origins or methods, popups,
downloads, WebSockets, declared response-size violations, navigation-budget
violations, and browser-network control failures. They never retain or print a
URL, request body, response body, header, page title, or schedule observation.
This diagnostic surface narrows an operator's remediation without weakening
the boundary or turning protected browser state into debugging output.
Blocked resource origins are further reduced to fixed families for Google font
CSS, Google Accounts static content, Google user content, other Google
resources, the exact PowerSchool parent origin, a child of the configured
PowerSchool host, a sibling in its registrable site, non-HTTP resources, or an
unknown origin. The classifier retains neither the origin nor any URL
component and does not grant access to any of those families.
Single-label siblings are narrowed further to the fixed `www`, `static`,
`cdn`, `assets`, `auth`, `sso`, or `login` roles; every other single-label or
nested sibling remains a fixed `other` class. These labels are diagnostic only
and do not become an origin allowlist.
After the operator explicitly authorized a one-time exact blocked-origin
diagnostic, the inert diagnostic build may append one strictly validated DNS
label to the sanitized sibling code. It still omits the scheme, registrable
domain, port, path, query, fragment, headers, content, credentials, and browser
state, and still aborts the request before transmission. This temporary output
exists only to permit an exact destination decision and must be removed again
after that decision. The contained diagnostic identified `assets-sis`; the
operator approved only the corresponding exact HTTPS sibling beneath the
configured PowerSchool registrable site. The ordinary policy now derives that
single origin using the pinned Public Suffix List, permits it only as a
GET/HEAD resource origin, and has removed the label-bearing diagnostic output.
No wildcard or other sibling is accepted.
The next contained run identified the distinct fixed sibling role `assets`.
After separate operator approval, the ordinary policy derives that exact HTTPS
origin through the same pinned registrable-site calculation and permits it only
for resource GET/HEAD requests. All other siblings remain blocked.
The next contained run reached a nested same-site sibling. The follow-up
classifier does not retain or emit its prefix; it reports only whether the
blocked origin is beneath the already approved `assets-sis` origin, beneath the
approved `assets` origin, beneath a fixed common sibling role (`www`, `static`,
`cdn`, `auth`, `sso`, or `login`), or another nested sibling. This
classification grants no new origin and the request remains blocked before
transmission.
The separately authorized terminal-only diagnostic identified another
PowerSchool same-site sibling, confirming that PowerSchool loads a resource
graph across sibling hosts. To avoid repeating per-host approvals, the ordinary
policy now permits HTTPS PowerSchool same-site origins as subresources only,
with GET/HEAD plus browser-internal `OPTIONS`/`POST` methods for non-top-level
resource requests. Exact PowerSchool top-level reads remain GET/HEAD-only, and
top-level sibling navigation, non-HTTPS origins, unrelated registrable sites,
form methods, downloads, popups, WebSockets, and non-resource authority remain
blocked. The label-bearing diagnostic is removed.

The first value-free live reason was `resource-origin-blocked`. The proven
predecessor collector already required three fixed Google identity-page static
origins: `https://ssl.gstatic.com`, `https://www.gstatic.com`, and
`https://fonts.gstatic.com`. Chalkwright now enforces that same closed baseline
for both repair and retained-profile collection, including when an older
protected environment supplies an explicit origin list. It does not derive an
origin from migrated browser state or permit a registrable-domain wildcard.
An explicit list must still include the exact PowerSchool and identity origins
and may add only individually validated exact origins; it cannot remove the
fixed reviewed baseline.
