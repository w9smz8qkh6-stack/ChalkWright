#!/usr/bin/env bash
set -euo pipefail
umask 077

reject() { echo "{\"status\":\"rejected\",\"code\":\"$1\"}" >&2; exit 1; }
[[ ${EUID} -eq 0 && $# -eq 0 ]] || reject production-powerschool-repair-usage-invalid
root=/usr/local/lib/chalkwright-production-admin
release=/opt/chalkwright/current
unit=chalkwright-powerschool-repair.service
desktop_user=bren
desktop_display=:0
desktop_access_granted=0
revoke_desktop_access() {
  [[ $desktop_access_granted -eq 1 ]] || return 0
  /usr/sbin/runuser -u "$desktop_user" -- /usr/bin/env HOME="/home/$desktop_user" DISPLAY="$desktop_display" /usr/bin/xhost -SI:localuser:classroom-hub >/dev/null 2>&1 || true
}
trap revoke_desktop_access EXIT INT TERM
[[ -x /usr/bin/node && -f "$root/provision-m17-powerschool-repair.mjs" && ! -L "$root/provision-m17-powerschool-repair.mjs" ]] || reject production-powerschool-repair-controller-invalid
[[ -x /usr/bin/xhost && -x /usr/sbin/runuser && -d "/home/$desktop_user" && ! -L "/home/$desktop_user" ]] || reject production-powerschool-repair-desktop-unavailable
[[ -L $release && -f "$release/dist/entrypoints/m17-powerschool-repair.js" && -f "$release/systemd/production/$unit.in" ]] || reject production-powerschool-repair-release-invalid
if [[ ! -e /etc/chalkwright/production/jobs/powerschool-repair.env ]]; then
  /usr/bin/node "$root/provision-m17-powerschool-repair.mjs" --production-apply || reject production-powerschool-repair-provision-failed
fi
/usr/bin/install -o root -g root -m 0644 "$release/systemd/production/$unit.in" "/etc/systemd/system/$unit"
/usr/bin/systemctl daemon-reload
/usr/sbin/runuser -u "$desktop_user" -- /usr/bin/env HOME="/home/$desktop_user" DISPLAY="$desktop_display" /usr/bin/xhost +SI:localuser:classroom-hub >/dev/null 2>&1 || reject production-powerschool-repair-desktop-grant-failed
desktop_access_granted=1
/usr/bin/systemctl start "$unit" || reject production-powerschool-repair-failed
echo '{"status":"production-powerschool-repaired","providerWrites":0}'
