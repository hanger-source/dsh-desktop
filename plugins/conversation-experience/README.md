# 会话体验

DSH 动态插件，改善高频会话操作：

- 终端命令：保留 DSH 原生卡片、标题、图标、状态、复制和输出；命令过长被截断时，点击命令区域展开，再次点击收起。
- 排队消息：多行预览与逐条展开，使用 `textarea` 编辑；`⌘/Ctrl + Enter` 保存，`Esc` 取消，普通 Enter 保留换行。

终端部分只增强原生 `[data-terminal]` 的命令区域，不接管工具渲染。排队消息使用 DSH 已公开的 `conversation.input.dock` 槽位；写操作由 Host 半通过权威 `sessionController.updateQueue` 完成，不复制队列状态。队列 entry 使用私有 ID，并在插件存活期间隐藏原生稳定根节点 `[data-queue-dock]`；停用插件后恢复 DSH 原生组件。
