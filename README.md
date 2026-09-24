# Hang DSH Plugins

面向官方 **DeepSeek Harness Desktop** 的 Hang 插件集合。官方 App 负责进程启动、更新、账号、Desktop profile 和插件管理；本仓库只提供标准 DSH bundle，不再分发另一套 Desktop 壳。

## 安装

在官方 DeepSeek Harness 中打开 **插件 → 添加插件**，粘贴 npm 包名：

```text
@hanger-source/hang-dsh-plugins
```

安装完成后选择 **立即启用**。用户只安装这一个包；总 bundle 会装配仓库内全部 Hang 插件。npm 安装不经过 GitHub `codeload`，Windows 与 macOS 使用同一条安装链路。

需要固定版本时附加版本号：

```text
@hanger-source/hang-dsh-plugins@0.3.2
```

需要直接跟随 Git 提交时，也可以使用仓库地址：

```text
https://github.com/hanger-source/hang-dsh-plugins
```

## 组成

| 组件 | 职责 |
|---|---|
| `conversation-experience` | 会话过程、排队消息与终端展示体验 |
| `quota-monitor` | OpenCode Go 用量与 DeepSeek 官方余额 |
| `node-repl` | 每个 Agent 会话独立的持久 Node.js REPL 工具 |

根目录的 `cordis.patch.yml` 是唯一装配入口。每个组件仍保留自己的 `package.json`、Host/Client 入口和构建检查，因此可以独立开发；发布与安装只认根 bundle 版本，不要求用户逐个安装子包。

官方插件页会把三个条目列在同一个 **Hang DSH Plugins** bundle 下，可分别启停。卸载总 bundle 会一起移除它们。

## 项目边界

```text
package.json                         # Git 仓库安装时读取的总 bundle 清单
cordis.patch.yml                     # 一次装配全部 Hang 插件
plugins/conversation-experience/     # 独立功能组件
plugins/quota-monitor/               # 独立功能组件
plugins/node-repl/                    # 独立功能组件
scripts/                              # 包结构与官方 DSH 安装验证
.github/workflows/verify.yml          # 在 macOS 和 Windows 跟随 @deepseek-ai/dsh@next 验证
.github/workflows/release.yml         # 发布 npm 总 bundle、验证并创建 Release
```

本仓库不拥有官方 Desktop 的启动链、签名、更新器或 profile 生命周期，也不直接修改 `/Applications/DeepSeek Harness.app`。

## 本地验证

要求本机已有当前官方 `dsh`：

```bash
npm run check
npm run verify:official
```

`verify:official` 会打出真实 npm 包、在临时 `DSH_HOME` 中从官方 web profile 创建验证 profile、通过 `dsh plugin` 安装总 bundle，并直接启动安装后包内与当前平台匹配的 OpenAI Node REPL runtime，核对 MCP 工具契约。随后启动真实 Host，确认三个组件正常启用并进入最终组合配置，且两个 Client 包进入页面运行图。验证脚本使用 Node.js，可在 macOS arm64 和 Windows x64 执行；验证目录会保留并打印路径，便于继续检查现场。

## 发布

总版本记录在根 `package.json`。推送 `hang-dsh-plugins-v<version>` tag，或在 Actions 中运行 **Release Hang DSH Plugins**，会：

1. 运行源码检查，生成总 bundle tgz 与 SHA-256；
2. 在 macOS 和 Windows 安装当前 `@deepseek-ai/dsh@next`；
3. 两个平台都通过官方插件管理器安装并验证同一个待发布 tgz；
4. 验证通过后发布 `@hanger-source/hang-dsh-plugins` 到 npm 官方 registry；
5. 创建 Git tag 和 GitHub Release。

子目录版本用于组件诊断，不再各自创建 Release 或要求用户分别选择版本频道。
