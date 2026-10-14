#!/usr/bin/env bash
set -euo pipefail
project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
sdk_templates="${KOMARI_SDK_TEMPLATES:-$project_root/../luci-app-campus-connect/.toolchains}"
cache="$project_root/.build-cache"
mkdir -p "$cache" "$project_root/.build-logs" "$project_root/dist"
log="$project_root/.build-logs/build-$(TZ=Asia/Shanghai date +%Y%m%d-%H%M%S).log"
exec > >(tee "$log") 2>&1
rg -qx 'PKG_VERSION:=2.0.0' "$project_root/Makefile"
rg -qx 'PKG_RELEASE:=1' "$project_root/Makefile"
node --check "$project_root/htdocs/luci-static/resources/view/komari/overview.js"
node --check "$project_root/htdocs/luci-static/resources/komari/server.js"
node --check "$project_root/htdocs/luci-static/resources/komari/agent.js"
node --check "$project_root/htdocs/luci-static/resources/komari/i18n.js"
node "$project_root/tests/i18n-test.cjs"
node "$project_root/tests/frontend-test.cjs"
node "$project_root/tests/log-loading-test.cjs"
python3 "$project_root/tests/backend-test.py"
python3 "$project_root/tests/agent-test.py"
python3 "$project_root/tests/log-test.py"
python3 "$project_root/tests/version-cache-test.py"
python3 "$project_root/tests/firmware-autostart-test.py"
for file in "$project_root"/root/usr/libexec/* "$project_root"/root/etc/init.d/* "$project_root"/root/etc/uci-defaults/*; do
  busybox ash -n "$file"
  [[ -x "$file" ]] || { echo "Runtime script is not executable: $file"; exit 1; }
done
for target in arm64 x86_64; do
  if [[ "$target" == arm64 ]]; then
    template="$sdk_templates/immortalwrt-sdk-25.12.1-mediatek-filogic"
  else
    template="$sdk_templates/immortalwrt-sdk-24.10.4-x86-64_gcc-13.3.0_musl.Linux-x86_64"
  fi
  sdk="$cache/sdk-$target"
  if [[ ! -f "$sdk/rules.mk" ]]; then
    [[ -f "$template/rules.mk" ]] || { echo "SDK template is missing: $template"; exit 1; }
    echo "Preparing dedicated SDK: $target"
    cp -a --reflink=auto "$template" "$sdk"
  fi
  # The existing SDKs keep writable build directories behind relative links.
  # Materialize each one inside this project's copy before invoking make.
  for directory in bin build_dir dl logs tmp; do
    if [[ -L "$sdk/$directory" ]]; then
      original="$(realpath "$template/$directory")"
      unlink "$sdk/$directory"
      cp -a --reflink=auto "$original" "$sdk/$directory"
    fi
  done
  [[ -f "$sdk/feeds/luci/luci.mk" ]] || { echo "LuCI feed is missing: $sdk"; exit 1; }
  mkdir -p "$cache/host-tools/bin"
  [[ -x "$cache/host-tools/bin/jsmin" ]] || cp "$sdk_templates/host-tools/bin/jsmin" "$cache/host-tools/bin/jsmin"
  [[ -x "$cache/host-tools/bin/install" ]] || cp "$sdk_templates/host-tools/bin/install" "$cache/host-tools/bin/install"
  package_dir="$sdk/package/luci-app-komari"
  [[ ! -L "$package_dir" ]] || { echo 'SDK package directory cannot be a symlink'; exit 1; }
  mkdir -p "$package_dir"
  [[ "$(realpath "$package_dir")" == "$(realpath "$sdk")/package/luci-app-komari" ]] || exit 1
  rsync -a --delete --exclude '.git' --exclude '.build-cache' --exclude '.build-logs' \
    --exclude 'dist' --exclude 'build.sh' --exclude 'build-support.py' --exclude '.gitignore' \
    --exclude 'tests' \
    "$project_root/" "$package_dir/"
  (
    cd "$sdk"
    export PATH="$cache/host-tools/bin:$PATH"
    umask 022
    config_backup="$(mktemp "$cache/config-$target.XXXXXX")"
    cp .config "$config_backup"
    trap 'cp "$config_backup" .config; rm -f "$config_backup"' EXIT
    if [[ ! -x staging_dir/hostpkg/bin/po2lmo && ! -x staging_dir/host/bin/po2lmo ]]; then
      po_tools="$cache/po-tools-$target"
      mkdir -p "$po_tools"
      cp -a feeds/luci/modules/luci-base/src/. "$po_tools/"
      make -C "$po_tools" po2lmo CC=cc
      mkdir -p staging_dir/hostpkg/bin
      cp "$po_tools/po2lmo" staging_dir/hostpkg/bin/po2lmo
    fi
    sed -i '/^CONFIG_PACKAGE_luci-app-komari=/d;/^# CONFIG_PACKAGE_luci-app-komari is not set$/d' .config
    printf '\nCONFIG_PACKAGE_luci-app-komari=m\n' >> .config
    sed -i '/^CONFIG_LUCI_LANG_zh_Hans=/d;/^# CONFIG_LUCI_LANG_zh_Hans is not set$/d;/^CONFIG_PACKAGE_luci-i18n-komari-zh-cn=/d;/^# CONFIG_PACKAGE_luci-i18n-komari-zh-cn is not set$/d' .config
    printf '\nCONFIG_LUCI_LANG_zh_Hans=m\nCONFIG_PACKAGE_luci-i18n-komari-zh-cn=m\n' >> .config
    echo "Building $target"
    make defconfig
    rg -qx 'CONFIG_PACKAGE_luci-app-komari=m' .config
    make package/luci-app-komari/clean V=s
    # Reuse prebuilt SDK host tools; runtime dependencies are declared in the package.
    make -C "$package_dir" compile TOPDIR="$sdk" V=s -j"${KOMARI_BUILD_JOBS:-2}"
    python3 "$project_root/build-support.py" "$project_root" "$sdk" "$target"
    python3 "$project_root/build-support.py" "$project_root" "$sdk" "$target" translation
  )
done
echo "Both package formats built and validated. Log: $log"
