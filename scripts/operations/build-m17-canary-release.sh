#!/usr/bin/env bash
set -euo pipefail

archive=/tmp/chalkwright-m17-canary-runtime.tar.gz
stage=$(/usr/bin/mktemp -d /tmp/chalkwright-m17-build.XXXXXXXX)
cleanup() { /usr/bin/rm -rf -- "$stage"; }
trap cleanup EXIT INT TERM

[[ ! -e $archive && ! -L $archive ]] || { echo '{"status":"rejected","code":"m17-release-archive-exists"}' >&2; exit 1; }
npm run build --silent
/usr/bin/install -d -m 0755 "$stage/runtime"
/usr/bin/cp -a dist public package.json package-lock.json "$stage/runtime/"
/usr/bin/install -d -m 0755 "$stage/runtime/systemd" "$stage/runtime/docs/migration" "$stage/runtime/scripts/operations"
/usr/bin/cp -a systemd/m17 "$stage/runtime/systemd/"
/usr/bin/cp -a docs/migration/m17-review-package.md "$stage/runtime/docs/migration/"
/usr/bin/cp -a scripts/operations/activate-m17-canary.sh scripts/operations/stop-m17-canary.sh scripts/operations/bind-m17-activation-manifest.mjs "$stage/runtime/scripts/operations/"
(
  cd "$stage/runtime"
  npm ci --omit=dev --ignore-scripts --silent
)
/usr/bin/tar --sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner -cf - -C "$stage/runtime" . | /usr/bin/gzip -n -9 > "$archive"
digest=$(/usr/bin/sha256sum "$archive" | /usr/bin/cut -d ' ' -f 1)
bytes=$(/usr/bin/stat -c %s "$archive")
echo "{\"status\":\"built-inert\",\"archive\":\"$archive\",\"sha256\":\"$digest\",\"bytes\":$bytes,\"providerRequests\":0,\"servicesStarted\":0,\"routeChanges\":0}"
