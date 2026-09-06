# DSH App

`native/` 是 DSH.app 的原生源码，`desktop-runtime/` 是 App 自有的 Web 管理运行时。

- Native 拥有窗口、菜单、启动页、进程生命周期、更新事务和失败恢复。
- 构建脚本把 App 自有运行时和独立的 Hang DSH Plugins 分别打成版本化 tgz，并生成只描述实际构建产物的清单。
- App 启动前使用标准 `dsh plugin --profile web add file:...tgz` 安装与当前 App 精确对应的运行时；固定 App 路径不再成为 pnpm 的包身份。
- Hang DSH Plugins 只在缺失或仍携带旧 UI 职责时由随附包初始化，之后保持独立版本；功能插件继续通过各自 Git tag 安装。
- 更新成功以 Desktop 运行时完成初始化为准；失败页面可以恢复事务开始前的 App、dsh 和 profile。

构建：

```bash
npm --prefix apps/dsh/desktop-runtime run check
bash apps/dsh/native/dsh-app-build.sh /tmp/DSH.app apps/dsh/native 0.0.0-dev
```

本地构建与隔离 profile 用于验收；发布工作流只负责对已经验收的提交生成安装产物。
