# dsh-plugins — Hang 的插件

本仓库统一管理 Hang 的所有插件，每个插件存一份**最新源码**（更新就地覆盖，历史交给 git）。

## 与官方的关系（无冲突）

- 官方部署目录：`/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/`，升级整目录替换。
- 本仓库本机副本：`~/.dsh/hang-plugins`（用户数据目录，官方升级不触碰）。
- 插件以动态会话插件运行，`pluginId` 由系统分配，不与官方包重名。

## 结构

```
packages/<name>/
├── code.host.js    # host 半源码（cordis_define 的 code.host 函数体）
├── code.client.js  # client 半源码（cordis_define 的 code.client 函数体）
└── README.md       # 功能、数据源、重放说明
skills/dsh-plugin-install/   # 安装 Skill：教 Agent 如何从本仓库启用/更新插件
```

## 使用

```bash
# 同步（拉到最新）
git -C ~/.dsh/hang-plugins pull

# 启用某个插件
# 对 Agent 说：启用 <name>。Agent 会加载 dsh-plugin-install Skill，
# 读 packages/<name>/ 的源码与 README，用 cordis_define + cordis_run 在当前会话重建并激活。

# 新增 / 更新插件
# 把最新版源码写入 packages/<name>/ 的两个文件，然后：
git -C ~/.dsh/hang-plugins add -A && git -C ~/.dsh/hang-plugins commit -m "update: <name>" && git -C ~/.dsh/hang-plugins push
```

## 当前插件

| 插件 | 说明 |
|---|---|
| `quota-monitor` | 侧边栏底部用量/余额监视（OpenCode Go 订阅用量 + DeepSeek 官方余额） |
| `hang-plugins` | 本仓库的 UI 管理器（设置页「Hang 的插件」：同步仓库、列出插件、启用引导） |