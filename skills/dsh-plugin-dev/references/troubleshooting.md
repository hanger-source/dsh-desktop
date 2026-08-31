# 参考：DSH Desktop 踩坑记录

> 被 `SKILL.md` 引用。改壳 / 插件前先扫一眼，避免重复踩坑。

1. **`\n` 字面在构建链（bash heredoc）会被破坏**：Swift 源码避免 `"\n"`，用 `String(UnicodeScalar(10))`。
2. **dsh 主题信号**：深色标记 = `<body data-ds-dark-theme>`（toggle），boot 脚本还写 `documentElement.style.colorScheme`——回调要双监听（body 属性 + html style），fallback `prefers-color-scheme`。
3. **settings.yaml 子键带缩进**（`  preference: light`）：解析行首必须 trim，否则永远默认 system → 标题栏不跟随；App 日志在 `~/.dsh/runtime/dsh-desktop/`。
4. **npm EPERM**（`~/.npm/_cacache` 权限，常因用过 sudo npm）：版本查询直接 `curl registry.npmjs.org/@deepseek-ai/dsh/latest`，不经 npm。
5. **原生 WKWebView 不支持 `-webkit-app-region: drag`**：页面顶到顶 + 顶部可拖 + 不选字不可兼得 → 用标准系统标题栏 + 页面不叠。
6. **动态插件进程内临时**：静态 App runtime 必须在连接恢复后比较 `packageId` 并执行 `run/update`；不能靠页面刷新读取新源码。
7. **标题栏跟随 dsh 外观的完整链路**：页面回调(theme) → 读 `~/.dsh/settings.yaml`(`ui-theme.preference`，注意缩进) → `window.appearance`（dark→darkAqua / light→aqua / system→nil）。
