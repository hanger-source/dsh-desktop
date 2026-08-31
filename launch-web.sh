#!/usr/bin/env bash
# 手动启动 dsh web（同 App 启动参数：--patch web-boot.yml）。
# web-boot.yml 提供：openBrowser:false（不弹浏览器）+ insert 注入 dsh-boot（自动启用 UI 插件）。
set -euo pipefail
home="${DSH_HOME:-$HOME/.dsh}"
exec /opt/homebrew/bin/dsh --profile web --patch "$home/hang-plugins/overlays/web/web-boot.yml" "$@"
