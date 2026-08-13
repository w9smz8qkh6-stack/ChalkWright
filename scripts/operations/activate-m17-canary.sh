#!/usr/bin/env bash
set -euo pipefail

reject() { echo "{\"status\":\"rejected\",\"code\":\"$1\"}" >&2; exit 1; }
[[ ${EUID} -eq 0 ]] || reject m17-activate-root-required
[[ $# -eq 1 && $1 =~ ^[a-f0-9]{64}$ ]] || reject m17-activate-usage-invalid
digest=$1
manifest=/etc/chalkwright/canary/activation-manifest.json
[[ -L /opt/chalkwright-canary/current ]] || reject m17-activate-release-invalid
[[ $(/usr/bin/readlink /opt/chalkwright-canary/current) == "releases/$digest" ]] || reject m17-activate-release-invalid
[[ -f $manifest && ! -L $manifest ]] || reject m17-activate-manifest-missing
/usr/sbin/runuser -u classroom-hub -- /usr/bin/node /opt/chalkwright-canary/current/dist/entrypoints/m17-canary-activation-manifest.js --verify "$manifest" "$digest" >/dev/null || reject m17-activate-manifest-invalid
for path in /etc/chalkwright/canary/server.json /etc/chalkwright/canary/calendar.json /etc/chalkwright/canary/jobs/plan-refresh.env /etc/chalkwright/canary/jobs/classroom-refresh.env /etc/chalkwright/canary/jobs/maintenance.env /var/lib/chalkwright/canary-powerschool-session/.classroom-hub-auth-state.json; do
  [[ -f $path && ! -L $path ]] || reject m17-activate-prerequisite-missing
done
stop_candidate() {
  /usr/bin/systemctl stop chalkwright-canary-classroom-refresh.timer chalkwright-canary-calendar-sync.timer chalkwright-canary-backup.timer chalkwright-canary-integrity.timer chalkwright-canary-plan-refresh.timer chalkwright-canary-calendar-sync.service chalkwright-canary-calendar-preflight.service chalkwright-canary-comparison.service chalkwright-canary-comparison-observation.service chalkwright-canary-classroom-preflight.service chalkwright-canary-classroom-refresh.service chalkwright-canary-plan-preflight.service chalkwright-canary-plan-refresh.service chalkwright-canary-backup.service chalkwright-canary-integrity.service chalkwright-canary.service || true
}
/usr/bin/systemctl start chalkwright-canary-plan-refresh.service || reject m17-activate-plan-failed
if ! /usr/bin/systemctl start chalkwright-canary-classroom-refresh.service; then stop_candidate; reject m17-activate-classroom-failed; fi
/usr/bin/systemctl start chalkwright-canary-integrity.service || { stop_candidate; reject m17-activate-integrity-failed; }
/usr/bin/systemctl start chalkwright-canary-backup.service || { stop_candidate; reject m17-activate-backup-failed; }
/usr/bin/systemctl start chalkwright-canary.service || { stop_candidate; reject m17-activate-server-failed; }
ready=0
for _ in {1..20}; do
  if /usr/bin/curl --fail --silent --show-error --max-time 2 --output /dev/null http://127.0.0.1:4319/classroom-screen/health && /usr/bin/curl --fail --silent --show-error --max-time 2 --output /dev/null http://127.0.0.1:4319/classroom-screen/ready; then ready=1; break; fi
  /usr/bin/sleep 0.25
done
if [[ $ready -ne 1 ]]; then stop_candidate; reject m17-activate-server-unready; fi
if ! /usr/bin/systemctl start chalkwright-canary-calendar-sync.service; then stop_candidate; reject m17-activate-calendar-failed; fi
if ! /usr/bin/systemctl start chalkwright-canary-plan-refresh.timer chalkwright-canary-classroom-refresh.timer chalkwright-canary-calendar-sync.timer chalkwright-canary-integrity.timer chalkwright-canary-backup.timer; then
  stop_candidate
  reject m17-activate-timer-failed
fi
echo "{\"status\":\"canary-active\",\"release\":\"sha256:$digest\",\"classroomUnitSucceeded\":true,\"integrityPassed\":true,\"backupVerified\":true,\"legacyUnitsChanged\":0,\"legacyRoutesChanged\":0,\"alertMode\":\"report-only\"}"
