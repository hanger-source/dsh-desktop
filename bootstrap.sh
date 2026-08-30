#!/usr/bin/env bash
# 冷启动引导：全新环境（无任何插件）时最快就位。
# 1) clone 仓库到 ~/.dsh/hang-plugins（已有则 pull）
# 2) 把 skills/ 同步到 ~/.dsh/skills（Agent 自动获得 dsh-plugin-install 技能）
# 3) 打印最后一步：开会话，对 Agent 说“启用我的插件”
set -euo pipefail

REPO="${DSH_HOME:-$HOME/.dsh}/hang-plugins"
REMOTE="https://github.com/hanger-source/dsh-plugins.git"
SKILL_DST="${DSH_HOME:-$HOME/.dsh}/skills"

if [ -d "$REPO/.git" ]; then
  git -C "$REPO" pull --quiet || echo "提示：pull 失败，继续使用本地副本"
  echo "[1/3] 仓库已存在，已尝试更新: $REPO"
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
echo "[3/3] 完成。最后一步只需一句话："
echo "      打开一个新会话，对该会话的 Agent 说：  启用我的插件"
echo "      Agent 会按 skills/dsh-plugin-install 依次启用仓库 packages/ 下所有插件。"