#!/usr/bin/env bash
set -euo pipefail
umask 077

reject() { echo "{\"status\":\"rejected\",\"code\":\"$1\"}" >&2; exit 1; }
[[ $# -eq 2 ]] || reject production-release-build-usage-invalid
source_root=$1
archive=$2
npm=/usr/local/bin/npm
[[ -d $source_root && ! -L $source_root && -d $source_root/.git ]] || reject production-release-source-invalid
[[ $archive == /var/lib/chalkwright/deploy/archives/chalkwright-production-*.tar.gz ]] || reject production-release-archive-path-invalid
[[ ! -e $archive && ! -L $archive ]] || reject production-release-archive-exists
[[ -x $npm ]] || reject production-release-npm-missing
commit=$(/usr/bin/git -C "$source_root" rev-parse --verify HEAD) || reject production-release-commit-invalid
[[ $commit =~ ^[a-f0-9]{40}$ ]] || reject production-release-commit-invalid

stage=$(/usr/bin/mktemp -d /var/lib/chalkwright/deploy/.build.XXXXXXXX)
cleanup() { /usr/bin/rm -rf -- "$stage"; }
trap cleanup EXIT INT TERM

(
  cd "$source_root"
  "$npm" ci --ignore-scripts --silent
  "$npm" run build --silent
)
/usr/bin/install -d -m 0755 "$stage/runtime" "$stage/runtime/systemd" "$stage/runtime/scripts/operations"
/usr/bin/cp -a "$source_root"/dist "$source_root"/public "$source_root"/package.json "$source_root"/package-lock.json "$stage/runtime/"
/usr/bin/cp -a "$source_root"/systemd/production "$stage/runtime/systemd/"
/usr/bin/cp -a "$source_root"/scripts/operations/activate-production.sh "$source_root"/scripts/operations/cutover-production-tailscale-route.sh "$source_root"/scripts/operations/migrate-production-plan-state.sh "$source_root"/scripts/operations/install-production-release.sh "$source_root"/scripts/operations/switch-production-release.sh "$source_root"/scripts/operations/deploy-production-from-main.sh "$source_root"/scripts/operations/provision-production-inert.sh "$stage/runtime/scripts/operations/"
/usr/bin/printf '{"version":1,"commit":"%s"}\n' "$commit" > "$stage/runtime/.chalkwright-release.json"
(
  cd "$stage/runtime"
  "$npm" ci --omit=dev --ignore-scripts --silent
)
/usr/bin/tar --sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner -cf - -C "$stage/runtime" . | /usr/bin/gzip -n -9 > "$archive"
/usr/bin/chmod 0600 "$archive"
digest=$(/usr/bin/sha256sum "$archive" | /usr/bin/cut -d ' ' -f 1)
bytes=$(/usr/bin/stat -c %s "$archive")
echo "{\"status\":\"built\",\"commit\":\"$commit\",\"sha256\":\"$digest\",\"bytes\":$bytes,\"providerRequests\":0,\"servicesStarted\":0}"
