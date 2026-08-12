#!/usr/bin/env bash
set -uo pipefail

release=002264cb6de9d04f18a0da4737b71510981b3027d1cb9f18429a8bfab4d0c823
root=/opt/classroom-hub

reject() {
  echo "{\"status\":\"rejected\",\"code\":\"$1\"}" >&2
  exit 1
}

[[ ${EUID} -eq 0 ]] || reject m16-candidate-smoke-root-required
[[ -L $root/current ]] || reject m16-candidate-smoke-release-invalid
[[ $(/usr/bin/readlink "$root/current") == "releases/$release" ]] ||
  reject m16-candidate-smoke-release-invalid
[[ -f $root/dist/entrypoints/production-plan-refresh.js ]] ||
  reject m16-candidate-smoke-runtime-invalid
[[ -f $root/dist/entrypoints/production-classroom-refresh.js ]] ||
  reject m16-candidate-smoke-runtime-invalid
[[ -f $root/dist/entrypoints/production-server.js ]] ||
  reject m16-candidate-smoke-runtime-invalid

/usr/bin/systemd-run \
  --unit=classroom-hub-m16-plan-smoke-final \
  --description='Temporary M-16 read-only plan smoke' \
  --wait --pipe --collect \
  --uid=classroom-hub --gid=classroom-hub \
  --working-directory="$root" \
  --setenv=NODE_ENV=production \
  --property=Type=exec \
  --property=EnvironmentFile=/etc/classroom-hub/jobs/production-plan-refresh.env \
  --property=UMask=0077 \
  --property=NoNewPrivileges=yes \
  --property=PrivateDevices=yes \
  --property=PrivateTmp=yes \
  --property=ProtectSystem=strict \
  --property=ProtectHome=yes \
  --property='ReadWritePaths=/var/lib/classroom-hub/production /var/lib/classroom-hub/powerschool-session' \
  --property='RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6' \
  --property='RestrictNamespaces=user pid net' \
  --property=MemoryMax=768M \
  --property=TasksMax=192 \
  --property=TimeoutStartSec=180s \
  /usr/bin/node "$root/dist/entrypoints/production-plan-refresh.js" ||
  reject m16-candidate-plan-smoke-failed

classroom_status=0
/usr/bin/systemd-run \
  --unit=classroom-hub-m16-classroom-smoke-final \
  --description='Temporary M-16 read-only Classroom smoke' \
  --wait --pipe --collect \
  --uid=classroom-hub --gid=classroom-hub \
  --working-directory="$root" \
  --setenv=NODE_ENV=production \
  --property=Type=exec \
  --property=EnvironmentFile=/etc/classroom-hub/jobs/production-classroom-refresh.env \
  --property=UMask=0077 \
  --property=NoNewPrivileges=yes \
  --property=PrivateDevices=yes \
  --property=PrivateTmp=yes \
  --property=ProtectSystem=strict \
  --property=ProtectHome=yes \
  --property=ReadWritePaths=/var/lib/classroom-hub/production \
  --property='RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6' \
  --property=RestrictNamespaces=yes \
  --property=MemoryMax=384M \
  --property=TasksMax=64 \
  --property=TimeoutStartSec=60s \
  /usr/bin/node "$root/dist/entrypoints/production-classroom-refresh.js" ||
  classroom_status=$?
if [[ $classroom_status -ne 0 && $classroom_status -ne 2 ]]; then
  reject m16-candidate-classroom-smoke-failed
fi

/usr/bin/systemd-run \
  --unit=classroom-hub-m16-candidate-final \
  --description='Temporary M-16 candidate display' \
  --collect \
  --uid=classroom-hub --gid=classroom-hub \
  --working-directory="$root" \
  --setenv=NODE_ENV=production \
  --setenv=CLASSROOM_HUB_PRODUCTION_CONFIG_REFERENCE=/etc/classroom-hub/server/production-server.json \
  --property=Type=exec \
  --property=UMask=0077 \
  --property=NoNewPrivileges=yes \
  --property=PrivateDevices=yes \
  --property=PrivateTmp=yes \
  --property=ProtectSystem=strict \
  --property=ProtectHome=yes \
  --property=InaccessiblePaths=-/etc/classroom-hub/providers \
  --property=ReadWritePaths=/var/lib/classroom-hub/production \
  --property='RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6' \
  --property=IPAddressDeny=any \
  --property=IPAddressAllow=localhost \
  --property=RestrictNamespaces=yes \
  --property=RuntimeMaxSec=2h \
  --property=TimeoutStopSec=30s \
  /usr/bin/node "$root/dist/entrypoints/production-server.js" ||
  reject m16-candidate-server-start-failed

echo "{\"status\":\"candidate-started\",\"release\":\"sha256:$release\",\"classroomExitCode\":$classroom_status,\"calendarRequests\":0,\"providerWrites\":0,\"routeChanges\":0}"
