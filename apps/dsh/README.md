# DSH App

`native/` 与 `runtime/` 共同组成一个 DSH.app Release，二者使用同一个 App 版本并原子发布。

- Native 只拥有 macOS 窗口、菜单、主题、启动页、进程启动/退出和系统操作。
- Host runtime 只拥有 App 状态、更新信息、插件仓库同步和动态插件 Host 装配。
- Client runtime 只拥有 App/插件设置页面，以及当前 WKWebView 中动态插件 Client half 的 run/update。
- `plugins/` 源码不复制进 App；它按 Git commit 独立同步。

构建：

```bash
bash apps/dsh/native/dsh-app-build.sh /tmp/DSH.app apps/dsh/native 0.1.0
```

本地构建用于开发验证；用户安装入口始终是 GitHub Release。
