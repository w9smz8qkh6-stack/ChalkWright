#!/usr/bin/env bash
set -euo pipefail
umask 077

reject() { echo "{\"status\":\"rejected\",\"code\":\"$1\"}" >&2; exit 1; }
[[ ${EUID} -eq 0 ]] || reject chalkwright-sudo-policy-root-required
[[ $# -eq 1 && $1 == --install ]] || reject chalkwright-sudo-policy-usage-invalid

admin=/usr/local/sbin/chalkwright-production-admin
admin_root=/usr/local/lib/chalkwright-production-admin
sudoers=/etc/sudoers.d/chalkwright-production-admin
bootstrap=/home/bren/src/chalkwright-m17-canary/scripts/operations/bootstrap-permanent-production.mjs
provision=/home/bren/src/chalkwright-m17-canary/scripts/operations/provision-production-inert.sh
bootstrap_digest=d6f26009f6bdf02924930da112b6288d032aaffbce2daf749469f71252d3bb10
provision_digest=73a51a833f3469f756b6c4edccfae2272fc0a38cd88209cf87023709847aae76

[[ -x /usr/bin/node && -x /usr/bin/bash && -x /usr/bin/sha256sum && -x /usr/sbin/visudo ]] || reject chalkwright-sudo-policy-tool-missing
for path in "$bootstrap" "$provision"; do
  [[ -f $path && ! -L $path ]] || reject chalkwright-sudo-policy-source-missing
done
[[ ! -e $admin && ! -L $admin && ! -e $admin_root && ! -L $admin_root && ! -e $sudoers && ! -L $sudoers ]] || reject chalkwright-sudo-policy-target-exists
actual_bootstrap=$(/usr/bin/sha256sum "$bootstrap" | /usr/bin/cut -d ' ' -f 1)
actual_provision=$(/usr/bin/sha256sum "$provision" | /usr/bin/cut -d ' ' -f 1)
[[ $actual_bootstrap == "$bootstrap_digest" && $actual_provision == "$provision_digest" ]] || reject chalkwright-sudo-policy-source-drift

created=()
cleanup() { for path in "${created[@]}"; do /usr/bin/rm -rf -- "$path"; done; }
trap cleanup EXIT INT TERM
/usr/bin/install -d -o root -g root -m 0755 "$admin_root"
created+=("$admin_root")
/usr/bin/install -o root -g root -m 0700 "$bootstrap" "$admin_root/bootstrap.mjs"
/usr/bin/install -o root -g root -m 0700 "$provision" "$admin_root/provision.sh"

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
  activate) exec /usr/bin/bash /opt/chalkwright/current/scripts/operations/activate-production.sh ;;
  cutover) exec /usr/bin/bash /opt/chalkwright/current/scripts/operations/cutover-production-tailscale-route.sh ;;
  *) reject chalkwright-admin-action-invalid ;;
esac
WRAPPER
/usr/bin/install -o root -g root -m 0755 "$wrapper_candidate" "$admin"
/usr/bin/rm -f -- "$wrapper_candidate"

sudoers_candidate=$admin_root/sudoers.candidate
/usr/bin/tee "$sudoers_candidate" >/dev/null <<'SUDOERS'
Cmnd_Alias CHALKWRIGHT_PRODUCTION_ADMIN = /usr/local/sbin/chalkwright-production-admin bootstrap, /usr/local/sbin/chalkwright-production-admin provision, /usr/local/sbin/chalkwright-production-admin activate, /usr/local/sbin/chalkwright-production-admin cutover
bren ALL=(root) NOPASSWD: CHALKWRIGHT_PRODUCTION_ADMIN
SUDOERS
/usr/sbin/visudo -cf "$sudoers_candidate" >/dev/null || reject chalkwright-sudo-policy-invalid
/usr/bin/install -o root -g root -m 0440 "$sudoers_candidate" "$sudoers"
/usr/bin/rm -f -- "$sudoers_candidate"
/usr/sbin/visudo -c >/dev/null || reject chalkwright-sudo-policy-global-invalid
created=()
trap - EXIT INT TERM
echo '{"status":"installed","commands":4,"generalRootShell":false,"passwordlessAll":false}'
