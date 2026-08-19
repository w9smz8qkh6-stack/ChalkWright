# Permanent production deployment

This is the one intended path from protected GitHub `main` to the permanent
Chalkwright production lane. It is host-native, uses no hosted deploy service,
and never stores protected configuration in GitHub or this repository.

## Steady state

After the one-time provision and acceptance steps, the inert
`chalkwright-deploy.timer` is installed and enabled. Every minute it asks an
isolated deployment checkout for `origin/main`.

When `main` contains a new commit, the controller:

1. checks out that exact remote commit in a disposable build directory;
2. installs locked dependencies, builds an immutable gzip archive, and binds
   the archive to a SHA-256 release directory under `/opt/chalkwright/releases`;
3. runs the new release's Calendar **preflight** as `classroom-hub`; this is
   list-only and must prove the already configured owned boundary;
4. atomically replaces `/opt/chalkwright/current` with the new release;
5. restarts only `chalkwright.service`, then checks its local `/health` and
   `/ready` endpoints; and
6. restores the former release and restarts it if either restart or local
   readiness check fails.

The current release records only its Git commit. Archives and prior release
directories are retained for operator recovery; no deployment output contains
Calendar IDs, credentials, provider material, routes, or configuration values.

Routine deploys never run PowerSchool repair or login, create or share a
Calendar, change Calendar targets, or start provider refresh jobs directly.
The already enabled refresh and Calendar timers continue using the atomically
selected release.

Before the deploy timer is active, an operator can trigger the same fixed
controller manually through the constrained admin wrapper:

```sh
sudo -n /usr/local/sbin/chalkwright-production-admin deploy
```

## One-time provision and cutover prerequisites

The controller deliberately refuses to operate until an operator provides the
owner-only protected production files:

- `/etc/chalkwright/production/server.json`
- `/etc/chalkwright/production/calendar.json`
- `/etc/chalkwright/production/jobs/plan-refresh.env`
- `/etc/chalkwright/production/jobs/classroom-refresh.env`
- `/etc/chalkwright/production/jobs/maintenance.env`

The Calendar file must pass `loadProductionCalendarConfig`: it names exactly
one application-owned Calendar, rejects `primary`, binds the target hash, and
uses a separate credential reference. The configuration itself is intentionally
not derived from the legacy or shadow runtime and is never copied into the
repository.

Initial provision also creates `/var/lib/chalkwright/deploy/source` as an
isolated checkout of the canonical GitHub repository and installs the
`systemd/production` templates through
`scripts/operations/provision-production-inert.sh`. It stages and selects the
first immutable release but does not start or enable any unit. These operations
are separate from normal deploys because they create host state. They require a
controlled first-release acceptance that proves display health/readiness,
PowerSchool and Classroom freshness, Calendar convergence, verified backup,
restore, and rollback. The shadow service and retained M-17 lane remain
available during that acceptance window.

`scripts/operations/activate-production.sh` is the subsequent explicit
activation step. It proves integrity and backup, runs both read-only refreshes,
starts the loopback display, requires health/readiness, starts the owned
Calendar synchronization, and adds only the six permanent timers to
`multi-user.target`. It does not alter the external route or stop the shadow;
the separately controlled Tailscale cutover follows only after this local
acceptance succeeds.

If the permanent PowerSchool profile is not ready but the live shadow database
already contains current read-only plan snapshots, an operator can run the
bounded one-time import before activation:

```sh
sudo -n /usr/local/sbin/chalkwright-production-admin migrate-plans
```

That command reads only the current `plan_snapshots` rows from the legacy shadow
SQLite database, validates their hashes and v1 plan contracts, requires the
room/screen/timezone to match the permanent production config, and rewrites the
accepted canonical/effective plans into the permanent SQLite repository. It
does not copy Classroom cache, Calendar journals, provider credentials, browser
profiles, logs, or raw PowerSchool state, and it does not start services,
enable timers, change routes, contact providers, or write to PowerSchool or
Google Classroom.

The controlled cutover changes only the exact current Tailscale Serve handler
that points at the shadow's loopback listener. It snapshots the complete Serve
configuration under `/var/lib/chalkwright/deploy/routes`, replaces that one
handler with the ready permanent display, verifies the configured handler, and
restores the snapshot if verification fails. It does not stop the legacy shadow
service; that remains a local rollback reference until post-cutover acceptance.

## Operator boundaries

The deployment controller is a root-owned system service only because it must
create root-owned immutable release directories and switch the `current`
symlink. Its Calendar preflight explicitly drops to the `classroom-hub`
service account. `NoNewPrivileges=false` is the narrow documented exception:
the host's `runuser` rejects the required UID drop when that flag is enabled.
The unit otherwise confines writable paths to the release/deployment roots and
uses strict filesystem, namespace, device, and network restrictions.

The service and timer files in the repository retain the `.in` suffix and have
no `[Install]` section. They are inert templates, not evidence of a live
deployment.
