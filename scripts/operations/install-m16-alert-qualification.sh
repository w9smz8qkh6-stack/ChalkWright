#!/usr/bin/env bash
set -euo pipefail

source_archive=/tmp/classroom-hub-m16-alert-qualification-runtime.tar.gz
source_sha256=a45b90c3414088871262a2f2954d2a89344d8b8c663e2fa7482448dccc763396
previous_release=002264cb6de9d04f18a0da4737b71510981b3027d1cb9f18429a8bfab4d0c823
release_root=/opt/classroom-hub/releases
release_dir="$release_root/$source_sha256"
installed_archive="$release_root/classroom-hub-m16-$source_sha256.tar.gz"
current_link=/opt/classroom-hub/current
next_link=/opt/classroom-hub/.current-m16-alert-next

if [[ ${EUID} -ne 0 ]]; then
  echo '{"status":"rejected","code":"m16-alert-install-root-required"}' >&2
  exit 1
fi
if [[ ! -f $source_archive || -L $source_archive ]]; then
  echo '{"status":"rejected","code":"m16-alert-install-archive-unsafe"}' >&2
  exit 1
fi
actual_sha256=$(/usr/bin/sha256sum "$source_archive" | /usr/bin/cut -d ' ' -f 1)
if [[ $actual_sha256 != "$source_sha256" ]]; then
  echo '{"status":"rejected","code":"m16-alert-install-archive-mismatch"}' >&2
  exit 1
fi
if [[ ! -L $current_link ]] ||
  [[ $(/usr/bin/readlink "$current_link") != "releases/$previous_release" ]] ||
  [[ -e $release_dir || -L $release_dir ]] ||
  [[ -e $installed_archive || -L $installed_archive ]] ||
  [[ -e $next_link || -L $next_link ]]; then
  echo '{"status":"rejected","code":"m16-alert-install-target-drift"}' >&2
  exit 1
fi

/usr/bin/install -o root -g root -m 0600 "$source_archive" "$installed_archive"
/usr/bin/install -d -o root -g root -m 0755 "$release_dir"
/usr/bin/tar -xzf "$source_archive" -C "$release_dir"
/usr/bin/chown -R root:root "$release_dir"
/usr/bin/find "$release_dir" -type d -exec /usr/bin/chmod 0755 {} +
/usr/bin/find "$release_dir" -type f -exec /usr/bin/chmod 0644 {} +
/usr/bin/ln -s "releases/$source_sha256" "$next_link"
/usr/bin/mv -T "$next_link" "$current_link"

echo '{"status":"installed-inert","currentRelease":"sha256:a45b90c3414088871262a2f2954d2a89344d8b8c663e2fa7482448dccc763396","servicesStarted":0,"routeChanges":0,"providerRequests":0,"messagesSent":0}'
