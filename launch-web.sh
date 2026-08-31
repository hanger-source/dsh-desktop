#!/usr/bin/env bash
# 开发诊断入口：使用已安装 DSH.app 自带的 runtime 启动同一条 web 链。
set -euo pipefail

dsh_home="${DSH_HOME:-$HOME/.dsh}"
app="${DSH_APP_PATH:-$HOME/Applications/DSH.app}"
runtime="$app/Contents/Resources/runtime"
state="$dsh_home/runtime/dsh-desktop"
overlay="$state/web-boot.generated.yml"
module="$dsh_home/profiles/web/node_modules/@hanger/dsh-desktop-runtime"

command -v dsh >/dev/null 2>&1 || { echo "找不到 dsh" >&2; exit 1; }
[ -f "$runtime/host/index.js" ] || { echo "App 缺少 Host runtime：$runtime" >&2; exit 1; }
[ -f "$runtime/client/package.json" ] || { echo "App 缺少 Client runtime：$runtime" >&2; exit 1; }

mkdir -p "$state" "$(dirname "$module")"
if [ -L "$module" ]; then
  [ "$(readlink "$module")" = "$runtime/client" ] || { echo "Client runtime 链接指向其他路径：$module" >&2; exit 1; }
elif [ -e "$module" ]; then
  echo "Client runtime 入口被非符号链接占用：$module" >&2
  exit 1
else
  ln -s "$runtime/client" "$module"
fi

sed "s|__DSH_DESKTOP_HOST__|$runtime/host/index.js|g" "$runtime/web-boot.yml" > "$overlay"
export DSH_HOME="$dsh_home"
export DSH_DESKTOP_REPO="$dsh_home/dsh-desktop"
export DSH_DESKTOP_RUNTIME="$state"
export DSH_DESKTOP_REMOTE="https://github.com/hanger-source/dsh-plugins.git"
export DSH_DESKTOP_GITHUB="hanger-source/dsh-plugins"
export DSH_APP_BUNDLE_PATH="$app"
app_version="$(defaults read "$app/Contents/Info" CFBundleShortVersionString)"
dsh_executable="$(command -v dsh)"
npm_executable="$(command -v npm || true)"
export DSH_APP_VERSION="$app_version"
export DSH_EXECUTABLE="$dsh_executable"
export DSH_NPM_EXECUTABLE="$npm_executable"
exec dsh --profile web --patch "$overlay" --no-open "$@"
