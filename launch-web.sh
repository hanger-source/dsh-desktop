#!/usr/bin/env bash
# 开发诊断入口：把本仓库的管理 Bundle 安装到独立 web profile 后启动 DSH。
set -euo pipefail

dsh_home="${DSH_HOME:-$HOME/.dsh}"
repo="$(cd "$(dirname "$0")" && pwd)"
manager="file:$repo/plugins/hang-dsh-plugins"

command -v dsh >/dev/null 2>&1 || {
	echo "找不到 dsh" >&2
	exit 1
}
command -v pnpm >/dev/null 2>&1 || {
	echo "找不到 pnpm；dsh plugin 需要 pnpm" >&2
	exit 1
}
export DSH_HOME="$dsh_home"
export HANG_DSH_PLUGIN_SOURCE_ROOT="$repo"
export DSH_DESKTOP_GITHUB="hanger-source/dsh-desktop"
dsh_executable="$(command -v dsh)"
npm_executable="$(command -v npm || true)"
export DSH_EXECUTABLE="$dsh_executable"
export DSH_NPM_EXECUTABLE="$npm_executable"
dsh plugin --profile web add "$manager" --save-exact
exec dsh --profile web --no-open "$@"
