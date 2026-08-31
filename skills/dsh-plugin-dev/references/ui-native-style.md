# 参考：插件 UI 原生风格控件

> 被 `SKILL.md` 引用。给 dsh 动态插件写 UI（设置页、浮条、按钮）前必读。

## 铁律
1. 颜色一律用 dsh 主题变量（`--dsw-alias-*` / `--dsw-specific-*`）；禁止自造色值、禁止 color-mix/currentColor 灰色块（用户明确否过）。
2. 样式带私有前缀（如 `.dsh-`），不写全局选择器，不碰 dsh 布局。
3. 浅深主题自适应（含"跟随系统"），全部走变量。
4. 按钮 = 原生胶囊淡底，不做实心大色块。
5. React children 用数组传元素，禁止 `"字符串" + <ReactElement>`（渲染成 `[object Object]`）。

## 变量清单（实测可用）
| 用途 | 变量 |
| --- | --- |
| 按钮背景/ hover | `transparent` / `var(--dsw-alias-interactive-bg-hover)` |
| 按钮边框 | `var(--dsw-alias-border-l2)` |
| 按钮文字 | `var(--dsw-alias-label-primary)` |
| 按钮圆角/内边距 | 胶囊 `999px` / `5px 14px` |
| 主按钮（主操作） | `var(--dsw-alias-button-primary-fill)` + `var(--dsw-alias-label-primary-foreground)` |
| 卡片边框/背景 | `var(--dsw-alias-border-l2)` / `var(--dsw-alias-bg-overlay)` |
| 代码块背景 | `var(--dsw-alias-bg-layer-1)` |
| 成功/警告/错误 | `state-success-primary` / `state-warn-primary` / `state-error-primary` |
| 弱化文字 | `opacity: .6` |

## 已验证按钮
```css
.dsh-app-btn {
  appearance: none; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 999px;
  padding: 5px 14px; font-size: 13px; line-height: 1.4;
}
.dsh-app-btn:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-app-btn:disabled { opacity: .55; cursor: default; }
```

## 参考实现
`apps/dsh/runtime/client/client.js` 的设置卡片、胶囊按钮、状态徽章与主题变量用法。
