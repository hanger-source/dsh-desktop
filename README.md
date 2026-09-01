# DSH Desktop

DSH Desktop 是 DeepSeek Harness 的 macOS 桌面产品仓库。它同时保存 App 源码与随 App 发布的静态运行时、Hang 的插件源码和技能；但三类更新各自拥有独立版本与生效边界，不再互相伪装成同一种“插件更新”。

## 三个更新域

| 更新对象 | 版本来源 | 发布与同步 | 生效方式 |
|---|---|---|---|
| DSH.app + App runtime | `CFBundleShortVersionString` / `dsh-app-v*` | GitHub Actions 构建 GitHub Release（DMG + ZIP） | 安装新 App 后重启 App |
| Hang 插件与技能 | Git commit | App 后台同步仓库；设置 → Hang 的插件可手动“同步并重载” | 当前 dsh 进程和当前页面直接 update，不重启 App |
| `@deepseek-ai/dsh` | npm semver | npmjs | 更新完成后重启 App，启动新的 dsh 进程 |

App runtime 是 DSH.app 的组成部分，不是 Hang 插件。只有 `plugins/` 目录下的扩展才进入动态 Cordis registry；插件所需的 Host/Client 源码和随附资源都保存在各自的插件目录中，由同一条仓库同步链加载。

## 目录

```text
apps/dsh/
  native/                 # AppKit + WKWebView 原生壳、构建脚本和图标
  runtime/
    host/                 # App 状态、版本、仓库同步、插件定义和父进程生命周期
    client/               # App 设置、Hang 插件设置、可信自动挂载与页面内 update
    web-boot.yml          # App 专属 dsh web overlay
plugins/
  conversation-experience/ # 会话工具展示与排队消息体验
  node-repl/              # Cordis 动态插件：独立 Node REPL MCP（macOS arm64）
  quota-monitor/          # 订阅用量与余额
skills/                   # 随插件仓库同步到 ~/.dsh/skills
.github/workflows/
  build-dsh-app.yml       # 写入版本、构建闭包、打 DMG/ZIP、发布 Release
bootstrap.sh              # 新机器：同步仓库/技能并安装 Release App
install.sh                # 下载 Release DMG 并安装到 ~/Applications
launch-web.sh             # 使用已安装 App runtime 的开发诊断入口
```

本机运行目录同样分开：

```text
~/Applications/DSH.app                 # App 与随 App 发布的 runtime
~/.dsh/dsh-desktop/                    # Git 插件/技能源码副本
~/.dsh/runtime/dsh-desktop/            # 日志、generated overlay、停用插件状态
~/.dsh/skills/                         # dsh 实际读取的技能
```

## 打开 App 后的链路

1. 原生 App 检查 Node.js 与正式安装的 `dsh`；仅在缺少 dsh 时通过对应 npm 安装 `@deepseek-ai/dsh@latest`。缺少 Node/npm 或安装失败会留在启动页并显示日志，不先打开空 WKWebView。
2. App 只从自身 `Contents/Resources/runtime` 生成 overlay，把静态 Host/Client runtime 装入 web profile；启动不依赖插件仓库里是否存在 App Hub。
3. dsh web 启动后，App runtime 在后台同步 `~/.dsh/dsh-desktop` 和技能。网络或 Git 同步失败只让插件域显示失败，不阻止 DSH 主界面启动。
4. 首个 Agent 就绪后，Host runtime 扫描仓库的 `plugins/`，为每个 Hang 动态插件定义最新 Package。
5. 静态 Client runtime 比较当前页面已加载的 `packageId`：未加载就 `run`，源码变化就 `update`。这条可信 App 链不创建审批请求，因此页面刷新、App 重启和 dsh 重启后都会自动恢复插件。
6. App 退出时终止自己持有的 dsh 子进程；Host runtime 也监控 App 父进程，App 被强杀后不会留下孤儿服务。

## 安装

普通用户从 Releases 下载 `DSH.dmg`，把 DSH.app 拖到 Applications。当前使用 ad-hoc 签名，另一台 Mac 第一次打开可能需要在“系统设置 → 隐私与安全性”点击“仍要打开”。

仓库安装入口：

```bash
bash bootstrap.sh
```

`install.sh` 只安装 CI Release，不会在用户机器上调用 `swiftc` 重新生成 App。

## App Release

Actions → **Release DSH Desktop**：

- 版本留空：在现有 `dsh-app-v*` Release 上递增 patch。
- 输入 `0.2.0`：发布 `dsh-app-v0.2.0`。
- 手动推送 `dsh-app-v*` tag：构建该版本。

CI 在构建前确定版本并写入 Info.plist，检查 App binary、完整静态 runtime 和 ad-hoc 签名，然后发布：

- `DSH.dmg`：人工下载安装；
- `DSH.app.zip`：脚本或调试下载；
- `SHA256SUMS.txt`：传输完整性检查。

失败的构建、版本、签名、tag 或 Release 操作会让 workflow 失败，不会用 `|| true` 伪装成功。

## 插件同步与重载

设置 → Hang 的插件 → **同步并重载** 完成一条操作：

```text
git pull --ff-only
  → 同步 skills
  → 比较插件最新源码与当前 Package
  → define 新 Package（仅变化的插件）
  → 当前页面 startUserRun(update)
```

插件的启用/停用状态写在 `~/.dsh/runtime/dsh-desktop/disabled-plugins.json`。主动停用的插件不会在下一次 App 启动时被自动开启；其他插件会自动恢复并且不重复审批。

## dsh 更新与重启

设置 → App → `@deepseek-ai/dsh` 显示已安装与 npm 最新版本。“更新并重启 APP”先更新全局 npm 包，成功后通过原生桥重启整个 App；因此原生窗口、dsh web、静态 runtime 和动态插件会在同一个新进程闭包内重新装配。

⌘R 只刷新当前页面并重新挂载 Client half，不更新 App binary，也不重启 dsh 服务。
