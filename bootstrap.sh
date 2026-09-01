#!/usr/bin/env bash
# 从当前 checkout 安装 GitHub Release App；用户机器不保留插件源码仓库。
set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
exec bash "$script_dir/install.sh"
