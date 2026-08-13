#!/usr/bin/env bash
set -euo pipefail

reject() { echo "{\"status\":\"rejected\",\"code\":\"$1\"}" >&2; exit 1; }
[[ ${EUID} -eq 0 ]] || reject m17-upgrade-root-required
[[ $# -eq 2 ]] || reject m17-upgrade-usage-invalid
archive=$1
digest=$2
previous=a1061444548f4f47d0d632e83425f1e5df24cd34e27631ecfa4ed751b52b5fdf
[[ $archive == /tmp/chalkwright-m17-canary-runtime.tar.gz ]] || reject m17-upgrade-archive-path-invalid
[[ $digest =~ ^[a-f0-9]{64}$ && $digest != $previous ]] || reject m17-upgrade-digest-invalid
[[ -f $archive && ! -L $archive ]] || reject m17-upgrade-archive-unsafe

root=/opt/chalkwright-canary
release="$root/releases/$digest"
current="$root/current"
next="$root/.current-$digest"
rollback="$root/.rollback-$previous"
[[ -L $current && $(/usr/bin/readlink "$current") == "releases/$previous" ]] || reject m17-upgrade-predecessor-invalid
[[ ! -e $release && ! -L $release && ! -e $next && ! -L $next && ! -e $rollback && ! -L $rollback ]] || reject m17-upgrade-target-exists

snapshot=
committed=0
switched=0
release_created=0
cleanup() {
  [[ $committed -eq 0 ]] || return 0
  set +e
  rollback_succeeded=0
  if [[ $switched -eq 1 && -L $current && $(/usr/bin/readlink "$current") == "releases/$digest" ]]; then
    if /usr/bin/ln -s "releases/$previous" "$rollback" && /usr/bin/mv -T "$rollback" "$current"; then
      rollback_succeeded=1
    fi
  fi
  /usr/bin/rm -f -- "$next"
  /usr/bin/rm -f -- "$rollback"
  [[ -z $snapshot ]] || /usr/bin/rm -f -- "$snapshot"
  if [[ $release_created -eq 1 && ($switched -eq 0 || $rollback_succeeded -eq 1) ]]; then
    /usr/bin/rm -rf -- "$release"
  fi
}
trap cleanup EXIT INT TERM
snapshot=$(/usr/bin/mktemp --tmpdir="$root" .m17-upgrade-archive.XXXXXXXX)
/usr/bin/chmod 0600 "$snapshot"
/usr/bin/timeout --signal=KILL 30s /usr/bin/cp --reflink=never -- "$archive" "$snapshot"
[[ $(/usr/bin/sha256sum "$snapshot" | /usr/bin/cut -d ' ' -f 1) == "$digest" ]] || reject m17-upgrade-archive-mismatch

units=(
  chalkwright-canary.service
  chalkwright-canary-plan-preflight.service
  chalkwright-canary-plan-refresh.service
  chalkwright-canary-plan-refresh.timer
  chalkwright-canary-classroom-preflight.service
  chalkwright-canary-classroom-refresh.service
  chalkwright-canary-classroom-refresh.timer
  chalkwright-canary-calendar-preflight.service
  chalkwright-canary-calendar-sync.service
  chalkwright-canary-calendar-sync.timer
  chalkwright-canary-comparison.service
  chalkwright-canary-comparison-observation.service
  chalkwright-canary-integrity.service
  chalkwright-canary-integrity.timer
  chalkwright-canary-backup.service
  chalkwright-canary-backup.timer
)
for unit in "${units[@]}"; do
  state=$(/usr/bin/env -i LANG=C LC_ALL=C SYSTEMD_COLORS=0 /usr/bin/timeout --signal=KILL 5s /usr/bin/systemctl show --property=ActiveState --value "$unit") || reject m17-upgrade-unit-state-unavailable
  [[ $state == inactive || $state == failed ]] || reject m17-upgrade-candidate-active
done

/usr/bin/install -d -o root -g root -m 0755 "$release"
release_created=1
/usr/bin/tar --no-same-owner --no-same-permissions -xzf "$snapshot" -C "$release"
for required in dist/entrypoints/m17-canary-server.js dist/entrypoints/m17-canary-calendar-sync.js dist/entrypoints/m17-canary-activation-manifest.js scripts/operations/activate-m17-canary.sh scripts/operations/stop-m17-canary.sh; do
  [[ -f "$release/$required" && ! -L "$release/$required" ]] || reject m17-upgrade-runtime-invalid
done
/usr/bin/chown -R root:root "$release"
/usr/bin/find "$release" -type d -exec /usr/bin/chmod 0755 {} +
/usr/bin/find "$release" -type f -exec /usr/bin/chmod 0644 {} +
/usr/bin/chmod 0755 "$release/scripts/operations/activate-m17-canary.sh" "$release/scripts/operations/stop-m17-canary.sh"
for unit_source in "$release"/systemd/m17/*.service.in "$release"/systemd/m17/*.timer.in; do
  name=$(/usr/bin/basename "$unit_source" .in)
  [[ -f "/etc/systemd/system/$name" && ! -L "/etc/systemd/system/$name" ]] || reject m17-upgrade-unit-missing
  /usr/bin/cmp -s "$unit_source" "/etc/systemd/system/$name" || reject m17-upgrade-unit-drift
done
/usr/bin/ln -s "releases/$digest" "$next"
for unit in "${units[@]}"; do
  state=$(/usr/bin/env -i LANG=C LC_ALL=C SYSTEMD_COLORS=0 /usr/bin/timeout --signal=KILL 5s /usr/bin/systemctl show --property=ActiveState --value "$unit") || reject m17-upgrade-unit-state-unavailable
  [[ $state == inactive || $state == failed ]] || reject m17-upgrade-candidate-became-active
done
[[ -L $current && $(/usr/bin/readlink "$current") == "releases/$previous" ]] || reject m17-upgrade-predecessor-changed
/usr/bin/mv -T "$next" "$current"
switched=1
[[ -L $current && $(/usr/bin/readlink "$current") == "releases/$digest" ]] || reject m17-upgrade-current-invalid
/usr/bin/rm -f -- "$snapshot"
committed=1
echo "{\"status\":\"upgraded-inert\",\"previousRelease\":\"sha256:$previous\",\"currentRelease\":\"sha256:$digest\",\"unitsChanged\":0,\"unitsStarted\":0,\"providerRequests\":0,\"routeChanges\":0}"
