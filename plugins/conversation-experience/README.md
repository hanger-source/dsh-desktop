# 会话体验

一个 DSH 动态插件，Client 源码按职责拆分：

- `client/terminal.js`：保留 DSH 原生终端卡，只增强被截断命令的点击展开和收起。
- `client/queue.js`：接管排队消息的多行预览、逐条展开和 `textarea` 编辑；操作按钮沿用 DSH 原生图标。

仓库运行时把 `client/*.js` 组合成同一个 Client half，因此 Cordis 中仍然只有一个「会话体验」插件、一个审批状态和一个启停入口。队列模块使用公开的 `conversation.input.dock` 槽位；写操作通过当前 `sessions` binding 的正式 Session Remote API 完成，不复制队列状态。

根目录的 `code.client.js` 是从这两个模块机械生成的旧 Desktop App 装载产物，不是维护源码；当前加载器会校验它与 `client/*.js` 完全一致，避免双份实现漂移。
