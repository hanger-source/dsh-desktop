# Node REPL

正式 DSH Host Bundle。安装后直接由 web profile 装入 Cordis，并注册：

- `mcp__node_repl__js`
- `mcp__node_repl__js_add_node_module_dir`
- `mcp__node_repl__js_reset`

插件将工具注册到每个会话自己的 `agent.ctx.tools`。某个会话第一次调用 REPL 工具时，才以该会话的工作目录启动一份独立 MCP server；同一会话持续复用自己的 JavaScript 内核，不同会话之间不会共享变量、模块路径或 `js_reset`。

MCP 返回图片时，插件通过 Cordis 的 `attachments` capability 将原始 base64 图片持久化，工具结果和后续模型请求只携带 DSH 附件引用。

当前 binary 仅支持 macOS arm64。来源版本、签名身份和 SHA-256 见 `vendor/darwin-arm64/manifest.json`。

安装：`dsh plugin --profile web add 'github:hanger-source/dsh-desktop#<tag>&path:/plugins/node-repl'`。
