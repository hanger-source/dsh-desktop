---
name: dsh-ui-native-style
description: 给 dsh 动态插件写 UI（设置页、浮条、按钮）时，控件必须采用 dsh 原生样式：用 dsh 主题变量（--dsw-alias-* / --dsw-specific-*），不自造颜色/灰色块，浅深主题自适应，且不影响 dsh 布局。写任何插件 UI 前先读本 skill。
---

# dsh 插件 UI：原生风格控件

开发 dsh 动态插件（settings.section / shell.overlay / 任意页面 UI）时的控件样式铁律。来源：dsh-app-hub 插件多轮实际打磨后的结论。

## 铁律

1. **只有 dsh 主题变量能当颜色**：背景/边框/文字一律用 `var(--dsw-alias-*)` / `var(--dsw-specific-*)`，**禁止自造色值、禁止 color-mix/currentColor 灰色块**（用户明确否过）。
2. **不变更 dsh 布局**：插件样式必须带私人前缀（如 `.dsh-app-`），不写全局选择器（body/通用 class），不碰 dsh 自己的元素。
3. **浅深自适应**：全部走变量，页面浅色主题自动浅、深色主题自动深（含"跟随系统"）。
4. **按钮风格 = dsh 原生胶囊淡底**（见下），不做实心大色块。
5. **React children 用数组传元素**，禁止 `'字符串' + <ReactElement>`（会渲染成 `[object Object]`）。

## 变量清单（已在 dsh 页面实测可用）

| 用途 | 变量 |
| --- | --- |
| 按钮背景（常态） | `transparent`（dsh 侧边栏选项风格：无底） |
| 按钮背景（hover） | `var(--dsw-alias-interactive-bg-hover)` |
| 按钮边框 | `var(--dsw-alias-border-l2)`（细） |
| 按钮文字 | `var(--dsw-alias-label-primary)` |
| 按钮圆角 | 胶囊 `999px`，内边距 `5px 14px` |
| 主按钮（如有主操作） | `var(--dsw-alias-button-primary-fill)` + `var(--dsw-alias-label-primary-foreground)` |
| 卡片边框 | `var(--dsw-alias-border-l2)`，圆角 12px，padding 14/16 |
| 卡片/浮条背景 | `var(--dsw-alias-bg-overlay)` 或 `var(--dsw-alias-bg-layer-1)` |
| 代码块背景 | `var(--dsw-alias-bg-layer-1)` |
| 成功/警告/错误 | `var(--dsw-alias-state-success-primary)` / `state-warn-primary` / `state-error-primary` |
| 弱化文字 | `opacity: .6`（不用改颜色） |

## 已验证按钮实现（React.createElement 场景）

```css
.dsh-app-btn {
  appearance: none; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center; /* 垂直居中 */
  background: transparent;
  color: var(--dsw-alias-label-primary);
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 999px;
  padding: 5px 14px; font-size: 13px; line-height: 1.4;
}
.dsh-app-btn:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-app-btn:disabled { opacity: .55; cursor: default; }
```

- 按钮内容用 `inline-flex + align-items/justify-content: center` 保证垂直居中。
- 状态文字跟在版本号后同一行用内联小字（`（已是最新）/（有新版本）`），不做胶囊徽章独占。

## React children 陷阱

```js
// 错：字符串拼接 React 元素 → "[object Object]"
h('span', null, '服务端口 ' + a.port + ' ' + (up ? h('span', {}, '运行中') : h('span', {}, '未运行')))
// 对：children 用数组
h('span', null, ['服务端口 ' + a.port + ' ', up ? h('span', { className: c1 }, '运行中') : h('span', { className: c2 }, '未运行')])
```

## 完整参考实现

`~/.dsh/hang-plugins/packages/dsh-app-hub/code.client.js` 的 `styles.insert` 段 + AppSection，即最终打磨版（含卡片/浮条/按钮全变量化）。