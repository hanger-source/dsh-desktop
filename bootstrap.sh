#!/usr/bin/env bash
# 冷启动引导：全新 dsh 环境一条命令全自动就位。
# 1) clone 仓库到 $DSH_HOME/hang-plugins（已有则 pull）
# 2) 把 skills/ 同步到 $DSH_HOME/skills（Agent 获得 dsh-plugin-install 技能）
# 3) 调用 install.sh：把声明式启动器 host-boot 装入官方预设目录（重启自动加载）
# 之后：打开一个新会话 → host-boot 自动把 packages/ 下所有插件 define+run 拉起。
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
echo "[3/3] 安装声明式启动器 host-boot（写入官方预设目录，随会话自动挂载）..."
DSH_BOOT_NO_SHELL="${DSH_BOOT_NO_SHELL:-0}" bash "$REPO/install.sh"

echo
echo "完成，全部就绪："
echo "  · 仓库：$REPO"
echo "  · 技能：$SKILL_DST"
echo "  · 启动器：$(dirname "$SKILL_DST")/.agent-presets/host-boot"
echo
echo "现在只需【打开一个新会话】——host-boot 会自动把 packages/ 下所有插件"
echo "define + run 全部拉起；宿主每次重启/新会话都会自动恢复，无需再操作。"
echo "（首次启用带 UI 的新插件，浏览器可能要求允许一次；之后全自动。）"
echo "命令行兜底：curl 'http://127.0.0.1:3080/api/dsh-plugins/enable?key=<插件key>'"