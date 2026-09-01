# DSH Desktop

这个仓库同时发布 DSH macOS App 和 Hang 的 DSH 插件，但两者使用不同的版本与更新链路。

## 更新边界

| 对象 | 版本 | 分发 | 生效 |
|---|---|---|---|
| DSH.app | `dsh-app-v*` | GitHub Actions 构建 DMG/ZIP Release | App 自动更新后重启 |
| `hang-dsh-plugins` | `plugin-hang-dsh-plugins-v*` | App 启动前通过 `dsh plugin --profile web add github:...&path:/plugins/hang-dsh-plugins` 确保最低兼容版本；后续由 Desktop App 页面独立更新 | 重载 dsh 服务 |
| 功能插件 | `plugin-<key>-v*` | 设置 → Hang 的插件，逐个通过正式 DSH Bundle 安装 | 自动重载 dsh 服务 |
| `@deepseek-ai/dsh` | npm semver | npmjs | 更新完成后重启 App |

App 不携带私有 DSH overlay，不 clone 插件仓库，也不把源码放进 `~/.dsh/dsh-desktop`。用户机器只保留标准 web profile、pnpm 安装结果和运行日志。

## 目录

```text
apps/dsh/native/                 # AppKit + WKWebView 原生壳与构建脚本
plugins/catalog.json             # 功能插件目录
plugins/hang-dsh-plugins/        # App 自动安装的隐藏管理 Bundle
plugins/conversation-experience/ # 会话体验 Bundle
plugins/quota-monitor/           # 订阅/余额 Bundle
plugins/node-repl/               # Node REPL Bundle 与随包二进制
.github/workflows/build-dsh-app.yml
launch-web.sh                    # 本仓库源码的本地 web profile 诊断入口
```

每个 `plugins/<key>` 都是可独立安装的 npm package 根目录，提交中已包含运行产物，不需要 Git 安装时执行 `prepare`。

## 插件版本与频道

正式版和 Beta 都使用不可变 tag：

```text
plugin-conversation-experience-v0.2.0
plugin-conversation-experience-v0.3.0-beta.1
```

管理页默认选择正式版；只有尚未发布正式版或用户主动选择时才使用 Beta，并在条目名称旁显示短的 `Beta` 标记。分支仅用于开发验证，不作为用户更新源。

插件安装格式：

```bash
dsh plugin --profile web add \
  'github:hanger-source/dsh-desktop#plugin-conversation-experience-v0.2.0&path:/plugins/conversation-experience'
```

开发分支也可以安装，前提是分支已推送：

```bash
dsh plugin --profile web add \
  'github:hanger-source/dsh-desktop#heads/feat/example&path:/plugins/conversation-experience'
```

## App 启动链

1. 检查 Node.js 与 `dsh`；缺少 dsh 时通过 npmjs 安装 `@deepseek-ai/dsh@latest`。
2. 检查 pnpm；缺少时通过 npm 安装 `pnpm@10`。
3. 检查 web profile 是否已经安装 App 要求的最低版本 `@hanger-source/hang-dsh-plugins`，缺失或版本过低时通过正式 `dsh plugin` 命令安装。
4. 直接运行 `dsh --profile web --no-open`，不再生成 overlay。
5. 管理 Bundle 仅在用户点击检查更新或执行安装时读取 GitHub tags；启用、更新、停用分别落到 web profile 的 package 依赖与 bundle 列表，然后由 App 重载 dsh 服务，不重启 App 进程。

App 退出时仍会终止自己持有的 dsh 子进程；管理 Bundle 也监控 App 父进程，避免留下孤儿服务。

## 本地验证

```bash
DSH_HOME="$(mktemp -d)" bash launch-web.sh --port 3091
```

`launch-web.sh` 只把本地 `hang-dsh-plugins` 以 `file:` package 装入指定 profile。其余功能插件在“设置 → Hang 的插件”中逐个启用。

## App Release

插件发布使用 Actions → **Release DSH Plugin**：选择插件并输入与其 `package.json` 一致的 semver。CI 会检查会话插件构建产物、执行 `npm pack --dry-run`，然后在当前提交创建 `plugin-<key>-v<version>` 不可变 tag。带 prerelease 的 semver 自动进入 Beta 频道；普通 semver 进入正式频道，不额外上传 tgz 或创建 Release 资产。

App 发布使用 Actions → **Release DSH Desktop**：

- 版本留空：在现有 `dsh-app-v*` Release 上递增 patch；
- 输入 `0.3.0`：发布 `dsh-app-v0.3.0`；
- 推送 `dsh-app-v*` tag：构建对应版本。

发布前必须先存在 App 所绑定的 `plugin-hang-dsh-plugins-v*` tag。CI 校验管理器 tag、App binary、Info.plist 版本和 ad-hoc 签名，然后发布 `DSH.dmg`、`DSH.app.zip` 与 `SHA256SUMS.txt`。

普通用户下载 DMG 后拖入 Applications。当前使用 ad-hoc 签名，另一台 Mac 首次打开可能需要在“系统设置 → 隐私与安全性”中允许打开。
