# dsh-app-hub —— 让 dsh 变成原生 macOS 应用（插件模式）

把 dsh web 以「插件 + 原生 Swift 壳」的方式变成桌面应用，并承担 App 的启动/退出链路（拉起服务、bootstrap、⌘Q 关服务）。

## 功能

- **原生壳 DSH.app**（Swift + AppKit + WKWebView，`~/Applications/DSH.app`）：
  - 窗口先显示动态进度条、持续计时和实时进程日志；本地没有正式全局 `dsh` 时从 npmjs 正式 registry 安装 `@deepseek-ai/dsh@latest`，不继承可能滞后的本机 registry；失败时直接展示安装日志。
  - 等待内置 `bootstrap.sh` 同步插件仓库与技能；失败时展示 bootstrap 日志，不继续加载空页面或旧副本。
  - 根据当前 `DSH_HOME` 生成 overlay，以正式全局 `dsh --profile web --patch <generated-overlay> --no-open` 启动服务，并从日志读取带 token 的 URL 后加载页面。
  - 编辑菜单（⌘C/⌘V 可用）、退出 ⌘Q；重启只操作 App 自己持有的 dsh 子进程。
  - 标题栏继续跟随 dsh 的浅色、深色或系统外观设置。
  - 若 3080 已被外部服务占用则明确报错，不接管、不清理；App 强杀时由 dsh-boot 的父进程监控关闭服务。
- **界面**（动态插件提供，设置 → App 页 + 左下角更新浮条）：
  - 生成/重建 `DSH.app`、打开壳、查看启动器与服务端口状态；
  - 版本检查（当前 `dsh --version` vs npm registry）与一键更新 CLI（`npm install -g @deepseek-ai/dsh@latest`），更新后重启服务生效；
  - 左下角检测到新版本自动浮出「发现新版本」条，可点更新/稍后。
- 控件样式全部使用 dsh 主题变量（`--dsw-alias-button-*`、`--dsw-alias-border-*`、`--dsw-alias-label-primary` 等），浅深主题自适应，不引入灰色块。

## 启动链路（本插件在链路中的角色）

DSH.app 是整条链路的入口：

```
DSH.app 打开
  ├─ 前台检查/安装正式全局 dsh（无则 npm install -g @deepseek-ai/dsh@latest）
  ├─ 等待 bootstrap.sh：clone/pull hang-plugins + 同步 skills
  ├─ 从模板生成含当前绝对路径的 runtime overlay
  ├─ spawn dsh --profile web --patch web-boot.generated.yml --no-open
  │    └─ web-boot.yml（App 专属 overlay）：openBrowser:false + insert 注入 dsh-boot
  │         ├─ 监听 agent/created → 自动启用本插件（以及 hang-plugins、quota-monitor）
  │         └─ 监控 DSH_PARENT_PID → App 消失时关闭服务
  ├─ 读取 server.log 中带 token 的 URL → WKWebView 加载真实页面
  └─ ⌘Q 退出 → SIGTERM App 自己持有的 dsh 子进程
```

## 关键文件（运行依赖）

- `~/.dsh/hang-plugins/overlays/web/web-boot.yml`：App 启动时 `--patch` 注入的 overlay（openBrowser:false + insert dsh-boot）。
- `~/.dsh/hang-plugins/overlays/web/plugins/dsh-boot.js`：dsh-boot 宿主插件（自动启用仓库 UI 插件 + `/api/dsh-plugins/enable` 端点）。
- `~/.dsh/hang-plugins/packages/dsh-app-hub/assets/DSHApp/`：壳的完整输入——`DSHApp.swift`（源码）、`dsh-app-build.sh`（构建脚本，**从同目录 DSHApp.swift 读取源码编译**，改 Swift 只需改这一个文件）、`icon-512.png`（壳图标，deepseek-ai 官方标）。
- 日志目录：`~/.dsh/hang-plugins/.runtime/dsh-app-hub/`；正式安装 `install.log`、同步 `bootstrap.log`、服务 `server.log`、dsh-boot `dsh-boot.log`。

重建壳：`bash ~/.dsh/hang-plugins/packages/dsh-app-hub/assets/DSHApp/dsh-app-build.sh`（输出 `~/Applications/DSH.app`）。

## 踩过的坑（对应代码注释）

1. **首次安装不能藏在后台**：空 WKWebView 无法区分安装中、安装失败和服务失败；App 先显示状态页，并把每个失败阶段连同对应日志展示出来。
2. **npm registry 发布必须闭合**：App 只安装 `@deepseek-ai/dsh@latest`，不会改用源码 checkout 或临时 `npm exec` 掩盖缺包。
3. **`--no-open` 在 `--profile` 模式下会被忽略**：仍需在 overlay 配置层设置 `openBrowser: false`。
4. **overlay 的插件名需要绝对路径**：仓库保存占位符模板，App/`launch-web.sh` 在运行时生成实际 overlay，不写死用户名。
5. **服务只能有一个 owner**：App 不再按端口杀进程或从页面插件自拉新服务；外部端口占用直接失败，重启和退出只操作 App 自己的子进程。
6. **动态插件是进程级特性**：dsh web 重启即失。恢复由 dsh-boot 在 `agent/created` 时自动 define+run（幂等：每个包只启用一次，避免双实例）。

## 启用

App 启动时 dsh-boot 会自动启用本插件（设置 → App 页出现即生效）。手动场景：对 Agent 说「启用 dsh-app-hub」→ 读 `code.host.js` / `code.client.js`（即 `cordis_define` 的 `code.host`/`code.client` 函数体）→ define + run 激活。
