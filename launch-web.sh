#!/usr/bin/env bash
# 手动启动 dsh web（同 App 启动参数：--patch web-boot.yml）。
# web-boot.yml 提供：openBrowser:false + Host 定义与静态 Client 自动挂载。
set -euo pipefail
dsh_home="${DSH_HOME:-$HOME/.dsh}"
repo="$dsh_home/hang-plugins"
template="$repo/overlays/web/web-boot.yml"
plugin="$repo/overlays/web/plugins/dsh-boot.js"
client_bootstrap="$repo/overlays/web/plugins/dsh-client-bootstrap"
runtime="$repo/.runtime/dsh-app-hub"
overlay="$runtime/web-boot.generated.yml"

command -v dsh >/dev/null 2>&1 || { echo "找不到正式安装的 dsh" >&2; exit 1; }
[ -f "$template" ] || { echo "缺少 overlay 模板: $template" >&2; exit 1; }
[ -f "$plugin" ] || { echo "缺少 dsh-boot: $plugin" >&2; exit 1; }
[ -f "$client_bootstrap/package.json" ] || { echo "缺少 dsh-client-bootstrap: $client_bootstrap" >&2; exit 1; }
mkdir -p "$runtime"
sed -e "s|__DSH_BOOT_PLUGIN__|$plugin|g" \
  -e "s|__DSH_CLIENT_BOOTSTRAP__|$client_bootstrap|g" \
  "$template" > "$overlay"
export DSH_HOME="$dsh_home"
export DSH_PLUGIN_REPO="$repo"
exec dsh --profile web --patch "$overlay" --no-open "$@"
