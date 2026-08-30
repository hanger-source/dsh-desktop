# hang-plugins

Hang 的插件管理器：设置页「Hang 的插件」。App 启动时由 dsh-boot 自动启用。

## 功能

- **同步仓库**：把 `~/.dsh/hang-plugins` 拉到 GitHub 最新（无副本则 clone），并把仓库里的 `skills/` 装到 `~/.dsh/skills/`。
- **列出插件**：显示仓库 `packages/` 里所有插件（名称 + 说明）。
- **启用**：点某插件的「启用」按钮后，在对话里对该会话 Agent 说“启用 <name>”，Agent 会从仓库包重建并激活（这一步必须由 Agent 用 cordis_define/cordis_run 执行，是系统安全设计，网页按钮不能直接运行代码）。平时不需要手动启用——dsh-boot 已在会话创建时把全部 UI 插件自动拉起。

## 重放步骤（新机器）

1. 读本目录 `code.host.js` / `code.client.js` 全文，分别作为 `cordis_define` 的 `code.host` / `code.client`。
2. `cordis_define`：kind `new`，idPrefix `pstore`，name `hang-plugins 管理器`。
3. `cordis_run` 激活；批准后设置页出现「Hang 的插件」。