# dsh-plugins — Hang 的插件与 DSH.app 启动链路

本仓库统一管理 Hang 的插件（每个包存一份**最新源码**，更新就地覆盖，历史交给 git），
以及 DSH.app 原生壳的完整启动链路（App 拉起服务 → bootstrap → 插件自动启用 → 退出关闭）。

## 链路总览（打开 DSH.app 之后发生的事）

1. **DSH.app（Swift 壳）** 立即显示可交互的启动页，并直接运行 `~/projects/deepseek-harness/apps/cli/lib/bin.js`；可用 `DSH_SOURCE_ROOT` 明确指定另一个 checkout。壳不在后台安装 npm 包。
2. App 构建时把 `packages/`、`dsh-boot.js` 和 overlay 模板打进 Resources；运行时生成含真实绝对路径的 overlay，再以 `node <cli> --profile web --patch <generated-overlay> --no-open` 拉起端口 3080：
   - `openBrowser: false`（`--no-open` 在 `--profile` 模式下会被 dsh CLI 忽略，必须从配置层关，否则每次启动弹浏览器）；
   - `insert:` 注入 **dsh-boot** 宿主引导插件。
3. 壳等待服务输出带 token 的真实启动 URL；成功后 WKWebView 才导航，失败则在同一窗口显示 `server.log` 尾部，不弹阻塞 modal、不留下空白窗口。
4. 页面可用后，后台执行 App 内置的 `bootstrap.sh`：clone/pull 本仓库到 `~/.dsh/hang-plugins`，再同步 `skills/`；网络失败不影响本次随 App 打包的插件快照。
5. **dsh-boot 插件** 监听 `agent/created`，自动把 App Resources 中带 UI 的插件 define + run 启用（幂等：每个包进程内只启用一次，多次 agent/created 不重复定义）：
   - `dsh-app-hub`（设置 → App 页）
   - `hang-plugins`（设置 → Hang 的插件管理器）
   - `quota-monitor`（侧边栏底部用量/余额）
6. **⌘Q 退出**：App 只向自己拉起的 dsh web 发送 `SIGTERM`，不清理外部占用 3080 的进程；App 异常退出时，dsh-boot 通过 `DSH_PARENT_PID` 检测父进程消失并关闭服务。

## 目录结构

```
bootstrap.sh                # 页面可用后执行的同步：拉仓库 + 同步技能 + 调 install.sh
install.sh                  # 构建/更新 DSH.app 壳 + 安装技能（不再安装 agent-preset）
launch-web.sh               # 手动启动 dsh web（同样带 web-boot.yml overlay）
overlays/web/web-boot.yml   # overlay 模板：构建进 App，运行时替换 dsh-boot 绝对路径
overlays/web/plugins/dsh-boot.js  # dsh-boot：agent/created 自动启用 UI 插件 + /api/dsh-plugins/enable 端点
packages/<name>/            # 每个插件：code.host.js / code.client.js / README.md（最新版一份）
  ├── dsh-app-hub/          # 设置 → App 页（生成壳、本地源码运行时状态）；assets/DSHApp/ 持壳源码与构建脚本
  ├── hang-plugins/         # 设置 → Hang 的插件管理器
  └── quota-monitor/        # 侧边栏底部用量/余额监视
skills/                     # 仓库自带技能（dsh-plugin-install / dsh-plugin-dev 等），bootstrap 同步到 ~/.dsh/skills/
```

## 运行时边界

- dsh 运行时唯一来自本机 `deepseek-harness` checkout 的已构建 CLI；DSH.app 不读全局 npm 安装。
- 插件运行快照来自 DSH.app 的 Resources；`~/.dsh/hang-plugins` 是后台同步副本和技能来源，不是首屏启动前提。
- 插件以动态会话插件运行，`pluginId` 由系统分配，不与官方包重名。
- dsh-boot 经 profile 的生成 overlay（`insert:` 语法）注入，只进 DSH.app 启动的 web profile。

## 当前插件

| 插件 | 说明 |
|---|---|
| `dsh-app-hub` | 设置 → App 页（DSH.app 生成/重建、本地源码运行时路径/版本/commit） |
| `hang-plugins` | 设置 → Hang 的插件管理器（同步仓库、列出插件、启用引导） |
| `quota-monitor` | 侧边栏底部用量/余额监视（OpenCode Go 订阅 + DeepSeek 官方余额，按当前模型 provider 匹配） |

## 通过 CI 发布 DSH.app（GitHub Actions）

`.github/workflows/build-dsh-app.yml` 在 macos runner 上自动构建 DSH.app 并打包 zip：

- **手动触发**：Actions → Build DSH.app → Run workflow，填版本号（如 `0.1.0`）→ 自动打 tag `v0.1.0` 并发布 Release；留空则只上传 artifact（测试用）。
- **打 tag**：`git tag v0.1.0 && git push origin v0.1.0` → 自动构建并发布到该 tag 的 Release。
- 下载地址：仓库 Releases 页（如 https://github.com/hanger-source/dsh-plugins/releases ）。
- **首次打开**：因 ad-hoc 签名，需右键 DSH.app → 打开（Gatekeeper 拦一次）。
- **运行前提**：本机已有完成构建的 `~/projects/deepseek-harness` checkout，或启动 App 时设置 `DSH_SOURCE_ROOT`。

## 手动启用 / 更新插件

```bash
# 同步（拉到最新）
git -C ~/.dsh/hang-plugins pull

# 手动启用某个插件（一般不需要——App 启动时 dsh-boot 已自动启用全部 UI 插件）
curl 'http://127.0.0.1:3080/api/dsh-plugins/enable?key=<插件key>'

# 新增 / 更新插件：把最新源码写入 packages/<name>/ 的两个文件，然后
git -C ~/.dsh/hang-plugins add -A && git -C ~/.dsh/hang-plugins commit -m "update: <name>" && git -C ~/.dsh/hang-plugins push
```
