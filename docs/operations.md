# Offline operations and future activation

M-06 establishes repository-owned operational contracts without activating a
deployment. Everything described here is local/offline evidence, not a claim
about current host services, scheduler ownership, Tailnet routing, providers,
or production recovery.

## Bounded jobs

The registry accepts only these exact names: `source-auth-preflight`,
`classroom-refresh`, `calendar-reconcile`, `operations-report`,
`alert-evaluate`, `brief-morning`, `brief-evening`, `sqlite-backup`,
`sqlite-integrity`, and `state-retention`. PowerSchool preflight and Classroom
refresh are implemented only by the isolated M-11 shadow entry point;
`calendar-reconcile` remains deferred everywhere. The general compiled entry
point accepts one name and no other argument:

```sh
npm run build
npm run ops:job -- operations-report
```

Every normally settled recognized attempt receives a typed outcome. Its
run-ledger record is required when local persistence is available; ledger
failure is itself returned as a non-success outcome but cannot durably record
its own failure. The report and integrity handlers observe local state, but the
complete job is classified `local-state` because recording that ledger is an
intentional write. Integrity is checked before any migration/open and again
afterward.
Unknown, augmented, or incorrectly cased invocations fail before configuration
or filesystem access. Job paths come only from the validated environment
contract and must be distinct normalized children of one managed root.
Before any operational open, the managed database must be a regular,
single-link, non-symlink file beneath physically resolved managed directories;
backup artifacts and catalogs use the same single-link trust boundary.

`operations-report` intentionally reports unavailable provider, assignment,
route, and display observations until later adapters supply verified evidence.
It does not turn absence into a healthy result. `alert-evaluate` is report-only
or uses an in-memory fake; no recipient or network transport exists.
`brief-morning` emits the minimal redacted contract. `brief-evening` remains
skipped at the executable boundary until a configured next class day is
available; its separately tested contract does not guess by calendar-day
arithmetic.

## SQLite maintenance

Integrity inspection opens an existing database read-only. Backup uses the
M-04 integrity, catalog, checksum, path, and 14-daily/8-weekly pruning contract.
Retention applies the accepted 90-day job/comparison/alert-history, 30-day
attendance/temporary-state, academic-year-plus-90-day plan/content/vocabulary,
and inactive-plus-one-year configuration/mapping/Calendar-state boundaries.
It preserves the current alert checkpoint and transitions due expiring records.
ADR-0013 does not yet assign schedule-observation, override, or terminal hold
history to a category; those records are preserved pending a reviewed policy.
These hooks do not prove a production RTO or RPO. `npm run ops:rehearse`
confines all files to one temporary synthetic root, runs six local jobs, and
removes that root.

Deadlines first request cooperative cancellation and wait for quiescence. If a
handler does not stop within the bounded grace period, the CLI makes a bounded
best-effort attempt to record a redacted hard-stop result and then exits 124
regardless of ledger availability. The exit status and process-supervisor
evidence are therefore the fallback when no ledger row can be persisted. An
interruption during native backup may leave an incomplete artifact/catalog
pair; the next run fails closed without deleting either file and requires
explicit operator repair.

## General inert deployment artifacts

`systemd/classroom-hub.service.in` is now the exact inert M-16 candidate for
the provider-free production display reader. It fixes the unprivileged service
identity, protected configuration reference, persistent-state write boundary,
provider-path denial, loopback-only network policy, and compiled entrypoint.
Its `.in` suffix, explicit pending marker, and absent `[Install]` section keep
it non-installable. The job service and seven timer templates retain unresolved
command/schedule/timezone/missed-run placeholders. This milestone neither
installs nor starts any of them.
`systemd/cadence-manifest.json` is the single pending schedule inventory.

The product requirement is for Classroom Hub's future standalone Linux
application/service scheduling to refresh the bell schedule at 07:20
Asia/Ho_Chi_Minh every Sunday through Friday, excluding Saturday. ChatGPT,
Codex, and OpenClaw must not own that schedule. M-07B records this requirement
only: the exact systemd expression, missed-run semantics, job command, and
production activation remain later design and deployment work.

## Authorized M-11 shadow units

The repository also contains four activation-ready system-unit files scoped
only to M-11. Each service explicitly runs as the configured unprivileged
application account:

- `classroom-hub-shadow.service` serves the persistent SQLite reader on the
  configured non-production loopback port;
- `classroom-hub-shadow-refresh.service` runs PowerSchool plan acquisition and
  then Classroom cache refresh sequentially;
- `classroom-hub-shadow-refresh.timer` contains only six fixed 07:20
  Asia/Ho_Chi_Minh events from 2026-08-11 through 2026-08-17, excluding
  Saturday; and
- `classroom-hub-shadow-backup.service` invokes the verified SQLite backup
  contract on demand.

The timer uses `Persistent=false`. A missed event is visible by the absence of
its expected run-ledger row, but systemd will not replay it after the approved
window. The installed systemd 259 parser validated every exact calendar
expression; exact-version 259 online man pages were not available, so the host
parser is the authoritative syntax check for this deployment.

The host user manager cannot apply capability-reducing `PrivateDevices`,
`ProtectClock`, `ProtectKernelLogs`, or `ProtectKernelModules`: isolated
`/usr/bin/true` probes fail at systemd's `CAPABILITIES` spawn step. The user
explicitly authorized system-manager units instead, retaining those controls
while running the application as that unprivileged account.

The persistent server and backup units require the owner-only least-authority
`/etc/classroom-hub/shadow/server.env`; only the
bounded refresh unit receives
`/etc/classroom-hub/shadow/refresh.env`. They execute the deployed snapshot
from `/opt/classroom-hub-shadow/current`, and write only under
`/var/lib/classroom-hub-shadow` plus the
separately protected PowerSchool filtered-state directory during refresh. They
make provider references and state inaccessible to the server and backup, and
the server's systemd IP policy permits loopback traffic only. They receive no
Calendar or operator token, expose no production compatibility
alias, and do not change the TV service, kiosk, or routing. Their installation
and activation are valid only under the explicit M-11 authorization recorded
in the review package. The superseded combined environment was removed after
an exact comparison with the retained refresh copy.

Each JSON entry in `CLASSROOM_HUB_SHADOW_COURSE_MAPPINGS` requires
`classId`, `sectionCode`, and `providerCourseKey`. It may also include the
bounded `attendanceClassCode` used by the legacy pre-check-in display. That
code is independent of the PowerSchool/Classroom section code used for course
mapping. Aggregate attendance links and counts come only from validated local
SQLite continuity rows; absent data hides only the dependent element.

The server and backup prohibit every namespace type. The refresh unit permits
only `user`, `pid`, and `net` namespaces because the enabled Chrome Linux
sandbox uses those namespaces; `cgroup`, `ipc`, `mnt`, `uts`, and `time`
namespace creation remain prohibited. Chrome's own sandbox stays enabled. The
repository verifier and adversarial tests reject a disabled or broadened
refresh namespace policy.
The pre-observation audit and the user-approved accelerated read-only
qualification passed, promoting M-11. The fixed-window system timer remains
active as supplemental evidence. This does not authorize M-12.

Before any future production activation or cutover, a separately authorized
milestone must:

1. characterize U-003 and approve exact clocks, timezone, ordering, and missed-
   run behavior;
2. provide a non-fixture managed server entry point and protected environment;
3. confirm ownership/permissions for state and backups;
4. validate loopback/Tailnet routing without public exposure;
5. complete a timed backup/restore and rollback rehearsal; and
6. retain one writer and a verified outside-hours rollback path.

ADR-0012 now accepts Telegram-compatible 30-minute evaluation plus new,
six-hour-repeat, and recovery semantics. The protected recipient/bot authority
has been provisioned and one fixed qualification message was delivered;
the user confirmed the intended recipient. Adapter wiring and routine live
delivery remain blocked on M-17 final-handoff authorization. The direct adapter
itself is offline-qualified with two separate external owner-only value files,
one fixed `sendMessage` HTTPS request, no retry, bounded redacted text/response,
and synthetic provider outcomes. No production job or unit can import it. Full
brief content and delivery semantics remain blocked on U-015. No general production unit,
routing rule, or Calendar job is activated by this checkpoint.

The inert M-16 alert-authority provisioner is
`scripts/operations/provision-m16-alert-authority.mjs`. It has no inspection or
dry-run mode because even validating the fixed legacy bot file is protected
access. The separately authorized exact reviewed command was:

```bash
sudo node scripts/operations/provision-m16-alert-authority.mjs --apply
```

It refuses source-hash drift, unsafe ownership/modes/links, malformed or
duplicate destinations, malformed tokens, existing targets, and a non-root
caller. Success creates only the separate bot token, destination, and exact
reference JSON beneath `/etc/classroom-hub/providers/alert-delivery`, prints no
value, makes no provider request, and installs or starts nothing. Applying it
does not wire the adapter or authorize a Telegram message; one bounded
non-sensitive delivery was authorized and completed separately. Do not run the
create-once provisioner again. The future M-17 delivery job remains excluded
from the parallel canary and requires its own final-handoff gate.

The separately gated live check is the dedicated
`m16-alert-live-qualification` entrypoint. Before its one permitted execution,
the SHA-bound archive
`/tmp/classroom-hub-m16-alert-qualification-runtime.tar.gz` must equal
`a45b90c3414088871262a2f2954d2a89344d8b8c663e2fa7482448dccc763396` and
be advanced from the exact prior candidate only by
`scripts/operations/install-m16-alert-qualification.sh`. The entrypoint runs as
`classroom-hub` with an empty environment containing only the fixed alert
reference. It sends the literal non-operational qualification text, once, and
reports no values. Do not substitute another recipient, message, executable,
reference, or retry. A failure is evidence to stop, not authority to resend.

After approval of the exact proposal fingerprint, execute these commands in
order and stop on the first non-success result:

```bash
cd /path/to/classroom-hub
sudo bash scripts/operations/install-m16-alert-qualification.sh
sudo node scripts/operations/provision-m16-alert-authority.mjs --apply
sudo -u classroom-hub /usr/bin/env -i -C /opt/classroom-hub/current CLASSROOM_HUB_ALERT_DELIVERY_REFERENCE=/etc/classroom-hub/providers/alert-delivery/alert-delivery.json /usr/bin/node /opt/classroom-hub/current/dist/entrypoints/m16-alert-live-qualification.js --execute
```

The host has sudo-rs `0.2.13-0ubuntu1` and uutils `env` 0.8.0. Their installed
`--help` output was checked directly for `sudo -u` and `env -i -C`; the current
[official uutils 0.9 `env` documentation](https://uutils.org/coreutils/docs/utils/env.html)
also describes `-i` and `-C`, but exact 0.8.0 online command documentation was
unavailable, so the runbook does not infer any unverified option beyond the
installed binaries.

The exact proposal completed once on 2026-08-12. The release install reported
no service, route, provider, or message action; protected provisioning created
three files while printing no value and making no request; and the one-shot
entrypoint reported one attempted and delivered message with zero service/route
changes and zero application-state writes. **Do not rerun this sequence.** The
protected targets and release are create-once and a repeat must fail closed.
Routine adapter/job wiring remains an M-17 final-handoff gate; the parallel
canary is report-only.

The legacy-derived Classroom trigger is also offline-qualified. A
local target must be in `pre_checkin` or `in_class_content`, identify one exact
mapped current class, and match the job's local date before source authority is
constructed. Every other state is a provider-free no-op. The eventual isolated
timer is proposed at 30-second evaluation; per-class failure state already
enforces 60/120/240/480/900-second backoff and retains last-known-good cache.
The user accepted that policy on 2026-08-11. The exact
`classroom-hub-production-classroom-refresh.service.in` and `.timer.in`
candidates now compose the local target and enforce a non-catch-up 30-second
monotonic evaluation. The separate plan-refresh candidate uses the accepted
07:20 Asia/Ho_Chi_Minh Sunday-through-Friday wall clock with Saturday excluded
and `Persistent=false`. Both remain non-installable, use separate future
environment files, reject ambient authority from other provider families, and
require later protected configuration, live readiness, and M-17 activation
authorization.

The exact offline set is recorded in
`systemd/m16-production-cadence-manifest.json`. Brief delivery, Telegram,
maintenance cadence finalization, Calendar handoff, and every protected value
remain deferred rather than silently folded into these two jobs.

## M-16 isolated cutover/rollback rehearsal

M-16 is an offline rehearsal and does not accept host targets or arbitrary
commands. Run it only from a reviewed build:

```bash
npm run ops:m16-rehearse
```

The entrypoint creates disposable loopback legacy/replacement services and
temporary SQLite state. It freezes the complete source/build/configuration
fingerprint, verifies the baseline, creates and checks a backup, excludes the
legacy writer, starts the simulated replacement service/writer/timers, switches
the loopback proxy, exercises the full `/classroom-screen` compatibility suite,
then always releases the replacement writer before restoring route, timers,
service, backup, and legacy writer. It deletes all temporary state afterward.

Accept rehearsal evidence only when it reports `passed`, one maximum writer,
`baselineRestored: true`, a rollback within the accepted four-hour RTO, and
zero attempted/completed external mutations and live operational changes. A
forward smoke failure may report `failed-restored`; that proves rollback only
and does not pass the forward gate. A double writer, incomplete restore,
configuration drift, or RTO breach fails without a promotable receipt.

Accepted ADR-0022 now applies this exact replacement order only to M-17's later
final-handoff gate. M-17 begins with a separate parallel-canary command sheet
that must not stop or alter any legacy writer, service, schedule, route, state,
or alert. It may name only one pre-approved exact candidate systemd, scheduler,
backup, Tailnet, and secondary-Calendar target. Stop before canary activation
if:

- the replacement refresh/readiness path is not clean;
- the Fully Kiosk on-device candidate smoke is unavailable, not ready, makes a
  foreign request, clips/overflows, or materially differs from the accepted
  three-viewport baseline;
- candidate route, service, scheduler, writer, Calendar target/deny, build,
  state-root, or configuration fingerprints differ from the approved manifest;
- the candidate Tailnet mapping would replace or overlap the legacy mapping;
- the candidate Calendar is `primary`, matches the legacy Calendar, lacks the
  expected owner, or contains unaudited foreign events in the approved window;
- a candidate writer or relevant candidate job is active, or the proposed
  cadence is not staggered from known legacy acquisition;
- the separate candidate backup or integrity check fails;
- the approved 18:00–20:00 Asia/Ho_Chi_Minh window, operator availability,
  report-only alert disposition, observation policy, or stop communication are
  not satisfied; or
- the existing `/classroom-screen` URL, Calendar, schedules, alerts, or state
  cannot remain unchanged and authoritative.

Canary rollback stops/removes only the exact candidate timers, services, and
separate Tailnet mapping. It retains secondary-Calendar evidence and candidate
state unless a separately approved owned-event cleanup applies. It never
restores or rewrites legacy state because the canary never displaces it.

After the approved observation interval passes, the final-handoff command sheet
must preserve the M-16 disable/quiesce/acquire/start/route/verify and inverse
rollback order. It additionally requires an explicit choice to retain the
secondary Calendar or migrate to another exact target, and a separate approval
to enable routine alert delivery.

Do not translate this amendment into `systemctl`, `tailscale serve`, Calendar,
OpenClaw cron, kiosk, or deployment commands without the separate live gate and
exact approved targets. ADR-0022 acceptance alone grants no such authority.

The separately authorized 2026-08-12 M-16 candidate gate did not perform the
M-17 handoff. It used a two-hour transient loopback reader and a separate
temporary non-Funnel Tailnet listener, preserved the legacy listener/backend,
and removed the candidate listener after the physical Fully Kiosk smoke. Plan,
health, and readiness passed; the inactive Classroom evaluation skipped before
source construction; and the styled pinned preview rendered on the physical
device after correcting temporary proxy handling for local asset subpaths. The
live-time `day_complete` fallback remains dependent on the explicitly deferred
evening next-class-day source. Do not replace that absence with calendar-day
guessing or treat it as part of the accepted 07:20 current-day plan job.

### Inert production reader composition

`npm run ops:production-server` is a compiled, provider-free candidate reader,
not an activation command. The exact inert `classroom-hub.service.in` template
invokes it but remains non-installable; no activation-ready unit or scheduler
artifact does. It starts only when
`CLASSROOM_HUB_PRODUCTION_CONFIG_REFERENCE` names an owner-only, exact-shape
JSON file and that file names a separate owner-only local operator-token file.
The composition binds to loopback, reads its confined SQLite state, preserves
the exact `/classroom-screen` compatibility family, and cannot read providers,
manage jobs or routes, spawn commands, or mutate Calendar.

The protected JSON contract contains only version `1`, a bounded production
instance ID, room/screen identity and label, loopback host and non-privileged
port, timezone and academic-year end, a production-named managed root with
separate database/backup paths, the operator-token reference, exact course
mappings, and bounded check-in/dismissal lead times. The configuration reference
and token must remain outside the managed state root and repository. The loader
rejects extra fields, repository-contained paths, symlinks, hard links,
permissive ownership/modes, broad roots, shadow identities, coupled references,
unsafe or missing managed state, and nested database/backup paths.

Do not create the real protected files or start this entrypoint until M-16 has
accepted exact targets and M-17 separately authorizes deployment/activation.
The current offline tests use only temporary synthetic files and state.

## M-14 non-production recovery runbook

This runbook applies only to a separately authorized Auto Lesson 2
qualification. It is not an operational Calendar job and cannot target
`primary` or the configured production deny hash.

1. Stop the qualification after any failed or interrupted result. Do not reuse
   its run ID for another forward execution.
2. Confirm the owner-only protected configuration names the failed run ID, has
   a fresh approval window of at most 15 minutes, and retains the exact target,
   production deny hash, scope, budgets, credential reference, and database.
3. Build the reviewed source. Print the recovery-specific approval fingerprint
   through the qualification entrypoint's
   `--print-recovery-approval-fingerprint` mode. Source, executed build,
   dependency, mode, configuration, and expiry changes invalidate that
   fingerprint. Recovery may start only while its complete overall deadline
   still fits inside the approval window.
4. Obtain explicit approval for that fingerprint. Use only the same
   entrypoint's `--recover --approval-fingerprint` mode with the protected
   config-reference environment variable.
5. Accept success only when the sanitized result reports zero remaining owned
   test events. The recovery preflights all four deterministic references and
   refuses any ownership or admitted-field mismatch before deleting anything.
   Every deletion uses `sendUpdates=none`, an etag, the durable scope lease, and
   a restart-safe journal.
6. If recovery is incomplete, make no generic Calendar search or mutation.
   Preserve the sanitized result and require a new bounded review and explicit
   authorization.

The automatic failure path invokes the same recovery logic while its bounded
signal is still usable. The separately approved recovery mode exists for an
abort, process loss, or later retry. It never lists Calendar events or accepts
an arbitrary event reference.

## M-15 bounded production-trial runbook

This is a one-off outside-hours trial, not a service or recurring job. The
checked-in command accepts only the fixed 2026-08-11 C509 scope and a protected
configuration reference. Never print or copy that configuration, the prepared
state, approval state, OAuth reference, Calendar ID, event references, etags,
or backup contents.

1. Build from the reviewed clean worktree and complete `npm run check` plus
   `git diff --check`. Source/build changes after preparation invalidate the
   proposal.
2. Confirm no OpenClaw Calendar sync is running, then disable only the fixed
   legacy job. The M-15 verifier requires its exact ID/name/schedule to remain
   present but report disabled and quiescent. Do not delete or reschedule it.
3. Run `npm run ops:m15-provision` once. It derives the production Calendar
   identity from the retained legacy source, requires it to match the protected
   M-14 production deny hash, reuses only the exact owner-only writer grant,
   and writes one owner-only external config without printing protected values.
4. Set `CLASSROOM_HUB_M15_CONFIG_REFERENCE` to that external config and run
   `npm run ops:m15-calendar-trial -- --prepare`. This creates and verifies a
   fresh source-state backup, reads the exact verified three-meeting plan,
   reproduces M-13's exact candidate set, and performs event-list plus exact
   event-GET reads. Accept only `m15-production-preflight-ready` with three
   observations/replacements and zero attempted/completed mutations.
5. Run `npm run ops:m15-calendar-trial -- --stage-approval`. Record only its
   proposal fingerprint, approval fingerprint, and expiry. Obtain explicit
   operator approval for that exact fingerprint. Do not execute if the build,
   backup, legacy exclusion, provider events, or approval window changed.
6. Execute only
   `npm run ops:m15-calendar-trial -- --execute --approval-fingerprint <exact>`.
   Accept success only with three replacements, exact readback, no rollback
   attempts, and no unexplained counts. Every write is etag-conditional and
   fixes `sendUpdates=none`. The fixed patch omits reminders and unrelated
   properties so the preflighted provider-default policy and foreign metadata
   remain unchanged.
7. Keep the legacy writer disabled until the user accepts sanitized trial
   evidence and rollback readiness. M-16 decides the later operational handoff.

On failure, do not re-enable the legacy writer while an M-15 process or lease
may remain. The executor compensates each changed event to its exact protected
legacy fields and verifies the result. A retained exact Classroom Hub ownership
marker is intentional and hash-bound by the approved adoption. If compensation
or readback is incomplete, preserve the protected state/database/backup, expose
only sanitized codes and hashes, and stop for a new recovery decision. Never
use generic Calendar commands to repair the scope.

M-06 serializes fake alert evaluation within one process. A future real
transport must add a cross-process lease/CAS before concurrent delivery is
authorized; no external delivery exists in this milestone.

## M-17 isolated parallel-canary runbook

This runbook never replaces the legacy OpenClaw display. The candidate uses
loopback port `4319`, `/opt/chalkwright-canary`,
`/etc/chalkwright/canary`, `/var/lib/chalkwright/canary-production`, a separate
filtered PowerSchool state directory, and the existing secondary owned
Calendar named `Auto Lesson 2`. Candidate alerts are report-only.

Run `npm run check` and `git diff --check` before proposing any live command.
Then obtain separate authorization for each group below:

1. Protected provisioning: run
   `sudo node scripts/operations/provision-m17-canary.mjs --apply`. It reads
   only the existing qualified M-16 production references and the qualified
   M-14 Calendar configuration staged by the operator as the owner-only,
   single-link protected handoff
   `/etc/chalkwright/migration/google-calendar-writer-config.json`. It derives
   the exact secondary target and legacy deny hash, creates eight new protected
   canary files (including a provider-free maintenance environment), and
   performs zero provider/service/route work. The handoff contains no source
   user-home path and must be provisioned outside the repository without
   printing its values. Canary provisioning is create-once and must not be
   retried after success.
2. Release: run `scripts/operations/build-m17-canary-release.sh`, record its
   archive digest, obtain approval for that exact digest, then run
   `sudo scripts/operations/install-m17-canary-inert.sh
/tmp/chalkwright-m17-canary-runtime.tar.gz <digest>`. Installation starts
   nothing and changes no route.
3. Filtered-state copy: execute the fixed root launcher with the approved
   installed release digest. It reads only the root-owned canary plan
   environment, permanently drops to `classroom-hub`, and imports the
   validated copy routine from that exact installed release. Run
   `sudo node scripts/operations/copy-m17-powerschool-state.mjs <digest>`.
   Accept only `copied-filtered-state` with zero profiles, Google origins, and
   provider requests. This is not a sign-in or repair.
4. State initialization: before any provider preflight, execute the fixed
   release-bound initializer once with
   `sudo node scripts/operations/initialize-m17-canary-state.mjs <digest>`.
   It validates the installed release, permanently drops to the service owner,
   creates only the isolated canary SQLite database, applies the checked-in
   schema, and verifies integrity. Accept only `initialized-inert` with zero
   provider requests, services started, and route changes. It refuses an
   existing database.
   If the copied session later fails closed at the status-page authentication
   redirect, the separately authorized operator-only recovery may invoke the
   legacy lane's bounded `repair_auth` once and then run the fixed
   `refresh-m17-powerschool-state-from-legacy.mjs` launcher with `sudo node` and
   the approved digest. The bridge is fixed to OpenClaw 2026.6.11's named
   `powerschool` read-only cookie interface and invokes OpenClaw's generic
   evaluation interface with one fixed, scanner-bound read-only expression. The
   expression returns only `location.origin` and local storage from the same
   document execution; it contains no mutation or network operation. The bridge
   accepts the result only when both that origin and the response URL have the
   configured PowerSchool origin, captures no profile files, and prints no
   cookie or storage values,
   permanently drops to the canary service owner, filters through the reviewed
   ADR-0014 validator, and atomically replaces only the canary state under its
   single-process lock. It reads no password, 1Password field, or Google
   credential. Stop if repair requests interactive approval.
5. Preactivation evidence: first run the plan and Classroom services as
   separately authorized read-only preflights. Perform an exact read-only
   semantic Calendar audit of `Auto Lesson 2`. Prepare one owner-only exact
   `comparison-input.json` containing only normalized reference/candidate
   dates, times, summaries, ownership coverage, readiness, display state, and
   plan verification—never provider IDs—and run
   `chalkwright-canary-comparison.service`. Any difference blocks activation.
6. Immutable live binding: inventory, but do not change, the proposed Tailnet
   target and legacy route. Put only the exact target, legacy-route SHA-256,
   and approved observation start/end in owner-only
   `activation-bindings.json`; then run the packaged
   `bind-m17-activation-manifest.mjs --apply`. It consumes the bindings and
   comparison evidence and creates one immutable owner-only manifest binding
   the installed release, exact Calendar/deny hashes, packaged stop command,
   comparison evidence, and observation policy without printing values.
   If a bound manifest is rejected before activation, never delete or overwrite
   it ad hoc. For the specifically recorded rejected fingerprint
   `sha256:2fda6668afbd28b2b3ee843e5ed42438cab30dacfdb496eb4c37e8ab74e925b2`,
   run the reviewed root-only
   `supersede-m17-activation-manifest.mjs --apply`. It first proves every
   candidate unit is inactive and the candidate Tailnet port/loopback target is
   absent, validates the exact protected file and fingerprint, then atomically
   renames it to the fixed owner-only rejected-manifest audit path and fsyncs
   the directory. It never deletes the manifest or changes a service, route, or
   provider. If archival fails, it restores the same inode to the live path.
   This helper is a serialized operator action: do not run activation, another
   manifest operation, or any candidate-route command concurrently. Its unit
   and route checks are bounded point-in-time preconditions, not a shared lock
   with those separately authorized commands.
   Rerun the provider-free preactivation comparison to recreate its consumed
   export, choose a fresh exact seven-day window immediately before separately
   authorized activation, and run the unchanged create-once binder. Retain the
   rejected manifest for audit. If activation does not follow at the approved
   start, reject and supersede again; inactive time never counts as coverage.

### M-17 failed-activation correction

The first activation manifest
`sha256:e84fdcc9a9ba7155d5b6382a3f191eae4f3f94f490228af418db52280e332a65`
is retained failure evidence: its attempt completed zero Calendar mutations and
left the candidate service, timers, and route inactive. Recover in this exact
serialized order, with no concurrent candidate lifecycle or route operation:

1. Run `supersede-m17-activation-manifest.mjs --apply`. Its fixed allowlist
   archives the exact failed manifest by fingerprint and refuses any other
   protected content, active candidate unit, or existing candidate route.
2. Build and independently review the corrected archive. Run the
   exact-predecessor `upgrade-m17-canary-inert.sh` only while every candidate
   unit is inactive. It snapshots the supplied archive into a root-owned file,
   verifies that snapshot's approved digest, compares installed unit bytes, and
   atomically advances `current` from the recorded predecessor. Failure before
   the switch removes only the incomplete release; an ambiguous post-switch
   failure restores the exact predecessor or retains both releases.
3. Rerun the provider-inaccessible preactivation comparison to create new
   immutable evidence, write fresh bindings whose seven-day start is imminent,
   and run the unchanged binder. The new manifest must bind the corrected
   release digest and must not reuse either rejected fingerprint.
4. Verify the new manifest and retry activation immediately. If activation does
   not begin within the bound start tolerance, stop and repeat supersession,
   comparison, and binding. Do not count inactive time as observation coverage.
5. Activation: only after all prior gates are clean, authorize
   `sudo /opt/chalkwright-canary/current/scripts/operations/activate-m17-canary.sh
<digest>`. The command first verifies the protected manifest and observation
   window. The exact command then requires a successful local SQLite integrity
   check and verified
   backup before readiness, performs the first bounded candidate Calendar
   reconciliation, starts the loopback reader, and starts only the five
   candidate timers. Nightly integrity and backup run at 18:35 and 18:40
   Asia/Ho_Chi_Minh with no catch-up.
   During the approved interval, update the normalized comparison input and
   run `chalkwright-canary-comparison-observation.service` for each retained
   checkpoint. This provider-inaccessible service writes a new fingerprinted
   SQLite record and never recreates the immutable preactivation export.
6. Routing and TV: inventory and verify the installed Tailscale/Fully Kiosk
   versions against official documentation, bind one new candidate-only URL to
   `127.0.0.1:4319`, and verify the legacy route fingerprint is unchanged.
   Change Fully Kiosk only during an explicitly authorized reversible window.

At any candidate defect, run
`sudo /opt/chalkwright-canary/current/scripts/operations/stop-m17-canary.sh`.
It first stops all candidate
timers, then quiesces every candidate provider/Calendar/maintenance oneshot and
the candidate display. Remove the exact candidate Tailnet mapping using the
separately approved route command. Do not clean Calendar events, delete state,
or alter legacy services/routes without a new explicit authorization. The
legacy display remains the immediate fallback throughout M-17.
