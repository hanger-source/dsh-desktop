#!/usr/bin/env bash
# 安装 DSH.app 原生壳 + 技能。App overlay 的 Host bootstrap 定义仓库插件，
# 静态 Client bootstrap 在启动、服务重启与页面重载后自动挂载它们。
set -euo pipefail

DST_HOME="${DSH_HOME:-$HOME/.dsh}"
REPO="${DST_HOME}/hang-plugins"

# 不再安装 agent-preset（预设是 id 选择制，不会自动挂载）。
echo "自动启用：Host 定义 + 静态 Client bootstrap 自动挂载（无需动态审批）"
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
    echo "==> 构建并安装 DSH.app（输出 ~/Applications/DSH.app）"
    bash "$SHELL_ASSETS/dsh-app-build.sh" "$HOME/Applications/DSH.app" "$SHELL_ASSETS"
    echo "壳已安装：$HOME/Applications/DSH.app（双击打开；也可在 dsh 设置 → App 里管理）"
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
