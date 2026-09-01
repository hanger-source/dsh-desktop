# 会话体验

一个正式 DSH Client Bundle。维护源码按职责拆分：

- `client/terminal.js`：保留 DSH 原生终端卡，只增强被截断命令的点击展开和收起。
- `client/queue.js`：接管排队消息的多行预览、逐条展开和 `textarea` 编辑；操作按钮沿用 DSH 原生图标。

发布前把 `client/*.js` 组合进预构建的 `client.js`；正式安装后 Cordis 中仍然只有一个「会话体验」Bundle。队列模块使用公开的 `conversation.input.dock` 槽位，写操作通过当前 `sessions` binding 的 Session Remote API 完成，不复制队列状态。

安装：`dsh plugin --profile web add 'github:hanger-source/dsh-desktop#<tag>&path:/plugins/conversation-experience'`。
