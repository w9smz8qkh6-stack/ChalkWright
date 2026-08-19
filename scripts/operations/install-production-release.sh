#!/usr/bin/env bash
set -euo pipefail
umask 077

reject() { echo "{\"status\":\"rejected\",\"code\":\"$1\"}" >&2; exit 1; }
[[ ${EUID} -eq 0 ]] || reject production-release-install-root-required
[[ $# -eq 2 ]] || reject production-release-install-usage-invalid
archive=$1
digest=$2
[[ $digest =~ ^[a-f0-9]{64}$ ]] || reject production-release-digest-invalid
[[ $archive == "/var/lib/chalkwright/deploy/archives/chalkwright-production-$digest.tar.gz" ]] || reject production-release-archive-path-invalid
[[ -f $archive && ! -L $archive ]] || reject production-release-archive-unsafe
[[ $(/usr/bin/sha256sum "$archive" | /usr/bin/cut -d ' ' -f 1) == "$digest" ]] || reject production-release-archive-mismatch

root=/opt/chalkwright
release="$root/releases/$digest"
[[ ! -e $release && ! -L $release ]] || { echo "{\"status\":\"already-staged\",\"release\":\"sha256:$digest\"}"; exit 0; }
/usr/bin/install -d -o root -g root -m 0755 "$root" "$root/releases" "$release"
committed=0
cleanup() {
  [[ $committed -eq 1 ]] || /usr/bin/rm -rf -- "$release"
}
trap cleanup EXIT INT TERM
/usr/bin/tar --no-same-owner --no-same-permissions -xzf "$archive" -C "$release"
for required in dist/entrypoints/production-server.js dist/entrypoints/production-calendar-sync.js dist/entrypoints/production-retained-plan-refresh.js dist/entrypoints/production-classroom-refresh.js dist/entrypoints/job.js .chalkwright-release.json systemd/production/chalkwright.service.in; do
  [[ -f "$release/$required" && ! -L "$release/$required" ]] || reject production-release-runtime-invalid
done
/usr/bin/chown -R root:root "$release"
/usr/bin/find "$release" -type d -exec /usr/bin/chmod 0755 {} +
/usr/bin/find "$release" -type f -exec /usr/bin/chmod 0644 {} +
/usr/bin/chmod 0755 "$release"/scripts/operations/*.sh
committed=1
echo "{\"status\":\"staged\",\"release\":\"sha256:$digest\",\"servicesStarted\":0,\"providerRequests\":0}"
