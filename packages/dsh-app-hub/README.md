# dsh-app-hub —— 让 dsh 变成原生 macOS 应用（插件模式）

把 dsh web 以「插件 + 原生 Swift 壳」的方式变成桌面应用，并承担 App 的启动/退出链路（拉起服务、bootstrap、⌘Q 关服务）。

## 功能

- **原生壳 DSH.app**（Swift + AppKit + WKWebView，`~/Applications/DSH.app`）：
  - 打开后立即显示启动状态，直接运行 `~/projects/deepseek-harness/apps/cli/lib/bin.js`；`DSH_SOURCE_ROOT` 可覆盖 checkout 路径，不执行后台 npm 安装。
  - 插件与 overlay 随 App 构建进 Resources；服务输出带 token 的 URL 后才加载页面，错误留在同一窗口显示。
  - 页面可用后后台执行 App 内置的 `bootstrap.sh` 同步仓库和技能；失败不影响本次内置插件快照。
  - 标题栏跟随 **dsh 外观设置**：浅→浅、深→深、跟随系统→照搬系统（读 `~/.dsh/settings.yaml` 的 `ui-theme.preference` + 页面回调双通道，见"踩过的坑"）。
  - 编辑菜单（⌘C/⌘V 可用）、退出 ⌘Q、关闭窗口 ⌘W。
  - **⌘Q 退出 = 关闭自有服务**：只 SIGTERM 自己拉起的 dsh web；强制退出时由 dsh-boot 的父进程监控关闭服务，不误杀外部 3080 进程。
- **界面**（动态插件提供，设置 → App 页）：
  - 生成/重建 `DSH.app`、打开壳、查看启动器与服务端口状态；
  - 显示本地 `deepseek-harness` checkout 路径、CLI 版本和 commit；更新由该源码仓库自身承担。
- 控件样式全部使用 dsh 主题变量（`--dsw-alias-button-*`、`--dsw-alias-border-*`、`--dsw-alias-label-primary` 等），浅深主题自适应，不引入灰色块。

## 启动链路（本插件在链路中的角色）

DSH.app 是整条链路的入口：

```
DSH.app 打开
  ├─ 立即显示本地启动页
  ├─ 从 App Resources 生成含绝对路径的 overlay
  ├─ spawn node ~/projects/deepseek-harness/apps/cli/lib/bin.js --profile web --patch <generated> --no-open
  │    └─ generated overlay：openBrowser:false + insert 注入 App 内置 dsh-boot
  │         └─ dsh-boot 监听 agent/created → 自动启用本插件（以及 hang-plugins、quota-monitor）
  ├─ 读取 server.log 的 token URL → WKWebView 加载真实页面
  ├─ 页面可用后后台 bootstrap.sh：clone/pull hang-plugins + 同步 skills
  └─ ⌘Q / 父进程消失 → 关闭 App 自己持有的服务
```

## 关键文件（运行依赖）

- `DSH.app/Contents/Resources/dsh-plugins/`：构建时固化的插件快照、overlay 模板与 dsh-boot；首屏启动不依赖网络同步。
- `~/.dsh/hang-plugins/.runtime/dsh-app-hub/web-boot.generated.yml`：App 运行时写入真实 dsh-boot 绝对路径的 overlay。
- `~/.dsh/hang-plugins/packages/dsh-app-hub/assets/DSHApp/`：壳的完整输入——`DSHApp.swift`（源码）、`dsh-app-build.sh`（构建脚本，**从同目录 DSHApp.swift 读取源码编译**，改 Swift 只需改这一个文件）、`icon-512.png`（壳图标，deepseek-ai 官方标）。
- 壳日志：`~/.dsh/hang-plugins/.runtime/dsh-app-hub/shell.log`（启动/主题偏好/退出打点，排查先看这里）；服务日志 `server.log`；dsh-boot 日志 `dsh-boot.log`。

重建壳：`bash ~/.dsh/hang-plugins/packages/dsh-app-hub/assets/DSHApp/dsh-app-build.sh`（输出 `~/Applications/DSH.app`）。

## 踩过的坑（对应代码注释）

1. **`\n` 字面在构建链（bash heredoc）会被破坏** → Swift 源码里避免 `"\n"`，用 `String(UnicodeScalar(10))`。
2. **dsh 主题信号**：深色标记在 `<body data-ds-dark-theme>`（切深色时 toggle），boot 脚本写 `html style.colorScheme`——回调要**双监听**（body 属性 + html style），fallback `prefers-color-scheme`。
3. **settings.yaml 子键带缩进**（`  preference: light`）：解析行首必须 trim，否则永远默认 system → 标题栏不跟随。
4. **npm EPERM**（`~/.npm/_cacache` 权限，常见于曾用 sudo npm）：版本查询改为直接 `curl registry.npmjs.org/@deepseek-ai/dsh/latest`，不经 npm。
5. **原生 WKWebView 不支持 `-webkit-app-region: drag`**（Electron 专属）；"页面顶到顶+顶部可拖+不选字"三者原生不可兼得，最终采用：标准系统标题栏 + 页面在下方（不叠）——标题栏区域无页面文本，结构性不可能出现选字光标。
6. **⌘Q 卡死**：不再从主线程执行 lsof 或清理任意端口 owner；App 只 SIGTERM 自己保存的子进程，异常退出由 dsh-boot 的 `DSH_PARENT_PID` 监控收口。
7. **`--no-open` 在 `--profile` 模式下被 dsh CLI 忽略**（allowUnknownOption 吞掉）→ 浏览器每次弹出；改为在 `web-boot.yml` 配置层 `openBrowser: false`。
8. **dsh-boot 经 `--patch` 注入失败**：patch 只支持修改已有条目（`entry not found`），新增插件必须用 `insert:` 语法；且 `name` 用绝对路径。
9. **动态插件是进程级特性**：dsh web 重启即失。恢复由 dsh-boot 在 `agent/created` 时自动 define+run（幂等：每个包只启用一次，避免双实例）。
10. **启动 URL 带 token**：端口返回 401 仍表示 web server 已监听；壳从 `server.log` 读取 `dsh web: http://127.0.0.1:3080/?token=...` 后再导航，不能用无 token 根 URL冒充页面就绪。

## 启用

App 启动时 dsh-boot 会自动启用本插件（设置 → App 页出现即生效）。手动场景：对 Agent 说「启用 dsh-app-hub」→ 读 `code.host.js` / `code.client.js`（即 `cordis_define` 的 `code.host`/`code.client` 函数体）→ define + run 激活。
