#!/usr/bin/env bash
set -euo pipefail
umask 077

reject() { echo "{\"status\":\"rejected\",\"code\":\"$1\"}" >&2; exit 1; }
[[ ${EUID} -eq 0 && $# -eq 0 ]] || reject production-powerschool-repair-usage-invalid
root=/usr/local/lib/chalkwright-production-admin
release=/opt/chalkwright/current
unit=chalkwright-powerschool-repair.service
desktop_user=bren
desktop_profile=
desktop_session=/var/lib/chalkwright/production-powerschool-repair-session
routine_session=/var/lib/chalkwright/production-session
source_plan_environment=/etc/chalkwright/production/jobs/plan-refresh.env
desktop_runtime=
runtime=
desktop_provider=
desktop_plan_environment=
desktop_environment=
source_references=/etc/chalkwright/migration/powerschool-repair-references.json
source_service_account=/etc/chalkwright/migration/powerschool-onepassword-service-account.env
production_config=/etc/chalkwright/production/server.json
candidate=
cleanup() {
  if [[ -n $candidate ]]; then
    /usr/bin/rm -f -- "$candidate" || true
  fi
  if [[ -n $runtime && -d $runtime && ! -L $runtime && $(/usr/bin/stat -c %U "$runtime") == "$desktop_user" && $(/usr/bin/stat -c %a "$runtime") == 700 ]]; then
    /usr/bin/rm -rf -- "$runtime"
  fi
}
trap cleanup EXIT INT TERM
[[ -x /usr/bin/node && -x /usr/bin/install && -x /usr/bin/loginctl && -x /usr/sbin/runuser && -d "/home/$desktop_user" && ! -L "/home/$desktop_user" ]] || reject production-powerschool-repair-controller-invalid
[[ -L $release && -f "$release/dist/entrypoints/m17-powerschool-repair.js" && -f "$release/systemd/production/$unit.in" ]] || reject production-powerschool-repair-release-invalid
desktop_runtime=$(/usr/bin/loginctl show-user "$desktop_user" -p RuntimePath --value) || reject production-powerschool-repair-desktop-runtime-unavailable
desktop_xauthority=$(/usr/sbin/runuser -u "$desktop_user" -- /usr/bin/env XDG_RUNTIME_DIR="$desktop_runtime" /usr/bin/systemctl --user show-environment | /usr/bin/sed -n 's/^XAUTHORITY=//p') || reject production-powerschool-repair-desktop-authority-unavailable
[[ $desktop_runtime == /run/user/* && -d $desktop_runtime && ! -L $desktop_runtime && $(/usr/bin/stat -c %U "$desktop_runtime") == "$desktop_user" && $(/usr/bin/stat -c %a "$desktop_runtime") == 700 ]] || reject production-powerschool-repair-desktop-runtime-unsafe
[[ $desktop_xauthority == "$desktop_runtime"/* && -f $desktop_xauthority && ! -L $desktop_xauthority && $(/usr/bin/stat -c %U "$desktop_xauthority") == "$desktop_user" && $(/usr/bin/stat -c %a "$desktop_xauthority") == 600 && $(/usr/bin/stat -c %h "$desktop_xauthority") == 1 ]] || reject production-powerschool-repair-desktop-authority-unsafe
runtime=$desktop_runtime/chalkwright-production-repair
desktop_provider=$runtime/provider
desktop_profile=$runtime/profile
desktop_plan_environment=$runtime/plan-refresh.env
desktop_environment=$runtime/desktop-repair.env
repair_date=$(/usr/bin/node -e '
const fs = require("node:fs");
const config = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const values = Object.fromEntries(
  new Intl.DateTimeFormat("en-CA", { timeZone: config.timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date())
    .map((part) => [part.type, part.value]),
);
const date = `${values.year}-${values.month}-${values.day}`;
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) process.exit(64);
process.stdout.write(date);
' "$production_config") || reject production-powerschool-repair-date-unavailable
[[ $repair_date =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || reject production-powerschool-repair-date-invalid
[[ ! -e $runtime && ! -L $runtime ]] || reject production-powerschool-repair-runtime-exists
/usr/bin/install -d -o "$desktop_user" -g "$desktop_user" -m 0700 "$runtime" "$desktop_provider" "$desktop_profile" "$desktop_session" || reject production-powerschool-repair-desktop-prepare-failed
/usr/bin/install -o "$desktop_user" -g "$desktop_user" -m 0600 "$source_plan_environment" "$desktop_plan_environment" || reject production-powerschool-repair-config-prepare-failed
/usr/bin/install -o "$desktop_user" -g "$desktop_user" -m 0600 "$source_references" "$desktop_provider/repair-references.json" || reject production-powerschool-repair-provider-prepare-failed
/usr/bin/install -o "$desktop_user" -g "$desktop_user" -m 0600 "$source_service_account" "$desktop_provider/onepassword-service-account.env" || reject production-powerschool-repair-provider-prepare-failed
/usr/bin/tee "$desktop_environment" >/dev/null <<EOF
CLASSROOM_HUB_POWERSCHOOL_SESSION_DIRECTORY="$desktop_session"
CLASSROOM_HUB_POWERSCHOOL_COMPATIBILITY_PROFILE_DIRECTORY="$desktop_profile"
CLASSROOM_HUB_POWERSCHOOL_ONEPASSWORD_SERVICE_ACCOUNT_ENV="$desktop_provider/onepassword-service-account.env"
CLASSROOM_HUB_POWERSCHOOL_REPAIR_REFERENCE="$desktop_provider/repair-references.json"
CHALKWRIGHT_M17_REPAIR_DATE="$repair_date"
HOME="$desktop_profile"
EOF
/usr/bin/chown "$desktop_user:$desktop_user" "$desktop_environment"
/usr/bin/chmod 0600 "$desktop_environment"
/usr/bin/install -d -o root -g root -m 0755 /etc/systemd/user
/usr/bin/install -o root -g root -m 0644 "$release/systemd/production/$unit.in" "/etc/systemd/user/$unit"
user_systemctl=(/usr/sbin/runuser -u "$desktop_user" -- /usr/bin/env XDG_RUNTIME_DIR="$desktop_runtime" /usr/bin/systemctl --user)
"${user_systemctl[@]}" daemon-reload || reject production-powerschool-repair-user-manager-unavailable
"${user_systemctl[@]}" reset-failed "$unit" >/dev/null 2>&1 || true
"${user_systemctl[@]}" start "$unit" || reject production-powerschool-repair-failed
source_state=$desktop_session/powerschool-session.json
target_state=$routine_session/powerschool-session.json
[[ -d $desktop_session && ! -L $desktop_session && -f $source_state && ! -L $source_state && -s $source_state && -d $routine_session && ! -L $routine_session ]] || reject production-powerschool-repair-state-unavailable
[[ $(/usr/bin/stat -c %U "$desktop_session") == "$desktop_user" && $(/usr/bin/stat -c %a "$desktop_session") == 700 && $(/usr/bin/stat -c %U "$source_state") == "$desktop_user" && $(/usr/bin/stat -c %a "$source_state") == 600 && $(/usr/bin/stat -c %h "$source_state") == 1 && $(/usr/bin/stat -c %s "$source_state") -le 1048576 && $(/usr/bin/stat -c %U "$routine_session") == classroom-hub && $(/usr/bin/stat -c %a "$routine_session") == 700 ]] || reject production-powerschool-repair-state-unsafe
candidate=$routine_session/.powerschool-session.repair.$$.candidate
/usr/bin/install -o classroom-hub -g classroom-hub -m 0600 "$source_state" "$candidate" || reject production-powerschool-repair-state-copy-failed
/usr/bin/mv -f -- "$candidate" "$target_state" || reject production-powerschool-repair-state-commit-failed
candidate=
echo '{"status":"production-powerschool-repaired","providerWrites":0,"profilesCopied":0,"googleOriginsCopied":0}'
