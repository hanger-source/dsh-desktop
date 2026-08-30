---
name: dsh-plugin-install
description: 从 Hang 的插件仓库启用/更新插件。用户说"启用 xxx""装上 xxx""把 xxx 搞下来"时使用。仓库本机副本在 ~/.dsh/hang-plugins（GitHub: hanger-source/dsh-plugins），每个插件一份最新源码。
---

# 启用 Hang 的插件

1. **同步仓库**：`git -C ~/.dsh/hang-plugins pull`
2. **读插件包**：`packages/<name>/` 下的 `README.md`（专属说明）、`code.host.js`、`code.client.js`（各自全文即 `cordis_define` 的 host/client 函数体）。
3. **重建激活**：
   - 本会话没有该插件 → `cordis_define` 用 `kind: "new"`、`idPrefix` 取插件名前 3–6 字母；有则用 `kind: "existing"` 追加。
   - `code.host`/`code.client` 原样传文件全文。
   - `cordis_run`：无 current 用 `run`；有 current 用 `update`。批准请求请在界面允许。
4. **验证**：`cordis_inspect_self` 确认运行状态；带 UI 的插件用 `cordis_inspect_query` 查 Slot occupants。
5. **更新约定**：插件源码改好后覆盖回仓库对应两个文件并 `git add -A && git commit -m "update: <name>" && git push`（仓库只保留一份最新源码）。