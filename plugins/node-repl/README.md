# Node REPL

正式 DSH Host Bundle。安装后直接由 web profile 装入 Cordis，并注册：

- `mcp__node_repl__js`
- `mcp__node_repl__js_add_node_module_dir`
- `mcp__node_repl__js_reset`

插件将工具注册到每个会话自己的 `agent.ctx.tools`。某个会话第一次调用 REPL 工具时，才以该会话的工作目录启动一份独立 MCP server；同一会话持续复用自己的 JavaScript 内核，不同会话之间不会共享变量、模块路径或 `js_reset`。

Node 内核直接复用当前 DSH Host 的 Node runtime。官方 Desktop Host 是 Electron 时，插件通过 `ELECTRON_RUN_AS_NODE=1` 使用当前 App 可执行文件；CLI Host 则直接使用当前 Node 可执行文件，不依赖系统 `PATH` 中另行安装 `node`。

MCP 返回图片时，插件通过 Cordis 的 `attachments` capability 将原始 base64 图片持久化，工具结果和后续模型请求只携带 DSH 附件引用。

MCP runtime 从 OpenAI 官方 ChatGPT 桌面应用中提取，并按当前系统选择随插件固定的可执行文件。目前支持 macOS arm64 和 Windows x64；来源版本、签名身份和 SHA-256 记录在对应 `vendor/<platform>/manifest.json`。

由仓库根目录的 **Hang DSH Plugins** 总 bundle 统一安装和装配，不面向用户单独安装。
