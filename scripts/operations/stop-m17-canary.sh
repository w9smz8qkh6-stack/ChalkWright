#!/usr/bin/env bash
set -euo pipefail

[[ ${EUID} -eq 0 ]] || { echo '{"status":"rejected","code":"m17-stop-root-required"}' >&2; exit 1; }
[[ $# -eq 0 ]] || { echo '{"status":"rejected","code":"m17-stop-usage-invalid"}' >&2; exit 1; }
/usr/bin/systemctl stop chalkwright-canary-classroom-refresh.timer chalkwright-canary-calendar-sync.timer chalkwright-canary-backup.timer chalkwright-canary-integrity.timer chalkwright-canary-plan-refresh.timer
/usr/bin/systemctl stop chalkwright-canary-calendar-sync.service chalkwright-canary-calendar-preflight.service chalkwright-canary-comparison.service chalkwright-canary-comparison-observation.service chalkwright-canary-classroom-preflight.service chalkwright-canary-classroom-refresh.service chalkwright-canary-powerschool-repair.service chalkwright-canary-plan-preflight.service chalkwright-canary-plan-refresh.service chalkwright-canary-backup.service chalkwright-canary-integrity.service chalkwright-canary.service
echo '{"status":"candidate-stopped","activeCandidateUnits":0,"legacyUnitsChanged":0,"legacyRoutesChanged":0,"calendarCleanupPerformed":0,"stateDeleted":0}'
