---
name: dsh-plugin-dev
description: 开发/更新 Hang 插件（plugins/* 的 code.host.js / code.client.js）时的规范与必读参考：目录结构、动态插件特性、UI 原生风格控件、踩坑记录、入库约定。用户说"开发/写/改/新增一个 Hang 插件"时使用。
---

# 开发 Hang 插件

仓库：`~/.dsh/dsh-desktop`（产品名 DSH Desktop）。本技能只管 `plugins/` 下真正的 Hang 动态插件；App 自带 runtime 位于 DSH.app 内，不按动态插件开发。

## 插件包结构（plugins/<key>/）

- `code.host.js`：Host 半边，全文即 `cordis_define` 的 `code.host` 函数体（`return { apply(ctx){...} }`）。
- `code.client.js`：Client 半边，全文即 `code.client` 函数体。
- `meta.json`：name / purpose / idPrefix（3-6 小写字母前缀）/ matchPrefix / self（管理器标记）。

## 动态插件特性（务必知晓）

- 动态运行实例属于当前 dsh 进程；DSH.app 静态 runtime 会在页面刷新、dsh 重启和 App 重启后按稳定 Plugin identity 自动恢复。
- `code.host/code.client` 是纯 JS 函数体：无 import/require/TS/JSX；Host 无 process/Buffer，用 `ctx.get('service')` 取服务；Client 用 React.createElement + `host.call` 调 Host。
- 生命周期：一切副作用交给 ctx.effect / 服务返回的 disposer，stop/update 后自动清理。
- 授权：Client 半边首次 run 需要用户批准；插件归属当前会话。

## 必读参考（写代码前）

- `references/ui-native-style.md`：**UI 原生风格控件**——颜色只用 dsh 主题变量（`--dsw-alias-*`/`--dsw-specific-*`），胶囊按钮、React children 陷阱（写任何 UI 前必读）。
- `references/troubleshooting.md`：**踩坑记录**——壳构建 `\n` 字面、dsh 主题双监听、settings.yaml 缩进、npm EPERM、app-region 限制、重启丢插件（改壳/排障前先扫一眼）。

## 入库约定

改好/新增插件后：覆盖 `plugins/<key>/` 对应文件并提交。发布到仓库后，在 App 的“Hang 的插件”页点“同步并重载”即可让当前页面执行 Package update；不需要重启 App。

App 壳或 App 设置属于 `apps/dsh/`，必须随 App Release 发布，禁止放进 `plugins/`。
