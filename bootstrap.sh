#!/usr/bin/env bash
# 在一台新 Mac 上安装 DSH Desktop：同步源码仓库和技能，再安装 GitHub Release App。
set -euo pipefail

dsh_home="${DSH_HOME:-$HOME/.dsh}"
repo="$dsh_home/dsh-desktop"
remote="https://github.com/hanger-source/dsh-plugins.git"

if [ -d "$repo/.git" ]; then
  git -C "$repo" pull --ff-only
elif [ -e "$repo" ]; then
  echo "目标路径已存在但不是 Git 仓库：$repo" >&2
  exit 1
else
  git clone "$remote" "$repo"
fi

mkdir -p "$dsh_home/skills"
if [ -d "$repo/skills" ]; then
  for skill in "$repo"/skills/*/; do
    [ -d "$skill" ] || continue
    name="$(basename "$skill")"
    mkdir -p "$dsh_home/skills/$name"
    ditto "$skill" "$dsh_home/skills/$name"
  done
fi

exec bash "$repo/install.sh"
