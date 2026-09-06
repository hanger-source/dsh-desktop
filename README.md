# DSH Desktop

DSH Desktop 是 `@deepseek-ai/dsh` 的 macOS 原生壳，同时提供 App 自有的更新与插件管理界面。

## 运行边界

| 对象 | 来源 | 版本与生效方式 |
|---|---|---|
| DSH.app | GitHub Release 的 DMG/ZIP | `dsh-app-v*`；安装后重启 App |
| Desktop 管理运行时 | `apps/dsh/desktop-runtime` | 构建时写入 App 版本并放入 `Contents/Resources/desktop-runtime`；只能随 App 更新 |
| Hang DSH Plugins | `plugins/hang-dsh-plugins` | `plugin-hang-dsh-plugins-v*`；独立检查、选择和更新 |
| `@deepseek-ai/dsh` | npmjs | 用户检查后选择更新；与其他所选项目统一重启 |
| 功能插件 | Git tag 对应的仓库子目录 | 每个插件独立版本、频道、启停和更新 |

Desktop 管理运行时属于 App，没有独立 Release。Hang DSH Plugins 是独立的宿主管理组件，拥有插件目录、安装和启停 API，不包含页面代码。App 随包携带一个可启动的管理器版本，仅在管理器缺失或仍是旧的页面/宿主混合结构时迁移；已经迁移完成的管理器不会随 App 启动被降级或覆盖。

## 更新模型

打开设置页面只读取本机版本，不访问远端，也不会用加载状态替换整页内容。

- “Desktop App”中的“检查更新”检查 App、Hang DSH Plugins 与 dsh。
- “Hang 的插件”中的“检查更新”刷新远端插件目录与插件版本。
- 单项有更新时，直接在该项执行更新。
- 已检查到多个候选时，“选择更新”打开独立弹窗；checkbox 只存在于弹窗中，不改变底层展示卡片。
- 已检查的 App、dsh 和功能插件可以进入同一个选择弹窗，作为一次事务安装并只重启一次。

更新开始前会保存 web profile 和原 dsh 版本；App 更新还保留原 App Bundle。只有新版页面中的 Desktop 管理运行时完成初始化后，事务才确认成功。准备失败、服务启动失败或管理运行时未就绪时，错误页面提供“恢复更新前版本”，统一恢复 App、dsh 与插件状态。

## 插件目录

`plugins/hang-dsh-plugins/catalog.json` 是管理器随包携带的初始目录。“检查更新”时会从仓库默认分支读取同一路径，界面中的插件集合由目录数据生成。目录条目给出 package、用途与 tag 前缀；版本来自不可变 tag：

```text
plugin-conversation-experience-v0.2.0
plugin-conversation-experience-v0.3.0-beta.1
```

功能插件通过标准 DSH profile 命令安装：

```bash
dsh plugin --profile web add \
  'github:hanger-source/dsh-desktop#plugin-conversation-experience-v0.2.0&path:/plugins/conversation-experience'
```

## 目录

```text
apps/dsh/native/                  # AppKit、启动链、更新事务与恢复
apps/dsh/desktop-runtime/         # 随 App 分发的设置页与组件状态 API
plugins/hang-dsh-plugins/         # 独立插件目录、安装和启停 API
plugins/conversation-experience/ # 独立功能插件
plugins/quota-monitor/           # 独立功能插件
plugins/node-repl/                # 独立功能插件
.github/workflows/                # App 与功能插件发布
launch-web.sh                     # 隔离 profile 的本地 Web 验收入口
```

## 本地验证

```bash
npm --prefix apps/dsh/desktop-runtime run check
npm --prefix plugins/hang-dsh-plugins run check
DSH_HOME="$(mktemp -d)" bash launch-web.sh --port 3091
bash apps/dsh/native/dsh-app-build.sh /tmp/DSH.app apps/dsh/native 0.0.0-dev
```

App Release 由 Actions → **Release DSH Desktop** 生成 DMG、ZIP 和 SHA256SUMS；管理器与功能插件由 **Release DSH Plugin** 创建各自的不可变 tag。
