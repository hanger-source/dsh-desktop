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
module_link="$dsh_home/profiles/web/node_modules/@hanger/dsh-client-bootstrap"
mkdir -p "$(dirname "$module_link")"
if [ -L "$module_link" ]; then
  [ "$(readlink "$module_link")" = "$client_bootstrap" ] || { echo "dsh-client-bootstrap 模块入口指向了其他路径: $module_link" >&2; exit 1; }
elif [ -e "$module_link" ]; then
  echo "dsh-client-bootstrap 模块入口已被非符号链接占用: $module_link" >&2
  exit 1
else
  ln -s "$client_bootstrap" "$module_link"
fi
mkdir -p "$runtime"
sed "s|__DSH_BOOT_PLUGIN__|$plugin|g" "$template" > "$overlay"
export DSH_HOME="$dsh_home"
export DSH_PLUGIN_REPO="$repo"
exec dsh --profile web --patch "$overlay" --no-open "$@"
