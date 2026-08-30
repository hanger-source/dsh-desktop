---
name: dsh-plugin-install
description: 冷启动/批量启用 Hang 的插件，并从仓库自动安装技能。新环境（无任何插件）或用户说"启用我的插件/把所有插件装上/装技能"时使用：从 ~/.dsh/hang-plugins 仓库读取 packages/*（逐个 define + run 激活）、skills/*（拷贝到用户技能目录）。
---

# Hang 的插件与技能（冷启动 / 批量安装）

仓库本机副本：`~/.dsh/hang-plugins`（GitHub: hanger-source/dsh-plugins）。
结构：
- `packages/<key>/`：插件最新源码——`code.host.js` + `code.client.js`（全文即 `cordis_define` 的 host/client 函数体）+ `meta.json`（name / purpose / idPrefix / matchPrefix / self）。
- `skills/<key>/SKILL.md`：仓库维护的技能文档；skill 发现目录 = 工作区 `.dsh/skills`（本项目即 `~/.dsh/skills`），拷贝过去即被会话收录。

## 一、安装技能（仓库 skills/ → 用户技能目录）

1. `git -C ~/.dsh/hang-plugins pull`（或 clone，见下"确保仓库就绪"）。
2. 对 `~/.dsh/hang-plugins/skills/*/SKILL.md`：`mkdir -p ~/.dsh/skills/<key> && cp SKILL.md ~/.dsh/skills/<key>/SKILL.md`（可整目录含附属文件）。
3. 验证：技能名出现在可用技能目录（SKILL_NAME.md 同理）；已装技能不再重复拷贝（幂等）。
   > 仓库根 `install.sh` 也会自动执行本步骤（含壳安装等其它能力，见该脚本）。

## 二、启用插件（packages/ → define + run）

1. **确保仓库就绪**：`~/.dsh/hang-plugins/.git` 存在则 `git -C ~/.dsh/hang-plugins pull`；不存在则 `git clone https://github.com/hanger-source/dsh-plugins.git ~/.dsh/hang-plugins`（如已跑过仓库根 `install.sh` 则跳过）。
2. **逐个启用 packages/**：
   - 读 `packages/<key>/meta.json`，跳过 `self: true`（管理器自身由本流程创建的实例承担，不需再建）。
   - 用 `cordis_inspect_self` 查本会话是否已有同前缀实例（pluginId 以 `matchPrefix` 中任一开头）：
     - 已有且运行中 → 跳过（已启用）
     - 已有且停止 → `cordis_run` 重启该实例的 currentPackageId
     - 无 → `cordis_define`（kind new，idPrefix 用 meta.idPrefix，code.host/code.client 用文件全文）→ `cordis_run`（run）→ 若出现批准请求请用户允许
3. **验证**：`cordis_inspect_self` 逐一确认 running；带 UI 的查 Slot occupants。
4. **收尾**：全启用后可提醒用户——管理器自己会出现在设置页「Hang 的插件」；之后日常启停、同步都在那里或 curl `/api/dsh-plugins/enable?key=<key>`。

## 三、给插件写 UI：必读「dsh 原生风格控件」

写任何插件 UI（设置页 / 浮条 / 按钮）**先读并遵守**：本仓库 `skills/dsh-plugin-install/SKILL.md` 内嵌的 UI 规范，或独立的 UI 规范文档（若存在 `dsh-ui-native-style` 已并入本节，以本节为准）。核心铁律：

1. 颜色一律用 dsh 主题变量（`--dsw-alias-*` / `--dsw-specific-*`）；**禁止自造色值 / color-mix 灰色块**；浅深主题自适应。
2. 样式带私有前缀（如 `.dsh-`），不写全局选择器，不碰 dsh 布局。
3. 按钮 = 原生胶囊淡底：`transparent` 底 + `var(--dsw-alias-border-l2)` 细边框 + `var(--dsw-alias-label-primary)` 文字 + hover `var(--dsw-alias-interactive-bg-hover)` + 圆角 999px + `display:inline-flex; align-items/justify-content:center`（垂直居中）。
4. React children **用数组传元素**，禁止 `"字符串" + <ReactElement>`（会渲染 `[object Object]`）。
5. 参考实现：`packages/dsh-app-hub/code.client.js` 的 `styles.insert` 段与 AppSection（变量清单、卡片/浮条/徽章全量示例）。

## 约定
- 只维护最新一版源码于仓库；改代码后覆盖 `packages/<key>/` 两文件并 `git add -A && git commit -m "update: <key>" && git push`。
- 技能文档改动同样入库提交；skill 生效目录更新由仓库根 `install.sh` 或本技能「一、安装技能」完成。
