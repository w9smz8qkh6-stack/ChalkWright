#!/usr/bin/env bash
set -euo pipefail
umask 077

reject() { echo "chalkwright-powerschool-repair-display-$1" >&2; exit 1; }
[[ $# -eq 0 ]] || reject usage-invalid
[[ ${RUNTIME_DIRECTORY:-} == /run/chalkwright-powerschool-repair ]] || reject runtime-directory-invalid
[[ -d $RUNTIME_DIRECTORY && ! -L $RUNTIME_DIRECTORY ]] || reject runtime-directory-invalid
[[ $(/usr/bin/stat -c '%u:%a' "$RUNTIME_DIRECTORY") == "$(/usr/bin/id -u):700" ]] || reject runtime-directory-invalid
[[ -x /usr/bin/Xvfb && -x /usr/bin/xauth && -x /usr/bin/od && -x /usr/bin/tr ]] || reject tool-missing

display=:99
authority="$RUNTIME_DIRECTORY/Xauthority"
[[ ! -e $authority && ! -L $authority ]] || reject authority-target-exists
cookie=$(/usr/bin/od -An -N16 -tx1 /dev/urandom | /usr/bin/tr -d ' \n')
[[ $cookie =~ ^[0-9a-f]{32}$ ]] || reject entropy-unavailable
printf 'add %s . %s\n' "$display" "$cookie" | /usr/bin/xauth -f "$authority" source - >/dev/null
unset cookie
[[ -f $authority && ! -L $authority && $(/usr/bin/stat -c '%u:%a' "$authority") == "$(/usr/bin/id -u):600" ]] || reject authority-unsafe

exec /usr/bin/Xvfb "$display" -auth "$authority" -nolisten tcp -screen 0 1280x720x24 -noreset
