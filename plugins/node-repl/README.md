# Node REPL

Hang 动态插件。由 DSH Desktop 同步到 `~/.dsh/dsh-desktop/plugins/node-repl` 后，现有插件加载器直接把 Host half 装入 Cordis，并注册：

- `mcp__node_repl__js`
- `mcp__node_repl__js_add_node_module_dir`
- `mcp__node_repl__js_reset`

插件通过 Cordis 的 `subprocess` capability 启动自带的 MCP server，通过 `tools` capability 注册模型工具；不需要 `dsh plugin add`、Profile 或额外 npm 包。

MCP 返回图片时，插件通过 Cordis 的 `attachments` capability 将原始 base64 图片持久化，工具结果和后续模型请求只携带 DSH 附件引用。

当前 binary 仅支持 macOS arm64。来源版本、签名身份和 SHA-256 见 `vendor/darwin-arm64/manifest.json`。
