#!/usr/bin/env bash
set -euo pipefail

reject() { echo "{\"status\":\"rejected\",\"code\":\"$1\"}" >&2; exit 1; }
[[ ${EUID} -eq 0 ]] || reject m17-install-root-required
[[ $# -eq 2 ]] || reject m17-install-usage-invalid
archive=$1
digest=$2
[[ $archive == /tmp/chalkwright-m17-canary-runtime.tar.gz ]] || reject m17-install-archive-path-invalid
[[ $digest =~ ^[a-f0-9]{64}$ ]] || reject m17-install-digest-invalid
[[ -f $archive && ! -L $archive ]] || reject m17-install-archive-unsafe
[[ $(/usr/bin/sha256sum "$archive" | /usr/bin/cut -d ' ' -f 1) == "$digest" ]] || reject m17-install-archive-mismatch

root=/opt/chalkwright-canary
release="$root/releases/$digest"
current="$root/current"
committed=0
cleanup() {
  [[ $committed -eq 0 ]] || return 0
  if [[ -L $current && $(/usr/bin/readlink "$current") == "releases/$digest" ]]; then /usr/bin/rm -f -- "$current"; fi
  for name in chalkwright-canary.service chalkwright-canary-powerschool-repair.service chalkwright-canary-plan-preflight.service chalkwright-canary-plan-refresh.service chalkwright-canary-plan-refresh.timer chalkwright-canary-classroom-preflight.service chalkwright-canary-classroom-refresh.service chalkwright-canary-classroom-refresh.timer chalkwright-canary-calendar-preflight.service chalkwright-canary-calendar-sync.service chalkwright-canary-calendar-sync.timer chalkwright-canary-comparison.service chalkwright-canary-comparison-observation.service chalkwright-canary-integrity.service chalkwright-canary-integrity.timer chalkwright-canary-backup.service chalkwright-canary-backup.timer; do
    /usr/bin/rm -f -- "/etc/systemd/system/$name"
  done
  /usr/bin/systemctl daemon-reload || true
  /usr/bin/rm -rf -- "$release"
}
for name in chalkwright-canary.service chalkwright-canary-powerschool-repair.service chalkwright-canary-plan-preflight.service chalkwright-canary-plan-refresh.service chalkwright-canary-plan-refresh.timer chalkwright-canary-classroom-preflight.service chalkwright-canary-classroom-refresh.service chalkwright-canary-classroom-refresh.timer chalkwright-canary-calendar-preflight.service chalkwright-canary-calendar-sync.service chalkwright-canary-calendar-sync.timer chalkwright-canary-comparison.service chalkwright-canary-comparison-observation.service chalkwright-canary-integrity.service chalkwright-canary-integrity.timer chalkwright-canary-backup.service chalkwright-canary-backup.timer; do
  [[ ! -e "/etc/systemd/system/$name" && ! -L "/etc/systemd/system/$name" ]] || reject m17-install-unit-exists
done
[[ ! -e $release && ! -L $release ]] || reject m17-install-target-exists
[[ ! -e $current && ! -L $current ]] || reject m17-install-current-exists
trap cleanup EXIT INT TERM
/usr/bin/install -d -o root -g root -m 0755 "$root" "$root/releases" "$release"
/usr/bin/tar --no-same-owner --no-same-permissions -xzf "$archive" -C "$release"
for required in dist/entrypoints/m17-canary-server.js dist/entrypoints/m17-powerschool-repair.js dist/entrypoints/production-retained-plan-refresh.js dist/entrypoints/production-classroom-refresh.js dist/entrypoints/m17-canary-calendar-sync.js dist/entrypoints/m17-canary-activation-manifest.js dist/entrypoints/m17-canary-comparison.js scripts/operations/activate-m17-canary.sh scripts/operations/stop-m17-canary.sh scripts/operations/bind-m17-activation-manifest.mjs systemd/m17/chalkwright-canary.service.in systemd/m17/chalkwright-canary-powerschool-repair.service.in systemd/m17/chalkwright-canary-plan-preflight.service.in systemd/m17/chalkwright-canary-classroom-preflight.service.in; do
  [[ -f "$release/$required" && ! -L "$release/$required" ]] || reject m17-install-runtime-invalid
done
/usr/bin/chown -R root:root "$release"
/usr/bin/find "$release" -type d -exec /usr/bin/chmod 0755 {} +
/usr/bin/find "$release" -type f -exec /usr/bin/chmod 0644 {} +
/usr/bin/chmod 0755 "$release/scripts/operations/activate-m17-canary.sh" "$release/scripts/operations/stop-m17-canary.sh"
/usr/bin/ln -s "releases/$digest" "$current"
for unit_source in "$release"/systemd/m17/*.service.in "$release"/systemd/m17/*.timer.in; do
  name=$(/usr/bin/basename "$unit_source" .in)
  /usr/bin/install -o root -g root -m 0644 "$unit_source" "/etc/systemd/system/$name"
done
/usr/bin/systemctl daemon-reload
committed=1
echo "{\"status\":\"installed-inert\",\"release\":\"sha256:$digest\",\"unitsInstalled\":17,\"unitsStarted\":0,\"providerRequests\":0,\"routeChanges\":0}"
