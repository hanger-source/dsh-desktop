---
name: dsh-plugin-install
description: 冷启动/批量启用 Hang 的插件，并从仓库自动安装技能。新环境（无任何插件）或用户说"启用我的插件/把所有插件装上/装技能"时使用：从 ~/.dsh/hang-plugins 仓库读取 packages/*（逐个 define + run 激活）、skills/*（拷贝到用户技能目录）。
---

# Hang 的插件与技能（冷启动 / 批量安装）

仓库本机副本：`~/.dsh/hang-plugins`（GitHub: hanger-source/dsh-plugins）。
结构：
- `packages/<key>/`：插件最新源码——`code.host.js` + `code.client.js`（全文即 `cordis_define` 的 host/client 函数体）+ `meta.json`（name / purpose / idPrefix / matchPrefix / self）。
- `skills/<key>/SKILL.md` + `skills/<key>/references/*.md`：技能主文档与分文档（见下方"参考文献"）。

## 一、安装技能（仓库 skills/ → 用户技能目录）

1. `git -C ~/.dsh/hang-plugins pull`（或 clone，见"确保仓库就绪"）。
2. 把 `~/.dsh/hang-plugins/skills/<key>/` **整个目录**（SKILL.md + references/）拷贝到 `~/.dsh/skills/<key>/`（技能发现根 = 工作区 `.dsh/skills`，本项目即 `~/.dsh/skills`）。
3. 验证：技能名出现在可用技能目录；已装跳过（幂等）。
   > 仓库根 `install.sh` 也会自动执行本步骤。

## 二、启用插件（packages/ → define + run）

1. **确保仓库就绪**：`~/.dsh/hang-plugins/.git` 存在则 `git -C ~/.dsh/hang-plugins pull`；否则 `git clone https://github.com/hanger-source/dsh-plugins.git ~/.dsh/hang-plugins`（如已跑过 `install.sh` 则跳过）。
2. **逐个启用 packages/**：
   - 读 `packages/<key>/meta.json`，跳过 `self: true`。
   - `cordis_inspect_self` 查本会话是否已有同前缀实例（pluginId 以 `matchPrefix` 开头）：
     - 运行中 → 跳过；停止 → `cordis_run` 重启其 currentPackageId；
     - 无 → `cordis_define`（kind new，idPrefix=meta.idPrefix，code.host/code.client 用文件全文）→ `cordis_run`（run）→ 有批准请求请用户允许。
3. **验证**：`cordis_inspect_self` 确认 running；带 UI 的查 Slot occupants。

## 三、必读参考文献（写 UI / 排障前）

- **UI 原生风格控件**：`references/ui-native-style.md` —— 颜色用 dsh 主题变量、胶囊按钮、React children 陷阱（写任何插件 UI 前必读）。
- **踩坑记录**：`references/troubleshooting.md` —— 壳构建 `\n` 字面、主题双监听、YAML 缩进、npm EPERM、app-region 限制、重启丢插件（改壳/插件前先扫一眼）。

## 约定
- 只维护最新一版源码于仓库；改代码后覆盖 `packages/<key>/` 两文件并 `git add -A && git commit -m "update: <key>" && git push`。
- 技能改动：改主 SKILL.md 或 references/ 后同样入库提交；生效目录更新由 `install.sh` 或本节"一、安装技能"完成。
