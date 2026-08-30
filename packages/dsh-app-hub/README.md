# dsh-app-hub —— 让 dsh 变成原生 macOS 应用（插件模式）

把 dsh web 以「插件 + 原生 Swift 壳」的方式变成桌面应用。

## 功能

- **原生壳 DSH.app**（Swift + AppKit + WKWebView，`~/Applications/DSH.app`）：
  - 打开时自动拉起 `dsh web --no-open`（端口 3080 未监听时），关壳不杀服务（服务常驻，刷新即连）；
  - 看门狗：服务挂了自动拉起、恢复自动重载页面；
  - 沉浸式标题栏跟随 **dsh 外观设置**：浅→浅、深→深、跟随系统→照搬系统（通过读 `~/.dsh/settings.yaml` 的 `ui-theme.preference` + 页面回调双通道，见下方"踩过的坑"）；
  - 编辑菜单（⌘C/⌘V 可用）、退出 ⌘Q、关闭窗口 ⌘W。
- **界面**（动态插件提供，设置 → App 页 + 左下角更新浮条）：
  - 生成/重建 `DSH.app`、打开壳、查看启动器与服务端口状态；
  - 版本检查（当前 `dsh --version` vs npm registry）与一键更新 CLI（`npm install -g @deepseek-ai/dsh@latest`），更新后重启服务生效；
  - 左下角检测到新版本自动浮出「发现新版本」条，可点更新/稍后。
- 控件样式全部使用 dsh 主题变量（`--dsw-alias-button-*`、`--dsw-alias-border-*`、`--dsw-alias-label-primary` 等），浅深主题自适应，不引入灰色块。

## 关键文件（运行依赖）

- `~/.dsh/dsh-app-hub/dsh-app-build.sh`：构建 DSH.app 的自包含脚本（含 Swift 源码 heredoc + Info.plist + 图标 icns + ad-hoc 签名）；插件 `create` 动作执行它。更新 Swift 逻辑时**需同步该脚本内嵌源码**（改 `~/projects/dsh-app-hub/DSHApp/DSHApp.swift` 后重新同步替换 heredoc 段，或直接改脚本内嵌段）。
- `~/.dsh/dsh-app-hub/icon-512.png`：壳图标（deepseek-ai 官方图标，macOS 自动圆角）。
- 壳日志：`~/.dsh/dsh-app-hub/shell.log`（启动/主题偏好/最终外观打点，排查先看这里）。

## 踩过的坑（对应代码注释）

1. **`\n` 字面在构建链（bash heredoc）会被破坏** → Swift 源码里避免 `"\n"`，用 `String(UnicodeScalar(10))`。
2. **dsh 主题信号**：深色标记在 `<body data-ds-dark-theme>`（切深色时 toggle），boot 脚本写 `html style.colorScheme`——回调要**双监听**（body 属性 + html style），fallback `prefers-color-scheme`。
3. **settings.yaml 子键带缩进**（`  preference: light`）：解析行首必须 trim，否则永远默认 system → 标题栏不跟随（上次"浅色失效"元凶）。
4. **npm EPERM**（`~/.npm/_cacache` 权限，常见于曾用 sudo npm）：版本查询改为直接 `curl registry.npmjs.org/@deepseek-ai/dsh/latest`，不经 npm。
5. **原生 WKWebView 不支持 `-webkit-app-region: drag`**（Electron 专属）；"页面顶到顶+顶部可拖+不选字"三者原生不可兼得，最终采用：标准系统标题栏 + 页面在下方（不叠）——标题栏区域无页面文本，结构性不可能出现选字光标。
6. 动态插件重启 dsh 即失，属进程内临时特性；本插件已入库本仓库，新环境/重启后用 `dsh-plugin-install` 一键启用。

## 启用

对 Agent 说「启用 dsh-app-hub」→ 读本目录 `code.host.js` / `code.client.js`（即 `cordis_define` 的 `code.host`/`code.client` 函数体）→ define + run 激活。之后在 dsh 设置 → App 页「生成 DSH.app」生成壳。
## 壳（DSH.app）资产

`assets/DSHApp/` 包含重建壳的完整输入：

- `DSHApp.swift`：壳源码（可读版）
- `dsh-app-build.sh`：自包含构建脚本（内嵌同名 Swift 源码 heredoc + Info.plist + 图标 icns + ad-hoc 签名）。**改 Swift 后两处都要同步**（源码文件与 heredoc 段）。
- `icon-512.png`：壳图标（deepseek-ai 官方标，macOS 自动圆角）
- `svg2png.swift` / `icon-make.swift`：图标生成辅助脚本（可选）

重建：`bash packages/dsh-app-hub/assets/DSHApp/dsh-app-build.sh ~/Applications ~/.dsh/dsh-app-hub`
