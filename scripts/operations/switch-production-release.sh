#!/usr/bin/env bash
set -euo pipefail
umask 077

reject() { echo "{\"status\":\"rejected\",\"code\":\"$1\"}" >&2; exit 1; }
[[ ${EUID} -eq 0 ]] || reject production-release-switch-root-required
[[ $# -eq 1 && $1 =~ ^[a-f0-9]{64}$ ]] || reject production-release-switch-usage-invalid
digest=$1
root=/opt/chalkwright
release="$root/releases/$digest"
current="$root/current"
next="$root/.current-$digest"
[[ -d $release && ! -L $release && -f "$release/.chalkwright-release.json" ]] || reject production-release-not-staged
[[ ! -e $next && ! -L $next ]] || reject production-release-switch-pending
previous=
if [[ -e $current || -L $current ]]; then
  [[ -L $current ]] || reject production-release-current-invalid
  previous=$(/usr/bin/readlink "$current")
  [[ $previous =~ ^releases/[a-f0-9]{64}$ ]] || reject production-release-current-invalid
fi
/usr/bin/ln -s "releases/$digest" "$next"
/usr/bin/mv -T "$next" "$current"
echo "{\"status\":\"selected\",\"previous\":\"${previous:-none}\",\"currentRelease\":\"sha256:$digest\"}"
