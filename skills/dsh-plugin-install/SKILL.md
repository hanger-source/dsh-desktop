---
name: dsh-plugin-install
description: 冷启动/批量启用 Hang 的插件。新环境（无任何插件）或用户说"启用我的插件/把所有插件装上"时使用：从 ~/.dsh/hang-plugins 仓库读取 packages/*，逐个 define + run 激活。
---

# 启用 Hang 的插件（冷启动 / 批量）

仓库本机副本：`~/.dsh/hang-plugins`（GitHub: hanger-source/dsh-plugins）。
每个插件 = `packages/<key>/` 下的 `code.host.js` + `code.client.js`（全文即 `cordis_define` 的 host/client 函数体）+ `meta.json`（name / purpose / idPrefix / matchPrefix / self）。

## 工作流

1. **确保仓库就绪**：`~/.dsh/hang-plugins/.git` 存在则 `git -C ~/.dsh/hang-plugins pull`；不存在则 `git clone https://github.com/hanger-source/dsh-plugins.git ~/.dsh/hang-plugins`（如已跑过仓库根 `bootstrap.sh` 则跳过）。
2. **逐个启用 packages/**：
   - 读 `packages/<key>/meta.json`，跳过 `self: true`（管理器自身由本流程创建的实例承担，不需再建）。
   - 用 `cordis_inspect_self` 查本会话是否已有同前缀实例（pluginId 以 `matchPrefix` 中任一开头）：
     - 已有且运行中 → 跳过（已启用）
     - 已有且停止 → `cordis_run` 重启该实例的 currentPackageId
     - 无 → `cordis_define`（kind new，idPrefix 用 meta.idPrefix，code.host/code.client 用文件全文）→ `cordis_run`（run）→ 若出现批准请求请用户允许
3. **验证**：`cordis_inspect_self` 逐一确认 running；带 UI 的查 Slot occupants。
4. **收尾**：全启用后可提醒用户——管理器自己会出现在设置页「Hang 的插件」；之后日常启停、同步都在那里或 curl `/api/dsh-plugins/enable?key=<key>`。

## 约定
- 只维护最新一版源码于仓库；改代码后覆盖 `packages/<key>/` 两文件并 `git add -A && git commit -m "update: <key>" && git push`。