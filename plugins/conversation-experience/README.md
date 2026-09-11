# 会话体验

一个正式 DSH Client Bundle，只增强长思考内容的滚动体验：

- `client/reasoning.js`：保留 DSH 原生 Think 行，为展开内容提供独立滚动容器，并在生成期间自动跟随底部。

DSH 0.1.5 已原生提供终端命令展开及完整的排队、编辑、Steer 和 Stop 状态机，本插件不隐藏或替换这些原生组件。发布前把 `client/*.js` 组合进预构建的 `client.js`；正式安装后 Cordis 中仍然只有一个「会话体验」Bundle。

安装：`dsh plugin --profile web add 'github:hanger-source/dsh-desktop#<tag>&path:/plugins/conversation-experience'`。
