---
name: dsh-plugin-dev
description: 开发/更新 Hang 插件（packages/* 的 code.host.js / code.client.js）时的规范与必读参考：目录结构、动态插件特性、UI 原生风格控件、踩坑记录、入库约定。用户说"开发/写/改/新增一个 Hang 插件"时使用。
---

# 开发 Hang 插件

仓库：`~/.dsh/hang-plugins`（GitHub: hanger-source/dsh-plugins）。本技能管"怎么写插件"；"怎么把插件装上/启用"走 `dsh-plugin-install` 技能。

## 插件包结构（packages/<key>/）

- `code.host.js`：Host 半边，全文即 `cordis_define` 的 `code.host` 函数体（`return { apply(ctx){...} }`）。
- `code.client.js`：Client 半边，全文即 `code.client` 函数体。
- `meta.json`：name / purpose / idPrefix（3-6 小写字母前缀）/ matchPrefix / self（管理器标记）。

## 动态插件特性（务必知晓）

- 进程内临时：dsh 重启后插件即失，需重新启用（`dsh-plugin-install`）。
- `code.host/code.client` 是纯 JS 函数体：无 import/require/TS/JSX；Host 无 process/Buffer，用 `ctx.get('service')` 取服务；Client 用 React.createElement + `host.call` 调 Host。
- 生命周期：一切副作用交给 ctx.effect / 服务返回的 disposer，stop/update 后自动清理。
- 授权：Client 半边首次 run 需要用户批准；插件归属当前会话。

## 必读参考（写代码前）

- `references/ui-native-style.md`：**UI 原生风格控件**——颜色只用 dsh 主题变量（`--dsw-alias-*`/`--dsw-specific-*`），胶囊按钮、React children 陷阱（写任何 UI 前必读）。
- `references/troubleshooting.md`：**踩坑记录**——壳构建 `\n` 字面、dsh 主题双监听、settings.yaml 缩进、npm EPERM、app-region 限制、重启丢插件（改壳/排障前先扫一眼）。

## 入库约定

改好/新增插件后：覆盖 `packages/<key>/` 对应文件，`git -C ~/.dsh/hang-plugins add -A && git commit -m "update: <key>" && git push`。
（壳类资产如 `assets/DSHApp/` 属于本仓库 `packages/dsh-app-hub/assets/`，改动同步该处。）
