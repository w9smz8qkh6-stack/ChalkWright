# M-11 review package: isolated mutation-disabled shadow

- **Status:** promoted under the user-approved accelerated qualification gate;
  the fixed observation remains active as supplemental evidence
- **Authorization:** explicit user authorization on 2026-08-10 for one
  seven-calendar-day observation window, followed by explicit approval to use
  one successful immediate qualification instead of waiting for that window to
  finish before promotion
- **Window:** 2026-08-11 through 2026-08-17, 07:20
  Asia/Ho_Chi_Minh, Sunday through Friday only
- **Production boundary:** no Calendar capability, provider write, production
  TV route, kiosk change, routing change, or M-12 work

## Roadmap fit

M-11 is the first and only checkpoint in Stage C before M-12. It consumes the
promoted M-10 direct-read integration and gates M-12's behavior comparison. Its
accelerated qualification is complete, so M-12 is the next separately
authorized milestone. It
does not renumber or collapse any milestone. The usable offline display gate
was completed at M-05; the minimum viable replacement still requires M-12
through M-18: real-behavior comparison, Calendar intent/ownership and writer
trial, production-readiness/rollback, cutover, stabilization, and legacy
retirement.

The requested 07:20 Sunday-through-Friday cadence differs from the reduced
legacy scheduler observation, which showed a 06:20 weekday PowerSchool refresh.
The user explicitly authorized the replacement cadence, so M-11 preserves that
decision as a bounded shadow experiment rather than silently inheriting the
legacy time. Saturday is excluded. Six executions occur during the seven-day
calendar window.

## Implemented boundary

The shadow has a distinct instance identity, `127.0.0.1:4318` listener,
separate owner-only least-authority server and provider-refresh environment
files, a managed state root, SQLite database, backup
directory, and run ledger. The HTTP request path reads only local SQLite and
repository assets. Its provider paths are inaccessible and its systemd IP
policy permits loopback traffic only. PowerSchool and Classroom provider access
occurs only in the bounded refresh unit and never on a display request.

PowerSchool uses the approved M-07C filtered-state collector and canonical-plan
pipeline. Classroom uses the M-08 fixed `courses.courseWork.list` transport and
normalized cache. The display projects matching cached coursework into the
existing content contract without making a provider call. The shadow omits a
mutation token, Calendar imports/capability, production compatibility alias,
and routing integration. Its configuration rejects any nonempty Calendar or
operator-token variable.

The refresh unit runs the PowerSchool job before Classroom. A failed or
repair-required plan acquisition prevents the later Classroom command from
starting. Each job has a finite deadline and records a sanitized outcome. The
service and jobs have systemd resource bounds and write allowlists.

## Mapping and configuration evidence

The user identified C509 as the current room and directed the legacy app to be
used as the established reference. A bounded read through the legacy
work-account Classroom CLI returned 14 active courses; exactly 12 had room C509
and 12 unique section/provider identities. Only aggregate counts were printed.
Those 12 one-to-one mappings were written atomically to the owner-only external
shadow environments. The server copy contains only display, mapping, and local
operations settings; the provider-capable refresh copy is inaccessible to the
persistent server and backup. The superseded combined copy was removed after
an exact byte comparison with the retained refresh copy. The runtime continues
to use Classroom Hub's dedicated narrow coursework credential; the broader
legacy token was used only for one-time course discovery and is not a shadow-
service dependency.

No credential value, course identifier, section value, provider response,
student record, or protected PowerSchool state content was printed or copied
into the repository.

## Timer and version evidence

The installed host reports systemd 259 (259.5). Its own
`systemd-analyze calendar` parser accepted each fixed event and resolved 07:20
Asia/Ho_Chi_Minh to 00:20 UTC. `systemd-analyze verify` accepted all four new
units. Exact-version 259 online man pages were not available; the installed
parser is therefore the version-matched authoritative syntax check used for
this host.

An authorized immediate qualification attempt on 2026-08-10 failed safely in
the PowerSchool step before Classroom started. The sanitized ledger recorded
`shadow-source-unavailable` with zero attempted and zero completed external
mutations. The sub-second browser-start failure exposed a containment conflict:
`RestrictNamespaces=true` prohibited the user, PID, and network namespaces
required by Chrome's enabled Linux sandbox. The corrected refresh unit permits
only `user`, `pid`, and `net`; all other namespace types remain prohibited, and
the server and backup continue to prohibit every namespace type. This follows
the installed systemd 259 allowlist semantics and Chromium's upstream Linux
sandbox architecture. Exact Chrome 150 versioned sandbox documentation was not
available, so the installed Chrome/Playwright tuple and host systemd parser are
the required runtime verification gate.

The host user manager rejects capability-reducing `PrivateDevices`,
`ProtectClock`, `ProtectKernelLogs`, and `ProtectKernelModules` at systemd's
`CAPABILITIES` spawn step; single-directive `/usr/bin/true` probes confirmed the
constraint. The first user-unit launch therefore failed before Node or SQLite
and was immediately disabled. The user explicitly authorized switching to
system-manager units that retain every sandbox control while running the
application as the unprivileged `bren` account. No provider read occurred on
the failed attempt.

## Accelerated live qualification evidence

After the user approved the accelerated gate, a one-time visible bootstrap on
the newly reconnected GNOME desktop completed successfully. It atomically
refreshed the owner-only filtered PowerSchool state at mode `0600` with one
hard link and removed its complete temporary profile. A subsequent exact
Tuesday read succeeded without Google, 1Password, credentials, or operator
involvement and emitted no provider content.

The installed system refresh unit had already proved that the corrected
namespace policy launches Chrome through its full system-manager sandbox; that
attempt stopped at `repair-required` because it preceded the successful state
refresh. Because the real host date was a no-class Monday and the user declined
to wait until Tuesday, the qualifying Tuesday composition ran once through the
same repository M-11 source and Classroom handlers as a bounded unprivileged
transient job. A direct-call-only injected clock selected the exact scheduled
instant, `2026-08-11T00:20:00Z`; it was never exposed through configuration or
the CLI and was removed from the source immediately after the run. The fixed
timer, host clock, deployed unit, and production service were unchanged.

PowerSchool plan acquisition succeeded first, then Classroom refresh
succeeded. The isolated SQLite ledger records both as `succeeded`, with zero
attempted and zero completed external mutations and no error codes. The local
shadow server then returned 200 for health, the Tuesday day plan, and the
body-suppressed Tuesday preview; `/tv` remained 404. Readiness remained 503 on
Monday because that endpoint intentionally evaluates the real current date and
Monday has no plan. No Calendar capability, provider write, production TV
route, kiosk change, or M-12 action occurred.

Two user-manager-only containment probes failed before or during startup: the
full system-service hardening set is not applicable in a user manager, and its
private temporary namespace prevented the Chrome-bearing source from
completing. Neither failure started Classroom. A separate sanitized acquisition
without that user-manager incompatibility returned `planned`. These probes do
not weaken the installed system unit, which retains the complete reviewed
hardening set. Successful scheduled execution under that exact unit remains
useful supplemental evidence from the still-active fixed window.

The timer contains only:

- Tuesday 2026-08-11;
- Wednesday 2026-08-12;
- Thursday 2026-08-13;
- Friday 2026-08-14;
- Sunday 2026-08-16; and
- Monday 2026-08-17.

Every event is at 07:20 Asia/Ho_Chi_Minh. `Persistent=false` prevents a missed
event from being replayed after the authorized window. A missing expected
run-ledger row is the observable missed-run signal.

## Offline evidence

Synthetic tests prove strict shadow configuration, distinct port/state paths,
Calendar/operator-capability rejection, canonical/effective plan persistence,
read-only local rendering, local-time date selection, fresh normalized
Classroom-cache projection and stale-cache suppression through the actual M-11
server wiring, mutation-route refusal, process restart with persistent SQLite
state, exact timer dates, and no Saturday or post-window catch-up. Architecture
and adversarial verifier tests enforce the split environments, inaccessible
provider paths, loopback-only server IP policy, and complete hardening set on
all three activation-ready services.

The full repository gate passed 458 tests, 97 local documentation links, 304
repository safety candidates, fixture and formatting checks, strict types,
production build, startup smoke, and the 6/6 temporary operations rehearsal.
`git diff --check` passed.

## Host pre-observation evidence

The clean built snapshot is deployed under the dedicated shadow path. All four
installed system-unit hashes exactly match the repository artifacts. The
service restarted successfully as `bren`; the system manager reports every
declared sandbox control active, including private devices, clock/kernel
protections, strict/read-only filesystem views, namespace/address-family
restrictions, and memory/task bounds. The active units separate server/backup
and provider-refresh environments, hide provider paths from persistent readers,
and deny the server all non-loopback IP traffic. systemd reports the expanded
loopback allowlist and full IPv4/IPv6 denylist as active.

The shadow health endpoint returns 200 on `127.0.0.1:4318`; readiness returns
503 before the first scheduled plan is stored, as designed. `/tv` returns 404.
The legacy production service remains independently listening on 20790. The
SQLite database and both environment files are regular, owner-only, single-link
files. The original backup rehearsal and the post-hardening backup both
completed successfully, leaving two backup/catalog pairs. Service restart
preserved the database.

The fixed timer is enabled and waiting for Tuesday 2026-08-11 07:20
Asia/Ho_Chi_Minh (00:20 UTC). The separately authorized accelerated run did not
change that cadence. The four disabled user-unit copies from the failed first
attempt and the one-time mapping helper were removed; they are recoverable from
the repository where applicable and contained no runtime state.

## Independent review

An independent read-only re-review found all four prior findings resolved: the
least-authority environment and network split, complete backup hardening and
adversarial verification, real fresh/stale cache projection through the M-11
HTTP wiring, and accurate transition documentation. It found no new material
correctness, security, testing, documentation, or scope blocker. The review
also reconfirmed the six-event timer, fail-closed refresh sequencing, and
absence of Calendar, provider-write, production-TV, kiosk, and M-12 capability.

## Deferred rather than completed

- the remaining fixed-window scheduled runs and exact installed-unit results,
  retained as supplemental operational evidence rather than a promotion gate;
- M-12 plan/display/operations comparison and every visual acceptance action;
- alert recipient or delivery transport decisions under U-008/ADR-0012;
- stabilization duration and rollback RTO approval under the remaining U-009
  portion;
- all Calendar reads, credentials, intents, writes, leases, and ownership work;
- production TV routing, aliases, service ownership, kiosk configuration,
  Tailnet changes, cutover, and legacy retirement; and
- any provider-write capability.

## Promotion and stop condition

M-11 is promoted under the user-approved accelerated gate: offline evidence is
clean; host state is distinct and protected; restart and backup succeeded; an
exact Tuesday credential-free PowerSchool read, canonical plan, Classroom
refresh, persistent zero-mutation ledger, and local display projection all
succeeded; the fixed-window timer remains active; Calendar/provider-write
capability is absent; and production routing is unchanged. The remaining
scheduled runs add operational evidence but no longer block promotion. Work
stops before M-12 unless the user separately authorizes that milestone.
