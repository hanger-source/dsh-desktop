---
name: dsh-plugin-install
description: 冷启动/批量启用 Hang 的插件，并从仓库自动安装技能。新环境（无任何插件）或用户说"启用我的插件/把所有插件装上/装技能"时使用：从 ~/.dsh/hang-plugins 仓库读取 packages/*（逐个 define + run 激活）、skills/*（拷贝到用户技能目录）。
---

# 安装 Hang 插件与技能（冷启动 / 批量）

仓库本机副本：`~/.dsh/hang-plugins`（GitHub: hanger-source/dsh-plugins）。
结构：
- `packages/<key>/`：插件源码（`code.host.js` + `code.client.js` + `meta.json`）——开发/修改插件见 `dsh-plugin-dev` 技能。
- `skills/<key>/`：技能目录（`SKILL.md` + `references/`）。

## 一、安装技能（仓库 skills/ → 用户技能目录）

1. 确保仓库就绪（见"二、确保仓库就绪"）。
2. 把 `~/.dsh/hang-plugins/skills/<key>/` **整目录**拷贝到 `~/.dsh/skills/<key>/`（技能发现根 = 工作区 `.dsh/skills`，本项目即 `~/.dsh/skills`）——已存在则幂等跳过。
   > 仓库根 `install.sh` 会自动执行本步骤。

## 二、启用插件（packages/ → define + run）

1. **确保仓库就绪**：`~/.dsh/hang-plugins/.git` 存在则 `git -C ~/.dsh/hang-plugins pull`；否则 `git clone https://github.com/hanger-source/dsh-plugins.git ~/.dsh/hang-plugins`（如已跑过 `install.sh` 则跳过）。
2. **逐个启用 packages/**：
   - 读 `packages/<key>/meta.json`，跳过 `self: true`。
   - `cordis_inspect_self` 查本会话是否已有同前缀实例（pluginId 以 `matchPrefix` 开头）：运行中 → 跳过；停止 → `cordis_run` 重启其 currentPackageId；无 → `cordis_define`（kind new，idPrefix=meta.idPrefix，code.host/code.client 用文件全文）→ `cordis_run`（run）→ 有批准请求请用户允许。
3. **验证**：`cordis_inspect_self` 确认 running；带 UI 的查 Slot occupants。

## 相关技能
- 写/改插件 → `dsh-plugin-dev`（含 UI 原生风格、踩坑参考）。
