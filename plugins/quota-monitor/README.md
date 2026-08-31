# quota-monitor

侧边栏底部用量/余额监视器（host+client 配对插件），App 启动时由 dsh-boot 自动启用。

## 功能

- 根据当前会话 `modelDirectories.directoryFor(sessionId).store.current.provider` 匹配数据源；provider 命名差异由 `SOURCES` 别名覆盖（如 `deepseek-official` → DeepSeek 官方）：
  - **OpenCode Go（订阅型）**：`小时 / 本周 / 本月` 三档用量百分比 + 迷你进度条 + 剩余倒计时
  - **DeepSeek 官方（充值型）**：`余额 ¥xx.xx`（原样精度）
- UI：侧边栏底部「插件 / 用量 / 设置」三行中的用量面板；名称加粗与更新时间同行；OpenCode Go 与 DeepSeek 两个数据源在 host 启动时预热并按 provider 共享缓存。当前 provider 每 30 秒刷新，非当前 provider 最多 5 分钟刷新一次；切换立即显示最近快照并异步拉新，并发刷新合并成一次请求。

## 数据源

| 数据源 | 密钥 ref（credentials 服务） | 接口 |
|---|---|---|
| OpenCode Go | `OPENCODE_API_KEY` | `GET https://opencode.ai/zen/go/v1/usage` |
| DeepSeek 官方 | `DEEPSEEK_API_KEY` | `GET https://api.deepseek.com/user/balance` |

百分比为官方接口整数口径（公开接口无小数精度）；金额原样小数。

## 手动启用（一般不需要——dsh-boot 已自动拉起；以下为手动 define/run 步骤）

1. 读取本目录 `code.host.js` 全文，作为 `cordis_define` 的 `code.host` 函数体。
2. 读取本目录 `code.client.js` 全文，作为 `cordis_define` 的 `code.client` 函数体。
3. `cordis_define`：kind `new`，idPrefix `quota`，name `model-quota-monitor`。
4. `cordis_run`（mode `run`）激活；若出现批准请求，在界面上允许。
5. 展开侧边栏（非 56px 窄栏）即可看到用量面板。

## 更新约定

仓库只保存**当前最新版一份源码**（更新代码时直接覆盖本目录两个文件），不保留历史版本；git 自行管理历史。
