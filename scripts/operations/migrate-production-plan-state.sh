#!/usr/bin/env bash
set -euo pipefail
umask 077

reject() { echo "{\"status\":\"rejected\",\"code\":\"$1\"}" >&2; exit 1; }
[[ ${EUID} -eq 0 ]] || reject production-plan-state-migration-root-required
[[ $# -eq 0 ]] || reject production-plan-state-migration-usage-invalid

release=/opt/chalkwright/current
production_env=/etc/chalkwright/production/jobs/maintenance.env
legacy_env=/home/bren/.config/classroom-hub/classroom-hub-shadow-server.env
[[ -L $release && -f "$release/dist/entrypoints/production-plan-state-migration.js" ]] || reject production-plan-state-migration-release-invalid
[[ -f $production_env && ! -L $production_env ]] || reject production-plan-state-migration-config-missing
[[ -f $legacy_env && ! -L $legacy_env ]] || reject production-plan-state-migration-legacy-config-missing

legacy_database=$(
  /usr/bin/node --input-type=module - "$legacy_env" <<'NODE'
import { readFileSync } from 'node:fs';
const value = Object.create(null);
for (const rawLine of readFileSync(process.argv[2], 'utf8').split(/\r?\n/u)) {
  const line = rawLine.trim();
  if (line.length === 0 || line.startsWith('#')) continue;
  const match = /^([A-Z][A-Z0-9_]*)=(.*)$/u.exec(line);
  if (match === null || Object.hasOwn(value, match[1])) process.exit(1);
  try {
    const parsed = JSON.parse(match[2]);
    if (typeof parsed !== 'string' || parsed.includes('\0') || /[\r\n]/u.test(parsed)) process.exit(1);
    value[match[1]] = parsed;
  } catch {
    process.exit(1);
  }
}
const database = value.CLASSROOM_HUB_DATABASE_PATH;
if (typeof database !== 'string' || !database.startsWith('/home/bren/.local/state/classroom-hub/')) process.exit(1);
process.stdout.write(database);
NODE
) || reject production-plan-state-migration-legacy-config-invalid

set -a
# shellcheck disable=SC1090
. "$production_env"
set +a
export CLASSROOM_HUB_LEGACY_PLAN_DATABASE_REFERENCE="$legacy_database"

exec /usr/bin/node "$release/dist/entrypoints/production-plan-state-migration.js"
