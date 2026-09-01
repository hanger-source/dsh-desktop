# DSH App

`native/` 是 DSH.app 的完整源码。App 不再携带 DSH overlay 或插件运行时。

- Native 拥有 macOS 窗口、菜单、主题、启动页、进程启动/退出和系统操作。
- App 启动前通过正式 `dsh plugin --profile web add` 确保指定版本的 `@hanger-source/hang-dsh-plugins` 已安装。
- App 直接启动标准 web profile；App 设置和插件管理页面由该管理 Bundle 提供。
- 功能插件从 Git tag 的仓库子目录独立安装，不复制进 App，也不 clone 到用户目录。

构建：

```bash
bash apps/dsh/native/dsh-app-build.sh /tmp/DSH.app apps/dsh/native 0.1.0
```

本地构建用于开发验证；用户安装入口始终是 GitHub Release。
