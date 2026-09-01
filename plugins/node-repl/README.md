# Node REPL

正式 DSH Host Bundle。安装后直接由 web profile 装入 Cordis，并注册：

- `mcp__node_repl__js`
- `mcp__node_repl__js_add_node_module_dir`
- `mcp__node_repl__js_reset`

插件通过 Cordis 的 `subprocess` capability 启动随 package 分发的 MCP server，并把 MCP 工具定义直接注册到当前 DSH 宿主的 `ctx.tools`，不安装第二份 ToolRuntime。

MCP 返回图片时，插件通过 Cordis 的 `attachments` capability 将原始 base64 图片持久化，工具结果和后续模型请求只携带 DSH 附件引用。

当前 binary 仅支持 macOS arm64。来源版本、签名身份和 SHA-256 见 `vendor/darwin-arm64/manifest.json`。

安装：`dsh plugin --profile web add 'github:hanger-source/dsh-desktop#<tag>&path:/plugins/node-repl'`。
