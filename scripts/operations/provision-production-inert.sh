#!/usr/bin/env bash
set -euo pipefail
umask 077

reject() { echo "{\"status\":\"rejected\",\"code\":\"$1\"}" >&2; exit 1; }
[[ ${EUID} -eq 0 ]] || reject production-provision-root-required
[[ $# -eq 0 ]] || reject production-provision-usage-invalid

repository=https://github.com/w9smz8qkh6-stack/chalkwright.git
deploy_root=/var/lib/chalkwright/deploy
source_root="$deploy_root/source"
archive_root="$deploy_root/archives"
release_root=/opt/chalkwright
units=(
  chalkwright.service
  chalkwright-backup.service
  chalkwright-backup.timer
  chalkwright-calendar-sync.service
  chalkwright-calendar-sync.timer
  chalkwright-classroom-refresh.service
  chalkwright-classroom-refresh.timer
  chalkwright-deploy.service
  chalkwright-deploy.timer
  chalkwright-integrity.service
  chalkwright-integrity.timer
  chalkwright-plan-refresh.service
  chalkwright-plan-refresh.timer
  chalkwright-powerschool-repair.service
)
for path in /etc/chalkwright/production/server.json /etc/chalkwright/production/calendar.json /etc/chalkwright/production/jobs/plan-refresh.env /etc/chalkwright/production/jobs/classroom-refresh.env /etc/chalkwright/production/jobs/maintenance.env; do
  [[ -f $path && ! -L $path ]] || reject production-provision-config-missing
done
[[ ! -e $source_root && ! -L $source_root ]] || reject production-provision-source-exists
[[ ! -e "$release_root/current" && ! -L "$release_root/current" ]] || reject production-provision-current-exists

created_source=0
created_units=0
cleanup() {
  [[ $created_units -eq 0 ]] || {
    for unit in "${units[@]}"; do
      [[ -f "/etc/systemd/system/$unit" && ! -L "/etc/systemd/system/$unit" ]] && /usr/bin/rm -f -- "/etc/systemd/system/$unit"
    done
    /usr/bin/systemctl daemon-reload || true
  }
  [[ $created_source -eq 0 ]] || /usr/bin/rm -rf -- "$source_root"
}
trap cleanup EXIT INT TERM
/usr/bin/install -d -o root -g root -m 0700 "$deploy_root" "$archive_root"
/usr/bin/git clone --quiet --no-checkout "$repository" "$source_root" || reject production-provision-source-clone-failed
created_source=1
/usr/bin/git -C "$source_root" fetch --quiet origin main || reject production-provision-source-fetch-failed
/usr/bin/git -C "$source_root" checkout --quiet --detach origin/main || reject production-provision-source-checkout-failed
commit=$(/usr/bin/git -C "$source_root" rev-parse --verify HEAD) || reject production-provision-commit-invalid
[[ $commit =~ ^[a-f0-9]{40}$ ]] || reject production-provision-commit-invalid
temporary_archive="$archive_root/chalkwright-production-bootstrap-$commit.tar.gz"
/usr/bin/bash "$source_root/scripts/operations/build-production-release.sh" "$source_root" "$temporary_archive"
digest=$(/usr/bin/sha256sum "$temporary_archive" | /usr/bin/cut -d ' ' -f 1)
archive="$archive_root/chalkwright-production-$digest.tar.gz"
[[ ! -e $archive && ! -L $archive ]] || reject production-provision-archive-exists
/usr/bin/mv "$temporary_archive" "$archive"
/usr/bin/bash "$source_root/scripts/operations/install-production-release.sh" "$archive" "$digest"
release="$release_root/releases/$digest"
for unit in "${units[@]}"; do
  [[ ! -e "/etc/systemd/system/$unit" && ! -L "/etc/systemd/system/$unit" ]] || reject production-provision-unit-exists
done
created_units=1
for unit_source in "$release"/systemd/production/*.service.in "$release"/systemd/production/*.timer.in; do
  unit=$(/usr/bin/basename "$unit_source" .in)
  /usr/bin/install -o root -g root -m 0644 "$unit_source" "/etc/systemd/system/$unit"
done
/usr/bin/systemctl daemon-reload
/usr/bin/bash "$source_root/scripts/operations/switch-production-release.sh" "$digest" >/dev/null
created_units=0
created_source=0
echo "{\"status\":\"provisioned-inert\",\"release\":\"sha256:$digest\",\"unitsInstalled\":14,\"unitsStarted\":0,\"routeChanges\":0,\"providerRequests\":0}"
