#!/usr/bin/env bash
set -euo pipefail
umask 077

reject() { echo "{\"status\":\"rejected\",\"code\":\"$1\"}" >&2; exit 1; }
[[ ${EUID} -eq 0 ]] || reject production-activate-root-required
[[ $# -eq 0 ]] || reject production-activate-usage-invalid
release=/opt/chalkwright/current
config=/etc/chalkwright/production/server.json
for path in "$config" /etc/chalkwright/production/calendar.json /etc/chalkwright/production/jobs/plan-refresh.env /etc/chalkwright/production/jobs/classroom-refresh.env /etc/chalkwright/production/jobs/maintenance.env; do
  [[ -f $path && ! -L $path ]] || reject production-activate-config-missing
done
[[ -L $release && -f "$release/dist/entrypoints/production-server.js" ]] || reject production-activate-release-invalid
for unit in chalkwright.service chalkwright-backup.service chalkwright-calendar-sync.service chalkwright-classroom-refresh.service chalkwright-deploy.service chalkwright-integrity.service chalkwright-plan-refresh.service; do
  [[ -f "/etc/systemd/system/$unit" && ! -L "/etc/systemd/system/$unit" ]] || reject production-activate-unit-missing
done

health_url=$(/usr/bin/node --input-type=module - "$config" <<'NODE'
import { readFileSync } from 'node:fs';
const value = JSON.parse(readFileSync(process.argv[2], 'utf8'));
if (value.host !== '127.0.0.1' || !Number.isInteger(value.port) || value.port < 1 || value.port > 65535) process.exit(1);
process.stdout.write(`http://127.0.0.1:${value.port}/classroom-screen`);
NODE
) || reject production-activate-health-config-invalid
timers=(
  chalkwright-plan-refresh.timer
  chalkwright-classroom-refresh.timer
  chalkwright-calendar-sync.timer
  chalkwright-integrity.timer
  chalkwright-backup.timer
  chalkwright-deploy.timer
)
new_timer_links=()
stop_permanent() {
  /usr/bin/systemctl stop "${timers[@]}" chalkwright-calendar-sync.service chalkwright-classroom-refresh.service chalkwright-plan-refresh.service chalkwright-backup.service chalkwright-integrity.service chalkwright.service || true
  for timer in "${new_timer_links[@]}"; do
    /usr/bin/rm -f -- "/etc/systemd/system/multi-user.target.wants/$timer"
  done
  if [[ ${#new_timer_links[@]} -gt 0 ]]; then /usr/bin/systemctl daemon-reload || true; fi
}
/usr/bin/systemctl start chalkwright-integrity.service || reject production-activate-integrity-failed
/usr/bin/systemctl start chalkwright-backup.service || { stop_permanent; reject production-activate-backup-failed; }
/usr/bin/systemctl start chalkwright-plan-refresh.service || { stop_permanent; reject production-activate-plan-failed; }
/usr/bin/systemctl start chalkwright-classroom-refresh.service || { stop_permanent; reject production-activate-classroom-failed; }
/usr/bin/systemctl start chalkwright.service || { stop_permanent; reject production-activate-server-failed; }
for _ in {1..20}; do
  if /usr/bin/curl --fail --silent --show-error --max-time 2 --output /dev/null "$health_url/health" && /usr/bin/curl --fail --silent --show-error --max-time 2 --output /dev/null "$health_url/ready"; then break; fi
  /usr/bin/sleep 0.25
done
/usr/bin/curl --fail --silent --show-error --max-time 2 --output /dev/null "$health_url/health" && /usr/bin/curl --fail --silent --show-error --max-time 2 --output /dev/null "$health_url/ready" || { stop_permanent; reject production-activate-server-unready; }
/usr/bin/systemctl start chalkwright-calendar-sync.service || { stop_permanent; reject production-activate-calendar-failed; }
for timer in "${timers[@]}"; do
  [[ -e "/etc/systemd/system/multi-user.target.wants/$timer" ]] || new_timer_links+=("$timer")
  /usr/bin/systemctl add-wants multi-user.target "$timer" || { stop_permanent; reject production-activate-timer-enable-failed; }
  /usr/bin/systemctl start "$timer" || { stop_permanent; reject production-activate-timer-start-failed; }
done
echo "{\"status\":\"active-internal\",\"displayHealth\":true,\"calendarSync\":\"started\",\"timersStarted\":6,\"routeChanges\":0,\"legacyServicesStopped\":0}"
