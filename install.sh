#!/usr/bin/env bash
# 安装已由 CI 构建的 DSH.app；不在用户机器上重新编译 App。
set -euo pipefail

release_url="https://github.com/hanger-source/dsh-plugins/releases/latest/download/DSH.dmg"
applications="$HOME/Applications"
work="$(mktemp -d "${TMPDIR:-/tmp}/dsh-desktop-install.XXXXXX")"
mount="$work/mount"
dmg="$work/DSH.dmg"
mounted=0

cleanup() {
  if [ "$mounted" = "1" ]; then
    hdiutil detach "$mount" -quiet || true
  fi
  rm -rf "$work"
}
trap cleanup EXIT

echo "正在下载 DSH Desktop Release…"
curl --fail --location --show-error "$release_url" --output "$dmg"
mkdir -p "$mount" "$applications"
hdiutil attach "$dmg" -nobrowse -readonly -mountpoint "$mount" -quiet
mounted=1
[ -d "$mount/DSH.app" ] || { echo "Release 中没有 DSH.app" >&2; exit 1; }

ditto "$mount/DSH.app" "$applications/DSH.app"
codesign --verify --deep --strict "$applications/DSH.app"
echo "已安装：$applications/DSH.app"
echo "首次打开若被 Gatekeeper 拦截，请到 系统设置 → 隐私与安全性 → 仍要打开。"
