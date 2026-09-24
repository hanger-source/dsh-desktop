# 会话体验

一个正式 DSH Client Bundle，保持会话工具、思考和排队消息的完整交互体验：

- `client/terminal.js`：保留 DSH 原生终端卡，为被截断的命令恢复整行点击与键盘展开、收起。
- `client/presentation.js`：针对 DSH 0.1.7 新增的 Turn process，为直接展示的中间思考文本恢复「思考」标题、摘要、展开收起和圆角滚动正文；不接管外层过程折叠、工具卡片和最终回答。
- `client/reasoning.js`：保留 DSH 原生 Think 行，为展开内容提供独立滚动容器，并在生成期间自动跟随底部。
- `client/queue.js`：以 DSH 0.1.7 的 Inbox 投影和 pending submission echo 为状态来源，恢复三行预览、逐条展开和大尺寸多行编辑器；发送、编辑、移除和 Steer 仍调用当前会话的原生 API。

本插件覆盖的是一整套会话交互，不是单独给思考正文加框。发布前把 `client/*.js` 组合进预构建的 `client.js`；正式安装后 Cordis 中仍然只有一个「会话体验」Bundle。

由仓库根目录的 **Hang DSH Plugins** 总 bundle 统一安装和装配，不面向用户单独安装。
