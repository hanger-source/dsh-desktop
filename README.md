# dsh-plugins — Hang 的插件与 DSH.app 启动链路

本仓库统一管理 Hang 的插件（每个包存一份**最新源码**，更新就地覆盖，历史交给 git），
以及 DSH.app 原生壳的完整启动链路（App 拉起服务 → bootstrap → 插件自动启用 → 退出关闭）。

## 链路总览（打开 DSH.app 之后发生的事）

1. **DSH.app（Swift 壳）** 先显示窗口并检查本机是否装了正式发布的全局 `dsh`；没有则在窗口中显示安装阶段并执行 `npm install -g @deepseek-ai/dsh@latest`。安装失败直接显示 `install.log` 的错误，不打开空白 WKWebView。
2. App 等待内置 `bootstrap.sh` 完成：clone/pull 本仓库到 `~/.dsh/hang-plugins`、同步技能；失败直接显示 `bootstrap.log`，不继续启动旧副本。
3. App 根据当前 `DSH_HOME` 生成含 dsh-boot 绝对路径的运行时 overlay，再以正式全局 `dsh --profile web --patch <generated-overlay> --no-open` 拉起服务。模板 `web-boot.yml`：
   - `openBrowser: false`（`--no-open` 在 `--profile` 模式下会被 dsh CLI 忽略，必须从配置层关，否则每次启动弹浏览器）；
   - `insert:` 注入 **dsh-boot** 宿主引导插件。
4. **dsh-boot 插件** 监听 `agent/created`，自动把 `packages/` 下带 UI 的插件 define + run 启用（幂等：每个包进程内只启用一次，多次 agent/created 不重复定义）：
   - `dsh-app-hub`（设置 → App 页 + 左下角更新条）
   - `hang-plugins`（设置 → Hang 的插件管理器）
   - `quota-monitor`（侧边栏底部用量/余额）
5. dsh 输出带 token 的启动 URL 后，App 才把 WKWebView 导向真实页面。**⌘Q 退出**只 `SIGTERM` App 自己持有的 dsh 子进程；若 3080 已被外部进程占用，App 明确报错，不接管也不杀掉它。dsh-boot 同时监控 `DSH_PARENT_PID`，App 被强杀后服务也会退出。

## 目录结构

```
bootstrap.sh                # App 后台执行的冷启动引导：拉仓库 + 同步技能 + 调 install.sh
install.sh                  # 构建/更新 DSH.app 壳 + 安装技能（不再安装 agent-preset）
launch-web.sh               # 手动启动正式全局 dsh，并生成同一份运行时 overlay
overlays/web/web-boot.yml   # App 专属 overlay 模板：openBrowser:false + insert 注入 dsh-boot
overlays/web/plugins/dsh-boot.js  # dsh-boot：agent/created 自动启用 UI 插件 + /api/dsh-plugins/enable 端点
packages/<name>/            # 每个插件：code.host.js / code.client.js / README.md（最新版一份）
  ├── dsh-app-hub/          # 设置 → App 页（生成壳、版本、更新 dsh、重启服务）+ 左下角更新条；assets/DSHApp/ 持壳源码与构建脚本
  ├── hang-plugins/         # 设置 → Hang 的插件管理器
  └── quota-monitor/        # 侧边栏底部用量/余额监视
skills/                     # 仓库自带技能（dsh-plugin-install / dsh-plugin-dev 等），bootstrap 同步到 ~/.dsh/skills/
```

## 与官方的关系（无冲突）

- 官方部署目录：`/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/`，升级整目录替换。
- 本仓库本机副本：`~/.dsh/hang-plugins`（用户数据目录，官方升级不触碰）。
- 插件以动态会话插件运行，`pluginId` 由系统分配，不与官方包重名。
- dsh-boot 经 profile 的 `--patch overlay`（`insert:` 语法）注入，只进本机 web profile，不改官方安装。

## 当前插件

| 插件 | 说明 |
|---|---|
| `dsh-app-hub` | 设置 → App 页（DSH.app 生成/重建、版本检查、更新 dsh、重启服务）+ 左下角新版本浮条 |
| `hang-plugins` | 设置 → Hang 的插件管理器（同步仓库、列出插件、启用引导） |
| `quota-monitor` | 侧边栏底部用量/余额监视（OpenCode Go 订阅 + DeepSeek 官方余额，按当前模型 provider 匹配） |

## 通过 CI 发布 DSH.app（GitHub Actions）

`.github/workflows/build-dsh-app.yml` 在 macos runner 上自动构建 DSH.app 并打包 zip：

- **手动触发**：Actions → Build DSH.app → Run workflow，填版本号（如 `0.1.0`）→ 自动打 tag `v0.1.0` 并发布 Release；留空则只上传 artifact（测试用）。
- **打 tag**：`git tag v0.1.0 && git push origin v0.1.0` → 自动构建并发布到该 tag 的 Release。
- 下载地址：仓库 Releases 页（如 https://github.com/hanger-source/dsh-plugins/releases ）。
- **首次打开**：因 ad-hoc 签名，需右键 DSH.app → 打开（Gatekeeper 拦一次）。

## 手动启用 / 更新插件

```bash
# 同步（拉到最新）
git -C ~/.dsh/hang-plugins pull

# 手动启用某个插件（一般不需要——App 启动时 dsh-boot 已自动启用全部 UI 插件）
curl 'http://127.0.0.1:3080/api/dsh-plugins/enable?key=<插件key>'

# 新增 / 更新插件：把最新源码写入 packages/<name>/ 的两个文件，然后
git -C ~/.dsh/hang-plugins add -A && git -C ~/.dsh/hang-plugins commit -m "update: <name>" && git -C ~/.dsh/hang-plugins push
```
