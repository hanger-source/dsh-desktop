---
name: dsh-plugin-install
description: 同步、启用或重载 DSH Desktop 中 plugins/ 下的 Hang 插件与 skills。新环境或用户说“同步我的插件”“把所有插件装上”“重载插件”时使用；优先使用 DSH.app 设置页的可信同步与 update 链。
---

# 同步 Hang 插件与技能

仓库本机副本：`~/.dsh/dsh-desktop`。

结构：

- `plugins/<key>/`：真正的 Hang 动态插件；
- `skills/<key>/`：同步到 `~/.dsh/skills/`；
- App runtime 在 DSH.app 内，不属于插件仓库 inventory。

## 正常入口

打开 DSH.app → 设置 → Hang 的插件 → **同步并重载**。

该操作依次执行 `git pull --ff-only`、技能同步、最新 Package define，以及当前页面的 `startUserRun(update)`。没有变化的 Package 不重复定义；主动停用的插件保持停用；无需重新审批或重启 App。

## 新机器

从 GitHub Release 安装 DSH.app。App 首次启动会在后台 clone 仓库并自动挂载 `plugins/`；也可以在仓库中执行 `bash bootstrap.sh`，同时安装技能和 Release App。

## 验证

在“Hang 的插件”页确认：

- 本机副本路径为 `~/.dsh/dsh-desktop`；
- commit 是刚同步的提交；
- 每个启用插件显示“运行中”；
- 页面刷新后仍自动挂载，且列表中没有 App Hub 或插件管理器自身。
