#!/usr/bin/env bash
# 手动启动 dsh web（同 App 启动参数：--patch web-boot.yml）。
# web-boot.yml 提供：openBrowser:false（不弹浏览器）+ insert 注入 dsh-boot（自动启用 UI 插件）。
set -euo pipefail
home="${DSH_HOME:-$HOME/.dsh}"
source_root="${DSH_SOURCE_ROOT:-$HOME/projects/deepseek-harness}"
repo="$home/hang-plugins"
runtime="$repo/.runtime/dsh-app-hub"
template="$repo/overlays/web/web-boot.yml"
overlay="$runtime/web-boot.generated.yml"
plugin="$repo/overlays/web/plugins/dsh-boot.js"
mkdir -p "$runtime"
sed "s|__DSH_BOOT_PLUGIN__|$plugin|g" "$template" > "$overlay"
export DSH_PLUGIN_REPO="$repo"
exec node "$source_root/apps/cli/lib/bin.js" --profile web --patch "$overlay" "$@"
