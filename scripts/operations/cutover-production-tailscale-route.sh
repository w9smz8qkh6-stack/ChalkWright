#!/usr/bin/env bash
set -euo pipefail
umask 077

reject() { echo "{\"status\":\"rejected\",\"code\":\"$1\"}" >&2; exit 1; }
[[ ${EUID} -eq 0 ]] || reject production-route-root-required
[[ $# -eq 0 ]] || reject production-route-usage-invalid
release=/opt/chalkwright/current
config=/etc/chalkwright/production/server.json
routes=/var/lib/chalkwright/deploy/routes
[[ -L $release && -f "$release/dist/entrypoints/production-server.js" ]] || reject production-route-release-invalid
[[ -f $config && ! -L $config ]] || reject production-route-config-missing
/usr/bin/systemctl is-active --quiet chalkwright.service || reject production-route-service-inactive

target=$(/usr/bin/node --input-type=module - "$config" <<'NODE'
import { readFileSync } from 'node:fs';
const value = JSON.parse(readFileSync(process.argv[2], 'utf8'));
if (value.host !== '127.0.0.1' || !Number.isInteger(value.port) || value.port < 1 || value.port > 65535) process.exit(1);
process.stdout.write(`http://127.0.0.1:${value.port}`);
NODE
) || reject production-route-config-invalid
status=$(/usr/bin/mktemp /var/lib/chalkwright/deploy/.tailscale-status.XXXXXXXX)
cleanup() { /usr/bin/rm -f -- "$status"; }
trap cleanup EXIT INT TERM
/usr/bin/tailscale serve status --json > "$status" || reject production-route-status-failed
route=$(/usr/bin/node --input-type=module - "$status" <<'NODE'
import { readFileSync } from 'node:fs';
const status = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const routes = [];
for (const [hostPort, value] of Object.entries(status.Web ?? {})) {
  const handler = value?.Handlers?.['/'];
  if (handler?.Proxy === 'http://127.0.0.1:4318') {
    const match = /:([0-9]{1,5})$/u.exec(hostPort);
    if (match !== null) routes.push([match[1], handler.Proxy]);
  }
}
if (routes.length !== 1) process.exit(1);
process.stdout.write(routes[0].join('\t'));
NODE
) || reject production-route-legacy-route-ambiguous
IFS=$'\t' read -r serve_port previous_target <<< "$route"
[[ $serve_port =~ ^[0-9]{1,5}$ && $serve_port -ge 1 && $serve_port -le 65535 ]] || reject production-route-legacy-route-invalid
[[ $previous_target == http://127.0.0.1:4318 ]] || reject production-route-legacy-target-invalid
/usr/bin/install -d -o root -g root -m 0700 "$routes"
snapshot="$routes/before-production-$serve_port.json"
[[ ! -e $snapshot && ! -L $snapshot ]] || reject production-route-snapshot-exists
/usr/bin/install -o root -g root -m 0600 "$status" "$snapshot" || reject production-route-snapshot-failed
restored=0
restore() {
  [[ $restored -eq 0 ]] || return 0
  /usr/bin/tailscale serve --bg --https="$serve_port" "$previous_target" || true
  restored=1
}
if ! /usr/bin/tailscale serve --bg --https="$serve_port" "$target"; then
  restore
  reject production-route-update-failed
fi
if ! /usr/bin/tailscale serve status --json > "$status" || ! /usr/bin/node --input-type=module - "$status" "$serve_port" "$target" <<'NODE'
import { readFileSync } from 'node:fs';
const [statusPath, port, target] = process.argv.slice(2);
const status = JSON.parse(readFileSync(statusPath, 'utf8'));
const match = Object.entries(status.Web ?? {}).filter(([hostPort, value]) =>
  hostPort.endsWith(`:${port}`) && value?.Handlers?.['/']?.Proxy === target,
);
process.exit(match.length === 1 ? 0 : 1);
NODE
then
  restore
  reject production-route-verification-failed
fi
restored=1
echo "{\"status\":\"cutover\",\"servePort\":$serve_port,\"routeSnapshot\":\"retained\",\"legacyServiceStopped\":false}"
