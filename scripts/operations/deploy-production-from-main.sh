#!/usr/bin/env bash
set -euo pipefail
umask 077

reject() { echo "{\"status\":\"rejected\",\"code\":\"$1\"}" >&2; exit 1; }
[[ ${EUID} -eq 0 ]] || reject production-deploy-root-required
source_root=/var/lib/chalkwright/deploy/source
archive_root=/var/lib/chalkwright/deploy/archives
release_root=/opt/chalkwright
config=/etc/chalkwright/production/server.json
calendar=/etc/chalkwright/production/calendar.json
[[ -d $source_root && ! -L $source_root && -d $source_root/.git ]] || reject production-deploy-source-missing
[[ -f $config && ! -L $config && -f $calendar && ! -L $calendar ]] || reject production-deploy-config-missing
/usr/bin/git -C "$source_root" fetch --quiet origin main || reject production-deploy-fetch-failed
commit=$(/usr/bin/git -C "$source_root" rev-parse --verify origin/main) || reject production-deploy-commit-invalid
[[ $commit =~ ^[a-f0-9]{40}$ ]] || reject production-deploy-commit-invalid
if [[ -L "$release_root/current" ]]; then
  current=$(/usr/bin/readlink "$release_root/current")
  if [[ $current =~ ^releases/[a-f0-9]{64}$ ]] && /usr/bin/grep -Fqx "{\"version\":1,\"commit\":\"$commit\"}" "$release_root/$current/.chalkwright-release.json"; then
    echo "{\"status\":\"up-to-date\",\"commit\":\"$commit\"}"
    exit 0
  fi
fi
work=$(/usr/bin/mktemp -d /var/lib/chalkwright/deploy/.source.XXXXXXXX)
cleanup() { /usr/bin/rm -rf -- "$work"; }
trap cleanup EXIT INT TERM
/usr/bin/git clone --quiet --shared --no-checkout "$source_root" "$work/repository" || reject production-deploy-checkout-failed
/usr/bin/git -C "$work/repository" checkout --quiet --detach "$commit" || reject production-deploy-checkout-failed
temporary_archive="$archive_root/chalkwright-production-staging-$commit.tar.gz"
/usr/bin/bash "$work/repository/scripts/operations/build-production-release.sh" "$work/repository" "$temporary_archive"
digest=$(/usr/bin/sha256sum "$temporary_archive" | /usr/bin/cut -d ' ' -f 1)
archive="$archive_root/chalkwright-production-$digest.tar.gz"
if [[ -e $archive || -L $archive ]]; then
  [[ -f $archive && ! -L $archive ]] || reject production-deploy-archive-exists
  [[ $(/usr/bin/sha256sum "$archive" | /usr/bin/cut -d ' ' -f 1) == "$digest" ]] || reject production-deploy-archive-exists
  /usr/bin/rm -f -- "$temporary_archive"
else
  /usr/bin/mv "$temporary_archive" "$archive"
fi
release="$release_root/releases/$digest"
if [[ -e $release || -L $release ]]; then
  [[ -f "$release/.chalkwright-release.json" && ! -L "$release/.chalkwright-release.json" ]] || reject production-deploy-release-exists
  /usr/bin/grep -Fqx "{\"version\":1,\"commit\":\"$commit\"}" "$release/.chalkwright-release.json" || reject production-deploy-release-exists
else
  /usr/bin/bash "$work/repository/scripts/operations/install-production-release.sh" "$archive" "$digest"
fi
CHALKWRIGHT_PRODUCTION_CALENDAR_CONFIG_REFERENCE="$calendar" /usr/sbin/runuser -u classroom-hub -- /usr/bin/node "$release/dist/entrypoints/production-calendar-sync.js" --preflight >/dev/null || reject production-deploy-calendar-preflight-failed
previous=
if [[ -L "$release_root/current" ]]; then previous=$(/usr/bin/readlink "$release_root/current"); fi
/usr/bin/bash "$work/repository/scripts/operations/switch-production-release.sh" "$digest" >/dev/null
rollback() {
  [[ -n $previous ]] || return 0
  /usr/bin/ln -s "$previous" "$release_root/.rollback-$digest"
  /usr/bin/mv -T "$release_root/.rollback-$digest" "$release_root/current"
  /usr/bin/systemctl restart chalkwright.service || true
}
if ! /usr/bin/systemctl restart chalkwright.service; then rollback; reject production-deploy-service-restart-failed; fi
health_url=$(/usr/bin/node --input-type=module - "$config" <<'NODE'
import { readFileSync } from 'node:fs';
const value = JSON.parse(readFileSync(process.argv[2], 'utf8'));
if (value.host !== '127.0.0.1' || !Number.isInteger(value.port) || value.port < 1 || value.port > 65535) process.exit(1);
process.stdout.write(`http://127.0.0.1:${value.port}/classroom-screen`);
NODE
) || { rollback; reject production-deploy-health-config-invalid; }
for _ in {1..20}; do
  if /usr/bin/curl --fail --silent --show-error --max-time 2 --output /dev/null "$health_url/health" && /usr/bin/curl --fail --silent --show-error --max-time 2 --output /dev/null "$health_url/ready"; then break; fi
  /usr/bin/sleep 0.25
done
if ! /usr/bin/curl --fail --silent --show-error --max-time 2 --output /dev/null "$health_url/health" || ! /usr/bin/curl --fail --silent --show-error --max-time 2 --output /dev/null "$health_url/ready"; then
  rollback
  reject production-deploy-health-failed
fi
echo "{\"status\":\"deployed\",\"commit\":\"$commit\",\"release\":\"sha256:$digest\",\"calendarPreflight\":\"passed\",\"health\":\"passed\"}"
