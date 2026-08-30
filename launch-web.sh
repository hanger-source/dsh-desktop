#!/usr/bin/env bash
# 启动 dsh web（launcher --patch 注入 dsh-boot 宿主钩子），带 --no-open。
set -euo pipefail
home="${DSH_HOME:-$HOME/.dsh}"
exec /opt/homebrew/bin/dsh --profile web --patch "$home/hang-plugins/overlays/web/web-boot.yml" --no-open "$@"
