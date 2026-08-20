#!/usr/bin/env bash
set -euo pipefail
umask 077

reject() { echo "{\"status\":\"rejected\",\"code\":\"$1\"}" >&2; exit 1; }
[[ ${EUID} -eq 0 && $# -eq 0 ]] || reject production-powerschool-repair-usage-invalid
root=/usr/local/lib/chalkwright-production-admin
release=/opt/chalkwright/current
unit=chalkwright-powerschool-repair.service
display_unit=chalkwright-powerschool-repair-display.service
[[ -x /usr/bin/node && -f "$root/provision-m17-powerschool-repair.mjs" && ! -L "$root/provision-m17-powerschool-repair.mjs" ]] || reject production-powerschool-repair-controller-invalid
[[ -x /usr/bin/Xvfb && -x /usr/bin/xauth ]] || reject production-powerschool-repair-display-unavailable
[[ -L $release && -f "$release/dist/entrypoints/m17-powerschool-repair.js" && -f "$release/systemd/production/$unit.in" && -f "$release/systemd/production/$display_unit.in" && -x "$release/scripts/operations/run-chalkwright-powerschool-repair-display.sh" ]] || reject production-powerschool-repair-release-invalid
if [[ ! -e /etc/chalkwright/production/jobs/powerschool-repair.env ]]; then
  /usr/bin/node "$root/provision-m17-powerschool-repair.mjs" --production-apply || reject production-powerschool-repair-provision-failed
fi
/usr/bin/install -o root -g root -m 0644 "$release/systemd/production/$unit.in" "/etc/systemd/system/$unit"
/usr/bin/install -o root -g root -m 0644 "$release/systemd/production/$display_unit.in" "/etc/systemd/system/$display_unit"
/usr/bin/systemctl daemon-reload
/usr/bin/systemctl start "$unit" || reject production-powerschool-repair-failed
echo '{"status":"production-powerschool-repaired","providerWrites":0}'
