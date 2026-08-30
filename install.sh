#!/usr/bin/env bash
# 安装 DSH.app 原生壳 + 技能。插件自动启用由 dsh-boot 承担（App overlay 注入，
# 会话创建时自动 define+run 仓库 packages/ 下的 UI 插件）。
set -euo pipefail

DST_HOME="${DSH_HOME:-$HOME/.dsh}"
REPO="${DST_HOME}/hang-plugins"

# 自动启用已改由 dsh-boot 承担：它经 App 启动 overlay（overlays/web/web-boot.yml 的 insert 注入）
# 加载进 web profile，在新会话（agent/created）时自动 define+run 启用仓库 packages/ 下的 UI 插件，
# 并提供 /api/dsh-plugins/enable 端点。不再安装 agent-preset（预设是 id 选择制，不会自动挂载）。
echo "自动启用：由 dsh-boot（App overlay 注入）在会话创建时自动拉起 UI 插件"
# ---- 安装原生壳 DSH.app（DSH_BOOT_NO_SHELL=1 时跳过，供 app 自动引导复用） ----
if [ "${DSH_BOOT_NO_SHELL:-0}" != "1" ]; then
# 从 packages/dsh-app-hub/assets/DSHApp/ 用 swiftc 构建并装到 ~/Applications/DSH.app
SHELL_ASSETS="$REPO/packages/dsh-app-hub/assets/DSHApp"
if [ -f "$SHELL_ASSETS/dsh-app-build.sh" ]; then
  if ! command -v swiftc >/dev/null 2>&1; then
    echo "跳过壳：未找到 swiftc（需要 Xcode Command Line Tools）"
  else
    # 运行日志/图标目录
    mkdir -p "$DST_HOME/hang-plugins/.runtime/dsh-app-hub"
    [ -f "$SHELL_ASSETS/icon-512.png" ] && cp "$SHELL_ASSETS/icon-512.png" "$DST_HOME/hang-plugins/.runtime/dsh-app-hub/icon-512.png"
    echo "==> 构建并安装 DSH.app（输出 ~/Applications）"
    bash "$SHELL_ASSETS/dsh-app-build.sh" "$HOME/Applications" "$SHELL_ASSETS" \
      && echo "壳已安装：$HOME/Applications/DSH.app（双击打开；也可在 dsh 设置 → App 里管理）" \
      || echo "壳构建失败：$?（详见上方输出）"
  fi
else
  echo "跳过壳：未找到 $SHELL_ASSETS/dsh-app-build.sh"
fi
echo "install.sh 完成。"

fi

# ---- 安装技能（仓库 skills/ → 用户技能目录 ~/.dsh/skills/） ----
# DSH 技能发现根 = 工作区 .dsh/skills（本机即 $DSH_HOME/skills），拷贝即被会话收录。
SKILL_ROOT="$DST_HOME/skills"
if [ -d "$REPO/skills" ]; then
  for sdir in "$REPO"/skills/*/; do
    [ -d "$sdir" ] || continue
    [ -f "$sdir/SKILL.md" ] || continue
    key="$(basename "$sdir")"
    mkdir -p "$SKILL_ROOT/$key"
    cp "$sdir/SKILL.md" "$SKILL_ROOT/$key/SKILL.md"
    echo "skill: $key -> $SKILL_ROOT/$key/SKILL.md"
  done
fi
