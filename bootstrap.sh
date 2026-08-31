#!/usr/bin/env bash
# 冷启动引导：全新 dsh 环境一条命令全自动就位。
# 1) clone 仓库到 $DSH_HOME/hang-plugins（已有则 pull）
# 2) 把 skills/ 同步到 $DSH_HOME/skills（Agent 获得 dsh-plugin-install 技能）
set -euo pipefail

REPO="${DSH_HOME:-$HOME/.dsh}/hang-plugins"
REMOTE="https://github.com/hanger-source/dsh-plugins.git"
SKILL_DST="${DSH_HOME:-$HOME/.dsh}/skills"

if [ -d "$REPO/.git" ]; then
  git -C "$REPO" pull --quiet
  echo "[1/3] 仓库已更新: $REPO"
else
  git clone --quiet "$REMOTE" "$REPO"
  echo "[1/3] 已 clone: $REPO"
fi

if [ -d "$REPO/skills" ]; then
  mkdir -p "$SKILL_DST"
  for dir in "$REPO"/skills/*/; do
    [ -d "$dir" ] || continue
    name="$(basename "$dir")"
    rm -rf "$SKILL_DST/$name"
    mkdir -p "$SKILL_DST/$name"
    cp -R "$dir"/* "$SKILL_DST/$name"/
  done
  echo "[2/3] 安装技能已同步到 $SKILL_DST"
fi

echo
echo "[3/3] 安装 DSH.app 原生壳 + 技能（App overlay 自动定义并挂载插件）..."
DSH_BOOT_NO_SHELL="${DSH_BOOT_NO_SHELL:-0}" bash "$REPO/install.sh"

echo
echo "完成，全部就绪："
echo "  · 仓库：$REPO"
echo "  · 技能：$SKILL_DST"
echo "  · 自动启用：Host dsh-boot 定义 + 静态 Client bootstrap 挂载（无需动态审批）"
echo
echo "打开 DSH.app：bootstrap 自动同步仓库/技能；Host 定义插件，静态 Client bootstrap"
echo "在启动、服务重启、页面重载与新会话切换后自动挂载 UI 插件。"
