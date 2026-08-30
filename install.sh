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