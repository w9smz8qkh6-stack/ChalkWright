#!/usr/bin/env bash
set -euo pipefail
umask 077

reject() { echo "{\"status\":\"rejected\",\"code\":\"$1\"}" >&2; exit 1; }
[[ ${EUID} -eq 0 ]] || reject chalkwright-sudo-policy-root-required
[[ $# -eq 1 && ( $1 == --install || $1 == --replace ) ]] || reject chalkwright-sudo-policy-usage-invalid

admin=/usr/local/sbin/chalkwright-production-admin
admin_root=/usr/local/lib/chalkwright-production-admin
sudoers=/etc/sudoers.d/chalkwright-production-admin
bootstrap=/home/bren/src/chalkwright-m17-canary/scripts/operations/bootstrap-permanent-production.mjs
provision=/home/bren/src/chalkwright-m17-canary/scripts/operations/provision-production-inert.sh
deploy=/home/bren/src/chalkwright-m17-canary/scripts/operations/deploy-production-from-main.sh
migration=/home/bren/src/chalkwright-m17-canary/scripts/operations/migrate-production-plan-state.sh
repair=/home/bren/src/chalkwright-m17-canary/scripts/operations/repair-production-powerschool.sh
repair_provision=/home/bren/src/chalkwright-m17-canary/scripts/operations/provision-m17-powerschool-repair.mjs
bootstrap_helper=/home/bren/src/chalkwright-m17-canary/scripts/operations/provision-m16-production.mjs
bootstrap_digest=d6f26009f6bdf02924930da112b6288d032aaffbce2daf749469f71252d3bb10
provision_digest=dd1659d9a5807fa48044afab8fb1fd7c8e55d686cbe9ce311f24e25944bb0527
deploy_digest=7090d2c37b2ea3e00a4e79761c3d870458314963ac2d50fad96eadb1e5374836
migration_digest=22bcf8b71558f013662b7fff5028603dfc0715b96824ee2d2a1c7af62bc63c8b
repair_digest=fc4f15bad5edfd478cc7b29d3c5bd0affb23de99377ad3a6b401d0cbfc736fbb
repair_provision_digest=f27fb2431a36b4e4339583eb1ec341b582d7397ca624765c40ea58e0b5d1ccae
bootstrap_helper_digest=72d7ad3023fa1fb9292499073ae42b02b2c30f2fe06630cff85762d790b6edbb

[[ -x /usr/bin/node && -x /usr/bin/bash && -x /usr/bin/sha256sum && -x /usr/sbin/visudo ]] || reject chalkwright-sudo-policy-tool-missing
for path in "$bootstrap" "$provision" "$deploy" "$migration" "$repair" "$repair_provision" "$bootstrap_helper"; do
  [[ -f $path && ! -L $path ]] || reject chalkwright-sudo-policy-source-missing
done
actual_bootstrap=$(/usr/bin/sha256sum "$bootstrap" | /usr/bin/cut -d ' ' -f 1)
actual_provision=$(/usr/bin/sha256sum "$provision" | /usr/bin/cut -d ' ' -f 1)
actual_deploy=$(/usr/bin/sha256sum "$deploy" | /usr/bin/cut -d ' ' -f 1)
actual_migration=$(/usr/bin/sha256sum "$migration" | /usr/bin/cut -d ' ' -f 1)
actual_repair=$(/usr/bin/sha256sum "$repair" | /usr/bin/cut -d ' ' -f 1)
actual_repair_provision=$(/usr/bin/sha256sum "$repair_provision" | /usr/bin/cut -d ' ' -f 1)
actual_bootstrap_helper=$(/usr/bin/sha256sum "$bootstrap_helper" | /usr/bin/cut -d ' ' -f 1)
[[ $actual_bootstrap == "$bootstrap_digest" && $actual_provision == "$provision_digest" && $actual_deploy == "$deploy_digest" && $actual_migration == "$migration_digest" && $actual_repair == "$repair_digest" && $actual_repair_provision == "$repair_provision_digest" && $actual_bootstrap_helper == "$bootstrap_helper_digest" ]] || reject chalkwright-sudo-policy-source-drift
if [[ $1 == --install ]]; then
  [[ ! -e $admin && ! -L $admin && ! -e $admin_root && ! -L $admin_root && ! -e $sudoers && ! -L $sudoers ]] || reject chalkwright-sudo-policy-target-exists
else
  for path in "$admin" "$admin_root" "$sudoers"; do
    [[ -e $path && ! -L $path ]] || reject chalkwright-sudo-policy-replace-target-invalid
  done
  /usr/bin/rm -rf -- "$admin_root"
  /usr/bin/rm -f -- "$admin" "$sudoers"
fi

created=()
cleanup() { for path in "${created[@]}"; do /usr/bin/rm -rf -- "$path"; done; }
trap cleanup EXIT INT TERM
/usr/bin/install -d -o root -g root -m 0755 "$admin_root"
created+=("$admin_root")
/usr/bin/install -o root -g root -m 0700 "$bootstrap" "$admin_root/bootstrap.mjs"
/usr/bin/install -o root -g root -m 0700 "$bootstrap_helper" "$admin_root/provision-m16-production.mjs"
/usr/bin/install -o root -g root -m 0700 "$provision" "$admin_root/provision.sh"
/usr/bin/install -o root -g root -m 0700 "$deploy" "$admin_root/deploy-production-from-main.sh"
/usr/bin/install -o root -g root -m 0700 "$migration" "$admin_root/migrate-production-plan-state.sh"
/usr/bin/install -o root -g root -m 0700 "$repair" "$admin_root/repair-production-powerschool.sh"
/usr/bin/install -o root -g root -m 0700 "$repair_provision" "$admin_root/provision-m17-powerschool-repair.mjs"

wrapper_candidate=$admin_root/wrapper.candidate
/usr/bin/tee "$wrapper_candidate" >/dev/null <<'WRAPPER'
#!/usr/bin/env bash
set -euo pipefail
umask 077
reject() { echo "{\"status\":\"rejected\",\"code\":\"$1\"}" >&2; exit 1; }
[[ $# -eq 1 ]] || reject chalkwright-admin-usage-invalid
case $1 in
  bootstrap) exec /usr/bin/node /usr/local/lib/chalkwright-production-admin/bootstrap.mjs --apply ;;
  provision) exec /usr/bin/bash /usr/local/lib/chalkwright-production-admin/provision.sh ;;
  deploy) exec /usr/bin/bash /usr/local/lib/chalkwright-production-admin/deploy-production-from-main.sh ;;
  migrate-plans) exec /usr/bin/bash /usr/local/lib/chalkwright-production-admin/migrate-production-plan-state.sh ;;
  repair-powerschool) exec /usr/bin/bash /usr/local/lib/chalkwright-production-admin/repair-production-powerschool.sh ;;
  activate) exec /usr/bin/bash /opt/chalkwright/current/scripts/operations/activate-production.sh ;;
  cutover) exec /usr/bin/bash /opt/chalkwright/current/scripts/operations/cutover-production-tailscale-route.sh ;;
  *) reject chalkwright-admin-action-invalid ;;
esac
WRAPPER
/usr/bin/install -o root -g root -m 0755 "$wrapper_candidate" "$admin"
/usr/bin/rm -f -- "$wrapper_candidate"

sudoers_candidate=$admin_root/sudoers.candidate
/usr/bin/tee "$sudoers_candidate" >/dev/null <<'SUDOERS'
Cmnd_Alias CHALKWRIGHT_PRODUCTION_ADMIN = /usr/local/sbin/chalkwright-production-admin bootstrap, /usr/local/sbin/chalkwright-production-admin provision, /usr/local/sbin/chalkwright-production-admin deploy, /usr/local/sbin/chalkwright-production-admin migrate-plans, /usr/local/sbin/chalkwright-production-admin repair-powerschool, /usr/local/sbin/chalkwright-production-admin activate, /usr/local/sbin/chalkwright-production-admin cutover
bren ALL=(root) NOPASSWD: CHALKWRIGHT_PRODUCTION_ADMIN
SUDOERS
/usr/sbin/visudo -cf "$sudoers_candidate" >/dev/null || reject chalkwright-sudo-policy-invalid
/usr/bin/install -o root -g root -m 0440 "$sudoers_candidate" "$sudoers"
/usr/bin/rm -f -- "$sudoers_candidate"
/usr/sbin/visudo -c >/dev/null || reject chalkwright-sudo-policy-global-invalid
created=()
trap - EXIT INT TERM
echo '{"status":"installed","commands":7,"generalRootShell":false,"passwordlessAll":false}'
