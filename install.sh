#!/usr/bin/env bash
# 把仓库 packages/ 中「无 UI」的插件（meta.ui=false）装入官方的用户预设目录
# ~/.dsh/.agent-presets/<id>/（DSH 自动发现，新会话自动挂载，重启自动恢复）。
# 幂等：重复运行只会刷新文件与配置行。
set -euo pipefail

DST_HOME="${DSH_HOME:-$HOME/.dsh}"
REPO="${DST_HOME}/hang-plugins"
PRESET_ROOT="${DST_HOME}/.agent-presets"

installed=0
for dir in "$REPO"/packages/*/; do
  [ -d "$dir" ] || continue
  meta="$dir/meta.json"
  [ -f "$meta" ] || continue
  # 只处理 ui=false 的声明式插件
  grep -q '"ui"[[:space:]]*:[[:space:]]*false' "$meta" || continue
  id="$(basename "$dir")"
  [ -f "$dir/plugin.host.js" ] || continue
  target="$PRESET_ROOT/$id"
  mkdir -p "$target/plugins"
  cp "$dir/plugin.host.js" "$target/plugins/$id.js"
  # 写 agent.cordis.yml（幂等覆盖，行 = 相对路径本地插件文件）
  {
    echo "- id: $id"
    echo "  name: ./plugins/$id.js"
  } > "$target/agent.cordis.yml"
  echo "installed: $id -> $target/agent.cordis.yml"
  installed=$((installed + 1))
done
echo "完成：声明式插件 $installed 个。DSH 每次创建新会话都会重扫该目录并自动挂载（重启不再丢）。"
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
